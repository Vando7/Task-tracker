import { z } from 'zod'
import { FAIRNESS_WINDOWS } from '../constants'
import { iconSchema, idSchema, timestampSchema } from './common'
import { publicUserSchema } from './user'

export const fairnessWindowSchema = z.enum(FAIRNESS_WINDOWS)

/**
 * Completions per person, from the completion log.
 *
 * Deliberately a plain tally: no points, no streaks, no badges. Gamifying
 * chores between people who live together tends to curdle; an honest count
 * provides the accountability without keeping score.
 */
export const fairnessRowSchema = z.object({
  user: publicUserSchema,
  completions: z.number().int().nonnegative(),
})
export type FairnessRow = z.infer<typeof fairnessRowSchema>

export const fairnessSchema = z.object({
  window: fairnessWindowSchema,
  from: timestampSchema,
  to: timestampSchema,
  rows: z.array(fairnessRowSchema),
  total: z.number().int().nonnegative(),
})
export type Fairness = z.infer<typeof fairnessSchema>

export const fairnessQuerySchema = z.object({
  window: fairnessWindowSchema.default('week'),
})
export type FairnessQuery = z.infer<typeof fairnessQuerySchema>

/**
 * "Bathroom: nothing done in 12 days". Fits the floor-plan
 * metaphor far better than a list, and answers the actual question the home
 * view is asked: what needs attention?
 */
export const roomStalenessSchema = z.object({
  roomId: idSchema,
  roomName: z.string(),
  roomIcon: iconSchema,
  floorId: idSchema,
  floorName: z.string(),
  openTaskCount: z.number().int().nonnegative(),
  lastCompletedAt: timestampSchema.nullable(),
  /** Null when nothing was ever completed here — not zero, which would read as "just done". */
  daysSinceLastCompletion: z.number().int().nonnegative().nullable(),
})
export type RoomStaleness = z.infer<typeof roomStalenessSchema>

export const stalenessSchema = z.object({
  rooms: z.array(roomStalenessSchema),
})
export type Staleness = z.infer<typeof stalenessSchema>
