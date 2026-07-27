import { z } from 'zod'
import { HEX_COLOR_PATTERN, LIMITS } from '../constants'

/**
 * Entity id. Deliberately permissive about the *shape* (uuid and cuid both
 * pass) so the id strategy can change without churning the whole contract,
 * but strict about the character set so ids are always URL- and log-safe.
 */
export const idSchema = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, { error: 'not a valid id' })

/**
 * A timestamp on the way *out* to a client.
 *
 * Accepts what Prisma hands us (a `Date`) or an already-serialised string, and
 * always emits ISO 8601 UTC. This is why response validation is worth doing:
 * it is the single place that guarantees the client never sees two different
 * timestamp formats for the same field.
 */
export const timestampSchema = z
  .union([z.date(), z.iso.datetime({ offset: true })])
  .transform((value) =>
    value instanceof Date ? value.toISOString() : new Date(value).toISOString(),
  )

/** A timestamp arriving *from* a client. Stored as UTC; never a naive local midnight. */
export const dateTimeInputSchema = z
  .union([z.date(), z.iso.datetime({ offset: true })])
  .transform((value) => (value instanceof Date ? value : new Date(value)))

export const hexColorSchema = z
  .string()
  .trim()
  .regex(HEX_COLOR_PATTERN, { error: 'expected a hex colour like #8A2BE2' })

/**
 * An emoji, or any short glyph. Not validated as "is an emoji" on purpose —
 * that check is a losing battle against Unicode, and a wrong one costs the
 * user their icon for no security benefit.
 */
export const iconSchema = z.string().trim().min(1).max(LIMITS.icon)

export const emailSchema = z.email().max(LIMITS.email).trim().toLowerCase()

export const passwordSchema = z
  .string()
  .min(LIMITS.passwordMin, { error: `at least ${LIMITS.passwordMin} characters` })
  .max(LIMITS.passwordMax)

/**
 * An IANA timezone name. Validated against the runtime's own tz database
 * rather than a hardcoded list, so it cannot go stale.
 */
export const timezoneSchema = z
  .string()
  .trim()
  .max(LIMITS.timezone)
  .refine(
    (tz) => {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: tz })
        return true
      } catch {
        return false
      }
    },
    { error: 'not a known IANA timezone' },
  )

/** `HH:MM`, 24-hour, for quiet hours. */
export const clockTimeSchema = z
  .string()
  .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, { error: 'expected HH:MM' })

export const okSchema = z.object({ ok: z.literal(true) })
export type Ok = z.infer<typeof okSchema>

/** Shape of every error body the API produces. */
export const apiErrorSchema = z.object({
  error: z.object({
    message: z.string(),
    code: z.string().optional(),
    /** Field-level detail, present only for validation failures. */
    fields: z.record(z.string(), z.array(z.string())).optional(),
  }),
})
export type ApiError = z.infer<typeof apiErrorSchema>

export const idParamSchema = z.object({ id: idSchema })
