import type { NotifyKind, Task } from '@task-tracker/shared'
import { prisma } from '../db'
import { env } from '../env'
import { hub } from '../events/hub'
import { sendPushToUser } from './push'
import { cycleKeyFor } from './recurrence'
import { serializeNotification } from './serialize'
import { isWithinQuietHours } from './time'

/**
 * Notification delivery.
 *
 * The one thing that has to be right here is idempotency. The scheduler runs
 * every couple of minutes and re-evaluates the same tasks each time, so without
 * a ledger every due-soon reminder would be re-sent on every tick — the single
 * most likely bug in the whole feature.
 *
 * The ledger is `NotifyLog`, unique on (user, task, kind, cycleKey). The cycle
 * key is what keeps the fix from introducing a second bug: keyed on only
 * (user, task, kind), a recurring task's reminder would fire once and then never
 * again for the rest of the task's life.
 */

const PRISMA_UNIQUE_VIOLATION = 'P2002'

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { code?: string }).code === PRISMA_UNIQUE_VIOLATION

type NotifyTarget = {
  userId: string
  workspaceId: string
  taskId: string
  taskName: string
  kind: NotifyKind
  cycleKey: string
  actorId: string | null
}

const PREFERENCE_FLAG: Record<
  NotifyKind,
  'onAssigned' | 'onDueSoon' | 'onOverdue' | 'onCompletedByOther' | 'onCommented'
> = {
  assigned: 'onAssigned',
  due_soon: 'onDueSoon',
  overdue: 'onOverdue',
  completed_by_other: 'onCompletedByOther',
  commented: 'onCommented',
}

const COPY: Record<NotifyKind, (taskName: string) => { title: string; body: string }> = {
  assigned: (taskName) => ({ title: 'New chore for you', body: taskName }),
  due_soon: (taskName) => ({ title: 'Due soon', body: taskName }),
  overdue: (taskName) => ({ title: 'Overdue', body: taskName }),
  completed_by_other: (taskName) => ({
    title: 'Someone got there first',
    body: `${taskName} is done`,
  }),
  commented: (taskName) => ({ title: 'New note', body: taskName }),
}

/**
 * Record, then fan out.
 *
 * Two layers, and both are needed. The cheap existence check short-circuits the
 * overwhelmingly common case — the scheduler re-examining a task it has already
 * reminded about — without attempting a doomed INSERT. The insert is still
 * wrapped, because a check alone loses a race between two overlapping ticks.
 *
 * The check is not merely an optimisation. Relying on the caught constraint
 * violation alone meant Prisma logged the failed INSERT at `error` level on every
 * single tick, which made a normal control-flow path look like a fault and buried
 * everything else in the log.
 */
async function deliver(target: NotifyTarget): Promise<boolean> {
  const preference = await prisma.notifyPreference.findUnique({
    where: { userId: target.userId },
    select: {
      enabled: true,
      onAssigned: true,
      onDueSoon: true,
      onOverdue: true,
      onCompletedByOther: true,
      onCommented: true,
      quietFrom: true,
      quietTo: true,
    },
  })

  // No row yet means the user has never visited settings. In-app still applies;
  // push cannot, because they have no subscription either.
  if (preference && !preference[PREFERENCE_FLAG[target.kind]]) return false

  // Already delivered for this cycle: nothing to do, and nothing to log about.
  const alreadySent = await prisma.notifyLog.findFirst({
    where: {
      userId: target.userId,
      taskId: target.taskId,
      kind: target.kind,
      cycleKey: target.cycleKey,
    },
    select: { id: true },
  })
  if (alreadySent) return false

  let logRow: { id: string } | null = null
  try {
    logRow = await prisma.notifyLog.create({
      data: {
        userId: target.userId,
        workspaceId: target.workspaceId,
        taskId: target.taskId,
        kind: target.kind,
        cycleKey: target.cycleKey,
        actorId: target.actorId,
      },
      select: { id: true },
    })
  } catch (error) {
    if (isUniqueViolation(error)) return false
    throw error
  }

  const full = await prisma.notifyLog.findUniqueOrThrow({
    where: { id: logRow.id },
    select: {
      id: true,
      workspaceId: true,
      kind: true,
      taskId: true,
      sentAt: true,
      readAt: true,
      task: { select: { name: true } },
      actor: { select: { id: true, name: true, email: true, avatarPath: true } },
    },
  })

  // In-app first: it works even for a user who refused push permission.
  hub.publishToUsers({
    workspaceId: target.workspaceId,
    userIds: [target.userId],
    type: 'notification',
    data: serializeNotification(full),
    actorId: target.actorId,
  })

  if (!preference?.enabled) return true

  const workspace = await prisma.workspace.findUnique({
    where: { id: target.workspaceId },
    select: { timezone: true },
  })

  // Quiet hours suppress push, never the in-app feed.
  if (
    workspace &&
    isWithinQuietHours(preference.quietFrom, preference.quietTo, workspace.timezone)
  ) {
    return true
  }

  const copy = COPY[target.kind](target.taskName)
  await sendPushToUser(target.userId, {
    title: copy.title,
    body: copy.body,
    // A real client route, and the same one `taskPath` builds in the web app's
    // `lib/share.ts` — the two cannot import each other, so they agree by hand and
    // both say so. This used to read `/workspaces/:id/tasks/:taskId`, which matches
    // nothing the router serves, so every push tap landed on the 404 page — a silent
    // failure, because nothing on the server can observe where a notification click
    // goes. `?task=` pins that task above the list and opens it.
    url: `${env.APP_ORIGIN}/w/${target.workspaceId}/tasks?task=${target.taskId}`,
    tag: `${target.kind}:${target.taskId}`,
  })

  return true
}

export async function notifyAssigned(
  task: Task,
  userIds: readonly string[],
  actorId: string,
): Promise<void> {
  await Promise.all(
    userIds.map((userId) =>
      deliver({
        userId,
        workspaceId: task.workspaceId,
        taskId: task.id,
        taskName: task.name,
        kind: 'assigned',
        // An assignment is a one-off act, so the cycle is the moment it happened.
        cycleKey: new Date().toISOString(),
        actorId,
      }),
    ),
  )
}

export async function notifyCompletedByOther(
  task: Task,
  userIds: readonly string[],
  actorId: string,
  completedAt: Date,
): Promise<void> {
  await Promise.all(
    userIds.map((userId) =>
      deliver({
        userId,
        workspaceId: task.workspaceId,
        taskId: task.id,
        taskName: task.name,
        kind: 'completed_by_other',
        cycleKey: completedAt.toISOString(),
        actorId,
      }),
    ),
  )
}

/**
 * Someone wrote a note on a task.
 *
 * `cycleKey` is the comment's own id, which makes this the cleanest fit in the
 * ledger of any event here: every comment is genuinely its own occurrence, so the
 * unique constraint stops a retry double-sending without ever suppressing the next
 * note. Contrast `notifyAssigned`, which has to use the wall clock because an
 * assignment has no such id.
 *
 * Callers decide who counts as a participant; nothing here fans out to the whole
 * household.
 */
export async function notifyCommented(
  task: { id: string; workspaceId: string; name: string },
  userIds: readonly string[],
  actorId: string,
  commentId: string,
): Promise<void> {
  await Promise.all(
    userIds.map((userId) =>
      deliver({
        userId,
        workspaceId: task.workspaceId,
        taskId: task.id,
        taskName: task.name,
        kind: 'commented',
        cycleKey: commentId,
        actorId,
      }),
    ),
  )
}

/** Called by the scheduler tick for `due_soon` and `overdue`. */
export async function notifyDeadline(
  task: { id: string; workspaceId: string; name: string; dueDate: Date | null; updatedAt: Date },
  userIds: readonly string[],
  kind: 'due_soon' | 'overdue',
): Promise<number> {
  const cycleKey = cycleKeyFor(task)
  const results = await Promise.all(
    userIds.map((userId) =>
      deliver({
        userId,
        workspaceId: task.workspaceId,
        taskId: task.id,
        taskName: task.name,
        kind,
        cycleKey,
        actorId: null,
      }),
    ),
  )
  return results.filter(Boolean).length
}

export async function ensurePreference(userId: string): Promise<void> {
  await prisma.notifyPreference.upsert({
    where: { userId },
    create: { userId },
    update: {},
  })
}
