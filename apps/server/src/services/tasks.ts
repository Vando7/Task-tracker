import {
  type AssigneeFilter,
  type CreateTaskInput,
  TASK_CATEGORY_RANK,
  type Task,
  type TaskCategory,
  type TaskList,
  type TaskListQuery,
  type UpdateTaskInput,
} from '@task-tracker/shared'
import type { MemberContext } from '../auth/middleware'
import { prisma } from '../db'
import { hub } from '../events/hub'
import { badRequest, notFound } from '../lib/errors'
import { notifyAssigned, notifyCompletedByOther } from './notifications'
import { cycleKeyFor, isRecurring, nextDueDate, nextInRotation } from './recurrence'
import { serializeTask, taskInclude } from './serialize'

/**
 * Task business logic. Route handlers stay thin: parse, authorize, call one of
 * these, respond. Every mutation that another member can see publishes an SSE
 * event before returning — not optional.
 */

const rankFor = (category: TaskCategory): number => TASK_CATEGORY_RANK[category]

async function fetchTask(taskId: string): Promise<Task> {
  const row = await prisma.task.findUnique({ where: { id: taskId }, include: taskInclude })
  if (!row) throw notFound('Task not found')
  return serializeTask(row)
}

async function loadOwnedTask(taskId: string, workspaceId: string) {
  const task = await prisma.task.findFirst({
    where: { id: taskId, workspaceId, deletedAt: null },
    select: {
      id: true,
      workspaceId: true,
      status: true,
      dueDate: true,
      updatedAt: true,
      recurrenceEvery: true,
      recurrenceUnit: true,
      recurrenceAnchor: true,
      rotateAssignees: true,
      name: true,
      assignees: { select: { userId: true }, orderBy: [{ assignedAt: 'asc' }, { userId: 'asc' }] },
    },
  })

  // Scoping the query by workspaceId is the whole fix: there is no path where a
  // task id from another household resolves, so there is nothing to forget to
  // check afterwards.
  if (!task) throw notFound('Task not found')
  return task
}

/**
 * Rooms attached to a task must live inside the task's own workspace.
 *
 * The legacy app did `Room.objects.get(id=room_id)` with no ownership check in
 * both task creation and `room_add`, so a crafted request created or attached
 * tasks in anyone's rooms. SQLite cannot express this constraint, so it is
 * enforced here and asserted in a test.
 */
async function assertRoomsInWorkspace(
  roomIds: readonly string[],
  workspaceId: string,
): Promise<void> {
  if (roomIds.length === 0) return

  const unique = [...new Set(roomIds)]
  const count = await prisma.room.count({
    where: {
      id: { in: unique },
      deletedAt: null,
      floor: { workspaceId, deletedAt: null },
    },
  })

  if (count !== unique.length) {
    throw notFound('One or more rooms do not exist in this workspace')
  }
}

/** Assignees must be members of the task's workspace. */
async function assertMembers(userIds: readonly string[], workspaceId: string): Promise<void> {
  if (userIds.length === 0) return

  const unique = [...new Set(userIds)]
  const count = await prisma.member.count({
    where: { workspaceId, userId: { in: unique } },
  })

  if (count !== unique.length) {
    throw badRequest('One or more users are not members of this workspace')
  }
}

function assigneeWhere(filter: AssigneeFilter, currentUserId: string) {
  if (filter === 'anyone') return {}
  if (filter === 'mine') return { assignees: { some: { userId: currentUserId } } }
  if (filter === 'unassigned') return { assignees: { none: {} } }
  return { assignees: { some: { userId: { in: [...filter] } } } }
}

export async function listTasks(ctx: MemberContext, query: TaskListQuery): Promise<TaskList> {
  const where = {
    workspaceId: ctx.workspaceId,
    deletedAt: null,
    ...(query.status ? { status: query.status } : {}),
    ...(query.roomId ? { rooms: { some: { roomId: query.roomId } } } : {}),
    // Tasks in *any* room on the floor. The legacy floor view filtered once per
    // room in a loop, which meant "in every room on this floor" — so adding a
    // room silently hid every existing floor-wide task.
    ...(query.floorId
      ? { rooms: { some: { room: { floorId: query.floorId, deletedAt: null } } } }
      : {}),
    // Excluded server-side. The legacy search relied on the client to hide
    // soft-deleted tasks, and the reconciliation path didn't.
    ...(query.search
      ? {
          OR: [{ name: { contains: query.search } }, { description: { contains: query.search } }],
        }
      : {}),
    ...assigneeWhere(query.assignee, ctx.user.id),
  }

  const [rows, total] = await Promise.all([
    prisma.task.findMany({
      where,
      include: taskInclude,
      // urgent -> special -> normal, then most recently touched. Done in SQL so
      // that paging through the completed history cannot reorder across pages.
      orderBy: [{ categoryRank: 'asc' }, { updatedAt: 'desc' }],
      take: query.limit,
      skip: query.offset,
    }),
    prisma.task.count({ where }),
  ])

  const now = new Date()
  return {
    tasks: rows.map((row) => serializeTask(row, now)),
    total,
    hasMore: query.offset + rows.length < total,
  }
}

export async function getTask(ctx: MemberContext, taskId: string): Promise<Task> {
  await loadOwnedTask(taskId, ctx.workspaceId)
  return fetchTask(taskId)
}

export async function createTask(ctx: MemberContext, input: CreateTaskInput): Promise<Task> {
  await Promise.all([
    assertRoomsInWorkspace(input.roomIds, ctx.workspaceId),
    assertMembers(input.assigneeIds, ctx.workspaceId),
  ])

  const created = await prisma.task.create({
    data: {
      workspaceId: ctx.workspaceId,
      name: input.name,
      description: input.description,
      category: input.category,
      categoryRank: rankFor(input.category),
      dueDate: input.dueDate ?? null,
      recurrenceEvery: input.recurrenceEvery ?? null,
      recurrenceUnit: input.recurrenceUnit ?? null,
      recurrenceAnchor: input.recurrenceAnchor,
      rotateAssignees: input.rotateAssignees,
      createdById: ctx.user.id,
      rooms: { create: input.roomIds.map((roomId) => ({ roomId })) },
      assignees: {
        create: input.assigneeIds.map((userId) => ({ userId, assignedById: ctx.user.id })),
      },
    },
    select: { id: true },
  })

  const task = await fetchTask(created.id)
  hub.publish({
    workspaceId: ctx.workspaceId,
    type: 'task.created',
    data: task,
    actorId: ctx.user.id,
  })

  // Whoever was assigned at creation still gets told.
  const others = input.assigneeIds.filter((userId) => userId !== ctx.user.id)
  if (others.length > 0) await notifyAssigned(task, others, ctx.user.id)

  return task
}

export async function updateTask(
  ctx: MemberContext,
  taskId: string,
  input: UpdateTaskInput,
): Promise<Task> {
  await loadOwnedTask(taskId, ctx.workspaceId)

  await prisma.task.update({
    where: { id: taskId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.category !== undefined
        ? { category: input.category, categoryRank: rankFor(input.category) }
        : {}),
      ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
      ...(input.recurrenceEvery !== undefined ? { recurrenceEvery: input.recurrenceEvery } : {}),
      ...(input.recurrenceUnit !== undefined ? { recurrenceUnit: input.recurrenceUnit } : {}),
      ...(input.recurrenceAnchor !== undefined ? { recurrenceAnchor: input.recurrenceAnchor } : {}),
      ...(input.rotateAssignees !== undefined ? { rotateAssignees: input.rotateAssignees } : {}),
    },
  })

  const task = await fetchTask(taskId)
  hub.publish({
    workspaceId: ctx.workspaceId,
    type: 'task.updated',
    data: task,
    actorId: ctx.user.id,
  })
  return task
}

/** Soft delete, so nothing is destroyed and nothing is orphaned. */
export async function deleteTask(ctx: MemberContext, taskId: string): Promise<void> {
  await loadOwnedTask(taskId, ctx.workspaceId)

  await prisma.task.update({ where: { id: taskId }, data: { deletedAt: new Date() } })
  hub.publish({
    workspaceId: ctx.workspaceId,
    type: 'task.deleted',
    data: { id: taskId },
    actorId: ctx.user.id,
  })
}

/**
 * Complete a task.
 *
 * Writes an append-only completion row, and for a recurring task computes the
 * next due date and returns it to `todo` — optionally handing it to the next
 * person in the rotation. The legacy app overwrote a single `completed_date`
 * and never cleared it on reset, so it destroyed its own history *and* reported
 * completions that no longer held.
 */
export async function completeTask(
  ctx: MemberContext,
  taskId: string,
  completedAt: Date = new Date(),
): Promise<Task> {
  const existing = await loadOwnedTask(taskId, ctx.workspaceId)

  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { id: ctx.workspaceId },
    select: { timezone: true },
  })

  const recurring = isRecurring(existing)
  const previousAssigneeIds = existing.assignees.map((assignee) => assignee.userId)

  let rotateTo: string | null = null
  if (recurring && existing.rotateAssignees) {
    const members = await prisma.member.findMany({
      where: { workspaceId: ctx.workspaceId },
      orderBy: [{ joinedAt: 'asc' }, { userId: 'asc' }],
      select: { userId: true },
    })
    rotateTo = nextInRotation(
      members.map((member) => member.userId),
      previousAssigneeIds,
      ctx.user.id,
    )
  }

  await prisma.$transaction(async (tx) => {
    await tx.taskCompletion.create({
      data: { taskId, completedById: ctx.user.id, completedAt },
    })

    if (recurring && existing.recurrenceEvery && existing.recurrenceUnit) {
      const next = nextDueDate({
        spec: {
          every: existing.recurrenceEvery,
          unit: existing.recurrenceUnit as 'day' | 'week' | 'month',
          anchor: existing.recurrenceAnchor as 'completion' | 'dueDate',
        },
        previousDueDate: existing.dueDate,
        completedAt,
        timeZone: workspace.timezone,
      })

      await tx.task.update({
        where: { id: taskId },
        data: { status: 'todo', dueDate: next },
      })

      if (rotateTo) {
        await tx.taskAssignee.deleteMany({ where: { taskId } })
        await tx.taskAssignee.create({
          data: { taskId, userId: rotateTo, assignedById: ctx.user.id },
        })
      }
    } else {
      await tx.task.update({ where: { id: taskId }, data: { status: 'done' } })
    }
  })

  const task = await fetchTask(taskId)
  hub.publish({
    workspaceId: ctx.workspaceId,
    type: 'task.updated',
    data: task,
    actorId: ctx.user.id,
  })

  const otherAssignees = previousAssigneeIds.filter((userId) => userId !== ctx.user.id)
  if (otherAssignees.length > 0) {
    await notifyCompletedByOther(task, otherAssignees, ctx.user.id, completedAt)
  }
  if (rotateTo && rotateTo !== ctx.user.id) {
    await notifyAssigned(task, [rotateTo], ctx.user.id)
  }

  return task
}

/** The manual escape hatch: back to `todo` without touching the completion log. */
export async function reopenTask(ctx: MemberContext, taskId: string): Promise<Task> {
  await loadOwnedTask(taskId, ctx.workspaceId)

  await prisma.task.update({ where: { id: taskId }, data: { status: 'todo' } })

  const task = await fetchTask(taskId)
  hub.publish({
    workspaceId: ctx.workspaceId,
    type: 'task.updated',
    data: task,
    actorId: ctx.user.id,
  })
  return task
}

export async function attachRoom(
  ctx: MemberContext,
  taskId: string,
  roomId: string,
): Promise<Task> {
  await loadOwnedTask(taskId, ctx.workspaceId)
  await assertRoomsInWorkspace([roomId], ctx.workspaceId)

  await prisma.taskRoom.upsert({
    where: { taskId_roomId: { taskId, roomId } },
    create: { taskId, roomId },
    update: {},
  })

  const task = await fetchTask(taskId)
  hub.publish({
    workspaceId: ctx.workspaceId,
    type: 'task.updated',
    data: task,
    actorId: ctx.user.id,
  })
  return task
}

/** A task left with zero rooms is still valid, and stays reachable. */
export async function detachRoom(
  ctx: MemberContext,
  taskId: string,
  roomId: string,
): Promise<Task> {
  await loadOwnedTask(taskId, ctx.workspaceId)

  await prisma.taskRoom.deleteMany({ where: { taskId, roomId } })

  const task = await fetchTask(taskId)
  hub.publish({
    workspaceId: ctx.workspaceId,
    type: 'task.updated',
    data: task,
    actorId: ctx.user.id,
  })
  return task
}

/**
 * Assignment is its own endpoint rather than a generic field update, so it can
 * be notified on and recorded with who assigned whom.
 */
export async function assignUser(
  ctx: MemberContext,
  taskId: string,
  userId: string,
): Promise<Task> {
  await loadOwnedTask(taskId, ctx.workspaceId)
  await assertMembers([userId], ctx.workspaceId)

  const created = await prisma.taskAssignee.upsert({
    where: { taskId_userId: { taskId, userId } },
    create: { taskId, userId, assignedById: ctx.user.id },
    update: {},
    select: { assignedAt: true },
  })

  const task = await fetchTask(taskId)
  hub.publish({
    workspaceId: ctx.workspaceId,
    type: 'task.assigned',
    data: task,
    actorId: ctx.user.id,
  })

  // `upsert` is idempotent, so only notify when this is genuinely new.
  const isNew = Date.now() - created.assignedAt.getTime() < 5_000
  if (isNew && userId !== ctx.user.id) await notifyAssigned(task, [userId], ctx.user.id)

  return task
}

export async function unassignUser(
  ctx: MemberContext,
  taskId: string,
  userId: string,
): Promise<Task> {
  await loadOwnedTask(taskId, ctx.workspaceId)

  await prisma.taskAssignee.deleteMany({ where: { taskId, userId } })

  const task = await fetchTask(taskId)
  hub.publish({
    workspaceId: ctx.workspaceId,
    type: 'task.unassigned',
    data: task,
    actorId: ctx.user.id,
  })
  return task
}

export { cycleKeyFor }
