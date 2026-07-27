import type { MemberRole } from '@task-tracker/shared'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { prisma } from '../db'
import { forbidden, notFound, unauthorized } from '../lib/errors'
import { loadSession, SESSION_COOKIE_NAME, type SessionUser } from './session'

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by `attachUser` on every request. Undefined when not signed in. */
    currentUser?: SessionUser
    currentSessionId?: string
  }
}

/**
 * Resolves the session cookie on every request. Registered as an `onRequest`
 * hook so that authorization is never accidentally skipped by a route that
 * forgot to opt in — routes opt *out* by simply not calling `requireUser`.
 */
export async function attachUser(request: FastifyRequest): Promise<void> {
  const cookie = request.cookies[SESSION_COOKIE_NAME]
  if (!cookie) return

  const user = await loadSession(cookie)
  if (!user) return

  request.currentUser = user
  request.currentSessionId = cookie
}

export function requireUser(request: FastifyRequest): SessionUser {
  const user = request.currentUser
  if (!user) throw unauthorized()
  return user
}

/**
 * Email verification is mandatory before a session is useful.
 * Enforced here as well as at login, so an account verified-then-unverified
 * cannot keep riding an old cookie.
 */
export function requireVerifiedUser(request: FastifyRequest): SessionUser {
  const user = requireUser(request)
  if (!user.emailVerifiedAt) {
    throw forbidden('Verify your email address before continuing')
  }
  return user
}

export type MemberContext = {
  user: SessionUser
  workspaceId: string
  role: MemberRole
}

/**
 * The single authorization gate for everything workspace-scoped.
 *
 * Because `Task.workspaceId` is a direct foreign key, membership is one indexed
 * lookup. The legacy equivalent walked `rooms -> floor -> workspace`, inspected
 * only the *first* room, and raised IndexError on a task with none.
 */
export async function requireMember(
  request: FastifyRequest,
  workspaceId: string,
  minimumRole: MemberRole = 'member',
): Promise<MemberContext> {
  const user = requireVerifiedUser(request)

  const membership = await prisma.member.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: user.id } },
    select: { role: true },
  })

  // Not a member reads as "not found": never confirm that someone else's
  // workspace exists.
  if (!membership) throw notFound('Workspace not found')

  const role = membership.role as MemberRole
  if (minimumRole === 'owner' && role !== 'owner') {
    throw forbidden('Only the workspace owner can do that')
  }

  return { user, workspaceId, role }
}

/** Clears a stale cookie so a client doesn't keep presenting a dead session. */
export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE_NAME, { path: '/' })
}
