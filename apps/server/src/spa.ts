import fastifyStatic from '@fastify/static'
import type { FastifyInstance } from 'fastify'

/**
 * Serving the built client from the API process.
 *
 * Its own module rather than a branch buried in `buildApp`, because the branch only
 * ran in production and so was never once exercised by a test. It shipped broken:
 * both static registrations passed `decorateReply: false`, so `reply.sendFile` did
 * not exist and every deep-link reload — a refresh on `/w/:id/tasks`, a tap on a
 * push notification — answered 500. The root path kept working, because the static
 * plugin serves that one itself and never reaches the fallback, which is exactly
 * why it looked fine.
 *
 * Extracted here it can be registered onto a bare Fastify instance in a test, with
 * no NODE_ENV to fake. See `src/test/spa.test.ts`.
 */
export async function registerWebClient(app: FastifyInstance, root: string): Promise<void> {
  // This registration *does* decorate the reply: `sendFile` below is the whole
  // point of it, and only one @fastify/static registration may add the decorator,
  // which is why the uploads one opts out.
  await app.register(fastifyStatic, { root, prefix: '/' })

  app.setNotFoundHandler((request, reply) => {
    const path = request.url.split('?')[0] ?? '/'

    const wantsApi = path.startsWith('/api/') || path.startsWith('/uploads/')
    // Only a navigation gets the shell. A POST to an unknown path is a genuine
    // 404, and answering it with HTML and a 200 would hide that.
    const isNavigation = request.method === 'GET' || request.method === 'HEAD'
    // A path that names a file is asking for that file, not for a client route — no
    // route this app serves has a dot in it. Returning the shell for a missing
    // `/assets/index-abc123.js` hands the browser HTML to parse as JavaScript,
    // which fails as a syntax error a long way from the real cause.
    const namesAFile = path.includes('.')

    if (wantsApi || !isNavigation || namesAFile) {
      return reply.code(404).send({ error: { message: 'Not found', code: 'not_found' } })
    }

    // Explicitly 200: a not-found handler replies 404 by default, and the shell for
    // a route the *client* does serve is not a missing document.
    return reply.code(200).type('text/html').sendFile('index.html', root)
  })
}
