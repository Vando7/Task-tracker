import { z } from 'zod'
import {
  ASSIGNEE_FILTER_KEYWORDS,
  DEFAULT_RECURRENCE_ANCHOR,
  LIMITS,
  RECURRENCE_ANCHORS,
  RECURRENCE_UNITS,
  TASK_CATEGORIES,
  TASK_STATUSES,
} from '../constants'
import {
  dateTimeInputSchema,
  hexColorSchema,
  iconSchema,
  idSchema,
  timestampSchema,
} from './common'
import { publicUserSchema } from './user'

export const taskCategorySchema = z.enum(TASK_CATEGORIES)
export const taskStatusSchema = z.enum(TASK_STATUSES)
export const recurrenceUnitSchema = z.enum(RECURRENCE_UNITS)
export const recurrenceAnchorSchema = z.enum(RECURRENCE_ANCHORS)

export const taskNameSchema = z.string().trim().min(1).max(LIMITS.taskName)

/**
 * Description is optional. The legacy *form* required it while the model
 * allowed blank, which is a contradiction users hit constantly.
 */
export const taskDescriptionSchema = z.string().trim().max(LIMITS.taskDescription)

/** A room reference on a task card. Typed, so it cannot be rendered as a string by mistake. */
export const taskRoomRefSchema = z.object({
  id: idSchema,
  name: z.string(),
  icon: iconSchema,
  floorId: idSchema,
  floorName: z.string(),
  floorColor: hexColorSchema,
})
export type TaskRoomRef = z.infer<typeof taskRoomRefSchema>

export const taskAssigneeSchema = z.object({
  user: publicUserSchema,
  assignedAt: timestampSchema,
  assignedById: idSchema.nullable(),
})
export type TaskAssignee = z.infer<typeof taskAssigneeSchema>

export const taskSchema = z.object({
  id: idSchema,
  /**
   * A direct foreign key, not inferred through `rooms -> floor -> workspace`.
   * Nearly every authorization bug in Part 2 was a symptom of that inference.
   */
  workspaceId: idSchema,
  name: taskNameSchema,
  description: taskDescriptionSchema,
  category: taskCategorySchema,
  status: taskStatusSchema,
  dueDate: timestampSchema.nullable(),
  recurrenceEvery: z.number().int().positive().nullable(),
  recurrenceUnit: recurrenceUnitSchema.nullable(),
  recurrenceAnchor: recurrenceAnchorSchema,
  rotateAssignees: z.boolean(),
  createdById: idSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,

  /** May be empty: a task with no rooms is still valid and must stay reachable (section 3). */
  rooms: z.array(taskRoomRefSchema),
  /** May be empty: "whoever gets to it" is a first-class state, not missing data (section 4.1). */
  assignees: z.array(taskAssigneeSchema),

  /** From the completion log. Powers "last done 3 days ago" (section 5.2). */
  lastCompletedAt: timestampSchema.nullable(),
  lastCompletedBy: publicUserSchema.nullable(),
  completionCount: z.number().int().nonnegative(),

  /**
   * Derived server-side from `dueDate` in the workspace timezone. The legacy
   * client decided this by checking whether a formatted string contained the
   * substring "ago" (Part 2, problem 16).
   */
  isOverdue: z.boolean(),
  isRecurring: z.boolean(),
})
export type Task = z.infer<typeof taskSchema>

/**
 * Recurrence is all-or-nothing: an every without a unit is meaningless, and a
 * unit without an every silently never fires.
 */
const recurrencePaired = <
  T extends { recurrenceEvery?: number | null; recurrenceUnit?: string | null },
>(
  value: T,
) => (value.recurrenceEvery == null) === (value.recurrenceUnit == null)

const recurrenceError = {
  error: 'recurrenceEvery and recurrenceUnit must be set together, or both left empty',
  path: ['recurrenceEvery'],
}

export const createTaskSchema = z
  .object({
    name: taskNameSchema,
    description: taskDescriptionSchema.default(''),
    category: taskCategorySchema.default('normal'),
    dueDate: dateTimeInputSchema.nullish(),
    recurrenceEvery: z.number().int().min(1).max(365).nullish(),
    recurrenceUnit: recurrenceUnitSchema.nullish(),
    recurrenceAnchor: recurrenceAnchorSchema.default(DEFAULT_RECURRENCE_ANCHOR),
    rotateAssignees: z.boolean().default(false),
    /** Optional. Unlike the legacy create form, zero rooms is allowed. */
    roomIds: z.array(idSchema).max(200).default([]),
    assigneeIds: z.array(idSchema).max(50).default([]),
  })
  .refine(recurrencePaired, recurrenceError)
export type CreateTaskInput = z.infer<typeof createTaskSchema>

/**
 * `status` is absent on purpose: completion goes through `/complete` and
 * `/reopen` so it can be recorded in the completion log and notified on. Rooms
 * and assignees have their own endpoints for the same reason.
 */
export const updateTaskSchema = z
  .object({
    name: taskNameSchema,
    description: taskDescriptionSchema,
    category: taskCategorySchema,
    dueDate: dateTimeInputSchema.nullable(),
    recurrenceEvery: z.number().int().min(1).max(365).nullable(),
    recurrenceUnit: recurrenceUnitSchema.nullable(),
    recurrenceAnchor: recurrenceAnchorSchema,
    rotateAssignees: z.boolean(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { error: 'nothing to update' })
  .refine(
    (value) =>
      !('recurrenceEvery' in value || 'recurrenceUnit' in value) ||
      recurrencePaired({
        recurrenceEvery: value.recurrenceEvery ?? null,
        recurrenceUnit: value.recurrenceUnit ?? null,
      }),
    recurrenceError,
  )
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>

const ASSIGNEE_KEYWORDS: readonly string[] = ASSIGNEE_FILTER_KEYWORDS

/**
 * `anyone` | `mine` | `unassigned` | a comma-separated list of user ids.
 *
 * Lives in the query string so a filtered view is linkable and survives reload
 * (section 4.1).
 */
export const assigneeFilterSchema = z
  .preprocess(
    (value) => {
      if (typeof value !== 'string') return value
      if (ASSIGNEE_KEYWORDS.includes(value)) return value
      return value
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
    },
    z.union([z.enum(ASSIGNEE_FILTER_KEYWORDS), z.array(idSchema).min(1).max(50)]),
  )
  .default('anyone')
export type AssigneeFilter = z.infer<typeof assigneeFilterSchema>

export const taskListQuerySchema = z.object({
  /** Omitted means both pending and done. */
  status: taskStatusSchema.optional(),
  roomId: idSchema.optional(),
  /**
   * Tasks in *any* room on this floor. The legacy floor view meant "in *every*
   * room on this floor", so adding a room silently hid existing floor-wide
   * tasks (Part 2, problem 8).
   */
  floorId: idSchema.optional(),
  search: z.string().trim().min(1).max(LIMITS.search).optional(),
  assignee: assigneeFilterSchema,
  limit: z.coerce.number().int().min(1).max(200).default(50),
  /** The legacy completed list was capped at 20 with no way to see further back (gap 37). */
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
})
export type TaskListQuery = z.infer<typeof taskListQuerySchema>

export const taskListSchema = z.object({
  tasks: z.array(taskSchema),
  total: z.number().int().nonnegative(),
  hasMore: z.boolean(),
})
export type TaskList = z.infer<typeof taskListSchema>

/** Optional explicit time, so "I actually did this last night" is expressible. */
export const completeTaskSchema = z
  .object({ completedAt: dateTimeInputSchema.optional() })
  .default({})
export type CompleteTaskInput = z.infer<typeof completeTaskSchema>

export const taskCompletionSchema = z.object({
  id: idSchema,
  taskId: idSchema,
  completedAt: timestampSchema,
  completedBy: publicUserSchema.nullable(),
})
export type TaskCompletion = z.infer<typeof taskCompletionSchema>

export const assignSchema = z.object({ userId: idSchema })
export type AssignInput = z.infer<typeof assignSchema>

export const attachRoomSchema = z.object({ roomId: idSchema })
export type AttachRoomInput = z.infer<typeof attachRoomSchema>

export const taskIdParamSchema = z.object({ taskId: idSchema })
