import {
  createFloorSchema,
  createRoomSchema,
  floorIdParamSchema,
  idParamSchema,
  reorderSchema,
  roomIdParamSchema,
  updateFloorSchema,
  updateRoomSchema,
  workspaceIdParamSchema,
} from '@task-tracker/shared'
import type { FastifyInstance } from 'fastify'
import { requireMember } from '../auth/middleware'
import { prisma } from '../db'
import { notFound } from '../lib/errors'
import { parseOrThrow } from '../lib/validate'
import {
  createFloor,
  createRoom,
  deleteFloor,
  deleteRoom,
  getLayout,
  reorderFloors,
  reorderRooms,
  updateFloor,
  updateRoom,
} from '../services/layout'

/**
 * Floors and rooms are addressed by their own id rather than nested under the
 * workspace, so the workspace has to be looked up from the entity before
 * authorization. That lookup is the gate: the legacy `room()` and `floor()`
 * views skipped it entirely and rendered any id for any signed-in user.
 */
async function workspaceIdForFloor(floorId: string): Promise<string> {
  const floor = await prisma.floor.findFirst({
    where: { id: floorId, deletedAt: null },
    select: { workspaceId: true },
  })
  if (!floor) throw notFound('Floor not found')
  return floor.workspaceId
}

async function workspaceIdForRoom(roomId: string): Promise<string> {
  const room = await prisma.room.findFirst({
    where: { id: roomId, deletedAt: null, floor: { deletedAt: null } },
    select: { floor: { select: { workspaceId: true } } },
  })
  if (!room) throw notFound('Room not found')
  return room.floor.workspaceId
}

export async function layoutRoutes(app: FastifyInstance): Promise<void> {
  app.get('/workspaces/:workspaceId/layout', async (request) => {
    const { workspaceId } = parseOrThrow(workspaceIdParamSchema, request.params)
    const ctx = await requireMember(request, workspaceId)
    return getLayout(ctx)
  })

  app.post('/workspaces/:workspaceId/floors', async (request, reply) => {
    const { workspaceId } = parseOrThrow(workspaceIdParamSchema, request.params)
    const ctx = await requireMember(request, workspaceId)
    const input = parseOrThrow(createFloorSchema, request.body)
    return reply.code(201).send(await createFloor(ctx, input))
  })

  app.post('/workspaces/:workspaceId/floors/reorder', async (request) => {
    const { workspaceId } = parseOrThrow(workspaceIdParamSchema, request.params)
    const ctx = await requireMember(request, workspaceId)
    const { ids } = parseOrThrow(reorderSchema, request.body)
    return reorderFloors(ctx, ids)
  })

  app.patch('/floors/:id', async (request) => {
    const { id } = parseOrThrow(idParamSchema, request.params)
    const ctx = await requireMember(request, await workspaceIdForFloor(id))
    const input = parseOrThrow(updateFloorSchema, request.body)
    return updateFloor(ctx, id, input)
  })

  app.delete('/floors/:id', async (request, reply) => {
    const { id } = parseOrThrow(idParamSchema, request.params)
    const ctx = await requireMember(request, await workspaceIdForFloor(id))
    await deleteFloor(ctx, id)
    return reply.code(204).send()
  })

  app.post('/floors/:floorId/rooms', async (request, reply) => {
    const { floorId } = parseOrThrow(floorIdParamSchema, request.params)
    const ctx = await requireMember(request, await workspaceIdForFloor(floorId))
    const input = parseOrThrow(createRoomSchema, request.body)
    return reply.code(201).send(await createRoom(ctx, floorId, input))
  })

  app.post('/floors/:floorId/rooms/reorder', async (request) => {
    const { floorId } = parseOrThrow(floorIdParamSchema, request.params)
    const ctx = await requireMember(request, await workspaceIdForFloor(floorId))
    const { ids } = parseOrThrow(reorderSchema, request.body)
    return reorderRooms(ctx, floorId, ids)
  })

  app.patch('/rooms/:roomId', async (request) => {
    const { roomId } = parseOrThrow(roomIdParamSchema, request.params)
    const ctx = await requireMember(request, await workspaceIdForRoom(roomId))
    const input = parseOrThrow(updateRoomSchema, request.body)
    return updateRoom(ctx, roomId, input)
  })

  app.delete('/rooms/:roomId', async (request, reply) => {
    const { roomId } = parseOrThrow(roomIdParamSchema, request.params)
    const ctx = await requireMember(request, await workspaceIdForRoom(roomId))
    await deleteRoom(ctx, roomId)
    return reply.code(204).send()
  })
}
