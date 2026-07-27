import type { CookieSerializeOptions } from '@fastify/cookie'
import { SESSION_COOKIE_NAME } from '@task-tracker/shared'
import { prisma } from '../db'
import { isProduction } from '../env'
import { randomToken } from './tokens'

/**
 * Opaque server-side sessions.
 *
 * The cookie value *is* the primary key of a `Session` row, so revocation is a
 * row delete — no JWT, no token blocklist, no "it expires in 15 minutes but
 * we can't actually revoke it" compromise.
 */

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

export { SESSION_COOKIE_NAME }

export function sessionCookieOptions(maxAgeMs = SESSION_TTL_MS): CookieSerializeOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    path: '/',
    maxAge: Math.floor(maxAgeMs / 1000),
  }
}

export async function createSession(
  userId: string,
  meta: { userAgent?: string | undefined; ip?: string | undefined } = {},
): Promise<{ id: string; expiresAt: Date }> {
  const id = randomToken(32)
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)

  await prisma.session.create({
    data: {
      id,
      userId,
      expiresAt,
      userAgent: meta.userAgent?.slice(0, 255) ?? null,
      ip: meta.ip ?? null,
    },
  })

  return { id, expiresAt }
}

export type SessionUser = {
  id: string
  email: string
  name: string
  avatarPath: string | null
  emailVerifiedAt: Date | null
  createdAt: Date
}

/**
 * Resolve a cookie value to a user, or null.
 *
 * An expired row is deleted on sight rather than merely ignored, so the table
 * self-cleans on use and the scheduler doesn't have to.
 */
export async function loadSession(sessionId: string): Promise<SessionUser | null> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: {
      expiresAt: true,
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          avatarPath: true,
          emailVerifiedAt: true,
          createdAt: true,
        },
      },
    },
  })

  if (!session) return null

  if (session.expiresAt.getTime() <= Date.now()) {
    await prisma.session.deleteMany({ where: { id: sessionId } })
    return null
  }

  return session.user
}

export async function destroySession(sessionId: string): Promise<void> {
  await prisma.session.deleteMany({ where: { id: sessionId } })
}

/** "Log out everywhere". */
export async function destroyAllSessions(userId: string): Promise<void> {
  await prisma.session.deleteMany({ where: { userId } })
}

/** Housekeeping, called from the scheduler tick. */
export async function pruneExpiredSessions(): Promise<number> {
  const result = await prisma.session.deleteMany({ where: { expiresAt: { lte: new Date() } } })
  return result.count
}
