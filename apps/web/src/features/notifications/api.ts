import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  NotificationList,
  NotifyPreference,
  UpdateNotifyPreferenceInput,
  VapidPublicKey,
} from '@task-tracker/shared'
import { api } from '../../lib/api'
import { keys } from '../../lib/keys'

export function useNotifications(workspaceId: string | undefined) {
  return useQuery({
    queryKey: keys.notifications(),
    queryFn: () =>
      api<NotificationList>(
        `/api/notifications${workspaceId ? `?workspaceId=${workspaceId}` : ''}`,
      ),
    enabled: Boolean(workspaceId),
  })
}

export function useNotifyPreferences() {
  return useQuery({
    queryKey: keys.notifyPreferences(),
    queryFn: () => api<NotifyPreference>('/api/notifications/preferences'),
  })
}

export function useUpdateNotifyPreferences() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateNotifyPreferenceInput) =>
      api<NotifyPreference>('/api/notifications/preferences', { method: 'PATCH', body: input }),
    onSuccess: (data) => queryClient.setQueryData(keys.notifyPreferences(), data),
  })
}

export function useMarkAllRead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api<{ ok: true }>('/api/notifications/read-all', { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.notifications() }),
  })
}

function useVapidKey() {
  return useQuery({
    queryKey: keys.vapidKey(),
    queryFn: () => api<VapidPublicKey>('/api/notifications/vapid-public-key'),
    staleTime: Number.POSITIVE_INFINITY,
  })
}

/**
 * VAPID keys arrive base64url encoded; `applicationServerKey` wants raw bytes.
 *
 * Backed by an explicitly allocated `ArrayBuffer` so the result is
 * `Uint8Array<ArrayBuffer>` rather than `Uint8Array<ArrayBufferLike>` — the
 * latter could be backed by a `SharedArrayBuffer`, which `BufferSource` rejects.
 */
const urlBase64ToUint8Array = (base64: string): Uint8Array<ArrayBuffer> => {
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=')
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'))

  const bytes = new Uint8Array(new ArrayBuffer(raw.length))
  for (let index = 0; index < raw.length; index += 1) {
    bytes[index] = raw.charCodeAt(index)
  }
  return bytes
}

export const pushSupported = (): boolean =>
  'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

/**
 * Subscribe this browser to push.
 *
 * Permission is requested here — the moment the user turns notifications on in
 * settings — and never on page load (section 4.3). A refusal is a normal
 * outcome: the in-app feed keeps working and nothing else changes.
 */
export function useEnablePush() {
  const { data: vapid } = useVapidKey()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async () => {
      if (!pushSupported()) throw new Error('This browser cannot do push notifications')
      if (!vapid?.publicKey) throw new Error('Push is not configured on this server')

      const permission = await Notification.requestPermission()
      if (permission !== 'granted') throw new Error('Notification permission was declined')

      const registration = await navigator.serviceWorker.register('/sw.js')
      await navigator.serviceWorker.ready

      const existing = await registration.pushManager.getSubscription()
      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapid.publicKey),
        }))

      await api('/api/notifications/subscribe', { method: 'POST', body: subscription.toJSON() })
      await api('/api/notifications/preferences', { method: 'PATCH', body: { enabled: true } })
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.notifyPreferences() }),
  })
}

export function useDisablePush() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      if (pushSupported()) {
        const registration = await navigator.serviceWorker.getRegistration()
        const subscription = await registration?.pushManager.getSubscription()
        if (subscription) {
          await api('/api/notifications/unsubscribe', {
            method: 'POST',
            body: { endpoint: subscription.endpoint },
          })
          await subscription.unsubscribe()
        }
      }
      await api('/api/notifications/preferences', { method: 'PATCH', body: { enabled: false } })
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.notifyPreferences() }),
  })
}

export const pushPermission = (): NotificationPermission | 'unsupported' =>
  pushSupported() ? Notification.permission : 'unsupported'
