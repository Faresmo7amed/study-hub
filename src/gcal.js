import { useSyncExternalStore } from 'react'
import { addDays, getStore, iso, onStoreChange, pad, parseISO, setStore, startOfDay, uid } from './shared'
import { EVENT_COLORS } from './todoActions'

/* ============================================================
   Google Calendar sync (talks to Google directly from the browser, no server)
   - Events: two-way. A new, changed or deleted event on either side is copied to the other.
   - Todos: one-way. Each todo of the next weeks appears as an all-day item "☐ text" (☑ when done) and follows
     moves, edits and deletes. Nothing you do in Google changes your todos.
   - Sign-in uses Google Identity Services with the web client id in VITE_GOOGLE_CLIENT_ID. The access token lasts about
     an hour and is kept on this device only (store key "gcal"), so the app asks you to reconnect when it runs out.
   - Events keep two extra fields: gid (the Google event id) and gsig (what the event looked like at the last sync).
   Setup steps are in SETUP_NOTES.md.
   ============================================================ */

const env = import.meta.env || {}
export const CLIENT_ID = env.VITE_GOOGLE_CLIENT_ID || ''
export const gcalConfigured = Boolean(CLIENT_ID)

const SCOPE = 'https://www.googleapis.com/auth/calendar.events'
const API = 'https://www.googleapis.com/calendar/v3'
export const GCAL_KEY = 'gcal'
export const GCAL_DEFAULT = { token: '', exp: 0, on: false, todos: true, last: 0, deleted: [], error: '', stats: null }

const state = () => getStore(GCAL_KEY, GCAL_DEFAULT)
const patchState = patch => setStore(GCAL_KEY, cur => ({ ...cur, ...patch }), GCAL_DEFAULT)
export const tokenValid = g => Boolean(g && g.token && g.exp > Date.now())

/* ---------- is a sync running? (for the UI) ---------- */
let busy = false
const subs = new Set()
const setBusy = v => { busy = v; subs.forEach(f => f()) }
export const useGcalBusy = () => useSyncExternalStore(f => { subs.add(f); return () => subs.delete(f) }, () => busy)

/* ---------- sign-in ---------- */
let gisPromise = null
const loadGIS = () => {
    if (window.google && window.google.accounts && window.google.accounts.oauth2) return Promise.resolve()
    if (!gisPromise) {
        gisPromise = new Promise((resolve, reject) => {
            const s = document.createElement('script')
            s.src = 'https://accounts.google.com/gsi/client'
            s.async = true
            s.onload = () => resolve()
            s.onerror = () => { gisPromise = null; reject(new Error('Could not load Google sign-in. Check your connection.')) }
            document.head.appendChild(s)
        })
    }
    return gisPromise
}

// interactive=false tries to get a new token without showing anything (works while the Google session is alive)
export async function connectGoogle(interactive = true) {
    if (!gcalConfigured) throw new Error('Google Calendar is not set up yet. Add VITE_GOOGLE_CLIENT_ID (see SETUP_NOTES.md).')
    await loadGIS()
    await new Promise((resolve, reject) => {
        const client = window.google.accounts.oauth2.initTokenClient({
            client_id: CLIENT_ID,
            scope: SCOPE,
            callback: r => {
                if (r.error) return reject(new Error(r.error_description || r.error))
                patchState({ token: r.access_token, exp: Date.now() + (Number(r.expires_in) || 3600) * 1000 - 60000, on: true, error: '' })
                return resolve()
            },
            error_callback: e => reject(new Error(e && e.type === 'popup_closed' ? 'The Google window was closed before finishing.' : (e && e.message) || 'Google sign-in failed.')),
        })
        client.requestAccessToken({ prompt: interactive ? '' : 'none' })
    })
}

export function disconnectGoogle() {
    const token = state().token
    try {
        if (token && window.google && window.google.accounts) window.google.accounts.oauth2.revoke(token, () => {})
    } catch { /* already revoked */ }
    patchState({ token: '', exp: 0, on: false, error: '' })
}

/* ---------- Google API ---------- */
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const isRateLimit = (status, t) => status === 429 || (status === 403 && /rate ?limit/i.test(JSON.stringify((t && t.error) || {})))

async function gfetch(path, { method = 'GET', body, params } = {}) {
    const url = new URL(API + path)
    Object.entries(params || {}).forEach(([k, v]) => { if (v != null) url.searchParams.set(k, v) })
    for (let attempt = 0; ; attempt++) {
        const res = await fetch(url, {
            method,
            headers: { Authorization: 'Bearer ' + state().token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
            body: body ? JSON.stringify(body) : undefined,
        })
        if (res.status === 204) return null
        if (res.status === 401) {
            patchState({ token: '', exp: 0 })
            throw Object.assign(new Error('Google sign-in expired. Connect again.'), { code: 'expired' })
        }
        if (res.ok) return res.json()
        const t = await res.json().catch(() => ({}))
        // Google says "too many requests": wait a little longer each time and try again (up to 5 retries)
        if (attempt < 5 && isRateLimit(res.status, t)) {
            await sleep(1000 * 2 ** attempt + Math.random() * 500)
            continue
        }
        throw Object.assign(new Error((t.error && t.error.message) || `Google answered ${res.status}`), { status: res.status })
    }
}

// Runs async jobs a few at a time (Google limits how fast one user can call)
async function pool(jobs, size = 2) {
    const out = []
    let i = 0
    await Promise.all(Array.from({ length: Math.min(size, jobs.length) }, async () => {
        while (i < jobs.length) {
            const n = i++
            out[n] = await jobs[n]()
        }
    }))
    return out
}

/* ---------- converting between the two formats ---------- */
const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone
const localDateTime = d => `${iso(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`
export const evSig = e => JSON.stringify([String(e.title || '').trim(), e.date, e.time || '', e.notes || '', Number(e.remind) || 0])

export function toGoogle(ev) {
    const body = { summary: ev.title || '(no title)', description: ev.notes || '', extendedProperties: { private: { shEvent: ev.id } } }
    if (ev.time) {
        const start = new Date(`${ev.date}T${ev.time}`)
        const end = new Date(start.getTime() + (Number(ev.dur) || 60) * 60000)
        body.start = { dateTime: localDateTime(start), timeZone: tz() }
        body.end = { dateTime: localDateTime(end), timeZone: tz() }
        body.reminders = { useDefault: false, overrides: [{ method: 'popup', minutes: Number(ev.remind) || 0 }] }
    } else {
        body.start = { date: ev.date }
        body.end = { date: iso(addDays(parseISO(ev.date), 1)) }
    }
    return body
}

export function fromGoogle(g) {
    let date = ''
    let time = ''
    let dur = 60
    if (g.start && g.start.dateTime) {
        const s = new Date(g.start.dateTime)
        const e = new Date(g.end && g.end.dateTime ? g.end.dateTime : s.getTime() + 3600000)
        date = iso(s)
        time = `${pad(s.getHours())}:${pad(s.getMinutes())}`
        dur = Math.max(5, Math.round((e - s) / 60000))
    } else if (g.start && g.start.date) {
        date = g.start.date
    }
    let remind = 0
    if (time) {
        const r = g.reminders || {}
        if (r.useDefault) remind = 10
        else {
            const popup = (r.overrides || []).find(o => o.method === 'popup')
            remind = popup ? Number(popup.minutes) || 0 : 0
        }
    }
    return { title: g.summary || '(no title)', notes: g.description || '', date, time, remind, dur }
}

const todoBody = t => ({
    summary: `${t.done ? '☑' : '☐'} ${t.text}`,
    description: ['Study Hub todo', t.link || ''].filter(Boolean).join('\n'),
    start: { date: t.date },
    end: { date: iso(addDays(parseISO(t.date), 1)) },
    transparency: 'transparent',
    extendedProperties: { private: { shTodo: t.id } },
})
const todoSig = t => `${t.done ? 1 : 0}|${t.text}|${t.date}`
const todoSigRemote = r => `${String(r.summary || '').startsWith('☑') ? 1 : 0}|${String(r.summary || '').replace(/^[☑☐]\s?/, '')}|${(r.start && r.start.date) || ''}`

/* ---------- the sync ---------- */
let suppressUntil = 0 // changes we make ourselves must not trigger another sync

async function runSync() {
    if (!tokenValid(state())) throw Object.assign(new Error('Google sign-in expired. Connect again.'), { code: 'expired' })
    const today = startOfDay(new Date())
    const from = addDays(today, -30)
    const to = addDays(today, 365)
    const fromISO = iso(from)
    const toISO = iso(to)
    const stats = { sent: 0, received: 0, removed: 0, todos: 0 }

    // 1. everything Google has in the window
    const remote = []
    let pageToken
    do {
        const r = await gfetch('/calendars/primary/events', {
            params: { timeMin: from.toISOString(), timeMax: to.toISOString(), singleEvents: 'true', showDeleted: 'true', maxResults: '2500', pageToken },
        })
        remote.push(...(r.items || []))
        pageToken = r.nextPageToken
    } while (pageToken)
    const byGid = new Map(remote.map(x => [x.id, x]))
    const priv = x => (x.extendedProperties && x.extendedProperties.private) || {}

    // 2. events deleted here are deleted there
    const deleted = state().deleted || []
    await pool(deleted.map(gid => async () => {
        try { await gfetch(`/calendars/primary/events/${encodeURIComponent(gid)}`, { method: 'DELETE' }) } catch (e) { if (e.status !== 404 && e.status !== 410) throw e }
    }))
    const gone = new Set(deleted)

    // 3. compare every local event with its Google twin
    const local = getStore('events', [])
    const upsert = new Map() // local id -> fields to merge
    const remove = new Set()
    const jobs = []
    for (const ev of local) {
        if (gone.has(ev.gid)) continue
        const sig = evSig(ev)
        if (ev.gid) {
            const r = byGid.get(ev.gid)
            if (!r || r.status === 'cancelled') {
                if (!r && (ev.date < fromISO || ev.date > toISO)) continue // outside the window we cannot tell
                remove.add(ev.id) // deleted in Google
                stats.removed += 1
                continue
            }
            const rf = fromGoogle(r)
            const rSig = evSig({ ...rf, id: ev.id })
            if (sig === ev.gsig && rSig === ev.gsig) continue
            if (sig !== ev.gsig && rSig === ev.gsig) {
                jobs.push(async () => { await gfetch(`/calendars/primary/events/${encodeURIComponent(ev.gid)}`, { method: 'PATCH', body: toGoogle(ev) }) })
                upsert.set(ev.id, { gsig: sig })
                stats.sent += 1
            } else {
                upsert.set(ev.id, { ...rf, gsig: rSig }) // changed in Google (or both: Google wins)
                stats.received += 1
            }
        } else {
            jobs.push(async () => {
                const made = await gfetch('/calendars/primary/events', { method: 'POST', body: toGoogle(ev) })
                upsert.set(ev.id, { gid: made.id, gsig: sig })
            })
            stats.sent += 1
        }
    }
    await pool(jobs)

    // 4. events that exist only in Google
    const known = new Set(local.map(e => e.gid).filter(Boolean))
    const ours = new Map(local.map(e => [e.id, e]))
    const add = []
    for (const r of remote) {
        if (r.status === 'cancelled' || known.has(r.id) || gone.has(r.id) || !r.start) continue
        const p = priv(r)
        if (p.shTodo) continue // a todo mirror, not an event
        const mine = p.shEvent && ours.get(p.shEvent)
        if (mine) {
            if (!mine.gid) upsert.set(mine.id, { gid: r.id, gsig: evSig(mine) })
            continue
        }
        const f = fromGoogle(r)
        if (!f.date) continue
        add.push({ id: p.shEvent || uid(), ...f, color: EVENT_COLORS[0], gid: r.id, gsig: evSig({ ...f }) })
        stats.received += 1
    }

    if (upsert.size || remove.size || add.length) {
        suppressUntil = Date.now() + 2500
        setStore('events', cur => {
            const next = cur.filter(e => !remove.has(e.id)).map(e => (upsert.has(e.id) ? { ...e, ...upsert.get(e.id) } : e))
            const have = new Set(next.map(e => e.id))
            add.forEach(e => { if (!have.has(e.id)) next.push(e) })
            return next
        }, [])
    }

    // 5. todos: mirror to Google, one way
    if (state().todos) {
        const lo = iso(addDays(today, -7))
        const hi = iso(addDays(today, 60))
        const wanted = new Map()
        Object.entries(getStore('todos', {})).forEach(([key, week]) => {
            ;(week || []).forEach((list, d) => {
                const date = iso(addDays(parseISO(key), d))
                if (date < lo || date > hi) return
                list.forEach(t => wanted.set(t.id, { id: t.id, text: t.text, done: !!t.done, link: t.link || '', date }))
            })
        })
        const mirrors = new Map()
        remote.forEach(r => { const p = priv(r); if (p.shTodo && r.status !== 'cancelled') mirrors.set(p.shTodo, r) })
        const tjobs = []
        wanted.forEach(t => {
            const r = mirrors.get(t.id)
            if (!r) tjobs.push(() => gfetch('/calendars/primary/events', { method: 'POST', body: todoBody(t) }))
            else if (todoSigRemote(r) !== todoSig(t)) tjobs.push(() => gfetch(`/calendars/primary/events/${encodeURIComponent(r.id)}`, { method: 'PATCH', body: todoBody(t) }))
        })
        mirrors.forEach((r, id) => {
            const date = r.start && r.start.date
            if (!wanted.has(id) && date && date >= lo && date <= hi) {
                tjobs.push(async () => { try { await gfetch(`/calendars/primary/events/${encodeURIComponent(r.id)}`, { method: 'DELETE' }) } catch (e) { if (e.status !== 404 && e.status !== 410) throw e } })
            }
        })
        await pool(tjobs)
        stats.todos = tjobs.length
    }

    patchState({ last: Date.now(), error: '', stats, deleted: (state().deleted || []).filter(g => !gone.has(g)) })
    return stats
}

let running = null
// Runs one sync at a time. Returns { sent, received, removed, todos }.
export function syncGoogle() {
    if (running) return running
    setBusy(true)
    running = runSync()
        .catch(e => {
            patchState({ error: e.code === 'expired' ? 'expired' : e.message || 'Sync failed.' })
            throw e
        })
        .finally(() => { running = null; setBusy(false) })
    return running
}

/* ---------- automatic sync (call once when the app starts) ---------- */
let started = false
export function startGoogleAutoSync() {
    if (started || !gcalConfigured) return
    started = true
    let timer = null
    let lastSilent = 0
    const attempt = async () => {
        const g = state()
        if (!g.on) return
        if (!tokenValid(g)) {
            if (Date.now() - lastSilent < 600000) return
            lastSilent = Date.now()
            try { await connectGoogle(false) } catch { return } // needs the user: the Settings window shows "Reconnect"
        }
        syncGoogle().catch(() => {})
    }
    const trigger = (delay = 6000) => {
        clearTimeout(timer)
        timer = setTimeout(attempt, delay)
    }
    onStoreChange(key => {
        if ((key === 'events' || key === 'todos') && Date.now() > suppressUntil) trigger()
    })
    window.addEventListener('focus', () => trigger(1500))
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') trigger(1500) })
    setInterval(() => { if (document.visibilityState === 'visible') trigger(500) }, 300000)
    trigger(3000)
}

