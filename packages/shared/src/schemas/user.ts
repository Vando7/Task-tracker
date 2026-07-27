import { z } from 'zod'
import { LIMITS } from '../constants'
import { emailSchema, idSchema, timestampSchema } from './common'

export const displayNameSchema = z.string().trim().min(1).max(LIMITS.userName)

/**
 * A user as other members of a workspace see them.
 *
 * `avatarPath` is nullable and that is a normal state, not missing data — the
 * client renders an initials avatar so a user without an upload never looks
 * broken.
 */
export const publicUserSchema = z.object({
  id: idSchema,
  name: displayNameSchema,
  email: emailSchema,
  avatarPath: z.string().nullable(),
})
export type PublicUser = z.infer<typeof publicUserSchema>

/** The authenticated user's own record, which carries fields others don't see. */
export const selfUserSchema = publicUserSchema.extend({
  emailVerifiedAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
})
export type SelfUser = z.infer<typeof selfUserSchema>

export const updateProfileSchema = z
  .object({ name: displayNameSchema })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { error: 'nothing to update' })
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>
