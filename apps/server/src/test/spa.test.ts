import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Fastify, { type FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { registerWebClient } from '../spa'

/**
 * The production-only branch that serves the built client.
 *
 * This exists because that branch shipped returning 500 for every client route:
 * both @fastify/static registrations passed `decorateReply: false`, so the fallback
 * called a `reply.sendFile` that was never added. Nothing caught it — the API tests
 * run in test mode where the branch is not registered at all, and the one path a
 * person checks by hand is `/`, which the static plugin answers itself without ever
 * reaching the fallback.
 *
 * So this registers it onto a bare Fastify against a fixture directory. No
 * NODE_ENV to fake, no built client needed, and the first assertion below fails
 * loudly if the reply is ever left undecorated again.
 */

const SHELL = '<!doctype html><title>Task Tracker</title><div id="root"></div>'

let app: FastifyInstance
let dist: string

beforeAll(async () => {
  dist = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-spa-'))
  fs.mkdirSync(path.join(dist, 'assets'))
  fs.writeFileSync(path.join(dist, 'index.html'), SHELL)
  fs.writeFileSync(path.join(dist, 'assets', 'index-abc123.js'), 'console.log(1)')

  app = Fastify()
  await registerWebClient(app, dist)
  await app.ready()
})

afterAll(async () => {
  await app.close()
  fs.rmSync(dist, { recursive: true, force: true })
})

describe('serving the built client', () => {
  it('serves the shell for a client route, which is what a reload hits', async () => {
    // The exact shape of URL that answered 500 in production: a deep client route
    // with a query string, reached by a refresh or a notification tap.
    const response = await app.inject({
      method: 'GET',
      url: '/w/019fa477-cb3e-76f8-9b1a-09b487c1fdce/tasks?roomId=019fa548-4688-76cc-a07f-3abe5072b01a',
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toMatch(/text\/html/)
    expect(response.body).toContain('<div id="root">')
  })

  it('serves the shell with 200, not the 404 a not-found handler defaults to', async () => {
    const response = await app.inject({ method: 'GET', url: '/house' })
    expect(response.statusCode).toBe(200)
  })

  it('serves real files as themselves', async () => {
    const asset = await app.inject({ method: 'GET', url: '/assets/index-abc123.js' })
    expect(asset.statusCode).toBe(200)
    expect(asset.body).toBe('console.log(1)')

    const root = await app.inject({ method: 'GET', url: '/' })
    expect(root.statusCode).toBe(200)
    expect(root.body).toContain('<div id="root">')
  })

  it('answers an unknown API path with JSON, never the shell', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/nope' })
    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: { message: 'Not found', code: 'not_found' } })
  })

  it('answers a missing asset with 404 rather than HTML to parse as JavaScript', async () => {
    // A stale shell asking for an asset that a deploy replaced. Handing it the
    // shell turns a missing file into a syntax error a long way from the cause.
    const response = await app.inject({ method: 'GET', url: '/assets/index-gone.js' })
    expect(response.statusCode).toBe(404)
    expect(response.headers['content-type']).toMatch(/application\/json/)
  })

  it('does not answer a non-navigation with the shell', async () => {
    const response = await app.inject({ method: 'POST', url: '/w/abc/tasks' })
    expect(response.statusCode).toBe(404)
    expect(response.json()).toMatchObject({ error: { code: 'not_found' } })
  })
})
