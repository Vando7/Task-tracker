import {
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  resetRequestSchema,
  verifyEmailSchema,
} from '@task-tracker/shared'
import type { FastifyInstance } from 'fastify'
import { clearSessionCookie, requireUser } from '../auth/middleware'
import {
  createSession,
  destroyAllSessions,
  destroySession,
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
} from '../auth/session'
import { autoVerifyEmail } from '../env'
import { parseOrThrow } from '../lib/validate'
import { login, register, requestPasswordReset, resetPassword, verifyEmail } from '../services/auth'

/**
 * Login, register and reset-request are rate limited by IP. The keying is
 * deliberate: `@fastify/rate-limit`'s default is per-IP, and for these three we
 * additionally fold the submitted email into the key, so one attacker cannot
 * exhaust a victim's budget and lock them out.
 */
export async function authRoutes(app: FastifyInstance): Promise<void> {
  const sensitive = {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '5 minutes',
        keyGenerator: (request: { ip: string; body?: unknown }) => {
          const email =
            typeof request.body === 'object' && request.body !== null
              ? String((request.body as { email?: unknown }).email ?? '')
              : ''
          return `${request.ip}:${email.toLowerCase()}`
        },
      },
    },
  }

  app.post('/register', sensitive, async (request, reply) => {
    const input = parseOrThrow(registerSchema, request.body)
    await register(input)
    // Always 202, whether or not the address was already taken. The flag is a
    // property of the server's configuration, not of this account, so reporting
    // it leaks nothing.
    return reply.code(202).send({ ok: true, verificationRequired: !autoVerifyEmail })
  })

  app.post('/verify', async (request) => {
    const { token } = parseOrThrow(verifyEmailSchema, request.body)
    await verifyEmail(token)
    return { ok: true }
  })

  app.post('/login', sensitive, async (request, reply) => {
    const input = parseOrThrow(loginSchema, request.body)
    const { userId } = await login(input.email, input.password)

    const session = await createSession(userId, {
      userAgent: request.headers['user-agent'],
      ip: request.ip,
    })

    reply.setCookie(SESSION_COOKIE_NAME, session.id, sessionCookieOptions())
    return { ok: true }
  })

  app.post('/logout', async (request, reply) => {
    const sessionId = request.currentSessionId
    if (sessionId) await destroySession(sessionId)
    clearSessionCookie(reply)
    return { ok: true }
  })

  /** "Log out everywhere" — drops every session row for the user. */
  app.post('/logout-all', async (request, reply) => {
    const user = requireUser(request)
    await destroyAllSessions(user.id)
    clearSessionCookie(reply)
    return { ok: true }
  })

  app.post('/password/reset-request', sensitive, async (request, reply) => {
    const { email } = parseOrThrow(resetRequestSchema, request.body)
    await requestPasswordReset(email)
    return reply.code(202).send({ ok: true })
  })

  app.post('/password/reset', async (request, reply) => {
    const input = parseOrThrow(resetPasswordSchema, request.body)
    await resetPassword(input.token, input.password)
    // Every session is gone, including this one.
    clearSessionCookie(reply)
    return { ok: true }
  })
}
