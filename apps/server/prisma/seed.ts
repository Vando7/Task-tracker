/**
 * A plausible two-floor house, so `pnpm dev` opens onto something worth looking
 * at rather than an empty state.
 *
 * Deliberately exercises the awkward cases the legacy app got wrong: an
 * unassigned task, a task with no rooms at all, a soft-deleted task that must
 * not show up in badge counts, an overdue task, and recurring tasks with real
 * completion history behind them.
 *
 * Re-runnable: it clears the tables it owns first.
 */

import { hashPassword } from '../src/auth/password'
import { closeDatabase, initDatabase, prisma } from '../src/db'

const SEED_PASSWORD = 'chores-are-fair'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

const now = Date.now()
const at = (offsetMs: number) => new Date(now + offsetMs)

async function clear(): Promise<void> {
  // Order matters: children before parents, because foreign keys are ON.
  await prisma.notifyLog.deleteMany()
  await prisma.pushSubscription.deleteMany()
  await prisma.notifyPreference.deleteMany()
  await prisma.taskCompletion.deleteMany()
  await prisma.taskAssignee.deleteMany()
  await prisma.taskRoom.deleteMany()
  await prisma.task.deleteMany()
  await prisma.room.deleteMany()
  await prisma.floor.deleteMany()
  await prisma.member.deleteMany()
  await prisma.workspace.deleteMany()
  await prisma.emailToken.deleteMany()
  await prisma.session.deleteMany()
  await prisma.user.deleteMany()
}

async function main(): Promise<void> {
  await initDatabase()
  await clear()

  const passwordHash = await hashPassword(SEED_PASSWORD)
  const verifiedAt = at(-30 * DAY)

  const [ivan, mira, deyan] = await Promise.all([
    prisma.user.create({
      data: { email: 'ivan@example.com', name: 'Ivan', passwordHash, emailVerifiedAt: verifiedAt },
    }),
    prisma.user.create({
      data: { email: 'mira@example.com', name: 'Mira', passwordHash, emailVerifiedAt: verifiedAt },
    }),
    prisma.user.create({
      data: { email: 'deyan@example.com', name: 'Deyan', passwordHash, emailVerifiedAt: verifiedAt },
    }),
  ])

  // Everyone gets notification preferences, but `enabled` stays false: push
  // permission is requested contextually, never on page load (section 4.3).
  await prisma.notifyPreference.createMany({
    data: [ivan, mira, deyan].map((user) => ({ userId: user.id, enabled: false })),
  })

  const workspace = await prisma.workspace.create({
    data: {
      name: 'Flat 4B',
      timezone: 'Europe/Sofia',
      createdById: ivan.id,
      members: {
        create: [
          { userId: ivan.id, role: 'owner', joinedAt: at(-30 * DAY) },
          { userId: mira.id, role: 'member', joinedAt: at(-28 * DAY) },
          { userId: deyan.id, role: 'member', joinedAt: at(-14 * DAY) },
        ],
      },
    },
  })

  const ground = await prisma.floor.create({
    data: {
      workspaceId: workspace.id,
      name: 'Ground floor',
      icon: '🏡',
      color: '#2E8B57',
      sortOrder: 0,
      rooms: {
        create: [
          { name: 'Kitchen', icon: '🍳', sortOrder: 0 },
          { name: 'Living room', icon: '🛋️', sortOrder: 1 },
          { name: 'Bathroom', icon: '🛁', sortOrder: 2 },
          { name: 'Hallway', icon: '🚪', sortOrder: 3 },
        ],
      },
    },
    include: { rooms: true },
  })

  const upstairs = await prisma.floor.create({
    data: {
      workspaceId: workspace.id,
      name: 'Upstairs',
      icon: '🛏️',
      // The legacy default purple, kept for continuity (section 5.6).
      color: '#8A2BE2',
      sortOrder: 1,
      rooms: {
        create: [
          { name: 'Bedroom', icon: '🛏️', sortOrder: 0 },
          { name: 'Study', icon: '📚', sortOrder: 1 },
          { name: 'Balcony', icon: '🌿', sortOrder: 2 },
        ],
      },
    },
    include: { rooms: true },
  })

  const room = (name: string): string => {
    const found = [...ground.rooms, ...upstairs.rooms].find((candidate) => candidate.name === name)
    if (!found) throw new Error(`seed: no room named ${name}`)
    return found.id
  }

  /** Bins go out on a fixed day, so this one anchors to the due date, not the completion. */
  await prisma.task.create({
    data: {
      workspaceId: workspace.id,
      name: 'Take the bins out',
      description: 'Green bin on the kerb before 07:00.',
      category: 'urgent',
      dueDate: at(2 * DAY),
      recurrenceEvery: 1,
      recurrenceUnit: 'week',
      recurrenceAnchor: 'dueDate',
      rotateAssignees: true,
      createdById: ivan.id,
      rooms: { create: [{ roomId: room('Kitchen') }, { roomId: room('Hallway') }] },
      assignees: { create: [{ userId: deyan.id, assignedById: ivan.id }] },
    },
  })

  /** Anchored to the completion, with real history behind it. */
  const vacuum = await prisma.task.create({
    data: {
      workspaceId: workspace.id,
      name: 'Vacuum the living room',
      description: 'Under the sofa too.',
      category: 'normal',
      dueDate: at(4 * DAY),
      recurrenceEvery: 2,
      recurrenceUnit: 'week',
      recurrenceAnchor: 'completion',
      createdById: mira.id,
      rooms: { create: [{ roomId: room('Living room') }] },
      assignees: { create: [{ userId: mira.id, assignedById: mira.id }] },
    },
  })
  await prisma.taskCompletion.createMany({
    data: [
      { taskId: vacuum.id, completedById: mira.id, completedAt: at(-24 * DAY) },
      { taskId: vacuum.id, completedById: ivan.id, completedAt: at(-10 * DAY) },
    ],
  })

  /** Unassigned on purpose: "whoever gets to it" is a first-class state. Also overdue. */
  await prisma.task.create({
    data: {
      workspaceId: workspace.id,
      name: 'Clean the bathroom',
      description: 'Sink, shower, mirror.',
      category: 'special',
      dueDate: at(-3 * DAY),
      recurrenceEvery: 1,
      recurrenceUnit: 'week',
      createdById: ivan.id,
      rooms: { create: [{ roomId: room('Bathroom') }] },
    },
  })

  await prisma.task.create({
    data: {
      workspaceId: workspace.id,
      name: 'Descale the kettle',
      category: 'normal',
      createdById: ivan.id,
      rooms: { create: [{ roomId: room('Kitchen') }] },
      assignees: { create: [{ userId: ivan.id, assignedById: ivan.id }] },
    },
  })

  await prisma.task.create({
    data: {
      workspaceId: workspace.id,
      name: 'Water the plants',
      description: 'Balcony pots first, they dry out fastest.',
      category: 'normal',
      dueDate: at(DAY),
      recurrenceEvery: 3,
      recurrenceUnit: 'day',
      createdById: deyan.id,
      rooms: { create: [{ roomId: room('Balcony') }, { roomId: room('Living room') }] },
      assignees: { create: [{ userId: deyan.id, assignedById: deyan.id }] },
    },
  })

  /** Already done, so the Completed list has something in it. */
  const shelf = await prisma.task.create({
    data: {
      workspaceId: workspace.id,
      name: 'Fix the wobbly shelf',
      description: 'Third bracket is loose.',
      category: 'normal',
      status: 'done',
      createdById: mira.id,
      rooms: { create: [{ roomId: room('Study') }] },
      assignees: { create: [{ userId: ivan.id, assignedById: mira.id }] },
    },
  })
  await prisma.taskCompletion.create({
    data: { taskId: shelf.id, completedById: ivan.id, completedAt: at(-5 * DAY) },
  })

  const sheets = await prisma.task.create({
    data: {
      workspaceId: workspace.id,
      name: 'Change the bed sheets',
      category: 'normal',
      dueDate: at(6 * DAY),
      recurrenceEvery: 2,
      recurrenceUnit: 'week',
      rotateAssignees: true,
      createdById: mira.id,
      rooms: { create: [{ roomId: room('Bedroom') }] },
      assignees: { create: [{ userId: mira.id, assignedById: mira.id }] },
    },
  })
  await prisma.taskCompletion.create({
    data: { taskId: sheets.id, completedById: ivan.id, completedAt: at(-8 * DAY) },
  })

  await prisma.task.create({
    data: {
      workspaceId: workspace.id,
      name: 'Deep clean the oven',
      description: 'The good degreaser is under the sink.',
      category: 'special',
      dueDate: at(21 * DAY),
      createdById: ivan.id,
      rooms: { create: [{ roomId: room('Kitchen') }] },
    },
  })

  /**
   * No rooms at all. In the legacy model this was unreachable-by-design and
   * crashed the workspace check; here it is valid, because a task belongs to the
   * workspace directly.
   */
  await prisma.task.create({
    data: {
      workspaceId: workspace.id,
      name: 'Book a plumber for the radiator',
      description: 'Whole-flat job, not tied to one room.',
      category: 'urgent',
      dueDate: at(5 * DAY),
      createdById: ivan.id,
    },
  })

  /** Soft-deleted: must not appear in lists, or in any room badge count. */
  await prisma.task.create({
    data: {
      workspaceId: workspace.id,
      name: 'Old task nobody needs',
      category: 'normal',
      createdById: ivan.id,
      deletedAt: at(-2 * DAY),
      rooms: { create: [{ roomId: room('Hallway') }] },
    },
  })

  const [userCount, taskCount, completionCount] = await Promise.all([
    prisma.user.count(),
    prisma.task.count({ where: { deletedAt: null } }),
    prisma.taskCompletion.count(),
  ])

  console.log(
    [
      '',
      `  Seeded "${workspace.name}" (${workspace.timezone})`,
      `    ${userCount} users, 2 floors, 7 rooms, ${taskCount} live tasks, ${completionCount} completions`,
      '',
      '  Sign in with any of:',
      '    ivan@example.com  ·  mira@example.com  ·  deyan@example.com',
      `    password: ${SEED_PASSWORD}`,
      '',
    ].join('\n'),
  )
}

main()
  .catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(closeDatabase)
