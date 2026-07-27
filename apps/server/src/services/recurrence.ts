import type { RecurrenceAnchor, RecurrenceUnit } from '@task-tracker/shared'
import { addInterval } from './time'

/**
 * Real recurrence — the biggest functional gap in the legacy app, where
 * "recurring" only meant a human could press a button to reset the task.
 */

export type RecurrenceSpec = {
  every: number
  unit: RecurrenceUnit
  anchor: RecurrenceAnchor
}

export function isRecurring(task: {
  recurrenceEvery: number | null
  recurrenceUnit: string | null
}): boolean {
  return task.recurrenceEvery != null && task.recurrenceUnit != null
}

/**
 * The next due date after a completion.
 *
 * `completion` — "every 2 weeks from when I actually did it". Late completions
 * push the schedule out, and you never owe a backlog of missed cycles. This is
 * the default.
 *
 * `dueDate` — "every other Sunday". The cadence holds no matter when it was
 * actually done. The wrinkle is that a long gap leaves the next date in the
 * past, which would resurrect the task as instantly overdue — so we keep
 * stepping until the result is in the future. That preserves the day-of-week
 * (the whole point of this mode) without handing back an already-late task.
 */
export function nextDueDate(params: {
  spec: RecurrenceSpec
  previousDueDate: Date | null
  completedAt: Date
  timeZone: string
}): Date {
  const { spec, previousDueDate, completedAt, timeZone } = params
  const { every, unit, anchor } = spec

  if (anchor === 'completion' || !previousDueDate) {
    return addInterval(completedAt, every, unit, timeZone)
  }

  let next = addInterval(previousDueDate, every, unit, timeZone)

  // Bounded so a pathological input (e.g. "every 1 day", untouched for years)
  // cannot spin. 520 steps covers ten years of weekly chores.
  let guard = 0
  while (next.getTime() <= completedAt.getTime() && guard < 520) {
    next = addInterval(next, every, unit, timeZone)
    guard += 1
  }

  return next
}

/**
 * Identifies which occurrence of a recurring reminder we are looking at.
 *
 * This is what goes in `NotifyLog.cycleKey`. Without it, a unique constraint on
 * (user, task, kind) would fire a reminder for the first cycle and then stay
 * silent forever; with it, each cycle gets exactly one reminder.
 */
export function cycleKeyFor(task: { dueDate: Date | null; updatedAt: Date }): string {
  return task.dueDate ? task.dueDate.toISOString() : `no-due:${task.updatedAt.toISOString()}`
}

/**
 * Who the task goes to next, when `rotateAssignees` is on.
 *
 * The rotation runs over the household — the workspace's members in join order
 * — rather than over some separate roster, because "the next person" in a shared
 * flat means the next person living there. Returns null when there is nobody to
 * rotate to, which leaves the task unassigned rather than inventing an assignee.
 */
export function nextInRotation(
  memberIds: readonly string[],
  currentAssigneeIds: readonly string[],
  completedById: string | null,
): string | null {
  if (memberIds.length === 0) return null

  const pivot = currentAssigneeIds[0] ?? completedById
  if (!pivot) return memberIds[0] ?? null

  const index = memberIds.indexOf(pivot)
  if (index === -1) return memberIds[0] ?? null

  return memberIds[(index + 1) % memberIds.length] ?? null
}
