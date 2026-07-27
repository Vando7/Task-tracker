import type {
  Comment,
  CommentList,
  CommentListQuery,
  CommentReactionEmoji,
  CreateCommentInput,
} from '@task-tracker/shared'
import type { MemberContext } from '../auth/middleware'
import { prisma } from '../db'
import { hub } from '../events/hub'
import { notFound } from '../lib/errors'
import { notifyCommented } from './notifications'
import { commentInclude, serializeComment } from './serialize'

/**
 * Comments and reactions.
 *
 * Authorization goes through the task: `workspaceId` is one non-nullable hop away
 * and the task has to be loaded anyway — for its name in the notification copy and
 * to reject a soft-deleted one. That is a single indexed lookup, so denormalising
 * `workspaceId` onto the comment would buy nothing. It is emphatically not the
 * `rooms -> floor -> workspace` inference the task model exists to avoid: that one
 * was multi-hop *and* broke outright for a task with no rooms.
 */

/** Every scoped query filters by workspace, so a foreign id simply does not resolve. */
async function loadTaskForComments(taskId: string, workspaceId: string) {
  const task = await prisma.task.findFirst({
    where: { id: taskId, workspaceId, deletedAt: null },
    select: {
      id: true,
      workspaceId: true,
      name: true,
      createdById: true,
      assignees: { select: { userId: true } },
    },
  })
  if (!task) throw notFound('Task not found')
  return task
}

async function fetchComment(commentId: string, viewerId: string): Promise<Comment> {
  const row = await prisma.taskComment.findUnique({
    where: { id: commentId },
    include: commentInclude,
  })
  if (!row) throw notFound('Comment not found')
  return serializeComment(row, viewerId)
}

/**
 * Oldest first, unlike every other list in the app: a thread reads as a
 * conversation, so the newest note belongs at the bottom by the composer.
 */
export async function listComments(
  ctx: MemberContext,
  taskId: string,
  query: CommentListQuery,
): Promise<CommentList> {
  await loadTaskForComments(taskId, ctx.workspaceId)

  const [rows, total] = await Promise.all([
    prisma.taskComment.findMany({
      where: { taskId },
      include: commentInclude,
      orderBy: { createdAt: 'asc' },
      take: query.limit,
      skip: query.offset,
    }),
    prisma.taskComment.count({ where: { taskId } }),
  ])

  return { comments: rows.map((row) => serializeComment(row, ctx.user.id)), total }
}

export async function createComment(
  ctx: MemberContext,
  taskId: string,
  input: CreateCommentInput,
): Promise<Comment> {
  const task = await loadTaskForComments(taskId, ctx.workspaceId)

  const created = await prisma.taskComment.create({
    data: { taskId, authorId: ctx.user.id, body: input.body },
    select: { id: true },
  })

  const comment = await fetchComment(created.id, ctx.user.id)
  hub.publish({
    workspaceId: ctx.workspaceId,
    type: 'comment.created',
    data: { id: comment.id, taskId },
    actorId: ctx.user.id,
  })

  const recipients = await participants(task, ctx.user.id)
  if (recipients.length > 0) {
    await notifyCommented(task, recipients, ctx.user.id, comment.id)
  }

  return comment
}

/**
 * Who hears about a note: assignees, whoever created the task, and anyone who has
 * already commented on it — minus the author.
 *
 * Deliberately *not* the whole household when a task is unassigned, which is what
 * `due_soon` and `overdue` do. A deadline is worth waking everyone for; comments
 * arrive far more often, and a note on an unclaimed chore is for the people
 * already involved with it. Whoever eventually claims it reads the thread then.
 */
async function participants(
  task: { id: string; createdById: string | null; assignees: Array<{ userId: string }> },
  actorId: string,
): Promise<string[]> {
  const priorCommenters = await prisma.taskComment.findMany({
    where: { taskId: task.id, authorId: { not: null } },
    select: { authorId: true },
    distinct: ['authorId'],
  })

  const ids = new Set<string>()
  for (const assignee of task.assignees) ids.add(assignee.userId)
  if (task.createdById) ids.add(task.createdById)
  for (const row of priorCommenters) if (row.authorId) ids.add(row.authorId)
  ids.delete(actorId)

  return [...ids]
}

/**
 * Author only, and a hard delete.
 *
 * Nothing points at a comment except its reactions, which cascade. The soft-delete
 * that floors and rooms need exists because deleting one would otherwise take task
 * join rows with it; a comment has no such dependents, so a tombstone would be
 * state to render for no benefit.
 */
export async function deleteComment(ctx: MemberContext, commentId: string): Promise<void> {
  const comment = await prisma.taskComment.findFirst({
    where: {
      id: commentId,
      // Scoped in the same query as the id, so a comment in someone else's
      // household is indistinguishable from one that does not exist.
      task: { workspaceId: ctx.workspaceId, deletedAt: null },
    },
    select: { id: true, taskId: true, authorId: true },
  })
  if (!comment) throw notFound('Comment not found')

  // 404 rather than 403: a member of this household can already see the comment,
  // so this leaks nothing — it just keeps one rule for "you cannot have this".
  if (comment.authorId !== ctx.user.id) throw notFound('Comment not found')

  await prisma.taskComment.delete({ where: { id: commentId } })
  hub.publish({
    workspaceId: ctx.workspaceId,
    type: 'comment.deleted',
    data: { id: commentId, taskId: comment.taskId },
    actorId: ctx.user.id,
  })
}

/**
 * Toggle one reaction.
 *
 * The composite primary key `(commentId, userId, emoji)` is what makes this a
 * toggle rather than a duplicate-row bug: the same emoji from the same person is
 * either present or absent, never twice.
 *
 * Reactions never notify. A push for a thumbs-up is noise, and keeping them out of
 * `NotifyLog` entirely means there is no ledger row to reason about either.
 */
export async function toggleReaction(
  ctx: MemberContext,
  commentId: string,
  emoji: CommentReactionEmoji,
): Promise<Comment> {
  const comment = await prisma.taskComment.findFirst({
    where: { id: commentId, task: { workspaceId: ctx.workspaceId, deletedAt: null } },
    select: { id: true, taskId: true },
  })
  if (!comment) throw notFound('Comment not found')

  const existing = await prisma.commentReaction.findUnique({
    where: { commentId_userId_emoji: { commentId, userId: ctx.user.id, emoji } },
    select: { emoji: true },
  })

  if (existing) {
    await prisma.commentReaction.delete({
      where: { commentId_userId_emoji: { commentId, userId: ctx.user.id, emoji } },
    })
  } else {
    await prisma.commentReaction.create({ data: { commentId, userId: ctx.user.id, emoji } })
  }

  const updated = await fetchComment(commentId, ctx.user.id)
  hub.publish({
    workspaceId: ctx.workspaceId,
    type: 'comment.updated',
    data: { id: commentId, taskId: comment.taskId },
    actorId: ctx.user.id,
  })
  return updated
}
