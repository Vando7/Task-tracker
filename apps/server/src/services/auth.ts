import type { RegisterInput } from '@task-tracker/shared'
import { hashPassword, verifyPassword } from '../auth/password'
import { destroyAllSessions } from '../auth/session'
import { hashToken, randomToken } from '../auth/tokens'
import { prisma } from '../db'
import { isDevelopment } from '../env'
import { badRequest, forbidden, unauthorized } from '../lib/errors'
import { passwordResetEmail, sendMail, verificationEmail } from './mail'
import { ensurePreference } from './notifications'

/**
 * Email + password authentication. No OAuth, no social login (section 4.2).
 *
 * A recurring theme below: endpoints that take an email address must not become
 * account-existence oracles. Register and reset-request therefore behave
 * identically whether or not the address is known.
 */

const VERIFY_TTL_MS = 24 * 60 * 60 * 1000
const RESET_TTL_MS = 60 * 60 * 1000

async function issueToken(
  userId: string,
  kind: 'verify' | 'reset',
  ttlMs: number,
): Promise<string> {
  const token = randomToken(32)

  await prisma.emailToken.create({
    data: {
      userId,
      kind,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + ttlMs),
    },
  })

  return token
}

/**
 * Always reports success. When the address is already taken we do nothing at
 * all, which is indistinguishable from the outside.
 */
export async function register(input: RegisterInput): Promise<void> {
  const existing = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true },
  })
  if (existing) return

  const user = await prisma.user.create({
    data: {
      email: input.email,
      name: input.name,
      passwordHash: await hashPassword(input.password),
    },
    select: { id: true, email: true },
  })

  await ensurePreference(user.id)

  const token = await issueToken(user.id, 'verify', VERIFY_TTL_MS)
  await sendMail(verificationEmail(user.email, token))
}

async function consumeToken(token: string, kind: 'verify' | 'reset'): Promise<string> {
  const row = await prisma.emailToken.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { id: true, userId: true, kind: true, expiresAt: true, usedAt: true },
  })

  if (!row || row.kind !== kind || row.usedAt || row.expiresAt.getTime() <= Date.now()) {
    throw badRequest('That link is invalid or has expired')
  }

  // Mark used before acting on it, so a double-click cannot use it twice.
  const claimed = await prisma.emailToken.updateMany({
    where: { id: row.id, usedAt: null },
    data: { usedAt: new Date() },
  })
  if (claimed.count === 0) throw badRequest('That link has already been used')

  return row.userId
}

export async function verifyEmail(token: string): Promise<void> {
  const userId = await consumeToken(token, 'verify')
  await prisma.user.update({
    where: { id: userId },
    data: { emailVerifiedAt: new Date() },
  })
}

export async function login(email: string, password: string): Promise<{ userId: string }> {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, passwordHash: true, emailVerifiedAt: true },
  })

  // Same error for unknown address and wrong password.
  if (!user) throw unauthorized('Email or password is incorrect')

  const ok = await verifyPassword(user.passwordHash, password)
  if (!ok) throw unauthorized('Email or password is incorrect')

  // Verification is mandatory before login succeeds (section 4.2). A distinct
  // message here is a deliberate trade: it tells an attacker the address exists,
  // but a user who cannot work out why their correct password is rejected will
  // simply leave.
  if (!user.emailVerifiedAt) {
    throw forbidden('Confirm your email address first — check your inbox for the link')
  }

  return { userId: user.id }
}

/** Always reports success, whether or not the address is known. */
export async function requestPasswordReset(email: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true } })
  if (!user) return

  const token = await issueToken(user.id, 'reset', RESET_TTL_MS)
  await sendMail(passwordResetEmail(user.email, token))
}

/**
 * Resets the password and drops every existing session for that user: if the
 * reset was triggered because someone else had access, leaving their cookie
 * working would defeat the point.
 */
export async function resetPassword(token: string, password: string): Promise<void> {
  const userId = await consumeToken(token, 'reset')

  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(password) },
  })

  await destroyAllSessions(userId)
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { passwordHash: true },
  })

  const ok = await verifyPassword(user.passwordHash, currentPassword)
  if (!ok) throw unauthorized('Current password is incorrect')

  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(newPassword) },
  })
}

/**
 * Development convenience: the console transport already prints the link, but
 * surfacing it in the HTTP response too means the client can show it inline
 * instead of asking the developer to go and read server logs.
 */
export function devTokenHint(token: string): { devToken?: string } {
  return isDevelopment ? { devToken: token } : {}
}
