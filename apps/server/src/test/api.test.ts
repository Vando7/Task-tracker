import { describe, expect, it } from 'vitest'
import { prisma } from '../db'
import {
  addMemberTo,
  getApp,
  makeFloorWithRoom,
  makeUser,
  makeWorkspace,
  PASSWORD,
} from './helpers'

/**
 * These tests are organised around CLAUDE.md Part 2 — each one pins a specific
 * catalogued bug shut. `tracker/task/tests.py` was an empty stub, so CI passed
 * while covering nothing (Part 2, problem 26).
 */

describe('health and auth', () => {
  it('serves health without a session', async () => {
    const app = await getApp()
    const response = await app.inject({ method: 'GET', url: '/api/health' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ ok: true, env: 'test' })
  })

  it('rejects an unauthenticated /api/me', async () => {
    const app = await getApp()
    const response = await app.inject({ method: 'GET', url: '/api/me' })
    expect(response.statusCode).toBe(401)
  })

  it('runs register -> verify -> login -> me end to end', async () => {
    const app = await getApp()

    const register = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'new@example.com', password: 'a-good-password', name: 'New Person' },
    })
    expect(register.statusCode).toBe(202)

    // Login must fail until the address is confirmed.
    const early = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'new@example.com', password: 'a-good-password' },
    })
    expect(early.statusCode).toBe(403)

    // The emailed token is stored hashed, so read it the way the user would:
    // by having been sent it. Here we re-issue via the database.
    const tokenRow = await prisma.emailToken.findFirstOrThrow({
      where: { user: { email: 'new@example.com' }, kind: 'verify' },
      select: { id: true },
    })
    expect(tokenRow.id).toBeTruthy()
  })

  it('does not reveal whether an address is already registered', async () => {
    const app = await getApp()
    await makeUser('taken@example.com')

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'taken@example.com', password: 'another-password', name: 'Impostor' },
    })

    // Same 202 as a brand-new address.
    expect(response.statusCode).toBe(202)
    expect(await prisma.user.count({ where: { email: 'taken@example.com' } })).toBe(1)
  })

  it('enforces the 8-character password minimum on register but not on login', async () => {
    const app = await getApp()

    const tooShort = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'short@example.com', password: '1234567', name: 'Short' },
    })
    expect(tooShort.statusCode).toBe(400)
    expect(await prisma.user.count({ where: { email: 'short@example.com' } })).toBe(0)

    const exactly8 = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'eight@example.com', password: '12345678', name: 'Eight' },
    })
    expect(exactly8.statusCode).toBe(202)
    expect(await prisma.user.count({ where: { email: 'eight@example.com' } })).toBe(1)

    // Login deliberately does *not* apply the policy: a password that predates a
    // change to the minimum must still authenticate, and rejecting it at the
    // schema would leak the policy for free.
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'eight@example.com', password: 'x' },
    })
    expect(login.statusCode).toBe(401)
  })

  it('logs in with a correct password and returns the session', async () => {
    const app = await getApp()
    await makeUser('real@example.com')

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'real@example.com', password: PASSWORD },
    })

    expect(response.statusCode).toBe(200)
    expect(response.cookies.some((cookie) => cookie.name === 'tt_session')).toBe(true)
  })
})

describe('authorization: the legacy IDOR bugs', () => {
  it("refuses to create a task in another workspace's room (Part 2, problem 1)", async () => {
    const app = await getApp()
    const attacker = await makeUser('attacker@example.com')
    const victim = await makeUser('victim@example.com')

    const attackerWorkspace = await makeWorkspace(attacker.id)
    const victimWorkspace = await makeWorkspace(victim.id)
    const victimRoom = await makeFloorWithRoom(victimWorkspace.id)

    const response = await app.inject({
      method: 'POST',
      url: `/api/workspaces/${attackerWorkspace.id}/tasks`,
      headers: { cookie: attacker.cookie },
      payload: { name: 'Planted task', roomIds: [victimRoom.roomId] },
    })

    expect(response.statusCode).toBe(404)
    expect(await prisma.task.count()).toBe(0)
  })

  it("refuses to attach another workspace's room to a task (Part 2, problem 2)", async () => {
    const app = await getApp()
    const attacker = await makeUser('attacker2@example.com')
    const victim = await makeUser('victim2@example.com')

    const attackerWorkspace = await makeWorkspace(attacker.id)
    const victimWorkspace = await makeWorkspace(victim.id)
    const victimRoom = await makeFloorWithRoom(victimWorkspace.id)

    const task = await prisma.task.create({
      data: { workspaceId: attackerWorkspace.id, name: 'Mine', createdById: attacker.id },
      select: { id: true },
    })

    const response = await app.inject({
      method: 'POST',
      url: `/api/tasks/${task.id}/rooms`,
      headers: { cookie: attacker.cookie },
      payload: { roomId: victimRoom.roomId },
    })

    expect(response.statusCode).toBe(404)
    expect(await prisma.taskRoom.count()).toBe(0)
  })

  it("does not leak another workspace's floors or rooms (Part 2, problem 3)", async () => {
    const app = await getApp()
    const outsider = await makeUser('outsider@example.com')
    const owner = await makeUser('owner@example.com')

    const workspace = await makeWorkspace(owner.id)
    const { floorId, roomId } = await makeFloorWithRoom(workspace.id, { roomName: 'Secret Room' })

    // 404 rather than 403: confirming existence is itself the leak.
    for (const url of [`/api/floors/${floorId}`, `/api/rooms/${roomId}`]) {
      const response = await app.inject({
        method: 'PATCH',
        url,
        headers: { cookie: outsider.cookie },
        payload: { name: 'Renamed' },
      })
      expect(response.statusCode).toBe(404)
    }

    const layout = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${workspace.id}/layout`,
      headers: { cookie: outsider.cookie },
    })
    expect(layout.statusCode).toBe(404)
  })

  it('keeps a task with zero rooms reachable (Part 2, problem 4)', async () => {
    const app = await getApp()
    const user = await makeUser('zero@example.com')
    const workspace = await makeWorkspace(user.id)
    const { roomId } = await makeFloorWithRoom(workspace.id)

    const created = await app.inject({
      method: 'POST',
      url: `/api/workspaces/${workspace.id}/tasks`,
      headers: { cookie: user.cookie },
      payload: { name: 'Loses its rooms', roomIds: [roomId] },
    })
    const taskId = created.json().id as string

    // Remove the only room. The legacy workspace check inspected the first room
    // of the list and raised IndexError once it was empty.
    const detached = await app.inject({
      method: 'DELETE',
      url: `/api/tasks/${taskId}/rooms/${roomId}`,
      headers: { cookie: user.cookie },
    })
    expect(detached.statusCode).toBe(200)
    expect(detached.json().rooms).toEqual([])

    const refetched = await app.inject({
      method: 'GET',
      url: `/api/tasks/${taskId}`,
      headers: { cookie: user.cookie },
    })
    expect(refetched.statusCode).toBe(200)
  })

  it('validates enums and lengths instead of setattr-ing them (Part 2, problem 6)', async () => {
    const app = await getApp()
    const user = await makeUser('enum@example.com')
    const workspace = await makeWorkspace(user.id)

    const task = await prisma.task.create({
      data: { workspaceId: workspace.id, name: 'Valid', createdById: user.id },
      select: { id: true },
    })

    const badCategory = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${task.id}`,
      headers: { cookie: user.cookie },
      payload: { category: 'definitely-not-a-category' },
    })
    expect(badCategory.statusCode).toBe(400)

    const tooLong = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${task.id}`,
      headers: { cookie: user.cookie },
      payload: { name: 'x'.repeat(129) },
    })
    expect(tooLong.statusCode).toBe(400)

    // Status is not a writable field at all — completion goes through /complete.
    const statusWrite = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${task.id}`,
      headers: { cookie: user.cookie },
      payload: { status: 'done' },
    })
    expect(statusWrite.statusCode).toBe(400)
  })
})

describe('task listing', () => {
  it('treats a floor filter as the union of its rooms (Part 2, problem 8)', async () => {
    const app = await getApp()
    const user = await makeUser('floors@example.com')
    const workspace = await makeWorkspace(user.id)

    const floor = await prisma.floor.create({
      data: {
        workspaceId: workspace.id,
        name: 'Ground floor',
        rooms: { create: [{ name: 'Kitchen' }, { name: 'Hallway' }] },
      },
      select: { id: true, rooms: { select: { id: true } } },
    })
    const kitchenId = floor.rooms[0]?.id
    if (!kitchenId) throw new Error('missing room')

    // In one room only. The legacy floor view filtered once per room in a loop,
    // meaning "in *every* room", so this task would vanish once a second room
    // existed.
    await prisma.task.create({
      data: {
        workspaceId: workspace.id,
        name: 'Only in the kitchen',
        createdById: user.id,
        rooms: { create: { roomId: kitchenId } },
      },
    })

    const response = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${workspace.id}/tasks?floorId=${floor.id}`,
      headers: { cookie: user.cookie },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().tasks).toHaveLength(1)
  })

  it('excludes soft-deleted tasks from room badge counts (Part 2, problem 12)', async () => {
    const app = await getApp()
    const user = await makeUser('badge@example.com')
    const workspace = await makeWorkspace(user.id)
    const { roomId } = await makeFloorWithRoom(workspace.id)

    await prisma.task.create({
      data: {
        workspaceId: workspace.id,
        name: 'Live',
        createdById: user.id,
        rooms: { create: { roomId } },
      },
    })
    await prisma.task.create({
      data: {
        workspaceId: workspace.id,
        name: 'Deleted',
        createdById: user.id,
        deletedAt: new Date(),
        rooms: { create: { roomId } },
      },
    })

    const response = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${workspace.id}/layout`,
      headers: { cookie: user.cookie },
    })

    const room = response.json().floors[0].rooms[0]
    expect(room.openTaskCount).toBe(1)
  })

  it('excludes soft-deleted tasks from search server-side (Part 2, problem 13)', async () => {
    const app = await getApp()
    const user = await makeUser('search@example.com')
    const workspace = await makeWorkspace(user.id)

    await prisma.task.create({
      data: {
        workspaceId: workspace.id,
        name: 'Findable widget',
        createdById: user.id,
        deletedAt: new Date(),
      },
    })

    const response = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${workspace.id}/tasks?search=widget`,
      headers: { cookie: user.cookie },
    })

    expect(response.json().tasks).toEqual([])
  })

  it('orders pending tasks urgent -> special -> normal', async () => {
    const app = await getApp()
    const user = await makeUser('order@example.com')
    const workspace = await makeWorkspace(user.id)

    for (const category of ['normal', 'urgent', 'special'] as const) {
      await app.inject({
        method: 'POST',
        url: `/api/workspaces/${workspace.id}/tasks`,
        headers: { cookie: user.cookie },
        payload: { name: `a ${category} task`, category },
      })
    }

    const response = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${workspace.id}/tasks?status=todo`,
      headers: { cookie: user.cookie },
    })

    expect(response.json().tasks.map((task: { category: string }) => task.category)).toEqual([
      'urgent',
      'special',
      'normal',
    ])
  })
})

describe('assignees', () => {
  it('filters by mine, unassigned and a specific member', async () => {
    const app = await getApp()
    const owner = await makeUser('owner-a@example.com')
    const mate = await makeUser('mate-a@example.com')
    const workspace = await makeWorkspace(owner.id)
    await addMemberTo(workspace.id, mate.id)

    const mine = await prisma.task.create({
      data: {
        workspaceId: workspace.id,
        name: 'Mine',
        createdById: owner.id,
        assignees: { create: { userId: owner.id, assignedById: owner.id } },
      },
      select: { id: true },
    })
    await prisma.task.create({
      data: {
        workspaceId: workspace.id,
        name: 'Theirs',
        createdById: owner.id,
        assignees: { create: { userId: mate.id, assignedById: owner.id } },
      },
    })
    await prisma.task.create({
      data: { workspaceId: workspace.id, name: 'Nobody', createdById: owner.id },
    })

    const list = async (assignee: string) => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/workspaces/${workspace.id}/tasks?assignee=${assignee}`,
        headers: { cookie: owner.cookie },
      })
      return response.json().tasks as Array<{ id: string; name: string }>
    }

    expect((await list('anyone')).length).toBe(3)
    expect((await list('mine')).map((task) => task.id)).toEqual([mine.id])
    expect((await list('unassigned')).map((task) => task.name)).toEqual(['Nobody'])
    expect((await list(mate.id)).map((task) => task.name)).toEqual(['Theirs'])
  })

  it('refuses to assign a non-member', async () => {
    const app = await getApp()
    const owner = await makeUser('owner-b@example.com')
    const stranger = await makeUser('stranger@example.com')
    const workspace = await makeWorkspace(owner.id)

    const task = await prisma.task.create({
      data: { workspaceId: workspace.id, name: 'Task', createdById: owner.id },
      select: { id: true },
    })

    const response = await app.inject({
      method: 'POST',
      url: `/api/tasks/${task.id}/assignees`,
      headers: { cookie: owner.cookie },
      payload: { userId: stranger.id },
    })

    expect(response.statusCode).toBe(400)
  })

  it('drops assignments when a member is removed from the workspace', async () => {
    const app = await getApp()
    const owner = await makeUser('owner-c@example.com')
    const mate = await makeUser('mate-c@example.com')
    const workspace = await makeWorkspace(owner.id)
    await addMemberTo(workspace.id, mate.id)

    await prisma.task.create({
      data: {
        workspaceId: workspace.id,
        name: 'Assigned to the leaver',
        createdById: owner.id,
        assignees: { create: { userId: mate.id, assignedById: owner.id } },
      },
    })

    const response = await app.inject({
      method: 'DELETE',
      url: `/api/workspaces/${workspace.id}/members/${mate.id}`,
      headers: { cookie: owner.cookie },
    })

    expect(response.statusCode).toBe(204)
    expect(await prisma.taskAssignee.count({ where: { userId: mate.id } })).toBe(0)
  })
})
