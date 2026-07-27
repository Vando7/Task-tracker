/**
 * Service worker: push display and notification clicks.
 *
 * Deliberately plain JavaScript in `public/` rather than a TypeScript entry that
 * needs its own build config. The legacy app had two build stories running side
 * by side — webpack for some assets, CDN script tags for others — and adding a
 * second bundler target here would recreate that for no gain.
 *
 * There is no offline caching. This app is useless without the server, so a
 * stale-cache story would only ever show wrong chore data.
 */

self.addEventListener('install', () => {
  // Take over immediately; there is no cached asset version to coordinate.
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  if (!event.data) return

  let payload
  try {
    payload = event.data.json()
  } catch {
    payload = { title: 'Task Tracker', body: event.data.text(), url: '/', tag: 'generic' }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title ?? 'Task Tracker', {
      body: payload.body ?? '',
      // Same tag replaces rather than stacks, so a chore cannot spam the tray.
      tag: payload.tag ?? 'generic',
      data: { url: payload.url ?? '/' },
      icon: '/icon.svg',
      badge: '/icon.svg',
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = event.notification.data?.url ?? '/'

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      })

      // Focus an existing tab rather than opening a duplicate.
      for (const client of clientList) {
        if ('focus' in client) {
          await client.focus()
          if ('navigate' in client) await client.navigate(target)
          return
        }
      }

      await self.clients.openWindow(target)
    })(),
  )
})
