import { SESSION_COOKIE_NAME } from '@task-tracker/shared'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../app'
import { hashPassword } from '../auth/password'
import { createSession } from '../auth/session'
import { prisma } from '../db'

export const PASSWORD = 'test-password-123'

let app: FastifyInstance | undefined

/** One app instance for the whole run; `.inject()` needs no listening socket. */
export async function getApp(): Promise<FastifyInstance> {
  if (!app) app = await buildApp()
  return app
}

export async function makeUser(
  email: string,
  options: { verified?: boolean; name?: string } = {},
): Promise<{ id: string; email: string; cookie: string }> {
  const user = await prisma.user.create({
    data: {
      email,
      name: options.name ?? email.split('@')[0] ?? 'Tester',
      passwordHash: await hashPassword(PASSWORD),
      emailVerifiedAt: options.verified === false ? null : new Date(),
    },
    select: { id: true, email: true },
  })

  await prisma.notifyPreference.create({ data: { userId: user.id } })

  const session = await createSession(user.id)
  return { ...user, cookie: `${SESSION_COOKIE_NAME}=${session.id}` }
}

export async function makeWorkspace(
  ownerId: string,
  options: { name?: string; timezone?: string } = {},
): Promise<{ id: string }> {
  return prisma.workspace.create({
    data: {
      name: options.name ?? 'Test House',
      timezone: options.timezone ?? 'UTC',
      createdById: ownerId,
      members: { create: { userId: ownerId, role: 'owner' } },
    },
    select: { id: true },
  })
}

export async function makeFloorWithRoom(
  workspaceId: string,
  options: { floorName?: string; roomName?: string } = {},
): Promise<{ floorId: string; roomId: string }> {
  const floor = await prisma.floor.create({
    data: {
      workspaceId,
      name: options.floorName ?? 'Ground floor',
      rooms: { create: { name: options.roomName ?? 'Kitchen' } },
    },
    select: { id: true, rooms: { select: { id: true } } },
  })

  const roomId = floor.rooms[0]?.id
  if (!roomId) throw new Error('helper failed to create a room')
  return { floorId: floor.id, roomId }
}

export async function addMemberTo(workspaceId: string, userId: string): Promise<void> {
  await prisma.member.create({ data: { workspaceId, userId } })
}
