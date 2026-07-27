import webpush from 'web-push'
import { prisma } from '../db'
import { env, pushEnabled } from '../env'

/**
 * Web Push delivery.
 *
 * Required for anything time-based: a deadline reminder that only fires while
 * the tab is open is worthless. Entirely optional infrastructure
 * though — with no VAPID keys configured, every function here becomes a no-op
 * and the app behaves exactly as it would without push.
 */

if (pushEnabled && env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY)
}

export type PushPayload = {
  title: string
  body: string
  /** Deep link to the task, so a tap lands on the thing being talked about. */
  url: string
  tag: string
}

/**
 * Send to every subscription a user has, deleting the ones the push service
 * reports as dead.
 *
 * 404/410 means the browser threw the subscription away (uninstalled the PWA,
 * cleared site data). Keeping those rows means retrying them forever on every
 * scheduler tick, so they go on the spot.
 */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<number> {
  if (!pushEnabled) return 0

  const subscriptions = await prisma.pushSubscription.findMany({
    where: { userId },
    select: { id: true, endpoint: true, p256dh: true, auth: true },
  })
  if (subscriptions.length === 0) return 0

  const body = JSON.stringify(payload)
  const expired: string[] = []
  let delivered = 0

  await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          body,
        )
        delivered += 1
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode
        if (statusCode === 404 || statusCode === 410) {
          expired.push(subscription.id)
        } else {
          console.warn(`[push] delivery failed for ${subscription.id}:`, statusCode ?? error)
        }
      }
    }),
  )

  if (expired.length > 0) {
    await prisma.pushSubscription.deleteMany({ where: { id: { in: expired } } })
  }

  return delivered
}
