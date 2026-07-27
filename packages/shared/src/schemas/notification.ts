import { z } from 'zod'
import { NOTIFY_KINDS } from '../constants'
import { clockTimeSchema, idSchema, timestampSchema } from './common'
import { publicUserSchema } from './user'

export const notifyKindSchema = z.enum(NOTIFY_KINDS)

export const notifyPreferenceSchema = z.object({
  /** Master switch. Off means no push and no time-based work for this user at all. */
  enabled: z.boolean(),
  onAssigned: z.boolean(),
  onDueSoon: z.boolean(),
  onOverdue: z.boolean(),
  onCompletedByOther: z.boolean(),
  dueSoonLeadHours: z.number().int().min(1).max(336),
  /** Quiet hours suppress push, never the in-app feed. */
  quietFrom: clockTimeSchema.nullable(),
  quietTo: clockTimeSchema.nullable(),
})
export type NotifyPreference = z.infer<typeof notifyPreferenceSchema>

/** Quiet hours are a range: one end without the other has no meaning. */
const quietHoursPaired = (value: { quietFrom?: string | null; quietTo?: string | null }) =>
  (value.quietFrom == null) === (value.quietTo == null)

export const updateNotifyPreferenceSchema = notifyPreferenceSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, { error: 'nothing to update' })
  .refine(
    (value) =>
      !('quietFrom' in value || 'quietTo' in value) ||
      quietHoursPaired({ quietFrom: value.quietFrom ?? null, quietTo: value.quietTo ?? null }),
    { error: 'quietFrom and quietTo must be set together, or both cleared', path: ['quietFrom'] },
  )
export type UpdateNotifyPreferenceInput = z.infer<typeof updateNotifyPreferenceSchema>

/**
 * Exactly the shape `PushSubscription.toJSON()` produces in the browser, so the
 * client can post it through without reshaping.
 */
export const pushSubscriptionInputSchema = z.object({
  endpoint: z.url().max(2048),
  keys: z.object({
    p256dh: z.string().min(1).max(255),
    auth: z.string().min(1).max(255),
  }),
})
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionInputSchema>

/**
 * Null when the server has no VAPID keys configured. The client must treat that
 * as "push unavailable" and carry on — notifications are strictly additive.
 */
export const vapidPublicKeySchema = z.object({ publicKey: z.string().nullable() })
export type VapidPublicKey = z.infer<typeof vapidPublicKeySchema>

/**
 * One delivered notification.
 *
 * This is the `NotifyLog` row. It does double duty: the (user, task, kind)
 * uniqueness is what stops the scheduler re-sending the same reminder on every
 * tick, and the same rows are the in-app feed behind the unread badge. That is
 * why `readAt` lives here rather than in a separate table.
 */
export const notificationSchema = z.object({
  id: idSchema,
  workspaceId: idSchema,
  kind: notifyKindSchema,
  taskId: idSchema.nullable(),
  taskName: z.string().nullable(),
  actor: publicUserSchema.nullable(),
  sentAt: timestampSchema,
  readAt: timestampSchema.nullable(),
})
export type Notification = z.infer<typeof notificationSchema>

export const notificationListQuerySchema = z.object({
  workspaceId: idSchema.optional(),
  unreadOnly: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((value) => value === true || value === 'true')
    .default(false),
  limit: z.coerce.number().int().min(1).max(100).default(30),
})
export type NotificationListQuery = z.infer<typeof notificationListQuerySchema>

export const notificationListSchema = z.object({
  notifications: z.array(notificationSchema),
  unreadCount: z.number().int().nonnegative(),
})
export type NotificationList = z.infer<typeof notificationListSchema>
