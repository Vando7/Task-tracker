import {
  commentIdParamSchema,
  commentListQuerySchema,
  createCommentSchema,
  idParamSchema,
  toggleReactionSchema,
} from '@task-tracker/shared'
import type { FastifyInstance } from 'fastify'
import { requireMember } from '../auth/middleware'
import { prisma } from '../db'
import { notFound } from '../lib/errors'
import { parseOrThrow } from '../lib/validate'
import { createComment, deleteComment, listComments, toggleReaction } from '../services/comments'
import { workspaceIdForTask } from '../services/tasks'

/**
 * Comments are addressed under their task; a single comment owns its own path,
 * because delete and react only ever have the comment's id to hand.
 *
 * Every handler is parse -> authorize -> service, with `requireMember` gating on
 * the workspace the comment's task belongs to.
 */

/** The workspace a comment belongs to: comment -> task, one non-nullable hop. */
async function workspaceIdForComment(commentId: string): Promise<string> {
  const comment = await prisma.taskComment.findFirst({
    where: { id: commentId, task: { deletedAt: null } },
    select: { task: { select: { workspaceId: true } } },
  })
  if (!comment) throw notFound('Comment not found')
  return comment.task.workspaceId
}

export async function commentRoutes(app: FastifyInstance): Promise<void> {
  app.get('/tasks/:id/comments', async (request) => {
    const { id } = parseOrThrow(idParamSchema, request.params)
    const ctx = await requireMember(request, await workspaceIdForTask(id))
    const query = parseOrThrow(commentListQuerySchema, request.query)
    return listComments(ctx, id, query)
  })

  app.post('/tasks/:id/comments', async (request, reply) => {
    const { id } = parseOrThrow(idParamSchema, request.params)
    const ctx = await requireMember(request, await workspaceIdForTask(id))
    const input = parseOrThrow(createCommentSchema, request.body)
    return reply.code(201).send(await createComment(ctx, id, input))
  })

  app.delete('/comments/:commentId', async (request, reply) => {
    const { commentId } = parseOrThrow(commentIdParamSchema, request.params)
    const ctx = await requireMember(request, await workspaceIdForComment(commentId))
    await deleteComment(ctx, commentId)
    return reply.code(204).send()
  })

  /** One toggling endpoint: the same emoji again removes it. */
  app.post('/comments/:commentId/reactions', async (request) => {
    const { commentId } = parseOrThrow(commentIdParamSchema, request.params)
    const ctx = await requireMember(request, await workspaceIdForComment(commentId))
    const { emoji } = parseOrThrow(toggleReactionSchema, request.body)
    return toggleReaction(ctx, commentId, emoji)
  })
}
