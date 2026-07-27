import { z } from 'zod'
import { LIMITS } from '../constants'
import { emailSchema, passwordSchema } from './common'
import { displayNameSchema } from './user'

/**
 * Email + password only. No OAuth, no social login (section 4.2) — so no
 * provider credentials in shell scripts, which is how the legacy app did it.
 */
export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: displayNameSchema,
})
export type RegisterInput = z.infer<typeof registerSchema>

/**
 * Login does not reuse `passwordSchema`: a legacy password that predates the
 * current minimum length must still be able to authenticate, and rejecting it
 * at the schema would leak the policy to an attacker for free.
 */
export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(LIMITS.passwordMax),
})
export type LoginInput = z.infer<typeof loginSchema>

/** Single-use token from a verification or reset email. */
export const emailTokenSchema = z.string().trim().min(16).max(256)

export const verifyEmailSchema = z.object({ token: emailTokenSchema })
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>

export const resetRequestSchema = z.object({ email: emailSchema })
export type ResetRequestInput = z.infer<typeof resetRequestSchema>

export const resetPasswordSchema = z.object({
  token: emailTokenSchema,
  password: passwordSchema,
})
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(LIMITS.passwordMax),
  newPassword: passwordSchema,
})
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>
