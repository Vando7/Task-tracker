import { z } from 'zod'
import { DEFAULT_FLOOR_COLOR, DEFAULT_FLOOR_ICON, DEFAULT_ROOM_ICON, LIMITS } from '../constants'
import { hexColorSchema, iconSchema, idSchema, timestampSchema } from './common'

export const floorNameSchema = z.string().trim().min(1).max(LIMITS.floorName)
export const roomNameSchema = z.string().trim().min(1).max(LIMITS.roomName)

const sortOrderSchema = z.number().int().min(0).max(9999)

export const roomSchema = z.object({
  id: idSchema,
  floorId: idSchema,
  name: roomNameSchema,
  icon: iconSchema,
  sortOrder: z.number().int(),
  /**
   * Tasks here that are not done. Excludes soft-deleted tasks — the legacy
   * badge counted them, so a deleted task inflated the count forever.
   */
  openTaskCount: z.number().int().nonnegative(),
  /**
   * Room staleness: "bathroom: nothing done in 12 days". Null
   * means nothing has ever been completed in this room, which is a real state
   * and not an error.
   */
  lastCompletedAt: timestampSchema.nullable(),
})
export type Room = z.infer<typeof roomSchema>

export const floorSchema = z.object({
  id: idSchema,
  workspaceId: idSchema,
  name: floorNameSchema,
  icon: iconSchema,
  /** Becomes a CSS custom property on the floor subtree, not 40 inline gradients. */
  color: hexColorSchema,
  sortOrder: z.number().int(),
  rooms: z.array(roomSchema),
  openTaskCount: z.number().int().nonnegative(),
})
export type Floor = z.infer<typeof floorSchema>

/** `GET /api/workspaces/:workspaceId/layout` — the whole home in one round trip. */
export const layoutSchema = z.object({
  workspaceId: idSchema,
  floors: z.array(floorSchema),
})
export type Layout = z.infer<typeof layoutSchema>

export const createFloorSchema = z.object({
  name: floorNameSchema,
  icon: iconSchema.default(DEFAULT_FLOOR_ICON),
  color: hexColorSchema.default(DEFAULT_FLOOR_COLOR),
  sortOrder: sortOrderSchema.optional(),
})
export type CreateFloorInput = z.infer<typeof createFloorSchema>

export const updateFloorSchema = z
  .object({
    name: floorNameSchema,
    icon: iconSchema,
    color: hexColorSchema,
    sortOrder: sortOrderSchema,
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { error: 'nothing to update' })
export type UpdateFloorInput = z.infer<typeof updateFloorSchema>

export const createRoomSchema = z.object({
  name: roomNameSchema,
  icon: iconSchema.default(DEFAULT_ROOM_ICON),
  sortOrder: sortOrderSchema.optional(),
})
export type CreateRoomInput = z.infer<typeof createRoomSchema>

export const updateRoomSchema = z
  .object({
    name: roomNameSchema,
    icon: iconSchema,
    sortOrder: sortOrderSchema,
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { error: 'nothing to update' })
export type UpdateRoomInput = z.infer<typeof updateRoomSchema>

/**
 * Bulk reorder: the ids in their new order. The legacy app had insertion order
 * and no way to change it.
 */
export const reorderSchema = z.object({ ids: z.array(idSchema).min(1).max(200) })
export type ReorderInput = z.infer<typeof reorderSchema>

export const floorIdParamSchema = z.object({ floorId: idSchema })
export const roomIdParamSchema = z.object({ roomId: idSchema })
