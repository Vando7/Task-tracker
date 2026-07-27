import { DEFAULT_DUE_SOON_LEAD_HOURS } from '@task-tracker/shared'
import { pruneExpiredSessions } from '../auth/session'
import { prisma } from '../db'
import { env } from '../env'
import { notifyDeadline } from '../services/notifications'

/**
 * The whole scheduler: one `setInterval` in the API process.
 *
 * This is the single place where dropping Django/Celery makes the design
 * genuinely simpler rather than just different — no broker, no worker container,
 * no Redis. It is safe precisely because delivery is idempotent: re-running a
 * tick cannot re-send anything, so a missed or doubled tick has no consequence.
 */

const HOUR_MS = 60 * 60 * 1000
/** The largest lead time any user can configure (14 days), used to bound the scan. */
const MAX_LEAD_HOURS = 336

export async function runDeadlineNotifications(now: Date = new Date()): Promise<{
  dueSoon: number
  overdue: number
}> {
  const horizon = new Date(now.getTime() + MAX_LEAD_HOURS * HOUR_MS)

  const tasks = await prisma.task.findMany({
    where: {
      deletedAt: null,
      status: { not: 'done' },
      dueDate: { not: null, lte: horizon },
    },
    select: {
      id: true,
      workspaceId: true,
      name: true,
      dueDate: true,
      updatedAt: true,
      assignees: { select: { userId: true } },
    },
  })

  if (tasks.length === 0) return { dueSoon: 0, overdue: 0 }

  // Recipients are the assignees, or every member when the task is unassigned —
  // "whoever gets to it" still needs telling.
  const workspaceIds = [...new Set(tasks.map((task) => task.workspaceId))]
  const members = await prisma.member.findMany({
    where: { workspaceId: { in: workspaceIds } },
    select: { workspaceId: true, userId: true },
  })

  const membersByWorkspace = new Map<string, string[]>()
  for (const member of members) {
    const list = membersByWorkspace.get(member.workspaceId)
    if (list) list.push(member.userId)
    else membersByWorkspace.set(member.workspaceId, [member.userId])
  }

  const candidateUserIds = [...new Set(members.map((member) => member.userId))]
  const preferences = await prisma.notifyPreference.findMany({
    where: { userId: { in: candidateUserIds } },
    select: { userId: true, dueSoonLeadHours: true },
  })
  const leadByUser = new Map(preferences.map((p) => [p.userId, p.dueSoonLeadHours]))

  let dueSoon = 0
  let overdue = 0

  for (const task of tasks) {
    if (!task.dueDate) continue

    const recipients =
      task.assignees.length > 0
        ? task.assignees.map((assignee) => assignee.userId)
        : (membersByWorkspace.get(task.workspaceId) ?? [])

    if (recipients.length === 0) continue

    const dueAt = task.dueDate.getTime()

    if (dueAt < now.getTime()) {
      overdue += await notifyDeadline(task, recipients, 'overdue')
      continue
    }

    // Lead time is per user, so one task can be "due soon" for one member and
    // still quiet for another.
    const readyFor = recipients.filter((userId) => {
      const lead = leadByUser.get(userId) ?? DEFAULT_DUE_SOON_LEAD_HOURS
      return dueAt - now.getTime() <= lead * HOUR_MS
    })

    if (readyFor.length > 0) {
      dueSoon += await notifyDeadline(task, readyFor, 'due_soon')
    }
  }

  return { dueSoon, overdue }
}

export function startScheduler(): () => void {
  let running = false

  const tick = async (): Promise<void> => {
    // Skip rather than queue: a tick that outlives its interval means the next
    // one has nothing new to do anyway.
    if (running) return
    running = true
    try {
      await pruneExpiredSessions()
      await runDeadlineNotifications()
    } catch (error) {
      console.error('[scheduler] tick failed:', error)
    } finally {
      running = false
    }
  }

  const timer = setInterval(() => void tick(), env.SCHEDULER_INTERVAL_MS)
  // Don't hold the process open on shutdown.
  timer.unref()

  // One tick shortly after boot, so a restart doesn't leave a due reminder
  // waiting for the full interval.
  const initial = setTimeout(() => void tick(), 5_000)
  initial.unref()

  return () => {
    clearInterval(timer)
    clearTimeout(initial)
  }
}
