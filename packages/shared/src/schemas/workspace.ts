import { z } from 'zod'
import { LIMITS, MEMBER_ROLES } from '../constants'
import { emailSchema, idSchema, timestampSchema, timezoneSchema } from './common'
import { publicUserSchema } from './user'

export const memberRoleSchema = z.enum(MEMBER_ROLES)

export const workspaceNameSchema = z.string().trim().min(1).max(LIMITS.workspaceName)

/**
 * A workspace is a household.
 *
 * `timezone` lives here rather than on the user: one household, one notion of
 * "today", so every member sees the same overdue state. Quiet hours stay
 * per-user, since those are about sleep.
 */
export const workspaceSchema = z.object({
  id: idSchema,
  name: workspaceNameSchema,
  timezone: timezoneSchema,
  createdById: idSchema.nullable(),
  createdAt: timestampSchema,
  /** The caller's own role, so the client can show or hide owner-only controls. */
  role: memberRoleSchema,
  memberCount: z.number().int().nonnegative(),
})
export type Workspace = z.infer<typeof workspaceSchema>

export const memberSchema = z.object({
  user: publicUserSchema,
  role: memberRoleSchema,
  joinedAt: timestampSchema,
})
export type Member = z.infer<typeof memberSchema>

export const createWorkspaceSchema = z.object({
  name: workspaceNameSchema,
  timezone: timezoneSchema.optional(),
})
export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>

export const updateWorkspaceSchema = z
  .object({
    name: workspaceNameSchema,
    timezone: timezoneSchema,
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { error: 'nothing to update' })
export type UpdateWorkspaceInput = z.infer<typeof updateWorkspaceSchema>

/**
 * Add a member by email. The invitee must already have an account — emailed
 * invite links with a pending state are still an open question, and this is the
 * legacy behaviour in the meantime.
 */
export const addMemberSchema = z.object({
  email: emailSchema,
  role: memberRoleSchema.default('member'),
})
export type AddMemberInput = z.infer<typeof addMemberSchema>

export const workspaceIdParamSchema = z.object({ workspaceId: idSchema })
export const memberParamSchema = z.object({ workspaceId: idSchema, userId: idSchema })
