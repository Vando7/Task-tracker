import {
  idParamSchema,
  notificationListQuerySchema,
  pushSubscriptionInputSchema,
  updateNotifyPreferenceSchema,
} from '@task-tracker/shared'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireVerifiedUser } from '../auth/middleware'
import { prisma } from '../db'
import { env, pushEnabled } from '../env'
import { parseOrThrow } from '../lib/validate'
import { serializeNotification } from '../services/serialize'

export async function notificationRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Null public key means push is not configured. The client must treat that as
   * "unavailable" and carry on: notifications are strictly additive, so a server
   * without VAPID keys is a fully working app minus push (section 4.3).
   */
  app.get('/vapid-public-key', async () => ({
    publicKey: pushEnabled ? (env.VAPID_PUBLIC_KEY ?? null) : null,
  }))

  app.get('/preferences', async (request) => {
    const user = requireVerifiedUser(request)
    const preference = await prisma.notifyPreference.upsert({
      where: { userId: user.id },
      create: { userId: user.id },
      update: {},
      select: {
        enabled: true,
        onAssigned: true,
        onDueSoon: true,
        onOverdue: true,
        onCompletedByOther: true,
        dueSoonLeadHours: true,
        quietFrom: true,
        quietTo: true,
      },
    })
    return preference
  })

  app.patch('/preferences', async (request) => {
    const user = requireVerifiedUser(request)
    const input = parseOrThrow(updateNotifyPreferenceSchema, request.body)
    return prisma.notifyPreference.upsert({
      where: { userId: user.id },
      create: { userId: user.id, ...input },
      update: input,
      select: {
        enabled: true,
        onAssigned: true,
        onDueSoon: true,
        onOverdue: true,
        onCompletedByOther: true,
        dueSoonLeadHours: true,
        quietFrom: true,
        quietTo: true,
      },
    })
  })

  /** Idempotent: the same browser re-subscribing updates its row. */
  app.post('/subscribe', async (request, reply) => {
    const user = requireVerifiedUser(request)
    const input = parseOrThrow(pushSubscriptionInputSchema, request.body)

    await prisma.pushSubscription.upsert({
      where: { endpoint: input.endpoint },
      create: {
        userId: user.id,
        endpoint: input.endpoint,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
      },
      update: {
        userId: user.id,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
      },
    })

    return reply.code(201).send({ ok: true })
  })

  app.post('/unsubscribe', async (request) => {
    const user = requireVerifiedUser(request)
    const { endpoint } = parseOrThrow(z.object({ endpoint: z.url().max(2048) }), request.body)
    await prisma.pushSubscription.deleteMany({ where: { userId: user.id, endpoint } })
    return { ok: true }
  })

  /** The in-app feed and unread badge, both backed by the NotifyLog rows. */
  app.get('/', async (request) => {
    const user = requireVerifiedUser(request)
    const query = parseOrThrow(notificationListQuerySchema, request.query)

    const where = {
      userId: user.id,
      ...(query.workspaceId ? { workspaceId: query.workspaceId } : {}),
      ...(query.unreadOnly ? { readAt: null } : {}),
    }

    const [rows, unreadCount] = await Promise.all([
      prisma.notifyLog.findMany({
        where,
        orderBy: { sentAt: 'desc' },
        take: query.limit,
        select: {
          id: true,
          workspaceId: true,
          kind: true,
          taskId: true,
          sentAt: true,
          readAt: true,
          task: { select: { name: true } },
          actor: { select: { id: true, name: true, email: true, avatarPath: true } },
        },
      }),
      prisma.notifyLog.count({ where: { userId: user.id, readAt: null } }),
    ])

    return { notifications: rows.map(serializeNotification), unreadCount }
  })

  app.post('/:id/read', async (request) => {
    const user = requireVerifiedUser(request)
    const { id } = parseOrThrow(idParamSchema, request.params)
    await prisma.notifyLog.updateMany({
      where: { id, userId: user.id, readAt: null },
      data: { readAt: new Date() },
    })
    return { ok: true }
  })

  app.post('/read-all', async (request) => {
    const user = requireVerifiedUser(request)
    await prisma.notifyLog.updateMany({
      where: { userId: user.id, readAt: null },
      data: { readAt: new Date() },
    })
    return { ok: true }
  })
}
