/**
 * Enums and limits shared by the server and the web client.
 *
 * Every list here is a `const` tuple so it can be both a Zod enum and a TS
 * union without the two drifting apart.
 */

export const TASK_CATEGORIES = ['urgent', 'special', 'normal'] as const
export type TaskCategory = (typeof TASK_CATEGORIES)[number]

/**
 * Pending-list ordering. The legacy app hardcoded urgent -> special -> normal
 * as three near-identical 25-line blocks (Part 2, problem 21); this is the same
 * order expressed once as data.
 */
export const TASK_CATEGORY_RANK: Record<TaskCategory, number> = {
  urgent: 0,
  special: 1,
  normal: 2,
}

/**
 * `todo | done` only. The legacy enum also had `updated` and `overdue`, which
 * nothing ever set. Overdue is derived from `dueDate`, never stored.
 */
export const TASK_STATUSES = ['todo', 'done'] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]

export const RECURRENCE_UNITS = ['day', 'week', 'month'] as const
export type RecurrenceUnit = (typeof RECURRENCE_UNITS)[number]

/**
 * Where the next due date is measured from when a recurring task is completed.
 *
 * - `completion` — "every 2 weeks from when I actually did it". Late completions
 *   push the schedule out; you never owe a backlog of missed cycles.
 * - `dueDate` — "every other Sunday". The cadence holds regardless of when it
 *   was done, so a long gap can leave the next date already in the past.
 *
 * Decided: default `completion` (CLAUDE.md section 6, question 2).
 */
export const RECURRENCE_ANCHORS = ['completion', 'dueDate'] as const
export type RecurrenceAnchor = (typeof RECURRENCE_ANCHORS)[number]
export const DEFAULT_RECURRENCE_ANCHOR: RecurrenceAnchor = 'completion'

export const MEMBER_ROLES = ['owner', 'member'] as const
export type MemberRole = (typeof MEMBER_ROLES)[number]

export const EMAIL_TOKEN_KINDS = ['verify', 'reset'] as const
export type EmailTokenKind = (typeof EMAIL_TOKEN_KINDS)[number]

export const NOTIFY_KINDS = ['assigned', 'due_soon', 'overdue', 'completed_by_other'] as const
export type NotifyKind = (typeof NOTIFY_KINDS)[number]

/** Non-id values the assignee filter can take. Anything else is a list of user ids. */
export const ASSIGNEE_FILTER_KEYWORDS = ['anyone', 'mine', 'unassigned'] as const
export type AssigneeFilterKeyword = (typeof ASSIGNEE_FILTER_KEYWORDS)[number]

export const FAIRNESS_WINDOWS = ['week', 'month'] as const
export type FairnessWindow = (typeof FAIRNESS_WINDOWS)[number]

/**
 * Length limits. The legacy app declared these on the model but never enforced
 * them, because Django does not validate on `save()` (Part 2, problem 6).
 * Here they are enforced by the request schema, which is the only way in.
 */
export const LIMITS = {
  taskName: 128,
  taskDescription: 512,
  workspaceName: 64,
  floorName: 64,
  roomName: 64,
  userName: 64,
  email: 254,
  icon: 16,
  search: 128,
  colorHex: 7,
  passwordMin: 10,
  passwordMax: 200,
  timezone: 64,
} as const

/** Legacy default floor colour, kept for visual continuity (section 5.6). */
export const DEFAULT_FLOOR_COLOR = '#8A2BE2'
export const DEFAULT_FLOOR_ICON = '🏠'
export const DEFAULT_ROOM_ICON = '🚪'

export const DEFAULT_TIMEZONE = 'UTC'

/** How far ahead of `dueDate` a `due_soon` notification fires, by default. */
export const DEFAULT_DUE_SOON_LEAD_HOURS = 24

/** `#rgb` or `#rrggbb`. */
export const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

export const SESSION_COOKIE_NAME = 'tt_session'

/** Named so the client and the SSE hub cannot disagree about the wire format. */
export const SSE_EVENT_NAME = 'message'
export const SSE_KEEPALIVE_MS = 25_000
