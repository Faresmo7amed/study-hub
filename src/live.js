import { useSyncExternalStore } from 'react'
import * as fb from './firebase'
import { STUDY_DEFAULT, getStore, notify, onStoreChange, setStore, systemNotify } from './shared'
import { play } from './sound'
import { pushNudge } from './pushClient'

/* ============================================================
   Live layer: one set of Firestore listeners for ALL your groups, running on every page.
   - friends' cards and cheers arrive instantly (no refresh)
   - presence: who is studying, online or offline
   - alerts: a friend starts studying, comes online, nudges or cheers you
   - your own timer follows your card, so a timer started on another device (or tab) appears here at once
   Started by <LiveWatcher /> in App.jsx once you are signed in and approved.
   ============================================================ */

export const ONLINE_MAX = 12 * 3600000 // a "studying" card expires after 12 hours
const ONLINE_MS = 5 * 60000            // seen in the last 5 minutes = online
const STALE_MS = 10 * 60000            // a studying card whose owner was not seen for 10 minutes is not trusted
const BEAT_MS = 120000                 // how often your own "I am here" is written
const COOLDOWN = 20000                 // ms before you can cheer the same friend again

/* ---------- observable data for the screens ---------- */
let snap = { members: {}, cheers: {}, ready: false }
const subs = new Set()
const commit = patch => {
    snap = { ...snap, ...patch }
    subs.forEach(f => f())
}
export const useLive = () => useSyncExternalStore(f => { subs.add(f); return () => subs.delete(f) }, () => snap)
export const getLive = () => snap

// What it does: says what one member is doing right now: 'studying' | 'paused' | 'online' | 'offline'.
// When to use it: for every dot, label or counter that shows presence. t = Date.now().
export function presenceOf(m, t) {
    const seen = m.seen || 0
    const legacy = !seen // a card written by an older version of the app has no "seen"
    const alive = legacy || t - seen < STALE_MS
    if (m.studying > 0 && t - m.studying < ONLINE_MAX && alive) return { state: 'studying', ms: t - m.studying }
    if (!m.studying && typeof m.paused === 'number' && t - (m.updatedAt || 0) < ONLINE_MAX && alive) return { state: 'paused', ms: m.paused }
    const last = Math.max(seen, m.updatedAt || 0)
    if (t - (legacy ? m.updatedAt || 0 : seen) < ONLINE_MS) return { state: 'online', ms: 0, last }
    return { state: 'offline', ms: 0, last }
}
const isOn = (m, t) => presenceOf(m, t).state !== 'offline'

/* ---------- alerts ---------- */
const recent = new Map()
const once = (key, ms = 60000) => {
    const t = Date.now()
    if (t - (recent.get(key) || 0) < ms) return false
    recent.set(key, t)
    return true
}
const groupName = gid => ((getStore('studygroup', STUDY_DEFAULT).groups || []).find(g => g.id === gid) || {}).name || 'your group'

function alertMe({ title, body, icon, tag, sound, sticky = false }) {
    notify({ title, body, icon, sticky })
    if (sound) play(sound)
    if (document.visibilityState !== 'visible') systemNotify(title, body, { tag, url: '/#/studygroup' })
}

/* ---------- your own timer follows your card ---------- */
// "runch" remembers when this device last changed its own timer, so an old card never overrides a newer local action.
let runChanged = Number(getStore('runch', 0)) || 0
onStoreChange(key => {
    if (key !== 'studyrun') return
    runChanged = Date.now()
    setStore('runch', runChanged, 0)
})

// What it does: copies a timer that was started, paused or stopped elsewhere onto this device (without saving minutes twice).
// When to use it: every time your own card arrives from the cloud.
function mirrorRun(card) {
    if (!card.updatedAt || card.updatedAt <= runChanged) return
    const t = Date.now()
    const run = getStore('studyrun', {})
    const on = Boolean(run && (run.on || run.start))
    const acc = on && run.on ? run.acc || 0 : 0
    const since = on ? (run.on ? run.since || 0 : run.start) : 0
    const local = !on ? { k: 'none' } : since ? { k: 'run', v: since - acc } : { k: 'pause', v: acc }
    const remote = card.studying > 0 && t - card.studying < ONLINE_MAX ? { k: 'run', v: card.studying } : !card.studying && typeof card.paused === 'number' ? { k: 'pause', v: card.paused } : { k: 'none' }
    if (local.k === remote.k && (remote.k === 'none' || Math.abs(local.v - remote.v) < 3000)) return
    // silent = true: this write must not look like something you did on this device
    if (remote.k === 'none') {
        setStore('studyrun', {}, {}, true)
        notify({ title: 'Study timer stopped', body: 'You stopped it on another device, and the time was saved there.', icon: '⏹' })
    } else if (remote.k === 'run') {
        setStore('studyrun', { on: true, acc: 0, since: remote.v, subject: (run && run.subject) || '' }, {}, true)
    } else {
        setStore('studyrun', { on: true, acc: remote.v, since: 0, subject: (run && run.subject) || '' }, {}, true)
    }
}

/* ---------- listeners ---------- */
let me = ''
const watchers = new Map() // group id -> { stop }
const firstSnap = new Set() // groups whose first members snapshot arrived (or failed)

const recompute = () => {
    const ids = (getStore('studygroup', STUDY_DEFAULT).groups || []).map(g => g.id)
    commit({ ready: ids.every(id => firstSnap.has(id)) })
}

function onMembers(gid, list) {
    const prev = snap.members[gid]
    const t = Date.now()
    firstSnap.add(gid)
    commit({ members: { ...snap.members, [gid]: list } })
    recompute()
    if (prev) {
        list.forEach(m => {
            if (m.uid === me) return
            const was = prev.find(x => x.uid === m.uid)
            const now = presenceOf(m, t).state
            const before = was ? presenceOf(was, t).state : 'offline'
            if (now === 'studying' && before !== 'studying') {
                if (once(`study-${m.uid}`)) alertMe({ title: `${m.name} is studying`, body: `${groupName(gid)} · join in and keep up!`, icon: '📖', tag: `study-${m.uid}`, sound: 'friendon' })
            } else if (now === 'online' && before === 'offline') {
                if (once(`online-${m.uid}`, 10 * 60000)) alertMe({ title: `${m.name} is online`, body: `${groupName(gid)} · say hi, or nudge them to study.`, icon: '🟢', tag: `online-${m.uid}`, sound: 'friendon' })
            }
        })
    }
    const mine = list.find(x => x.uid === me)
    if (mine) mirrorRun(mine)
}

function onCheers(gid, list) {
    commit({ cheers: { ...snap.cheers, [gid]: list } })
    const seen = getStore('cheerseen', {})
    const next = { ...seen }
    const t = Date.now()
    list.forEach(c => {
        if (c.to !== me) return
        next[c.id] = c.at
        if (c.at === seen[c.id] || t - c.at > 86400000) return
        const who = ((snap.members[gid] || []).find(m => m.uid === c.from) || {}).name || 'A friend'
        const nudge = c.kind === 'nudge'
        const emoji = { clap: '👏', fire: '🔥', muscle: '💪' }[c.kind] || '👏'
        alertMe({
            title: nudge ? `${who} nudged you 👉` : `${who} cheered you ${emoji}`,
            body: nudge ? 'Time to open the timer and start studying.' : 'Keep going, they are counting on you!',
            icon: nudge ? '👉' : '💌', tag: `nudge-${c.from}`, sound: 'cheer', sticky: nudge,
        })
    })
    if (JSON.stringify(next) !== JSON.stringify(seen)) setStore('cheerseen', next, {})
}

function watch(gid) {
    let dead = false
    const offs = []
    const keep = p => p.then(off => { if (dead) off(); else offs.push(off) }).catch(() => {})
    const failed = () => { firstSnap.add(gid); recompute() }
    keep(fb.watchMembers(gid, list => onMembers(gid, list), failed))
    keep(fb.watchCheers(gid, list => onCheers(gid, list), () => {}))
    return { stop: () => { dead = true; offs.forEach(f => f()) } }
}

// What it does: makes the listeners match your list of groups (adds new ones, drops left ones).
// When to use it: when the list of groups changes. startLive calls it for you.
export function syncGroups() {
    if (!me) return
    const groups = getStore('studygroup', STUDY_DEFAULT).groups || []
    const ids = new Set(groups.map(g => g.id))
    watchers.forEach((w, gid) => {
        if (ids.has(gid)) return
        w.stop()
        watchers.delete(gid)
        firstSnap.delete(gid)
        const { [gid]: _m, ...members } = snap.members // eslint-disable-line no-unused-vars
        const { [gid]: _c, ...cheers } = snap.cheers // eslint-disable-line no-unused-vars
        commit({ members, cheers })
    })
    groups.forEach(g => { if (!watchers.has(g.id)) watchers.set(g.id, watch(g.id)) })
    recompute()
}

/* ---------- "I am here" ---------- */
let beatTimer = null
const beat = () => {
    if (!me) return
    ;(getStore('studygroup', STUDY_DEFAULT).groups || []).forEach(g => fb.touchMember(g.id, me).catch(() => {}))
}
const onVisible = () => { if (document.visibilityState === 'visible') beat() }

export function startLive(uid) {
    if (me === uid) return
    stopLive()
    me = uid
    syncGroups()
    setTimeout(beat, 4000)
    beatTimer = setInterval(beat, BEAT_MS)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', beat)
}

export function stopLive() {
    watchers.forEach(w => w.stop())
    watchers.clear()
    firstSnap.clear()
    clearInterval(beatTimer)
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('online', beat)
    me = ''
    snap = { members: {}, cheers: {}, ready: false }
    subs.forEach(f => f())
}

/* ---------- actions ---------- */
const lastCheer = {}
// What it does: sends a cheer or a nudge to a friend (and a push to their phone if their app is closed).
// When to use it: from every cheer or nudge button. kind: 'clap' | 'fire' | 'muscle' | 'nudge'.
export function cheer(gid, toUid, kind) {
    if (!me) return
    const t = Date.now()
    if (t - (lastCheer[toUid] || 0) < COOLDOWN) {
        notify({ title: 'Easy there', body: 'Wait a few seconds before cheering the same friend again.', icon: '⏳' })
        return
    }
    lastCheer[toUid] = t
    const count = ((snap.cheers[gid] || []).find(c => c.id === `${me}_${toUid}`) || {}).n || 0
    fb.saveCheer(gid, `${me}_${toUid}`, { from: me, to: toUid, kind, n: count + 1, at: t })
        .then(() => {
            play('cheer')
            if (kind === 'nudge') {
                notify({ title: 'Nudge sent 👉', body: 'They will see it now, or on their phone if the app is closed.', icon: '✅' })
                pushNudge(gid, toUid, getStore('studygroup', STUDY_DEFAULT).name)
            }
        })
        .catch(e => notify({ title: 'Cloud problem', body: (e && e.message) || 'Something went wrong.', icon: '⚠️' }))
}
