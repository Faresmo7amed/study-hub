/* Study Hub service worker.
   Its jobs: (1) show system notifications (phones only allow this through a service worker),
   (2) bring the app to the front when you tap a notification.
   It does not cache anything, so you always get the latest version of the app. */

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))

self.addEventListener('notificationclick', event => {
    event.notification.close()
    const target = new URL((event.notification.data && event.notification.data.url) || '/#/dashboard', self.location.origin).href
    event.waitUntil((async () => {
        const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
        for (const client of all) {
            if (new URL(client.url).origin === self.location.origin) {
                await client.focus()
                if ('navigate' in client) { try { await client.navigate(target) } catch { /* same page */ } }
                return
            }
        }
        await self.clients.openWindow(target)
    })())
})

// Ready for server-sent push messages later (needs a backend; see SETUP notes). Harmless until then.
self.addEventListener('push', event => {
    let data = {}
    try { data = event.data ? event.data.json() : {} } catch { data = { title: 'Study Hub', body: event.data && event.data.text() } }
    event.waitUntil(self.registration.showNotification(data.title || 'Study Hub', {
        body: data.body || '', icon: '/icon-192.png', badge: '/icon-192.png', data: { url: data.url || '/#/dashboard' },
    }))
})
