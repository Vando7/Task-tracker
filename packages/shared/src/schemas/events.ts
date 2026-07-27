import { z } from 'zod'
import { idSchema, timestampSchema } from './common'
import { floorSchema, roomSchema } from './layout'
import { notificationSchema } from './notification'
import { taskSchema } from './task'
import { memberSchema } from './workspace'

/**
 * Server-Sent Events, replacing the legacy 10-second polling ping.
 *
 * The polling loop could only detect *that* something changed, never *what* —
 * so every change cost two full list fetches, two edits inside one interval
 * collapsed into one, and a change that didn't raise the maximum timestamp was
 * invisible. Each event here carries the changed entity, so the client writes it
 * straight into the query cache.
 */
export const SSE_EVENT_TYPES = [
  'task.created',
  'task.updated',
  'task.deleted',
  'task.assigned',
  'task.unassigned',
  'floor.created',
  'floor.updated',
  'floor.deleted',
  'room.created',
  'room.updated',
  'room.deleted',
  'member.added',
  'member.removed',
  'notification',
] as const
export type SseEventType = (typeof SSE_EVENT_TYPES)[number]

const deletedSchema = z.object({ id: idSchema })

const envelope = <TType extends SseEventType, TData extends z.ZodType>(type: TType, data: TData) =>
  z.object({
    /** Monotonic per hub, so a reconnecting client can be told where it left off. */
    id: z.string(),
    type: z.literal(type),
    workspaceId: idSchema,
    /**
     * Who caused this. Lets a client skip echoing back its own change, which is
     * what makes optimistic updates not flicker.
     */
    actorId: idSchema.nullable(),
    at: timestampSchema,
    data,
  })

export const sseEventSchema = z.discriminatedUnion('type', [
  envelope('task.created', taskSchema),
  envelope('task.updated', taskSchema),
  envelope('task.deleted', deletedSchema),
  envelope('task.assigned', taskSchema),
  envelope('task.unassigned', taskSchema),
  envelope('floor.created', floorSchema),
  envelope('floor.updated', floorSchema),
  envelope('floor.deleted', deletedSchema),
  envelope('room.created', roomSchema),
  envelope('room.updated', roomSchema),
  envelope('room.deleted', deletedSchema),
  envelope('member.added', memberSchema),
  envelope('member.removed', z.object({ userId: idSchema })),
  envelope('notification', notificationSchema),
])
export type SseEvent = z.infer<typeof sseEventSchema>

/** Narrow an event to one type, for exhaustive handling on the client. */
export type SseEventOf<T extends SseEventType> = Extract<SseEvent, { type: T }>

export const eventStreamQuerySchema = z.object({ workspaceId: idSchema })
export type EventStreamQuery = z.infer<typeof eventStreamQuerySchema>
