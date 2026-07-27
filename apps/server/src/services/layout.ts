import type {
  CreateFloorInput,
  CreateRoomInput,
  Floor,
  Layout,
  Room,
  Staleness,
  UpdateFloorInput,
  UpdateRoomInput,
} from '@task-tracker/shared'
import type { MemberContext } from '../auth/middleware'
import { prisma } from '../db'
import { hub } from '../events/hub'
import { notFound } from '../lib/errors'
import { serializeFloor, serializeRoom } from './serialize'
import { startOfDayInZone } from './time'

/**
 * Floors and rooms — the spatial model that makes this app different from every
 * flat to-do list.
 *
 * Both soft-delete. In the legacy app they hard-cascaded, which dropped the
 * task/room join rows: a task that lived only in the deleted room became
 * invisible forever, and then crashed the workspace check that inspected its
 * first room.
 */

const floorOrder = [{ sortOrder: 'asc' }, { createdAt: 'asc' }] as const
const roomOrder = [{ sortOrder: 'asc' }, { createdAt: 'asc' }] as const

/**
 * Per-room open task counts and last-completion times, in two queries.
 *
 * `openTaskCount` excludes soft-deleted tasks. The legacy badge counted them, so
 * deleting a task inflated its room's badge permanently.
 */
async function roomStats(workspaceId: string): Promise<{
  open: Map<string, number>
  lastCompleted: Map<string, Date>
}> {
  const [openGroups, links] = await Promise.all([
    prisma.taskRoom.groupBy({
      by: ['roomId'],
      where: {
        room: { deletedAt: null, floor: { workspaceId, deletedAt: null } },
        task: { workspaceId, deletedAt: null, status: { not: 'done' } },
      },
      _count: { taskId: true },
    }),
    prisma.taskRoom.findMany({
      where: {
        room: { deletedAt: null, floor: { workspaceId, deletedAt: null } },
        task: { workspaceId, deletedAt: null },
      },
      select: {
        roomId: true,
        task: {
          select: {
            completions: {
              select: { completedAt: true },
              orderBy: { completedAt: 'desc' },
              take: 1,
            },
          },
        },
      },
    }),
  ])

  const open = new Map<string, number>()
  for (const group of openGroups) open.set(group.roomId, group._count.taskId)

  const lastCompleted = new Map<string, Date>()
  for (const link of links) {
    const completedAt = link.task.completions[0]?.completedAt
    if (!completedAt) continue
    const current = lastCompleted.get(link.roomId)
    if (!current || completedAt > current) lastCompleted.set(link.roomId, completedAt)
  }

  return { open, lastCompleted }
}

export async function getLayout(ctx: MemberContext): Promise<Layout> {
  const [floors, stats] = await Promise.all([
    prisma.floor.findMany({
      where: { workspaceId: ctx.workspaceId, deletedAt: null },
      orderBy: [...floorOrder],
      include: { rooms: { where: { deletedAt: null }, orderBy: [...roomOrder] } },
    }),
    roomStats(ctx.workspaceId),
  ])

  return {
    workspaceId: ctx.workspaceId,
    floors: floors.map((floor) =>
      serializeFloor(
        floor,
        floor.rooms.map((room) =>
          serializeRoom(
            room,
            stats.open.get(room.id) ?? 0,
            stats.lastCompleted.get(room.id) ?? null,
          ),
        ),
      ),
    ),
  }
}

/** Room staleness: "bathroom: nothing done in 12 days". */
export async function getStaleness(ctx: MemberContext): Promise<Staleness> {
  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { id: ctx.workspaceId },
    select: { timezone: true },
  })

  const [floors, stats] = await Promise.all([
    prisma.floor.findMany({
      where: { workspaceId: ctx.workspaceId, deletedAt: null },
      orderBy: [...floorOrder],
      select: {
        id: true,
        name: true,
        rooms: { where: { deletedAt: null }, orderBy: [...roomOrder] },
      },
    }),
    roomStats(ctx.workspaceId),
  ])

  const today = startOfDayInZone(new Date(), workspace.timezone).getTime()
  const DAY = 24 * 60 * 60 * 1000

  return {
    rooms: floors.flatMap((floor) =>
      floor.rooms.map((room) => {
        const lastCompletedAt = stats.lastCompleted.get(room.id) ?? null
        return {
          roomId: room.id,
          roomName: room.name,
          roomIcon: room.icon,
          floorId: floor.id,
          floorName: floor.name,
          openTaskCount: stats.open.get(room.id) ?? 0,
          lastCompletedAt: lastCompletedAt?.toISOString() ?? null,
          // Whole days, measured between calendar days in the workspace zone, so
          // "yesterday evening" reads as 1 day rather than 0.
          daysSinceLastCompletion: lastCompletedAt
            ? Math.max(
                0,
                Math.round(
                  (today - startOfDayInZone(lastCompletedAt, workspace.timezone).getTime()) / DAY,
                ),
              )
            : null,
        }
      }),
    ),
  }
}

async function nextFloorSortOrder(workspaceId: string): Promise<number> {
  const last = await prisma.floor.findFirst({
    where: { workspaceId, deletedAt: null },
    orderBy: { sortOrder: 'desc' },
    select: { sortOrder: true },
  })
  return (last?.sortOrder ?? -1) + 1
}

async function nextRoomSortOrder(floorId: string): Promise<number> {
  const last = await prisma.room.findFirst({
    where: { floorId, deletedAt: null },
    orderBy: { sortOrder: 'desc' },
    select: { sortOrder: true },
  })
  return (last?.sortOrder ?? -1) + 1
}

async function reloadFloor(floorId: string, workspaceId: string): Promise<Floor> {
  const floor = await prisma.floor.findFirst({
    where: { id: floorId, workspaceId, deletedAt: null },
    include: { rooms: { where: { deletedAt: null }, orderBy: [...roomOrder] } },
  })
  if (!floor) throw notFound('Floor not found')

  const stats = await roomStats(workspaceId)
  return serializeFloor(
    floor,
    floor.rooms.map((room) =>
      serializeRoom(room, stats.open.get(room.id) ?? 0, stats.lastCompleted.get(room.id) ?? null),
    ),
  )
}

async function reloadRoom(roomId: string, workspaceId: string): Promise<Room> {
  const room = await prisma.room.findFirst({
    where: { id: roomId, deletedAt: null, floor: { workspaceId, deletedAt: null } },
  })
  if (!room) throw notFound('Room not found')

  const stats = await roomStats(workspaceId)
  return serializeRoom(room, stats.open.get(room.id) ?? 0, stats.lastCompleted.get(room.id) ?? null)
}

export async function createFloor(ctx: MemberContext, input: CreateFloorInput): Promise<Floor> {
  const created = await prisma.floor.create({
    data: {
      workspaceId: ctx.workspaceId,
      name: input.name,
      icon: input.icon,
      color: input.color,
      sortOrder: input.sortOrder ?? (await nextFloorSortOrder(ctx.workspaceId)),
    },
    select: { id: true },
  })

  const floor = await reloadFloor(created.id, ctx.workspaceId)
  hub.publish({
    workspaceId: ctx.workspaceId,
    type: 'floor.created',
    data: floor,
    actorId: ctx.user.id,
  })
  return floor
}

export async function updateFloor(
  ctx: MemberContext,
  floorId: string,
  input: UpdateFloorInput,
): Promise<Floor> {
  const existing = await prisma.floor.findFirst({
    where: { id: floorId, workspaceId: ctx.workspaceId, deletedAt: null },
    select: { id: true },
  })
  if (!existing) throw notFound('Floor not found')

  await prisma.floor.update({ where: { id: floorId }, data: input })

  const floor = await reloadFloor(floorId, ctx.workspaceId)
  hub.publish({
    workspaceId: ctx.workspaceId,
    type: 'floor.updated',
    data: floor,
    actorId: ctx.user.id,
  })
  return floor
}

/**
 * Soft-deletes the floor and its rooms, and detaches those rooms from their
 * tasks. Tasks left with zero rooms stay reachable — they belong to the
 * workspace directly.
 */
export async function deleteFloor(ctx: MemberContext, floorId: string): Promise<void> {
  const existing = await prisma.floor.findFirst({
    where: { id: floorId, workspaceId: ctx.workspaceId, deletedAt: null },
    select: { id: true, rooms: { where: { deletedAt: null }, select: { id: true } } },
  })
  if (!existing) throw notFound('Floor not found')

  const roomIds = existing.rooms.map((room) => room.id)
  const now = new Date()

  await prisma.$transaction([
    prisma.taskRoom.deleteMany({ where: { roomId: { in: roomIds } } }),
    prisma.room.updateMany({ where: { floorId, deletedAt: null }, data: { deletedAt: now } }),
    prisma.floor.update({ where: { id: floorId }, data: { deletedAt: now } }),
  ])

  hub.publish({
    workspaceId: ctx.workspaceId,
    type: 'floor.deleted',
    data: { id: floorId },
    actorId: ctx.user.id,
  })
}

export async function createRoom(
  ctx: MemberContext,
  floorId: string,
  input: CreateRoomInput,
): Promise<Room> {
  const floor = await prisma.floor.findFirst({
    where: { id: floorId, workspaceId: ctx.workspaceId, deletedAt: null },
    select: { id: true },
  })
  if (!floor) throw notFound('Floor not found')

  const created = await prisma.room.create({
    data: {
      floorId,
      name: input.name,
      icon: input.icon,
      sortOrder: input.sortOrder ?? (await nextRoomSortOrder(floorId)),
    },
    select: { id: true },
  })

  const room = await reloadRoom(created.id, ctx.workspaceId)
  hub.publish({
    workspaceId: ctx.workspaceId,
    type: 'room.created',
    data: room,
    actorId: ctx.user.id,
  })
  return room
}

export async function updateRoom(
  ctx: MemberContext,
  roomId: string,
  input: UpdateRoomInput,
): Promise<Room> {
  const existing = await prisma.room.findFirst({
    where: {
      id: roomId,
      deletedAt: null,
      floor: { workspaceId: ctx.workspaceId, deletedAt: null },
    },
    select: { id: true },
  })
  if (!existing) throw notFound('Room not found')

  await prisma.room.update({ where: { id: roomId }, data: input })

  const room = await reloadRoom(roomId, ctx.workspaceId)
  hub.publish({
    workspaceId: ctx.workspaceId,
    type: 'room.updated',
    data: room,
    actorId: ctx.user.id,
  })
  return room
}

export async function deleteRoom(ctx: MemberContext, roomId: string): Promise<void> {
  const existing = await prisma.room.findFirst({
    where: {
      id: roomId,
      deletedAt: null,
      floor: { workspaceId: ctx.workspaceId, deletedAt: null },
    },
    select: { id: true },
  })
  if (!existing) throw notFound('Room not found')

  await prisma.$transaction([
    prisma.taskRoom.deleteMany({ where: { roomId } }),
    prisma.room.update({ where: { id: roomId }, data: { deletedAt: new Date() } }),
  ])

  hub.publish({
    workspaceId: ctx.workspaceId,
    type: 'room.deleted',
    data: { id: roomId },
    actorId: ctx.user.id,
  })
}

/** Bulk reorder. Ignores ids that aren't in scope rather than failing the batch. */
export async function reorderFloors(ctx: MemberContext, ids: readonly string[]): Promise<Floor[]> {
  await prisma.$transaction(
    ids.map((id, index) =>
      prisma.floor.updateMany({
        where: { id, workspaceId: ctx.workspaceId, deletedAt: null },
        data: { sortOrder: index },
      }),
    ),
  )

  const layout = await getLayout(ctx)
  for (const floor of layout.floors) {
    hub.publish({
      workspaceId: ctx.workspaceId,
      type: 'floor.updated',
      data: floor,
      actorId: ctx.user.id,
    })
  }
  return layout.floors
}

export async function reorderRooms(
  ctx: MemberContext,
  floorId: string,
  ids: readonly string[],
): Promise<Floor> {
  const floor = await prisma.floor.findFirst({
    where: { id: floorId, workspaceId: ctx.workspaceId, deletedAt: null },
    select: { id: true },
  })
  if (!floor) throw notFound('Floor not found')

  await prisma.$transaction(
    ids.map((id, index) =>
      prisma.room.updateMany({
        where: { id, floorId, deletedAt: null },
        data: { sortOrder: index },
      }),
    ),
  )

  const updated = await reloadFloor(floorId, ctx.workspaceId)
  hub.publish({
    workspaceId: ctx.workspaceId,
    type: 'floor.updated',
    data: updated,
    actorId: ctx.user.id,
  })
  return updated
}
