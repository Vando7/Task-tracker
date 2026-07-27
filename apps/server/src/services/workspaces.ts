import {
  type AddMemberInput,
  type CreateWorkspaceInput,
  DEFAULT_TIMEZONE,
  type Fairness,
  type FairnessWindow,
  type Member,
  type UpdateWorkspaceInput,
  type Workspace,
} from '@task-tracker/shared'
import type { MemberContext } from '../auth/middleware'
import type { SessionUser } from '../auth/session'
import { prisma } from '../db'
import { hub } from '../events/hub'
import { badRequest, conflict, forbidden, notFound } from '../lib/errors'
import { ensurePreference } from './notifications'
import { publicUserSelect, serializeMember, serializeWorkspace } from './serialize'
import { startOfWindow } from './time'

/**
 * Workspace lifecycle.
 *
 * The legacy app auto-created a workspace on *every* login and offered no way to
 * create, rename or delete one — so a user could not name their own household,
 * and a cleared session crashed the index view.
 * Here workspaces are ordinary resources, a user may belong to several, and
 * belonging to none is a normal state the UI handles.
 */

export async function listWorkspaces(user: SessionUser): Promise<Workspace[]> {
  const memberships = await prisma.member.findMany({
    where: { userId: user.id },
    orderBy: { joinedAt: 'asc' },
    select: {
      role: true,
      workspace: {
        select: {
          id: true,
          name: true,
          timezone: true,
          createdById: true,
          createdAt: true,
          _count: { select: { members: true } },
        },
      },
    },
  })

  return memberships.map((membership) =>
    serializeWorkspace(membership.workspace, membership.role, membership.workspace._count.members),
  )
}

export async function createWorkspace(
  user: SessionUser,
  input: CreateWorkspaceInput,
): Promise<Workspace> {
  const created = await prisma.workspace.create({
    data: {
      name: input.name,
      timezone: input.timezone ?? DEFAULT_TIMEZONE,
      createdById: user.id,
      members: { create: { userId: user.id, role: 'owner' } },
    },
    select: {
      id: true,
      name: true,
      timezone: true,
      createdById: true,
      createdAt: true,
      _count: { select: { members: true } },
    },
  })

  await ensurePreference(user.id)
  return serializeWorkspace(created, 'owner', created._count.members)
}

export async function updateWorkspace(
  ctx: MemberContext,
  input: UpdateWorkspaceInput,
): Promise<Workspace> {
  const updated = await prisma.workspace.update({
    where: { id: ctx.workspaceId },
    data: input,
    select: {
      id: true,
      name: true,
      timezone: true,
      createdById: true,
      createdAt: true,
      _count: { select: { members: true } },
    },
  })

  return serializeWorkspace(updated, ctx.role, updated._count.members)
}

/** Owner only. Cascades through floors, rooms, tasks and completions. */
export async function deleteWorkspace(ctx: MemberContext): Promise<void> {
  await prisma.workspace.delete({ where: { id: ctx.workspaceId } })
}

export async function listMembers(ctx: MemberContext): Promise<Member[]> {
  const members = await prisma.member.findMany({
    where: { workspaceId: ctx.workspaceId },
    orderBy: [{ joinedAt: 'asc' }],
    select: { role: true, joinedAt: true, user: { select: publicUserSelect } },
  })
  return members.map(serializeMember)
}

/**
 * Add an existing account by email.
 *
 * Scoped to the workspace in the URL. The legacy endpoints ignored which
 * workspace entirely and did `Workspace.objects.get(created_by=request.user)`,
 * which raised MultipleObjectsReturned for anyone who had created two, and 500'd
 * on an unknown email.
 */
export async function addMember(ctx: MemberContext, input: AddMemberInput): Promise<Member> {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true },
  })

  // A plain 400, not a 500, and deliberately not "no such user" — that would
  // turn this endpoint into an account-existence oracle.
  if (!user) {
    throw badRequest('That address does not have an account yet, so it cannot be added')
  }

  const existing = await prisma.member.findUnique({
    where: { workspaceId_userId: { workspaceId: ctx.workspaceId, userId: user.id } },
    select: { userId: true },
  })
  if (existing) throw conflict('Already a member of this workspace')

  const created = await prisma.member.create({
    data: { workspaceId: ctx.workspaceId, userId: user.id, role: input.role },
    select: { role: true, joinedAt: true, user: { select: publicUserSelect } },
  })

  await ensurePreference(user.id)

  const member = serializeMember(created)
  hub.publish({
    workspaceId: ctx.workspaceId,
    type: 'member.added',
    data: member,
    actorId: ctx.user.id,
  })
  return member
}

/**
 * Removing a member also removes their assignments in that workspace —
 * otherwise the task list would render an assignee who no longer has access.
 */
export async function removeMember(ctx: MemberContext, userId: string): Promise<void> {
  const membership = await prisma.member.findUnique({
    where: { workspaceId_userId: { workspaceId: ctx.workspaceId, userId } },
    select: { role: true },
  })
  if (!membership) throw notFound('Not a member of this workspace')

  if (membership.role === 'owner') {
    const owners = await prisma.member.count({
      where: { workspaceId: ctx.workspaceId, role: 'owner' },
    })
    if (owners <= 1) throw forbidden('A workspace must keep at least one owner')
  }

  await prisma.$transaction([
    prisma.taskAssignee.deleteMany({
      where: { userId, task: { workspaceId: ctx.workspaceId } },
    }),
    prisma.member.delete({
      where: { workspaceId_userId: { workspaceId: ctx.workspaceId, userId } },
    }),
  ])

  hub.publish({
    workspaceId: ctx.workspaceId,
    type: 'member.removed',
    data: { userId },
    actorId: ctx.user.id,
  })
}

/**
 * Completions per person over the last week or month, straight from the
 * completion log.
 *
 * Shared houses don't argue about *what* needs doing — they argue about who's
 * been doing it. Deliberately a plain tally: no points, no streaks, no badges.
 */
export async function getFairness(ctx: MemberContext, window: FairnessWindow): Promise<Fairness> {
  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { id: ctx.workspaceId },
    select: { timezone: true },
  })

  const from = startOfWindow(window, workspace.timezone)
  const to = new Date()

  const [members, groups] = await Promise.all([
    prisma.member.findMany({
      where: { workspaceId: ctx.workspaceId },
      orderBy: [{ joinedAt: 'asc' }],
      select: { user: { select: publicUserSelect } },
    }),
    prisma.taskCompletion.groupBy({
      by: ['completedById'],
      where: {
        completedAt: { gte: from, lte: to },
        task: { workspaceId: ctx.workspaceId },
      },
      _count: { id: true },
    }),
  ])

  const counts = new Map<string, number>()
  for (const group of groups) {
    if (group.completedById) counts.set(group.completedById, group._count.id)
  }

  // Every member appears, including those with zero. A missing row would read as
  // "no data" when it actually means "has done nothing this week", and that
  // distinction is the entire point of the screen.
  const rows = members
    .map((member) => ({ user: member.user, completions: counts.get(member.user.id) ?? 0 }))
    .sort((a, b) => b.completions - a.completions || a.user.name.localeCompare(b.user.name))

  return {
    window,
    from: from.toISOString(),
    to: to.toISOString(),
    rows,
    total: rows.reduce((sum, row) => sum + row.completions, 0),
  }
}
