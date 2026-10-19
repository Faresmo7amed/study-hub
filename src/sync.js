import { useSyncExternalStore } from 'react'
import { SYNC_KEYS, applyRemote, clearLocalData, getStore, hasLocalData, notify, onStoreChange, removeKey, setStore, storedKeys } from './shared'
import * as fb from './firebase'

/* ============================================================
   Local-first sync
   - the app always reads and writes localStorage, so it is instant and works offline
   - every change is remembered as "dirty" and pushed to the cloud shortly after
   - every key is its own cloud document, and the newest edit wins per key
   - the bookkeeping lives in the local-only store key "sync":
       { uid, cursor, dirty: [keys], times: {key: ms}, pushed: {key: ms} }
   ============================================================ */

const META = 'sync'
const meta = () => getStore(META, {})
const patchMeta = patch => setStore(META, cur => ({ ...cur, ...patch }), {})

/* ---------- observable state for the UI ---------- */
// phase: off | loading | signedout | syncing | dirty | synced | offline | error | choose
let state = { phase: fb.configured ? 'loading' : 'off', user: null, message: '', lastSync: 0, choose: null }
const subs = new Set()
const set = patch => {
    state = { ...state, ...patch }
    subs.forEach(fn => fn())
}
const subscribe = fn => {
    subs.add(fn)
    return () => subs.delete(fn)
}
export const getSyncUser = () => state.user
export const useSyncState = () => useSyncExternalStore(subscribe, () => state)

/* ---------- one operation at a time ---------- */
let chain = Promise.resolve()
const run = fn => {
    const p = chain.then(fn)
    chain = p.catch(() => {})
    return p
}

let pushTimer = null
let retryTimer = null
let lastRefresh = 0

function handleError(e) {
    const code = (e && e.code) || ''
    const offline = !navigator.onLine || ['unavailable', 'app/timeout', 'auth/network-request-failed'].includes(code)
    if (offline) {
        set({ phase: 'offline', message: 'You are offline. Changes are saved on this device and will sync later.' })
        clearTimeout(retryTimer)
        retryTimer = setTimeout(() => refresh(true), 30000)
        return
    }
    const message = code === 'permission-denied'
        ? 'The cloud refused this change. Check your Firestore rules and that you are signed in.'
        : (e && e.message) || 'Sync failed.'
    if (state.phase !== 'error') notify({ title: 'Sync problem', body: message, icon: '⚠️' })
    set({ phase: 'error', message })
}

function finish() {
    const pending = (meta().dirty || []).length > 0
    set({ phase: pending ? 'dirty' : 'synced', lastSync: Date.now(), message: '' })
    if (pending) schedulePush(500)
}

/* ---------- pull: apply what changed in the cloud ---------- */
async function pullStep() {
    const user = state.user
    if (!user) return
    const docs = await fb.pull(user.uid, meta().cursor || 0)
    let cursor = meta().cursor || 0
    for (const d of docs) {
        cursor = Math.max(cursor, d.serverAt)
        if (!SYNC_KEYS.includes(d.key)) continue
        const m = meta()
        if ((m.pushed || {})[d.key] === d.updatedAt) continue // our own write coming back
        const dirty = (m.dirty || []).includes(d.key)
        if (dirty && ((m.times || {})[d.key] || 0) >= d.updatedAt) continue // our edit is newer, it will be pushed
        let value
        try { value = JSON.parse(d.value) } catch { continue }
        applyRemote(d.key, value)
        patchMeta({ dirty: (m.dirty || []).filter(k => k !== d.key), pushed: { ...(m.pushed || {}), [d.key]: d.updatedAt } })
    }
    patchMeta({ cursor })
}

/* ---------- push: send local edits ---------- */
async function pushStep() {
    const user = state.user
    if (!user) return
    const keys = (meta().dirty || []).filter(k => SYNC_KEYS.includes(k))
    if (!keys.length) return
    set({ phase: 'syncing' })
    for (const key of keys) {
        const updatedAt = (meta().times || {})[key] || Date.now()
        await fb.push(user.uid, key, JSON.stringify(getStore(key, null)), updatedAt)
        const m = meta()
        const unchanged = ((m.times || {})[key] || 0) === updatedAt // no edit while we were sending
        patchMeta({
            pushed: { ...(m.pushed || {}), [key]: updatedAt },
            dirty: unchanged ? (m.dirty || []).filter(k => k !== key) : m.dirty,
        })
    }
}

function schedulePush(delay = 2000) {
    clearTimeout(pushTimer)
    if (state.user && state.phase !== 'choose') set({ phase: 'dirty' })
    pushTimer = setTimeout(() => {
        run(async () => {
            await pushStep()
            finish()
        }).catch(handleError)
    }, delay)
}

function refresh(force) {
    if (!state.user || state.phase === 'choose') return
    if (!force && Date.now() - lastRefresh < 15000) return
    lastRefresh = Date.now()
    run(async () => {
        await pullStep()
        await pushStep()
        finish()
    }).catch(handleError)
}

export function syncNow() {
    return run(async () => {
        set({ phase: 'syncing' })
        await pullStep()
        await pushStep()
        finish()
    }).catch(handleError)
}

/* ---------- first time this account meets this device ---------- */
function adoptCloud(docs, uid) {
    const have = new Set(docs.map(d => d.key))
    SYNC_KEYS.forEach(k => { if (!have.has(k)) removeKey(k) })
    docs.forEach(d => {
        try { applyRemote(d.key, JSON.parse(d.value)) } catch {}
    })
    patchMeta({
        uid,
        cursor: Math.max(0, ...docs.map(d => d.serverAt)),
        dirty: [],
        times: {},
        pushed: Object.fromEntries(docs.map(d => [d.key, d.updatedAt])),
    })
}

async function adoptDevice(docs, uid) {
    const keep = storedKeys()
    const now = Date.now()
    for (const d of docs) {
        if (!keep.includes(d.key)) await fb.remove(uid, d.key)
    }
    patchMeta({
        uid,
        cursor: Math.max(0, ...docs.map(d => d.serverAt)),
        dirty: keep,
        times: Object.fromEntries(keep.map(k => [k, now])),
        pushed: {},
    })
    await pushStep()
}

async function link(user) {
    set({ user, phase: 'syncing', message: '', choose: null })
    try {
        await run(async () => {
            const m = meta()
            if (m.uid === user.uid) {
                await pullStep()
                await pushStep()
                finish()
                return
            }
            const docs = (await fb.pull(user.uid, 0)).filter(d => SYNC_KEYS.includes(d.key))
            const local = hasLocalData()
            const foreign = Boolean(m.uid) // this device was linked to another account
            if (!local) {
                adoptCloud(docs, user.uid)
                finish()
            } else if (!docs.length && !foreign) {
                await adoptDevice(docs, user.uid)
                finish()
            } else {
                set({ phase: 'choose', choose: { user, docs, localKeys: storedKeys(), remoteKeys: docs.map(d => d.key), foreign } })
            }
        })
    } catch (e) {
        handleError(e)
    }
}

export function resolveChoice(which) {
    const c = state.choose
    if (!c) return
    set({ phase: 'syncing', choose: null })
    run(async () => {
        if (which === 'cloud') adoptCloud(c.docs, c.user.uid)
        else await adoptDevice(c.docs, c.user.uid)
        finish()
    }).catch(handleError)
}

export async function signOutAndWipe() {
    await fb.logOut()
    clearLocalData()
    window.location.reload()
}

/* ---------- start once ---------- */
let started = false
export async function startSync() {
    if (started) return
    started = true
    if (!fb.configured) return

    onStoreChange(key => {
        if (!SYNC_KEYS.includes(key) || !meta().uid || state.phase === 'choose') return
        const m = meta()
        patchMeta({ dirty: [...new Set([...(m.dirty || []), key])], times: { ...(m.times || {}), [key]: Date.now() } })
        schedulePush()
    })

    window.addEventListener('focus', () => refresh(false))
    window.addEventListener('online', () => refresh(true))
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') refresh(false)
    })
    setInterval(() => {
        if (document.visibilityState === 'visible') refresh(false)
    }, 120000)

    try {
        await fb.onUser(user => {
            if (user) link(user)
            else set({ user: null, phase: 'signedout', choose: null, message: '' })
        })
    } catch (e) {
        handleError(e)
    }
}
