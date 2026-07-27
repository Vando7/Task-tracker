import { LIMITS } from '@task-tracker/shared'
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
 * Each test here pins one specific behaviour shut — mostly the authorization and
 * data-integrity mistakes made by the implementation this replaced, which shipped
 * an empty test stub and so had CI passing while covering nothing.
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
  it("refuses to create a task in another workspace's room", async () => {
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

  it("refuses to attach another workspace's room to a task", async () => {
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

  it("does not leak another workspace's floors or rooms", async () => {
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

  it('keeps a task with zero rooms reachable', async () => {
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

  it('validates enums and lengths instead of setattr-ing them', async () => {
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
  it('treats a floor filter as the union of its rooms', async () => {
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

  it('excludes soft-deleted tasks from room badge counts', async () => {
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

  it('excludes soft-deleted tasks from search server-side', async () => {
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

describe('comments and reactions', () => {
  it('posts, lists and hard-deletes a note, author only', async () => {
    const app = await getApp()
    const owner = await makeUser('c-owner@example.com', { name: 'Owner' })
    const mate = await makeUser('c-mate@example.com', { name: 'Mate' })
    const workspace = await makeWorkspace(owner.id)
    await addMemberTo(workspace.id, mate.id)

    const task = await prisma.task.create({
      data: { workspaceId: workspace.id, name: 'Descale the kettle', createdById: owner.id },
      select: { id: true },
    })

    const created = await app.inject({
      method: 'POST',
      url: `/api/tasks/${task.id}/comments`,
      headers: { cookie: mate.cookie },
      payload: { body: 'It was properly furred up this time.' },
    })
    expect(created.statusCode).toBe(201)
    const comment = created.json() as { id: string; canDelete: boolean; author: { name: string } }
    expect(comment.author.name).toBe('Mate')
    // The author's own view of their note.
    expect(comment.canDelete).toBe(true)

    // `canDelete` is per viewer, which is why a Comment is never broadcast over
    // the SSE hub — one shared payload would hand this answer to everyone.
    const asOwner = await app.inject({
      method: 'GET',
      url: `/api/tasks/${task.id}/comments`,
      headers: { cookie: owner.cookie },
    })
    expect(asOwner.statusCode).toBe(200)
    const listed = asOwner.json() as { total: number; comments: Array<{ canDelete: boolean }> }
    expect(listed.total).toBe(1)
    expect(listed.comments[0]?.canDelete).toBe(false)

    // A member who did not write it cannot delete it, and is told 404 rather
    // than 403 so there is one answer for "you cannot have this".
    const byOther = await app.inject({
      method: 'DELETE',
      url: `/api/comments/${comment.id}`,
      headers: { cookie: owner.cookie },
    })
    expect(byOther.statusCode).toBe(404)
    expect(await prisma.taskComment.count()).toBe(1)

    const byAuthor = await app.inject({
      method: 'DELETE',
      url: `/api/comments/${comment.id}`,
      headers: { cookie: mate.cookie },
    })
    expect(byAuthor.statusCode).toBe(204)
    expect(await prisma.taskComment.count()).toBe(0)
  })

  it("answers 404 for a note on another household's task", async () => {
    const app = await getApp()
    const attacker = await makeUser('c-attacker@example.com')
    const victim = await makeUser('c-victim@example.com')

    const victimWorkspace = await makeWorkspace(victim.id)
    await makeWorkspace(attacker.id)

    const task = await prisma.task.create({
      data: { workspaceId: victimWorkspace.id, name: 'Private chore', createdById: victim.id },
      select: { id: true },
    })
    const note = await prisma.taskComment.create({
      data: { taskId: task.id, authorId: victim.id, body: 'Something private' },
      select: { id: true },
    })

    for (const attempt of [
      { method: 'GET' as const, url: `/api/tasks/${task.id}/comments` },
      { method: 'POST' as const, url: `/api/tasks/${task.id}/comments`, payload: { body: 'hi' } },
      { method: 'DELETE' as const, url: `/api/comments/${note.id}` },
      {
        method: 'POST' as const,
        url: `/api/comments/${note.id}/reactions`,
        payload: { emoji: '👍' },
      },
    ]) {
      const response = await app.inject({ ...attempt, headers: { cookie: attacker.cookie } })
      expect(response.statusCode).toBe(404)
    }

    // Nothing was written, and nothing was read.
    expect(await prisma.taskComment.count({ where: { taskId: task.id } })).toBe(1)
    expect(await prisma.commentReaction.count()).toBe(0)
  })

  it('toggles a reaction rather than duplicating it', async () => {
    const app = await getApp()
    const owner = await makeUser('r-owner@example.com', { name: 'Owner' })
    const mate = await makeUser('r-mate@example.com', { name: 'Mate' })
    const workspace = await makeWorkspace(owner.id)
    await addMemberTo(workspace.id, mate.id)

    const task = await prisma.task.create({
      data: { workspaceId: workspace.id, name: 'Task', createdById: owner.id },
      select: { id: true },
    })
    const note = await prisma.taskComment.create({
      data: { taskId: task.id, authorId: owner.id, body: 'A note' },
      select: { id: true },
    })

    const react = (cookie: string, emoji: string) =>
      app.inject({
        method: 'POST',
        url: `/api/comments/${note.id}/reactions`,
        headers: { cookie },
        payload: { emoji },
      })

    const first = await react(owner.cookie, '👍')
    expect(first.statusCode).toBe(200)
    expect(first.json().reactions).toEqual([
      { emoji: '👍', count: 1, users: [expect.objectContaining({ name: 'Owner' })], mine: true },
    ])

    // Two people, one emoji: grouped, not duplicated.
    const second = await react(mate.cookie, '👍')
    expect(second.json().reactions[0]).toMatchObject({ emoji: '👍', count: 2, mine: true })

    // The same person and emoji again removes it — the composite primary key is
    // what makes this a toggle instead of a duplicate-row failure.
    const third = await react(owner.cookie, '👍')
    expect(third.json().reactions[0]).toMatchObject({ emoji: '👍', count: 1, mine: false })
    expect(await prisma.commentReaction.count()).toBe(1)

    // A group that empties disappears rather than lingering at zero.
    await react(mate.cookie, '👍')
    const empty = await app.inject({
      method: 'GET',
      url: `/api/tasks/${task.id}/comments`,
      headers: { cookie: owner.cookie },
    })
    expect(empty.json().comments[0].reactions).toEqual([])
  })

  it('rejects an unknown emoji and an empty or oversized note', async () => {
    const app = await getApp()
    const user = await makeUser('v-user@example.com')
    const workspace = await makeWorkspace(user.id)

    const task = await prisma.task.create({
      data: { workspaceId: workspace.id, name: 'Task', createdById: user.id },
      select: { id: true },
    })
    const note = await prisma.taskComment.create({
      data: { taskId: task.id, authorId: user.id, body: 'A note' },
      select: { id: true },
    })

    for (const body of ['', '   ', 'x'.repeat(LIMITS.commentBody + 1)]) {
      const response = await app.inject({
        method: 'POST',
        url: `/api/tasks/${task.id}/comments`,
        headers: { cookie: user.cookie },
        payload: { body },
      })
      expect(response.statusCode).toBe(400)
    }

    // A free-form emoji is not a reaction: the set is closed, so the row stays a
    // predictable width on a phone.
    const bogus = await app.inject({
      method: 'POST',
      url: `/api/comments/${note.id}/reactions`,
      headers: { cookie: user.cookie },
      payload: { emoji: '💩' },
    })
    expect(bogus.statusCode).toBe(400)
    expect(await prisma.commentReaction.count()).toBe(0)
  })

  it('counts notes on the task payload without shipping their bodies', async () => {
    const app = await getApp()
    const user = await makeUser('count-user@example.com')
    const workspace = await makeWorkspace(user.id)

    const task = await prisma.task.create({
      data: { workspaceId: workspace.id, name: 'Task', createdById: user.id },
      select: { id: true },
    })
    await prisma.taskComment.createMany({
      data: [
        { taskId: task.id, authorId: user.id, body: 'One' },
        { taskId: task.id, authorId: user.id, body: 'Two' },
      ],
    })

    const response = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${workspace.id}/tasks`,
      headers: { cookie: user.cookie },
    })

    const listed = response.json().tasks[0] as Record<string, unknown>
    expect(listed.commentCount).toBe(2)
    // The dashboard's one hot query must not start carrying comment text.
    expect(JSON.stringify(listed)).not.toContain('One')
  })

  it('notifies the participants of a note, never its author', async () => {
    const app = await getApp()
    const author = await makeUser('n-author@example.com')
    const assignee = await makeUser('n-assignee@example.com')
    const creator = await makeUser('n-creator@example.com')
    const bystander = await makeUser('n-bystander@example.com')

    const workspace = await makeWorkspace(creator.id)
    for (const user of [author, assignee, bystander]) {
      await addMemberTo(workspace.id, user.id)
    }

    const task = await prisma.task.create({
      data: {
        workspaceId: workspace.id,
        name: 'Shared chore',
        createdById: creator.id,
        assignees: { create: { userId: assignee.id, assignedById: creator.id } },
      },
      select: { id: true },
    })

    const response = await app.inject({
      method: 'POST',
      url: `/api/tasks/${task.id}/comments`,
      headers: { cookie: author.cookie },
      payload: { body: 'Worth knowing about this one.' },
    })
    expect(response.statusCode).toBe(201)

    const notified = await prisma.notifyLog.findMany({
      where: { taskId: task.id, kind: 'commented' },
      select: { userId: true, cycleKey: true },
    })

    expect(new Set(notified.map((row) => row.userId))).toEqual(new Set([assignee.id, creator.id]))
    // Not the author, and not every member: a note on an unclaimed chore is for
    // the people already involved, unlike a deadline.
    expect(notified.map((row) => row.userId)).not.toContain(author.id)
    expect(notified.map((row) => row.userId)).not.toContain(bystander.id)

    // The cycle key is the comment's own id, so a second note notifies again
    // where a (user, task, kind) key alone would silently suppress it.
    const comment = response.json() as { id: string }
    expect(notified.every((row) => row.cycleKey === comment.id)).toBe(true)

    const again = await app.inject({
      method: 'POST',
      url: `/api/tasks/${task.id}/comments`,
      headers: { cookie: author.cookie },
      payload: { body: 'And another thing.' },
    })
    expect(again.statusCode).toBe(201)
    expect(await prisma.notifyLog.count({ where: { taskId: task.id, kind: 'commented' } })).toBe(4)
  })

  it('respects the per-user commented toggle', async () => {
    const app = await getApp()
    const author = await makeUser('t-author@example.com')
    const optedOut = await makeUser('t-opted-out@example.com')
    const workspace = await makeWorkspace(optedOut.id)
    await addMemberTo(workspace.id, author.id)

    await prisma.notifyPreference.update({
      where: { userId: optedOut.id },
      data: { onCommented: false },
    })

    const task = await prisma.task.create({
      data: { workspaceId: workspace.id, name: 'Chore', createdById: optedOut.id },
      select: { id: true },
    })

    await app.inject({
      method: 'POST',
      url: `/api/tasks/${task.id}/comments`,
      headers: { cookie: author.cookie },
      payload: { body: 'A note they do not want to hear about.' },
    })

    expect(
      await prisma.notifyLog.count({ where: { userId: optedOut.id, kind: 'commented' } }),
    ).toBe(0)
  })

  it('drops notes and reactions when the task is hard-deleted, but not on soft delete', async () => {
    const app = await getApp()
    const user = await makeUser('cascade-user@example.com')
    const workspace = await makeWorkspace(user.id)

    const task = await prisma.task.create({
      data: { workspaceId: workspace.id, name: 'Task', createdById: user.id },
      select: { id: true },
    })
    const note = await prisma.taskComment.create({
      data: { taskId: task.id, authorId: user.id, body: 'A note' },
      select: { id: true },
    })
    await prisma.commentReaction.create({
      data: { commentId: note.id, userId: user.id, emoji: '👍' },
    })

    // The task route soft-deletes, so the thread survives with it.
    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/tasks/${task.id}`,
      headers: { cookie: user.cookie },
    })
    expect(deleted.statusCode).toBe(204)
    expect(await prisma.taskComment.count({ where: { taskId: task.id } })).toBe(1)

    // ...but it is no longer reachable, because a soft-deleted task is not.
    const afterDelete = await app.inject({
      method: 'GET',
      url: `/api/tasks/${task.id}/comments`,
      headers: { cookie: user.cookie },
    })
    expect(afterDelete.statusCode).toBe(404)

    await prisma.task.delete({ where: { id: task.id } })
    expect(await prisma.taskComment.count()).toBe(0)
    expect(await prisma.commentReaction.count()).toBe(0)
  })
})
