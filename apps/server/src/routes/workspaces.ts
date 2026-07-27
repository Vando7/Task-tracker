import {
  addMemberSchema,
  createWorkspaceSchema,
  fairnessQuerySchema,
  idParamSchema,
  memberParamSchema,
  updateWorkspaceSchema,
  workspaceIdParamSchema,
} from '@task-tracker/shared'
import type { FastifyInstance } from 'fastify'
import { requireMember, requireVerifiedUser } from '../auth/middleware'
import { parseOrThrow } from '../lib/validate'
import { getStaleness } from '../services/layout'
import {
  addMember,
  createWorkspace,
  deleteWorkspace,
  getFairness,
  listMembers,
  listWorkspaces,
  removeMember,
  updateWorkspace,
} from '../services/workspaces'

export async function workspaceRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', async (request) => {
    const user = requireVerifiedUser(request)
    return listWorkspaces(user)
  })

  app.post('/', async (request, reply) => {
    const user = requireVerifiedUser(request)
    const input = parseOrThrow(createWorkspaceSchema, request.body)
    return reply.code(201).send(await createWorkspace(user, input))
  })

  app.patch('/:id', async (request) => {
    const { id } = parseOrThrow(idParamSchema, request.params)
    const ctx = await requireMember(request, id, 'owner')
    const input = parseOrThrow(updateWorkspaceSchema, request.body)
    return updateWorkspace(ctx, input)
  })

  app.delete('/:id', async (request, reply) => {
    const { id } = parseOrThrow(idParamSchema, request.params)
    const ctx = await requireMember(request, id, 'owner')
    await deleteWorkspace(ctx)
    return reply.code(204).send()
  })

  app.get('/:workspaceId/members', async (request) => {
    const { workspaceId } = parseOrThrow(workspaceIdParamSchema, request.params)
    const ctx = await requireMember(request, workspaceId)
    return listMembers(ctx)
  })

  app.post('/:workspaceId/members', async (request, reply) => {
    const { workspaceId } = parseOrThrow(workspaceIdParamSchema, request.params)
    const ctx = await requireMember(request, workspaceId, 'owner')
    const input = parseOrThrow(addMemberSchema, request.body)
    return reply.code(201).send(await addMember(ctx, input))
  })

  app.delete('/:workspaceId/members/:userId', async (request, reply) => {
    const { workspaceId, userId } = parseOrThrow(memberParamSchema, request.params)
    // A member may always remove themselves; removing anyone else is owner-only.
    const selfRemoval = request.currentUser?.id === userId
    const ctx = await requireMember(request, workspaceId, selfRemoval ? 'member' : 'owner')
    await removeMember(ctx, userId)
    return reply.code(204).send()
  })

  app.get('/:workspaceId/stats/fairness', async (request) => {
    const { workspaceId } = parseOrThrow(workspaceIdParamSchema, request.params)
    const ctx = await requireMember(request, workspaceId)
    const { window } = parseOrThrow(fairnessQuerySchema, request.query)
    return getFairness(ctx, window)
  })

  app.get('/:workspaceId/stats/staleness', async (request) => {
    const { workspaceId } = parseOrThrow(workspaceIdParamSchema, request.params)
    const ctx = await requireMember(request, workspaceId)
    return getStaleness(ctx)
  })
}
