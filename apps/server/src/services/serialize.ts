import {
  type Floor,
  floorSchema,
  type Member,
  memberSchema,
  type Notification,
  notificationSchema,
  type PublicUser,
  publicUserSchema,
  type Room,
  roomSchema,
  type SelfUser,
  selfUserSchema,
  type Task,
  taskSchema,
  type Workspace,
  workspaceSchema,
} from '@task-tracker/shared'
import type { Prisma } from '../../generated/prisma/client'
import { isOverdue } from './time'

/**
 * Prisma row -> API shape.
 *
 * Everything goes through the shared schema's `parse`, which is what the "the
 * server validates responses too" rule in CLAUDE.md section 2 buys: a field
 * renamed in the database cannot quietly reach the client as `undefined`, and
 * every timestamp is normalised to one ISO format in exactly one place.
 */

export const publicUserSelect = {
  id: true,
  name: true,
  email: true,
  avatarPath: true,
} as const

/**
 * `satisfies` rather than `as const`: Prisma's input types want mutable arrays,
 * so a fully-readonly literal is rejected, but we still want the shape checked
 * against the schema rather than widened to `any`.
 */
export const taskInclude = {
  rooms: {
    include: {
      room: {
        select: {
          id: true,
          name: true,
          icon: true,
          deletedAt: true,
          floor: { select: { id: true, name: true, color: true, deletedAt: true } },
        },
      },
    },
  },
  assignees: {
    include: { user: { select: publicUserSelect } },
    orderBy: [{ assignedAt: 'asc' }, { userId: 'asc' }],
  },
  completions: {
    orderBy: { completedAt: 'desc' },
    take: 1,
    include: { completedBy: { select: publicUserSelect } },
  },
  _count: { select: { completions: true } },
} satisfies Prisma.TaskInclude

type TaskRow = {
  id: string
  workspaceId: string
  name: string
  description: string
  category: string
  status: string
  dueDate: Date | null
  recurrenceEvery: number | null
  recurrenceUnit: string | null
  recurrenceAnchor: string
  rotateAssignees: boolean
  createdById: string | null
  createdAt: Date
  updatedAt: Date
  rooms: Array<{
    room: {
      id: string
      name: string
      icon: string
      deletedAt: Date | null
      floor: { id: string; name: string; color: string; deletedAt: Date | null }
    }
  }>
  assignees: Array<{
    userId: string
    assignedAt: Date
    assignedById: string | null
    user: { id: string; name: string; email: string; avatarPath: string | null }
  }>
  completions: Array<{
    completedAt: Date
    completedBy: { id: string; name: string; email: string; avatarPath: string | null } | null
  }>
  _count: { completions: number }
}

export function serializeTask(row: TaskRow, now: Date = new Date()): Task {
  const latest = row.completions[0]

  return taskSchema.parse({
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    description: row.description,
    category: row.category,
    status: row.status,
    dueDate: row.dueDate,
    recurrenceEvery: row.recurrenceEvery,
    recurrenceUnit: row.recurrenceUnit,
    recurrenceAnchor: row.recurrenceAnchor,
    rotateAssignees: row.rotateAssignees,
    createdById: row.createdById,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,

    // A soft-deleted room or floor is detached from the task's point of view.
    // The task itself stays reachable, which is the whole point of the direct
    // workspace foreign key.
    rooms: row.rooms
      .filter((link) => link.room.deletedAt === null && link.room.floor.deletedAt === null)
      .map((link) => ({
        id: link.room.id,
        name: link.room.name,
        icon: link.room.icon,
        floorId: link.room.floor.id,
        floorName: link.room.floor.name,
        floorColor: link.room.floor.color,
      })),

    assignees: row.assignees.map((assignee) => ({
      user: assignee.user,
      assignedAt: assignee.assignedAt,
      assignedById: assignee.assignedById,
    })),

    lastCompletedAt: latest?.completedAt ?? null,
    lastCompletedBy: latest?.completedBy ?? null,
    completionCount: row._count.completions,

    isOverdue: row.status !== 'done' && isOverdue(row.dueDate, now),
    isRecurring: row.recurrenceEvery != null && row.recurrenceUnit != null,
  })
}

export function serializePublicUser(row: {
  id: string
  name: string
  email: string
  avatarPath: string | null
}): PublicUser {
  return publicUserSchema.parse(row)
}

export function serializeSelfUser(row: {
  id: string
  name: string
  email: string
  avatarPath: string | null
  emailVerifiedAt: Date | null
  createdAt: Date
}): SelfUser {
  return selfUserSchema.parse(row)
}

export function serializeWorkspace(
  row: { id: string; name: string; timezone: string; createdById: string | null; createdAt: Date },
  role: string,
  memberCount: number,
): Workspace {
  return workspaceSchema.parse({ ...row, role, memberCount })
}

export function serializeMember(row: {
  role: string
  joinedAt: Date
  user: { id: string; name: string; email: string; avatarPath: string | null }
}): Member {
  return memberSchema.parse(row)
}

export function serializeRoom(
  row: { id: string; floorId: string; name: string; icon: string; sortOrder: number },
  openTaskCount: number,
  lastCompletedAt: Date | null,
): Room {
  return roomSchema.parse({ ...row, openTaskCount, lastCompletedAt })
}

export function serializeFloor(
  row: {
    id: string
    workspaceId: string
    name: string
    icon: string
    color: string
    sortOrder: number
  },
  rooms: Room[],
): Floor {
  return floorSchema.parse({
    ...row,
    rooms,
    openTaskCount: rooms.reduce((total, room) => total + room.openTaskCount, 0),
  })
}

export function serializeNotification(row: {
  id: string
  workspaceId: string
  kind: string
  taskId: string | null
  sentAt: Date
  readAt: Date | null
  task: { name: string } | null
  actor: { id: string; name: string; email: string; avatarPath: string | null } | null
}): Notification {
  return notificationSchema.parse({
    id: row.id,
    workspaceId: row.workspaceId,
    kind: row.kind,
    taskId: row.taskId,
    taskName: row.task?.name ?? null,
    actor: row.actor,
    sentAt: row.sentAt,
    readAt: row.readAt,
  })
}
