import { eventStreamQuerySchema, SSE_KEEPALIVE_MS, type SseEvent } from '@task-tracker/shared'
import type { FastifyInstance } from 'fastify'
import { requireMember } from '../auth/middleware'
import { hub } from '../events/hub'
import { parseOrThrow } from '../lib/validate'

/**
 * `GET /api/events?workspaceId=…` — one long-lived response per client.
 *
 * SSE rather than WebSockets because nothing here needs a client-to-server
 * stream: all writes stay ordinary POST/PATCH requests. That keeps this to plain
 * HTTP, and `EventSource` handles reconnection on its own.
 */
export async function eventRoutes(app: FastifyInstance): Promise<void> {
  app.get('/events', async (request, reply) => {
    const { workspaceId } = parseOrThrow(eventStreamQuerySchema, request.query)
    const ctx = await requireMember(request, workspaceId)

    // Take over the socket: Fastify must not try to serialise a response body.
    reply.hijack()

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Tells nginx not to buffer, which would otherwise hold events until the
      // response ended — i.e. forever.
      'X-Accel-Buffering': 'no',
    })

    // An immediate comment flushes headers so the client's `onopen` fires now
    // rather than whenever the first real event happens to arrive.
    reply.raw.write(': connected\n\n')

    const send = (event: SseEvent): void => {
      reply.raw.write(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`)
    }

    const unsubscribe = hub.subscribe(workspaceId, { userId: ctx.user.id, send })

    // Comment-only keepalive, so intermediaries don't drop an idle connection.
    const keepalive = setInterval(() => {
      reply.raw.write(': keepalive\n\n')
    }, SSE_KEEPALIVE_MS)

    let closed = false
    const cleanup = (): void => {
      if (closed) return
      closed = true
      clearInterval(keepalive)
      unsubscribe()
    }

    request.raw.on('close', cleanup)
    request.raw.on('error', cleanup)
    reply.raw.on('close', cleanup)
  })

  /** Small operational window into the hub; handy when SSE "isn't working". */
  app.get('/events/stats', async (request) => {
    const { workspaceId } = parseOrThrow(eventStreamQuerySchema, request.query)
    await requireMember(request, workspaceId)
    return {
      workspaceSubscribers: hub.subscriberCount(workspaceId),
      totalSubscribers: hub.subscriberCount(),
    }
  })
}
