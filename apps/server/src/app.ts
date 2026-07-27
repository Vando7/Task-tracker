import fs from 'node:fs'
import cookie from '@fastify/cookie'
import multipart from '@fastify/multipart'
import rateLimit from '@fastify/rate-limit'
import fastifyStatic from '@fastify/static'
import Fastify, { type FastifyInstance } from 'fastify'
import { ZodError } from 'zod'
import { attachUser } from './auth/middleware'
import { env, isProduction, isTest, paths } from './env'
import { HttpError } from './lib/errors'
import { authRoutes } from './routes/auth'
import { commentRoutes } from './routes/comments'
import { eventRoutes } from './routes/events'
import { layoutRoutes } from './routes/layout'
import { meRoutes } from './routes/me'
import { notificationRoutes } from './routes/notifications'
import { taskRoutes } from './routes/tasks'
import { workspaceRoutes } from './routes/workspaces'

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: isTest ? false : { level: isProduction ? 'info' : 'warn' },
    trustProxy: isProduction,
    // SSE responses are hijacked and never time out on their own.
    connectionTimeout: 0,
  })

  await app.register(cookie, { secret: env.SESSION_SECRET })
  await app.register(multipart)

  // Off by default; the auth routes opt in per-route. A household app has no
  // reason to throttle its own members browsing task lists.
  await app.register(rateLimit, { global: false, max: 300, timeWindow: '1 minute' })

  // Resolving the session on *every* request means no route can forget to do it.
  // Routes opt out of auth simply by not calling requireUser.
  app.addHook('onRequest', attachUser)

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof HttpError) {
      return reply.code(error.statusCode).send({
        error: {
          message: error.message,
          code: error.code,
          ...(error.fields ? { fields: error.fields } : {}),
        },
      })
    }

    // A schema mismatch on the way *out* is our bug, not the caller's, so it
    // must be loud in the log and opaque in the response.
    if (error instanceof ZodError) {
      request.log.error({ issues: error.issues }, 'response failed schema validation')
      return reply.code(500).send({ error: { message: 'Internal error', code: 'internal' } })
    }

    // Errors raised by Fastify itself (body too large, malformed JSON, rate
    // limit) already carry a client-safe status and message.
    const framework = error as { statusCode?: number; code?: string; message?: string }
    if (framework.statusCode && framework.statusCode >= 400 && framework.statusCode < 500) {
      return reply.code(framework.statusCode).send({
        error: {
          message: framework.message ?? 'Bad request',
          code: framework.code ?? 'bad_request',
        },
      })
    }

    request.log.error({ err: error }, 'unhandled error')
    return reply.code(500).send({ error: { message: 'Internal error', code: 'internal' } })
  })

  app.get('/api/health', async () => ({
    ok: true,
    env: env.NODE_ENV,
    pushConfigured: Boolean(env.VAPID_PUBLIC_KEY),
  }))

  await app.register(authRoutes, { prefix: '/api/auth' })
  await app.register(meRoutes, { prefix: '/api/me' })
  await app.register(workspaceRoutes, { prefix: '/api/workspaces' })
  await app.register(notificationRoutes, { prefix: '/api/notifications' })
  // These own their full paths because floors, rooms and tasks are addressed by
  // their own ids as well as nested under a workspace.
  await app.register(layoutRoutes, { prefix: '/api' })
  await app.register(taskRoutes, { prefix: '/api' })
  await app.register(commentRoutes, { prefix: '/api' })
  await app.register(eventRoutes, { prefix: '/api' })

  // Uploaded avatars.
  fs.mkdirSync(paths.uploadDir, { recursive: true })
  await app.register(fastifyStatic, {
    root: paths.uploadDir,
    prefix: '/uploads/',
    decorateReply: false,
  })

  // In production the server also serves the built client, so deployment is one
  // process and one image.
  if (isProduction && fs.existsSync(paths.webDist)) {
    await app.register(fastifyStatic, {
      root: paths.webDist,
      prefix: '/',
      decorateReply: false,
    })

    // SPA fallback: any non-API path that isn't a real file is client routing.
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/') || request.url.startsWith('/uploads/')) {
        return reply.code(404).send({ error: { message: 'Not found', code: 'not_found' } })
      }
      return reply.sendFile('index.html', paths.webDist)
    })
  } else {
    app.setNotFoundHandler((_request, reply) =>
      reply.code(404).send({ error: { message: 'Not found', code: 'not_found' } }),
    )
  }

  return app
}
