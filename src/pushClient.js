import * as fb from './firebase'
import { getStore, registerWorker, setStore } from './shared'

/* ============================================================
   Talks to your Cloudflare Worker (see worker/README.md).
   The Worker is what lets Study Hub notify you while the app is closed, and keeps Google Calendar
   connected without popups. Nothing here runs unless VITE_PUSH_URL is set.
   ============================================================ */

const env = import.meta.env || {}
export const PUSH_URL = String(env.VITE_PUSH_URL || '').replace(/\/+$/, '')
const VAPID = env.VITE_VAPID_PUBLIC_KEY || ''
export const workerConfigured = Boolean(PUSH_URL)
export const pushReady = Boolean(PUSH_URL && VAPID)
export const pushSupported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

// What it does: one call to the Worker, signed in with your Firebase token.
// When to use it: for every Worker request. Throws with .status and .code when the Worker says no.
export async function workerCall(path, method = 'GET', body) {
    if (!PUSH_URL) throw Object.assign(new Error('The Worker is not set up.'), { code: 'not_configured' })
    const token = await fb.getIdToken()
    if (!token) throw Object.assign(new Error('Sign in first.'), { code: 'signin' })
    const res = await fetch(PUSH_URL + path, {
        method,
        headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw Object.assign(new Error(data.detail ? `${data.error}: ${data.detail}` : data.error || `The Worker answered ${res.status}`), { status: res.status, code: data.error })
    return data
}

const toKey = text => {
    const s = text.replace(/-/g, '+').replace(/_/g, '/')
    return Uint8Array.from(atob(s + '='.repeat((4 - (s.length % 4)) % 4)), c => c.charCodeAt(0))
}

// What it does: turns on notifications for a closed app on this device.
// When to use it: from a button (the browser only asks for permission after a click).
export async function subscribePush() {
    if (!pushReady) throw new Error('Closed-app notifications are not set up yet (see worker/README.md).')
    if (!pushSupported()) throw new Error('This browser cannot receive push messages. On iPhone, add Study Hub to the Home Screen first.')
    if (Notification.permission === 'default') await Notification.requestPermission()
    if (Notification.permission !== 'granted') throw new Error('Notifications are blocked in the browser settings.')
    await registerWorker()
    const reg = await navigator.serviceWorker.ready
    let sub = await reg.pushManager.getSubscription()
    if (!sub) {
        try {
            sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(VAPID) })
        } catch {
            const old = await reg.pushManager.getSubscription()
            if (old) await old.unsubscribe()
            sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(VAPID) })
        }
    }
    await workerCall('/subscribe', 'POST', { subscription: sub.toJSON() })
    setStore('push', { on: true }, {})
}

// What it does: renews the subscription quietly on each start, if you turned it on before.
export async function ensurePush() {
    if (!pushReady || !pushSupported() || Notification.permission !== 'granted' || !getStore('push', {}).on) return
    try { await subscribePush() } catch { /* offline: next start */ }
}

export async function unsubscribePush() {
    setStore('push', { on: false }, {})
    try {
        const reg = await navigator.serviceWorker.getRegistration()
        const sub = reg && (await reg.pushManager.getSubscription())
        if (sub) {
            await workerCall('/unsubscribe', 'POST', { endpoint: sub.endpoint }).catch(() => {})
            await sub.unsubscribe()
        }
        await workerCall('/reminders', 'PUT', { items: [] }).catch(() => {})
    } catch { /* nothing to remove */ }
}

// What it does: replaces the list of things the Worker will remind you about while the app is closed.
export const syncReminders = items => (getStore('push', {}).on ? workerCall('/reminders', 'PUT', { items }).catch(() => {}) : Promise.resolve())

// What it does: asks the Worker to push a nudge to a friend's phone or computer, even if their app is closed.
export const pushNudge = (group, to, name) => (workerConfigured ? workerCall('/nudge', 'POST', { group, to, name }).catch(() => {}) : Promise.resolve())

export const notifyAdminRequest = () => (workerConfigured ? workerCall('/notify-admin', 'POST', {}).catch(() => {}) : Promise.resolve())
export const notifyApproved = uid => (workerConfigured ? workerCall('/notify-approved', 'POST', { uid }).catch(() => {}) : Promise.resolve())
