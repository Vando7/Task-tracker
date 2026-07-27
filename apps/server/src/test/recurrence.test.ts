import { describe, expect, it } from 'vitest'
import { prisma } from '../db'
import { runDeadlineNotifications } from '../jobs/scheduler'
import { nextDueDate, nextInRotation } from '../services/recurrence'
import { addInterval, isWithinQuietHours, startOfDayInZone } from '../services/time'
import { addMemberTo, getApp, makeUser, makeWorkspace } from './helpers'

describe('recurrence anchoring', () => {
  const spec = { every: 2, unit: 'week' as const, anchor: 'completion' as const }

  it('anchors to the completion by default, pushing the schedule out', () => {
    // Due Sunday the 1st, actually done Thursday the 5th.
    const next = nextDueDate({
      spec,
      previousDueDate: new Date('2026-03-01T09:00:00Z'),
      completedAt: new Date('2026-03-05T18:30:00Z'),
      timeZone: 'UTC',
    })

    // 5 March + 14 days = 19 March, measured from when it was done.
    expect(next.toISOString()).toBe('2026-03-19T18:30:00.000Z')
  })

  it('anchors to the previous due date when asked, holding the cadence', () => {
    const next = nextDueDate({
      spec: { ...spec, anchor: 'dueDate' },
      previousDueDate: new Date('2026-03-01T09:00:00Z'),
      completedAt: new Date('2026-03-05T18:30:00Z'),
      timeZone: 'UTC',
    })

    // 1 March + 14 days = 15 March. Still a Sunday, still 09:00.
    expect(next.toISOString()).toBe('2026-03-15T09:00:00.000Z')
  })

  it('never hands back an already-overdue date when anchored to the due date', () => {
    // Five weeks late: a single step would land in the past and the task would
    // reappear instantly overdue.
    const next = nextDueDate({
      spec: { ...spec, anchor: 'dueDate' },
      previousDueDate: new Date('2026-03-01T09:00:00Z'),
      completedAt: new Date('2026-04-06T12:00:00Z'),
      timeZone: 'UTC',
    })

    expect(next.getTime()).toBeGreaterThan(new Date('2026-04-06T12:00:00Z').getTime())
    // Cadence preserved: still a multiple of 14 days from the original.
    const days = (next.getTime() - new Date('2026-03-01T09:00:00Z').getTime()) / 86_400_000
    expect(days % 14).toBe(0)
  })

  it('preserves wall-clock time across a DST boundary', () => {
    // Europe/Sofia moves to summer time on 29 March 2026.
    const before = new Date('2026-03-22T07:00:00Z') // 09:00 local
    const after = addInterval(before, 2, 'week', 'Europe/Sofia')

    const localHour = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Sofia',
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(after)

    expect(localHour).toBe('09')
    // Which means the UTC instant shifted by an hour, as it must.
    expect(after.toISOString()).toBe('2026-04-05T06:00:00.000Z')
  })

  it('clamps a month step onto short months', () => {
    const next = addInterval(new Date('2026-01-31T10:00:00Z'), 1, 'month', 'UTC')
    expect(next.toISOString().slice(0, 10)).toBe('2026-02-28')
  })
})

describe('rotation', () => {
  it('advances to the next member and wraps around', () => {
    const members = ['a', 'b', 'c']
    expect(nextInRotation(members, ['a'], 'a')).toBe('b')
    expect(nextInRotation(members, ['c'], 'c')).toBe('a')
  })

  it('falls back to the first member when the pivot is unknown', () => {
    expect(nextInRotation(['a', 'b'], [], null)).toBe('a')
    expect(nextInRotation(['a', 'b'], ['gone'], null)).toBe('a')
  })

  it('returns null when there is nobody to rotate to', () => {
    expect(nextInRotation([], ['a'], 'a')).toBeNull()
  })
})

describe('quiet hours', () => {
  it('handles a range that wraps past midnight', () => {
    const at = (iso: string) => new Date(iso)
    // 22:00 to 07:00 UTC.
    expect(isWithinQuietHours('22:00', '07:00', 'UTC', at('2026-03-01T23:30:00Z'))).toBe(true)
    expect(isWithinQuietHours('22:00', '07:00', 'UTC', at('2026-03-01T03:00:00Z'))).toBe(true)
    expect(isWithinQuietHours('22:00', '07:00', 'UTC', at('2026-03-01T12:00:00Z'))).toBe(false)
  })

  it('is inactive when either end is unset', () => {
    expect(isWithinQuietHours(null, '07:00', 'UTC')).toBe(false)
    expect(isWithinQuietHours('22:00', null, 'UTC')).toBe(false)
  })
})

describe('timezone helpers', () => {
  it('starts the day in the workspace zone, not UTC', () => {
    // 00:30 on 2 March in Sofia is still 22:30 on 1 March in UTC.
    const start = startOfDayInZone(new Date('2026-03-01T22:30:00Z'), 'Europe/Sofia')
    expect(start.toISOString()).toBe('2026-03-01T22:00:00.000Z')
  })
})

describe('completion log and recurrence over HTTP', () => {
  it('records an append-only completion and reschedules a recurring task', async () => {
    const app = await getApp()
    const user = await makeUser('rec@example.com')
    const workspace = await makeWorkspace(user.id, { timezone: 'UTC' })

    const created = await app.inject({
      method: 'POST',
      url: `/api/workspaces/${workspace.id}/tasks`,
      headers: { cookie: user.cookie },
      payload: {
        name: 'Vacuum',
        dueDate: '2026-03-01T09:00:00Z',
        recurrenceEvery: 2,
        recurrenceUnit: 'week',
      },
    })
    const taskId = created.json().id as string

    const completed = await app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/complete`,
      headers: { cookie: user.cookie },
      payload: { completedAt: '2026-03-05T18:30:00Z' },
    })

    const task = completed.json()
    // Back to todo with a new due date, rather than sitting in the done list.
    expect(task.status).toBe('todo')
    expect(task.dueDate).toBe('2026-03-19T18:30:00.000Z')
    expect(task.completionCount).toBe(1)
    expect(task.lastCompletedAt).toBe('2026-03-05T18:30:00.000Z')

    // Complete it again: history accumulates, it is never overwritten. The
    // legacy app kept one `completed_date` and clobbered it every time.
    await app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/complete`,
      headers: { cookie: user.cookie },
      payload: { completedAt: '2026-03-20T08:00:00Z' },
    })

    expect(await prisma.taskCompletion.count({ where: { taskId } })).toBe(2)
  })

  it('marks a one-off task done and leaves the due date alone', async () => {
    const app = await getApp()
    const user = await makeUser('oneoff@example.com')
    const workspace = await makeWorkspace(user.id)

    const created = await app.inject({
      method: 'POST',
      url: `/api/workspaces/${workspace.id}/tasks`,
      headers: { cookie: user.cookie },
      payload: { name: 'Descale the kettle' },
    })
    const taskId = created.json().id as string

    const completed = await app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/complete`,
      headers: { cookie: user.cookie },
      payload: {},
    })

    expect(completed.json().status).toBe('done')
    expect(completed.json().completionCount).toBe(1)
  })

  it('hands a rotating task to the next member on completion', async () => {
    const app = await getApp()
    const owner = await makeUser('rot-owner@example.com')
    const mate = await makeUser('rot-mate@example.com')
    const workspace = await makeWorkspace(owner.id)
    await addMemberTo(workspace.id, mate.id)

    const created = await app.inject({
      method: 'POST',
      url: `/api/workspaces/${workspace.id}/tasks`,
      headers: { cookie: owner.cookie },
      payload: {
        name: 'Bins',
        dueDate: '2026-03-01T09:00:00Z',
        recurrenceEvery: 1,
        recurrenceUnit: 'week',
        rotateAssignees: true,
        assigneeIds: [owner.id],
      },
    })
    const taskId = created.json().id as string

    const completed = await app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/complete`,
      headers: { cookie: owner.cookie },
      payload: {},
    })

    const assignees = completed.json().assignees as Array<{ user: { id: string } }>
    expect(assignees).toHaveLength(1)
    expect(assignees[0]?.user.id).toBe(mate.id)
  })
})

describe('notification idempotency', () => {
  it('sends a reminder once no matter how many ticks run (section 4.3)', async () => {
    const user = await makeUser('sched@example.com')
    const workspace = await makeWorkspace(user.id)

    await prisma.notifyPreference.update({
      where: { userId: user.id },
      data: { enabled: true, dueSoonLeadHours: 48 },
    })

    await prisma.task.create({
      data: {
        workspaceId: workspace.id,
        name: 'Due tomorrow',
        createdById: user.id,
        dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
        assignees: { create: { userId: user.id, assignedById: user.id } },
      },
    })

    const first = await runDeadlineNotifications()
    expect(first.dueSoon).toBe(1)

    // This is the bug the ledger exists to prevent: the scheduler re-evaluates
    // the same task on every tick.
    const second = await runDeadlineNotifications()
    const third = await runDeadlineNotifications()
    expect(second.dueSoon).toBe(0)
    expect(third.dueSoon).toBe(0)

    expect(await prisma.notifyLog.count({ where: { kind: 'due_soon' } })).toBe(1)
  })

  it('reminds again on the next cycle of a recurring task', async () => {
    const user = await makeUser('cycle@example.com')
    const workspace = await makeWorkspace(user.id)

    await prisma.notifyPreference.update({
      where: { userId: user.id },
      data: { enabled: true, dueSoonLeadHours: 48 },
    })

    const task = await prisma.task.create({
      data: {
        workspaceId: workspace.id,
        name: 'Weekly bins',
        createdById: user.id,
        dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
        recurrenceEvery: 1,
        recurrenceUnit: 'week',
        assignees: { create: { userId: user.id, assignedById: user.id } },
      },
      select: { id: true },
    })

    expect((await runDeadlineNotifications()).dueSoon).toBe(1)

    // Next cycle: a new due date means a new cycleKey. Keying the ledger on
    // (user, task, kind) alone would leave this silent forever.
    await prisma.task.update({
      where: { id: task.id },
      data: { dueDate: new Date(Date.now() + 8 * 24 * 60 * 60 * 1000) },
    })
    await prisma.notifyPreference.update({
      where: { userId: user.id },
      data: { dueSoonLeadHours: 336 },
    })

    expect((await runDeadlineNotifications()).dueSoon).toBe(1)
    expect(await prisma.notifyLog.count({ where: { kind: 'due_soon' } })).toBe(2)
  })

  it('notifies every member when a due task is unassigned', async () => {
    const owner = await makeUser('un-owner@example.com')
    const mate = await makeUser('un-mate@example.com')
    const workspace = await makeWorkspace(owner.id)
    await addMemberTo(workspace.id, mate.id)
    await prisma.notifyPreference.create({ data: { userId: mate.id } }).catch(() => {})

    await prisma.task.create({
      data: {
        workspaceId: workspace.id,
        name: 'Whoever gets to it',
        createdById: owner.id,
        dueDate: new Date(Date.now() - 60_000),
      },
    })

    const result = await runDeadlineNotifications()
    expect(result.overdue).toBe(2)
  })

  it('respects a per-event preference toggle', async () => {
    const user = await makeUser('pref@example.com')
    const workspace = await makeWorkspace(user.id)

    await prisma.notifyPreference.update({
      where: { userId: user.id },
      data: { enabled: true, onOverdue: false },
    })

    await prisma.task.create({
      data: {
        workspaceId: workspace.id,
        name: 'Late',
        createdById: user.id,
        dueDate: new Date(Date.now() - 60_000),
        assignees: { create: { userId: user.id, assignedById: user.id } },
      },
    })

    expect((await runDeadlineNotifications()).overdue).toBe(0)
  })
})
