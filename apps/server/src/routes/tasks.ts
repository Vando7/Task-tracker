import {
  assignSchema,
  attachRoomSchema,
  completeTaskSchema,
  createTaskSchema,
  idParamSchema,
  taskListQuerySchema,
  updateTaskSchema,
  workspaceIdParamSchema,
} from '@task-tracker/shared'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireMember } from '../auth/middleware'
import { prisma } from '../db'
import { notFound } from '../lib/errors'
import { parseOrThrow } from '../lib/validate'
import {
  assignUser,
  attachRoom,
  completeTask,
  createTask,
  deleteTask,
  detachRoom,
  getTask,
  listTasks,
  reopenTask,
  unassignUser,
  updateTask,
} from '../services/tasks'

const taskRoomParamSchema = z.object({ id: z.string(), roomId: z.string() })
const taskUserParamSchema = z.object({ id: z.string(), userId: z.string() })

/**
 * A task's workspace is one column away, so authorization is a single indexed
 * lookup with nothing to infer. This function is the entire reason the direct
 * `Task.workspaceId` foreign key was worth the redesign.
 */
async function workspaceIdForTask(taskId: string): Promise<string> {
  const task = await prisma.task.findFirst({
    where: { id: taskId, deletedAt: null },
    select: { workspaceId: true },
  })
  if (!task) throw notFound('Task not found')
  return task.workspaceId
}

export async function taskRoutes(app: FastifyInstance): Promise<void> {
  app.get('/workspaces/:workspaceId/tasks', async (request) => {
    const { workspaceId } = parseOrThrow(workspaceIdParamSchema, request.params)
    const ctx = await requireMember(request, workspaceId)
    const query = parseOrThrow(taskListQuerySchema, request.query)
    return listTasks(ctx, query)
  })

  app.post('/workspaces/:workspaceId/tasks', async (request, reply) => {
    const { workspaceId } = parseOrThrow(workspaceIdParamSchema, request.params)
    const ctx = await requireMember(request, workspaceId)
    const input = parseOrThrow(createTaskSchema, request.body)
    return reply.code(201).send(await createTask(ctx, input))
  })

  app.get('/tasks/:id', async (request) => {
    const { id } = parseOrThrow(idParamSchema, request.params)
    const ctx = await requireMember(request, await workspaceIdForTask(id))
    return getTask(ctx, id)
  })

  app.patch('/tasks/:id', async (request) => {
    const { id } = parseOrThrow(idParamSchema, request.params)
    const ctx = await requireMember(request, await workspaceIdForTask(id))
    const input = parseOrThrow(updateTaskSchema, request.body)
    return updateTask(ctx, id, input)
  })

  app.delete('/tasks/:id', async (request, reply) => {
    const { id } = parseOrThrow(idParamSchema, request.params)
    const ctx = await requireMember(request, await workspaceIdForTask(id))
    await deleteTask(ctx, id)
    return reply.code(204).send()
  })

  app.post('/tasks/:id/complete', async (request) => {
    const { id } = parseOrThrow(idParamSchema, request.params)
    const ctx = await requireMember(request, await workspaceIdForTask(id))
    const input = parseOrThrow(completeTaskSchema, request.body ?? {})
    return completeTask(ctx, id, input.completedAt ?? new Date())
  })

  /** The manual escape hatch from section 5.2. */
  app.post('/tasks/:id/reopen', async (request) => {
    const { id } = parseOrThrow(idParamSchema, request.params)
    const ctx = await requireMember(request, await workspaceIdForTask(id))
    return reopenTask(ctx, id)
  })

  app.post('/tasks/:id/rooms', async (request) => {
    const { id } = parseOrThrow(idParamSchema, request.params)
    const ctx = await requireMember(request, await workspaceIdForTask(id))
    const { roomId } = parseOrThrow(attachRoomSchema, request.body)
    return attachRoom(ctx, id, roomId)
  })

  app.delete('/tasks/:id/rooms/:roomId', async (request) => {
    const { id, roomId } = parseOrThrow(taskRoomParamSchema, request.params)
    const ctx = await requireMember(request, await workspaceIdForTask(id))
    return detachRoom(ctx, id, roomId)
  })

  /**
   * Assignment is its own endpoint, not a generic field update, so it can be
   * notified on and recorded with who assigned whom (section 4.1).
   */
  app.post('/tasks/:id/assignees', async (request) => {
    const { id } = parseOrThrow(idParamSchema, request.params)
    const ctx = await requireMember(request, await workspaceIdForTask(id))
    const { userId } = parseOrThrow(assignSchema, request.body)
    return assignUser(ctx, id, userId)
  })

  app.delete('/tasks/:id/assignees/:userId', async (request) => {
    const { id, userId } = parseOrThrow(taskUserParamSchema, request.params)
    const ctx = await requireMember(request, await workspaceIdForTask(id))
    return unassignUser(ctx, id, userId)
  })
}
