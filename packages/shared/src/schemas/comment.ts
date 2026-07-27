import { z } from 'zod'
import { COMMENT_REACTIONS, LIMITS } from '../constants'
import { idSchema, timestampSchema } from './common'
import { publicUserSchema } from './user'

/**
 * Comments on a task.
 *
 * The task's `description` says what the chore *is*; a comment records what
 * happened on one occasion — "descaled it, was bad, maybe make this monthly". Both
 * belong on the task, but not in the same field: before this existed the only
 * place to put the second kind of note was the description, where the next person
 * to tidy it up destroyed it.
 *
 * Append-only in spirit, like `TaskCompletion`: bodies are not editable, and the
 * author can delete their own. One less state to render, one less event to
 * publish, and no "edited" ambiguity in a thread two housemates are reading.
 */

export const commentBodySchema = z.string().trim().min(1).max(LIMITS.commentBody)

export const commentReactionEmojiSchema = z.enum(COMMENT_REACTIONS)

/**
 * One emoji's worth of reactions, already grouped by the server.
 *
 * `mine` saves every client recomputing "am I in this list" on each render, and
 * `users` is what the tooltip needs — a bare count would make the row useless for
 * the one thing it is for, knowing who acknowledged something.
 */
export const commentReactionGroupSchema = z.object({
  emoji: commentReactionEmojiSchema,
  count: z.number().int().positive(),
  users: z.array(publicUserSchema),
  mine: z.boolean(),
})
export type CommentReactionGroup = z.infer<typeof commentReactionGroupSchema>

export const commentSchema = z.object({
  id: idSchema,
  taskId: idSchema,
  body: commentBodySchema,
  /** Null when the author's account is gone. The note survives them. */
  author: publicUserSchema.nullable(),
  createdAt: timestampSchema,
  /** Empty is the overwhelmingly common case, and is not an empty slot to fill. */
  reactions: z.array(commentReactionGroupSchema),
  /** Whether the signed-in user may delete this one. Author only. */
  canDelete: z.boolean(),
})
export type Comment = z.infer<typeof commentSchema>

export const createCommentSchema = z.object({ body: commentBodySchema })
export type CreateCommentInput = z.infer<typeof createCommentSchema>
export type CreateCommentBody = z.input<typeof createCommentSchema>

export const commentListSchema = z.object({
  comments: z.array(commentSchema),
  total: z.number().int().nonnegative(),
})
export type CommentList = z.infer<typeof commentListSchema>

/**
 * Oldest first, unlike the task list. A thread is read as a conversation, so the
 * newest belongs at the bottom next to the composer.
 */
export const commentListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
})
export type CommentListQuery = z.infer<typeof commentListQuerySchema>

/** One endpoint, toggling: posting an emoji you already used removes it. */
export const toggleReactionSchema = z.object({ emoji: commentReactionEmojiSchema })
export type ToggleReactionInput = z.infer<typeof toggleReactionSchema>

export const commentIdParamSchema = z.object({ commentId: idSchema })
