import { useEffect, useMemo, useRef, useState } from 'react'
import { DAYS, MONTH_TIERS, STUDY_DEFAULT, TYPES, activeDaysIn, addDays, clamp, computeStats, dayIndex, getStore, hms, isHttp, iso, notify, onStoreChange, parseISO, reward, setStore, tierState, todayISO, uid as newId, useNow, useStats, useStore, weekStart } from './shared'
import { RewardHost } from './Rewards'
import { DatabaseView, loadBlocks, snapshotBlock } from './Database'
import { RoadmapView, loadRoadmaps, snapshotRoadmap } from './Roadmap'
import { HeatGrid, HeatLegend } from './Heatmap'
import * as fb from './firebase'
import { getSyncUser, useSyncState } from './sync'
import { play } from './sound'

/* eslint-disable react-refresh/only-export-components */
/* ============================================================
   Study Group
   - you study with a timer, minutes are saved per day in the synced key "studygroup"
   - your "card" (name, daily minutes, studying now) is copied to every group you joined
   - friends read the cards live; streaks and rankings are computed on each device
   ============================================================ */

export const STREAK_MIN = 30           // minutes of study that make a day count for the streak
const KEEP_DAYS = 120           // how many days of history go into your card
export const MAX_SESSION = 360         // a forgotten timer never adds more than 6 hours
const ONLINE_MAX = 12 * 3600000 // "studying now" expires after 12 hours
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const EMPTY = []
const PERIODS = { today: 'Today', week: 'This week', month: 'This month', total: 'All time' }
const TITLES = ['👑 Top of the pack', '🥈 Chasing the crown', '🥉 On the podium']
const CHEERS = { clap: '👏', fire: '🔥', muscle: '💪' }
const NUDGE = '👉'
const HEAT_GROUP = [1, 60, 180, 360] // the same for the whole group, so the levels are higher
const HEAT_MINUTES = [1, 30, 60, 120] // minutes of study where each green level of a friend's graph starts
const COOLDOWN = 20000 // ms before you can cheer the same friend again
// [key, label, hint, max length]
const PROFILE_FIELDS = [
    ['focus', 'Studying', 'ITI prep, React, IELTS…', 60],
    ['bio', 'Bio', 'A line about you', 160],
    ['city', 'City', 'Alexandria', 40],
    ['email', 'Email', 'name@example.com', 80],
    ['link', 'Link', 'github.com/you', 100],
]

// What it does: turns a picked image into a 96x96 square JPEG data URL (about 5 KB).
// When to use it: for the profile photo. Firebase Storage needs a paid plan, so the photo lives inside your card.
const toAvatar = file => new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
        const side = Math.min(img.width, img.height)
        const canvas = document.createElement('canvas')
        canvas.width = 96
        canvas.height = 96
        canvas.getContext('2d').drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 96, 96)
        URL.revokeObjectURL(url)
        resolve(canvas.toDataURL('image/jpeg', 0.8))
    }
    img.onerror = () => {
        URL.revokeObjectURL(url)
        reject(new Error('That file is not an image.'))
    }
    img.src = url
})

// What it does: subscribes to one live feed of the open group and returns its latest value.
// When to use it: for each live list or document of a group (cheers, the group document).
function useFeed(watch, activeId, uid, empty) {
    const [feed, setFeed] = useState({ id: '', value: empty })
    useEffect(() => {
        if (!activeId || !uid) return
        let off = null
        let dead = false
        watch(activeId, value => setFeed({ id: activeId, value }), () => {}).then(stop => {
            if (dead) stop()
            else off = stop
        }).catch(() => {})
        return () => {
            dead = true
            if (off) off()
        }
    }, [activeId, uid]) // eslint-disable-line react-hooks/exhaustive-deps
    return feed.id === activeId ? feed.value : empty
}
export const fmtMin = m => {
    const n = Math.round(m)
    return n >= 60 ? `${Math.floor(n / 60)}h ${n % 60}m` : `${n}m`
}

// Minutes between two ISO dates, both included
const sumDays = (days, from, to) => Object.entries(days).reduce((sum, [k, v]) => (k >= from && k <= to ? sum + v : sum), 0)

export function streakOf(days, today) {
    const ok = k => (days[k] || 0) >= STREAK_MIN
    let cursor = parseISO(today)
    if (!ok(iso(cursor))) cursor = addDays(cursor, -1) // today can still be saved
    let streak = 0
    while (ok(iso(cursor))) {
        streak += 1
        cursor = addDays(cursor, -1)
    }
    let best = 0
    let run = 0
    Object.keys(days).filter(ok).sort().forEach(k => {
        run = ok(iso(addDays(parseISO(k), -1))) ? run + 1 : 1
        best = Math.max(best, run)
    })
    return { streak, best: Math.max(best, streak) }
}

const fail = e => notify({ title: 'Cloud problem', body: (e && e.message) || 'Something went wrong.', icon: '⚠️' })

// Copy my card to the groups (all of them, or only the ids given)
// Firestore cannot store arrays inside arrays, so each day is a key: { "0": [...], "3": [...] }
const planOf = week => {
    const plan = {}
    ;(week || []).forEach((list, i) => {
        if (list.length) plan[i] = list.slice(0, 30).map(t => ({ t: String(t.text).slice(0, 80), d: t.done ? 1 : 0, y: t.type || 'task' }))
    })
    return plan
}

function publish(user, ids) {
    const s = getStore('studygroup', STUDY_DEFAULT)
    if (!user || !s.name) return
    const stamp = new Date()
    const cutoff = iso(addDays(stamp, -KEEP_DAYS))
    const weekKey = iso(weekStart(stamp))
    const week = getStore('todos', {})[weekKey] || []
    const planned = week[dayIndex(stamp)] || []
    const app = computeStats(getStore('todos', {}), getStore('activity', {}), getStore('focus', {}))
    const card = {
        name: s.name,
        days: Object.fromEntries(Object.entries(s.days).filter(([k]) => k >= cutoff)),
        total: s.total,
        tier: tierState(activeDaysIn(iso(stamp).slice(0, 7), getStore('activity', {}), getStore('focus', {}), s.days, STREAK_MIN), iso(stamp).slice(0, 7)).tier,
        // A running session is shared as a virtual start time; a paused one as the milliseconds counted so far
        studying: (() => { const p = runParts(getStore('studyrun', {})); return p && p.since ? p.since - p.acc : 0 })(),
        ...(() => { const p = runParts(getStore('studyrun', {})); return p && !p.since ? { paused: Math.max(0, p.acc) } : {} })(),
        todos: {
            done: planned.filter(t => t.done).length, total: planned.length,
            week: weekKey, plan: planOf(week), streak: app.streak, best: app.best,
        },
        updatedAt: stamp.getTime(),
        profile: Object.fromEntries(Object.entries(s.profile || {}).filter(([, v]) => v)),
    }
    const list = ids || s.groups.map(g => g.id)
    list.forEach(id => fb.saveMember(id, user.uid, card).catch(fail))
}

/* The session is stored on this device only ("studyrun"), so a reload does not lose it.
   Shape: { on: true, acc: ms counted before the current stretch, since: ms when the current stretch began, 0 = paused }
   Elapsed time = acc + (now - since). Only time while the page was alive is ever counted. */
export const runParts = r => (r && r.on ? { acc: r.acc || 0, since: r.since || 0 } : r && r.start ? { acc: 0, since: r.start } : null) // old saves had only { start }
export const runActive = r => Boolean(runParts(r))
export const runRunning = r => Boolean(runParts(r) && runParts(r).since)
export const runElapsed = (r, t) => {
    const p = runParts(r)
    return p ? p.acc + (p.since ? Math.max(0, t - p.since) : 0) : 0
}

export function startSession(user, subject = '') {
    if (runActive(getStore('studyrun', {}))) return
    setStore('studyrun', { on: true, acc: 0, since: Date.now(), subject: String(subject || '').slice(0, 30) }, {})
    play('studystart')
    publish(user)
}

// Freeze the clock at time t (default now). Used by the Pause button and by the sleep guard.
function pauseAt(t, user) {
    const p = runParts(getStore('studyrun', {}))
    if (!p || !p.since) return false
    setStore('studyrun', { ...getStore('studyrun', {}), on: true, acc: p.acc + Math.max(0, t - p.since), since: 0 }, {})
    publish(user)
    return true
}

export function pauseSession(user) {
    if (pauseAt(Date.now(), user)) play('uncheck')
}

export function resumeSession(user) {
    const p = runParts(getStore('studyrun', {}))
    if (!p || p.since) return
    setStore('studyrun', { ...getStore('studyrun', {}), on: true, acc: p.acc, since: Date.now() }, {})
    play('studystart')
    publish(user)
}

/* Sleep and closed-tab guard. It runs once for the whole app (this file is loaded by the left rail).
   - A heartbeat records "the page was alive at this moment" every second.
   - If the page was closed, or the laptop slept, the next heartbeat or the next start-up sees a gap
     and pauses the session at the last moment the page was alive, so the gap is not counted. */
const SEEN_KEY = 'studyhub-run-seen'
const SLEEP_GAP = 90000 // background tabs can be throttled to one tick a minute, so a shorter gap is not sleep
let lastTick = Date.now()

function publishWhenReady(tries = 0) {
    const user = getSyncUser()
    if (user) publish(user)
    else if (tries < 15) setTimeout(() => publishWhenReady(tries + 1), 2000)
}

function guardBeat() {
    const t = Date.now()
    const gap = t - lastTick
    const before = lastTick
    lastTick = t
    if (!runRunning(getStore('studyrun', {}))) return
    if (gap > SLEEP_GAP) {
        if (pauseAt(before, getSyncUser())) {
            notify({ title: 'Study timer paused', body: 'The device was asleep, so that time was not counted. Press Resume when you are back.', icon: '⏸' })
            publishWhenReady()
        }
        return
    }
    try { localStorage.setItem(SEEN_KEY, String(t)) } catch { /* private mode: the guard still works while the page is open */ }
}

if (typeof window !== 'undefined' && !window.__studyGuard) {
    window.__studyGuard = true
    // Start-up: if a session was running when the page was last alive, pause it at that moment
    try {
        const seen = Number(localStorage.getItem(SEEN_KEY)) || 0
        if (seen && runRunning(getStore('studyrun', {})) && pauseAt(seen, null)) publishWhenReady()
    } catch { /* ignore */ }
    setInterval(guardBeat, 1000)
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') guardBeat() })
    window.addEventListener('pagehide', () => {
        try { if (runRunning(getStore('studyrun', {}))) localStorage.setItem(SEEN_KEY, String(Date.now())) } catch { /* ignore */ }
    })
}

export function stopSession(user) {
    const r = getStore('studyrun', {})
    if (!runActive(r)) return
    const minutes = Math.min(MAX_SESSION, Math.floor(runElapsed(r, Date.now()) / 60000))
    const today = todayISO()
    const before = getStore('studygroup', STUDY_DEFAULT).days[today] || 0
    const subject = String(r.subject || '').trim()
    setStore('studyrun', {}, {})
    if (minutes > 0) {
        setStore('studygroup', cur => ({
            ...cur,
            days: { ...cur.days, [today]: (cur.days[today] || 0) + minutes },
            total: cur.total + minutes,
            log: [...(cur.log || []), { d: today, m: minutes, s: subject }].slice(-600),
            subjects: subject ? [...(cur.subjects || []).filter(x => x !== subject), subject].slice(-30) : (cur.subjects || []),
        }), STUDY_DEFAULT)
    }
    const goalMin = getStore('studygroup', STUDY_DEFAULT).goalMin || 0
    play('studyend')
    if (before < STREAK_MIN && before + minutes >= STREAK_MIN) {
        const { streak } = streakOf(getStore('studygroup', STUDY_DEFAULT).days, today)
        reward({ icon: '🔥', title: streak > 1 ? `${streak}-day study streak` : 'Study streak started', body: `${STREAK_MIN} minutes done today. Come back tomorrow!`, kind: 'goal' })
        play('streak')
    } else if (goalMin > 0 && before < goalMin && before + minutes >= goalMin) {
        reward({ icon: '🎯', title: 'Study goal reached', body: `${fmtMin(goalMin)} of study today.`, kind: 'goal' })
        play('goal')
    } else {
        notify({ title: 'Session saved', body: `${minutes} min added to today.`, icon: '📚' })
    }
    publish(user)
}

// What it does: sends a cheer to a friend, unless you cheered the same friend a few seconds ago.
// When to use it: from the cheer buttons. "count" is how many cheers you already sent that friend.
const lastCheer = {}
function cheerFriend(groupId, uid, toUid, kind, count) {
    const t = Date.now()
    if (t - (lastCheer[toUid] || 0) < COOLDOWN) {
        notify({ title: 'Easy there', body: 'Wait a few seconds before cheering the same friend again.', icon: '⏳' })
        return
    }
    lastCheer[toUid] = t
    fb.saveCheer(groupId, `${uid}_${toUid}`, { from: uid, to: toUid, kind, n: count + 1, at: t }).then(() => play('cheer')).catch(fail)
}

// What it does: saves one snapshot in the group, unless it is too big for one cloud document.
// When to use it: from the Share and Update buttons.
function shareToGroup(groupId, uid, id, kind, title, data) {
    const text = JSON.stringify(data)
    if (text.length > 150000) {
        notify({ title: 'Too big to share', body: 'Remove some rows or topics and try again.', icon: '📦' })
        return
    }
    fb.saveShare(groupId, id, { owner: uid, kind, title: title.slice(0, 80), data: text, updatedAt: Date.now() })
        .then(() => play('save'))
        .catch(fail)
}

function refreshShares(user) {
    const list = getStore('studygroup', STUDY_DEFAULT).shared || []
    if (!user || !list.length) return
    const blocks = loadBlocks()
    const roadmaps = loadRoadmaps()
    list.forEach(({ g, id }) => {
        const rest = id.slice(user.uid.length + 1) // "b_main" or "r_fullstack"
        const ref = rest.slice(2)
        let kind, title, data
        if (rest.startsWith('b_')) {
            const b = blocks.find(x => x.id === ref)
            if (!b) return
            kind = 'goals'
            title = `🗄️ ${b.order.map(t => b.tables[t].name).join(' + ')}`
            data = snapshotBlock(b)
        } else {
            if (!roadmaps.maps[ref]) return
            kind = 'roadmap'
            title = `🗺️ ${roadmaps.maps[ref].title || 'Untitled roadmap'}`
            data = snapshotRoadmap(roadmaps, ref)
        }
        const text = JSON.stringify(data)
        if (text.length > 150000) return
        fb.saveShare(g, id, { owner: user.uid, kind, title: title.slice(0, 80), data: text, updatedAt: Date.now() }).catch(() => {})
    })
}

// What it does: keeps your card fresh while the app is open. It sends your todo counts 20 s after you
// change a todo, and once a few seconds after the app loads.
// When to use it: mounted once in App, so it works on every page.
export function StudyPublisher() {
    const { user } = useSyncState()
    const uid = user ? user.uid : ''
    useEffect(() => {
        if (!user) return
        let cardTimer = setTimeout(() => { publish(user); refreshShares(user) }, 5000)
        let shareTimer = null
        const off = onStoreChange(key => {
            if (key === 'todos' || key === 'activity') {
                clearTimeout(cardTimer)
                cardTimer = setTimeout(() => publish(user), 5000)
            }
            if (key === 'roadmaps' || key === 'database') {
                clearTimeout(shareTimer)
                shareTimer = setTimeout(() => refreshShares(user), 4000)
            }
        })
        return () => {
            clearTimeout(cardTimer)
            clearTimeout(shareTimer)
            off()
        }
    }, [uid]) // eslint-disable-line react-hooks/exhaustive-deps
    return <RewardHost studyMin={STREAK_MIN} />
}

/* ---------- small forms ---------- */
function NameForm({ initial, onSave, onCancel }) {
    const [name, setName] = useState(initial)
    return (
        <form className="card sg-box" onSubmit={e => { e.preventDefault(); if (name.trim()) onSave(name.trim()) }}>
            <h2>{initial ? 'Change your name' : 'Pick the name your friends will see'}</h2>
            <p className="muted small">It appears on the leaderboard, so use something your friends will recognise.</p>
            <label className="field"><span>Display name</span>
                <input autoFocus value={name} maxLength={24} onChange={e => setName(e.target.value)} />
            </label>
            <div className="row">
                <button className="btn primary" type="submit" disabled={!name.trim()}>Save name</button>
                {onCancel && <button className="btn" type="button" onClick={onCancel}>Cancel</button>}
            </div>
        </form>
    )
}

function AddGroup({ onCreate, onJoin }) {
    const [name, setName] = useState('')
    const [code, setCode] = useState('')
    return (
        <div className="card sg-box sg-add">
            <form className="row" onSubmit={e => { e.preventDefault(); if (name.trim()) onCreate(name.trim()) }}>
                <input value={name} maxLength={40} onChange={e => setName(e.target.value)} placeholder="Create a group, e.g. ITI Squad" aria-label="New group name" />
                <button className="btn primary" type="submit" disabled={!name.trim()}>Create</button>
            </form>
            <form className="row" onSubmit={e => { e.preventDefault(); if (code.trim()) onJoin(code.trim()) }}>
                <input value={code} maxLength={8} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="Or join with an invite code" aria-label="Invite code" />
                <button className="btn" type="submit" disabled={code.trim().length < 8}>Join</button>
            </form>
        </div>
    )
}

const Notice = ({ title, text }) => (
    <div className="sg">
        <style>{CSS}</style>
        <div className="card sg-box"><h2>{title}</h2><p className="muted">{text}</p></div>
    </div>
)

/* Child of the rows, the profile dialog and the profile view. Shows the photo, or the first letter. */
function Avatar({ name, photo, size = 36 }) {
    const ok = typeof photo === 'string' && photo.startsWith('data:image/jpeg;base64,')
    const box = { width: size, height: size }
    return ok
        ? <img className="sg-avatar" src={photo} alt="" style={box} />
        : <span className="sg-avatar" style={{ ...box, fontSize: size * 0.4 }}>{(name || '?')[0].toUpperCase()}</span>
}

/* Parent: StudyGroup. Child: Avatar. Edit your name, photo and optional info. */
function ProfileModal({ name: startName, profile, onSave, onClose }) {
    const [name, setName] = useState(startName)
    const [p, setP] = useState(profile || {})
    const [error, setError] = useState('')
    const set = (key, value) => setP(cur => ({ ...cur, [key]: value }))

    const pick = async e => {
        const file = e.target.files[0]
        e.target.value = ''
        if (!file) return
        try {
            set('photo', await toAvatar(file))
            setError('')
        } catch (err) {
            setError(err.message)
        }
    }
    const save = e => {
        e.preventDefault()
        if (!name.trim()) return
        const clean = Object.fromEntries(Object.entries(p).map(([k, v]) => [k, String(v || '').trim()]).filter(([, v]) => v))
        if (clean.link && !isHttp(clean.link)) clean.link = 'https://' + clean.link
        onSave(name.trim(), clean)
    }

    return (
        <div className="modal-back" onMouseDown={e => e.target === e.currentTarget && onClose()}>
            <form className="modal" onSubmit={save} role="dialog" aria-label="Edit profile">
                <h2>Your profile</h2>
                <p className="muted small" style={{ marginTop: -6 }}>Only the name is required. Everything else is optional, only members of your groups can see it, and an empty field is not shared.</p>
                <div className="sg-photo">
                    <Avatar name={name} photo={p.photo} size={72} />
                    <div className="row">
                        <label className="btn sm">Upload photo<input type="file" accept="image/*" hidden onChange={pick} /></label>
                        {p.photo && <button type="button" className="btn sm ghost" onClick={() => set('photo', '')}>Remove</button>}
                    </div>
                </div>
                {error && <p style={{ color: 'var(--bad)' }} role="alert">{error}</p>}
                <label className="field"><span>Display name (required)</span>
                    <input value={name} maxLength={24} onChange={e => setName(e.target.value)} />
                </label>
                {PROFILE_FIELDS.map(([key, label, hint, max]) => (
                    <label key={key} className="field"><span>{label} (optional)</span>
                        {key === 'bio'
                            ? <textarea rows={3} maxLength={max} value={p[key] || ''} placeholder={hint} onChange={e => set(key, e.target.value)} />
                            : <input maxLength={max} value={p[key] || ''} placeholder={hint} onChange={e => set(key, e.target.value)} />}
                    </label>
                ))}
                <div className="row"><span className="grow" /><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="submit" className="btn primary" disabled={!name.trim()}>Save profile</button></div>
            </form>
        </div>
    )
}

/* Parent: StudyGroup. Child: Avatar. A friend's profile and stats. */
function ProfileView({ r, isMe, cheerCount, onCheer, onClose }) {
    const p = r.profile
    return (
        <div className="modal-back" onMouseDown={e => e.target === e.currentTarget && onClose()}>
            <div className="modal" role="dialog" aria-label={`${r.name}'s profile`}>
                <div className="sg-pv">
                    <Avatar name={r.name} photo={p.photo} size={72} />
                    <div>
                        <h2 style={{ margin: 0 }}>{r.name}{isMe ? ' (you)' : ''} <TitleChip tier={r.tier} /></h2>
                        {p.focus && <p className="muted" style={{ margin: 0 }}>📖 {p.focus}</p>}
                        {r.on && <p style={{ margin: 0 }}>🟢 studying now</p>}
                        {r.paused && <p style={{ margin: 0 }}>⏸ paused</p>}
                    </div>
                </div>
                {p.bio && <p>{p.bio}</p>}
                <ul className="sg-info">
                    {p.city && <li>📍 {p.city}</li>}
                    {p.email && <li>✉️ <a href={`mailto:${p.email}`}>{p.email}</a></li>}
                    {p.link && <li>🔗 {isHttp(p.link) ? <a href={p.link} target="_blank" rel="noopener noreferrer">{p.link}</a> : p.link}</li>}
                </ul>
                <div className="sg-pstats">
                    <div><b>{fmtMin(r.today)}</b><span> today</span></div>
                    <div><b>{fmtMin(r.week)}</b><span> this week</span></div>
                    <div><b>{fmtMin(r.total)}</b><span> all time</span></div>
                    <div><b>📚 {r.streak}</b><span> study streak</span></div>
                    <div><b>🔥 {r.appStreak}</b><span> todo streak</span></div>
                    <div><b>{r.best}</b><span> best study streak</span></div>
                    <div><b>💌 {cheerCount}</b><span> cheers</span></div>
                </div>
                <div className="sg-pheat">
                    <b className="small">Study activity (minutes a day, last 18 weeks)</b>
                    <HeatGrid counts={r.days} weeks={18} thresholds={HEAT_MINUTES} unit="minute" />
                    <HeatLegend />
                </div>
                <div className="row" style={{ marginTop: 14 }}>
                    {!isMe && Object.entries(CHEERS).map(([k, e]) => <button key={k} className="btn" onClick={() => onCheer(r.uid, k)}>{e} Cheer {r.name}</button>)}
                    <span className="grow" /><button className="btn" onClick={onClose}>Close</button>
                </div>
            </div>
        </div>
    )
}

// What it does: reads a share's JSON text and returns the object, or null when the text is broken.
// When to use it: when parsing data that came from another user, because it may be invalid.
const parseShare = text => {
    try {
        return JSON.parse(text)
    } catch {
        return null
    }
}

/* Parent: StudyGroup opens this. Child: nothing. Lets you pick what to share. */
function ShareModal({ groupName, uid, mine, onPut, onRemove, onClose }) {
    const [items] = useState(() => {
        const roadmaps = loadRoadmaps()
        return [
            ...loadBlocks().map(b => ({
                id: `${uid}_b_${b.id}`, kind: 'goals', title: `🗄️ ${b.order.map(t => b.tables[t].name).join(' + ')}`, make: () => snapshotBlock(b),
            })),
            ...roadmaps.order.filter(id => roadmaps.maps[id]).map(id => ({
                id: `${uid}_r_${id}`, kind: 'roadmap', title: `🗺️ ${roadmaps.maps[id].title || 'Untitled roadmap'}`, make: () => snapshotRoadmap(roadmaps, id),
            })),
        ]
    })
    return (
        <div className="modal-back" onMouseDown={e => e.target === e.currentTarget && onClose()}>
            <div className="modal" role="dialog" aria-label="Share with the group">
                <h2>Share with {groupName}</h2>
                <p className="muted small" style={{ marginTop: -6 }}>Friends open it read-only, looking like your own page. A group of tables is shared with all its cells (but not row notes). A roadmap is shared without notes, resources and checklist text. Press Update after you make progress.</p>
                <ul className="sg-shares">
                    {items.map(it => (
                        <li key={it.id}>
                            <div className="grow"><b>{it.title}</b><small className="muted">{it.kind === 'roadmap' ? 'Roadmap' : 'Group of tables'}</small></div>
                            {mine.has(it.id) ? (
                                <>
                                    <button className="btn sm" onClick={() => onPut(it.id, it.kind, it.title, it.make())}>Update</button>
                                    <button className="btn sm danger" onClick={() => onRemove(it.id)}>Unshare</button>
                                </>
                            ) : (
                                <button className="btn sm primary" onClick={() => onPut(it.id, it.kind, it.title, it.make())}>Share</button>
                            )}
                        </li>
                    ))}
                </ul>
                <div className="row" style={{ marginTop: 14 }}><span className="grow" /><button className="btn" onClick={onClose}>Close</button></div>
            </div>
        </div>
    )
}

/* Parent: StudyGroup. Child: nothing. Shows one friend's shared snapshot. */
/* Parent: StudyGroup. Child: RoadmapView or DatabaseView. Full-screen, read-only view of a friend's share. */
function ShareView({ share, ownerName, onClose }) {
    const data = parseShare(share.data)
    const ok = Boolean(data) && data.v === 2
    useEffect(() => {
        const onKey = e => { if (e.key === 'Escape') onClose() }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [onClose])
    return (
        <div className="sg-full" role="dialog" aria-label={share.title}>
            <div className="sg-fullbar">
                <div className="sg-fulltitle">
                    <b>{share.title}</b>
                    <span className="muted small">Shared by {ownerName} · updated {new Date(share.updatedAt).toLocaleDateString()} · read only</span>
                </div>
                <button className="btn" onClick={onClose}>Close</button>
            </div>
            <div className="sg-fullbody">
                {!ok && <p className="card sg-box">This share was made with an older version. Ask {ownerName} to press Update on it.</p>}
                {ok && share.kind === 'roadmap' && <RoadmapView data={data.roadmap} />}
                {ok && share.kind === 'goals' && <DatabaseView db={data.block} />}
            </div>
        </div>
    )
}

// Parent: StudyGroup. Plan a time to study together and see the sessions your friends planned.
// "+ My calendar" copies a session into your own events, so it reminds you like any other event.
function Sessions({ list, uid, isOwner, members, onPlan, onDrop, onCopy }) {
    const [title, setTitle] = useState('')
    const [date, setDate] = useState(todayISO())
    const [time, setTime] = useState('20:00')
    const today = todayISO()
    const upcoming = list.filter(x => x.date >= today).sort((a, b) => `${a.date} ${a.time || ''}`.localeCompare(`${b.date} ${b.time || ''}`)).slice(0, 8)

    const submit = e => {
        e.preventDefault()
        const v = title.trim()
        if (!v || !date) return
        onPlan(v.slice(0, 60), date, time)
        setTitle('')
    }

    return (
        <>
            <div className="sg-sharehead">
                <h3>Study sessions</h3>
                <span className="muted small">Plan a time to study together</span>
            </div>
            <form className="sg-sform" onSubmit={submit}>
                <input value={title} maxLength={60} onChange={e => setTitle(e.target.value)} placeholder="Mock interview, React night…" aria-label="Session title" />
                <input type="date" value={date} min={today} onChange={e => setDate(e.target.value)} aria-label="Session date" />
                <input type="time" value={time} onChange={e => setTime(e.target.value)} aria-label="Session time" />
                <button className="btn primary" type="submit" disabled={!title.trim() || !date}>Plan</button>
            </form>
            {!upcoming.length && <p className="muted small" style={{ margin: 0 }}>No sessions planned yet. Pick a day and invite your friends to study with you.</p>}
            <ul className="sg-shares">
                {upcoming.map(x => {
                    const who = members.find(m => m.uid === x.owner)
                    return (
                        <li key={x.id}>
                            <div className="grow">
                                <b>📅 {x.title}</b>
                                <small className="muted">{parseISO(x.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}{x.date === today ? ' (today)' : ''} · {x.time || 'all day'} · by {x.owner === uid ? 'you' : who ? who.name : 'a friend'}</small>
                            </div>
                            <button className="btn sm" onClick={() => onCopy(x)}>+ My calendar</button>
                            {(x.owner === uid || isOwner) && <button className="btn sm danger" onClick={() => onDrop(x.id)}>Remove</button>}
                        </li>
                    )
                })}
            </ul>
        </>
    )
}

function WeekPlan({ r, isMe, today, ws, onNudge }) {
    const plan = r.plan
    const all = plan ? Object.values(plan).flat() : []
    const done = all.filter(x => x.d).length
    return (
        <article className={'sg-plan' + (isMe ? ' me' : '')}>
            <header>
                <Avatar name={r.name} photo={r.profile.photo} size={32} />
                <b>{r.name}{isMe ? ' (you)' : ''}</b>
                <span className="muted small grow">{all.length ? `${done}/${all.length} done this week` : 'Nothing planned this week'}</span>
                <span className="sg-chip" title="Todo and focus streak">🔥 {r.appStreak}</span>
                {!isMe && (plan && plan[today] || []).some(x => !x.d) && <button className="btn sm" onClick={() => onNudge(r.uid)}>{NUDGE} Nudge</button>}
            </header>
            {all.length > 0 && <div className="bar"><i className={done === all.length ? 'full' : ''} style={{ width: (100 * done) / all.length + '%' }} /></div>}
            <div className="sgw-grid">
                {DAYS.map((name, i) => {
                    const list = (plan && plan[i]) || []
                    const dn = list.filter(x => x.d).length
                    return (
                        <div key={i} className={'sgw-col' + (i === today ? ' today' : '') + (i < today ? ' past' : '')}>
                            <div className="sgw-head">
                                <h4>{name}</h4>
                                <span className="muted small">{addDays(ws, i).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                                {list.length > 0 && <span className={'sgw-count' + (dn === list.length ? ' all' : '')}>{dn === list.length ? '✓ ' : ''}{dn}/{list.length}</span>}
                            </div>
                            {list.length === 0 ? <p className="muted small sgw-empty">Nothing planned.</p> : (
                                <ul className="sgw-list">
                                    {list.map((x, j) => {
                                        const meta = TYPES[x.y] || TYPES.task
                                        return (
                                            <li key={j} className={'sgw-td' + (x.d ? ' done' : '')}>
                                                <input type="checkbox" checked={!!x.d} readOnly disabled aria-label={x.t} />
                                                <div className="sgw-main">
                                                    <span className="sgw-text">{x.t}</span>
                                                    <span className="sgw-type" style={{ '--c': meta.color }}>{meta.icon} {meta.label}</span>
                                                </div>
                                            </li>
                                        )
                                    })}
                                </ul>
                            )}
                        </div>
                    )
                })}
            </div>
        </article>
    )
}

function WeekSummary({ rows, friday, ws }) {
    const minutes = rows.reduce((n, r) => n + r.week, 0)
    const prevFrom = iso(addDays(ws, -7))
    const prevTo = iso(addDays(ws, -1))
    const champ = [...rows].map(r => ({ name: r.name, min: sumDays(r.days, prevFrom, prevTo) })).sort((a, b) => b.min - a.min)[0]
    const all = rows.flatMap(r => (r.plan ? Object.values(r.plan).flat() : []))
    const done = all.filter(x => x.d).length
    const top = [...rows].sort((a, b) => b.week - a.week)[0]
    return (
        <div className="sg-summary">
            <b>{friday ? '🏁 Week wrap-up' : '📊 Week so far'}</b>
            <span>⏱️ {fmtMin(minutes)} studied together</span>
            <span>✅ {done}/{all.length} todos done</span>
            {top && top.week > 0 && <span>👑 {top.name} leads with {fmtMin(top.week)}</span>}
            {champ && champ.min > 0 && <span>🏆 Last week: {champ.name} with {fmtMin(champ.min)}</span>}
        </div>
    )
}


const TitleChip = ({ tier }) => {
    const t = tier > 0 ? MONTH_TIERS[Math.min(tier, MONTH_TIERS.length) - 1] : null
    return t ? <span className="sg-ttl" style={{ '--tc': t.color }} title={`${t.name}: this month's title`}>{t.icon} {t.name}</span> : null
}

const fmtDay = k => parseISO(k).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

// Parent: StudyGroup. Child: nothing. Your own week as a chart with your daily goal, and where your minutes went.
function MyStudy({ s, update, liveToday, now }) {
    const [scope, setScope] = useState('week')
    const ws = weekStart(now)
    const today = iso(now)
    const days = s.days || {}
    const goal = s.goalMin || STREAK_MIN
    const per = DAYS.map((name, i) => {
        const k = iso(addDays(ws, i))
        return { name, k, min: (days[k] || 0) + (k === today ? liveToday : 0) }
    })
    const max = Math.max(goal, 30, ...per.map(d => d.min)) * 1.15
    const total = per.reduce((n, d) => n + d.min, 0)
    const activeN = per.filter(d => d.min > 0).length
    const from = scope === 'week' ? iso(ws) : '0000-00-00'
    const bySubject = {}
    ;(s.log || []).forEach(e => { if (e.d >= from) bySubject[e.s || 'No subject'] = (bySubject[e.s || 'No subject'] || 0) + e.m })
    const subjects = Object.entries(bySubject).sort((a, b) => b[1] - a[1])
    const top = Math.max(1, ...subjects.map(x => x[1]))
    const setGoal = delta => update(d => { d.goalMin = clamp((d.goalMin || STREAK_MIN) + delta, 15, 600) })

    return (
        <section className="card sg-my" aria-label="My study">
            <div className="row">
                <h3 className="grow">My week</h3>
                <span className="muted small">Daily goal {fmtMin(goal)}</span>
                <button className="icon-btn" onClick={() => setGoal(-15)} aria-label="Lower daily study goal">−</button>
                <button className="icon-btn" onClick={() => setGoal(15)} aria-label="Raise daily study goal">+</button>
            </div>
            <div className="sg-plot" role="img" aria-label={`Minutes studied each day this week, ${fmtMin(total)} in total`}>
                <span className="sg-goalline" style={{ bottom: (100 * goal) / max + '%' }}><em>goal</em></span>
                {per.map(d => (
                    <div key={d.k} className="sg-col" title={`${d.name}: ${fmtMin(d.min)}`}>
                        <i className={d.min >= goal ? 'hit' : d.k === today ? 'now' : ''} style={{ height: (100 * d.min) / max + '%' }} />
                    </div>
                ))}
            </div>
            <div className="sg-xl">{per.map(d => <small key={d.k} className={d.k === today ? 'now' : ''}>{d.name.slice(0, 3)}</small>)}</div>
            <p className="muted small" style={{ margin: 0 }}>{fmtMin(total)} this week · {activeN} active day{activeN === 1 ? '' : 's'}{activeN ? ` · about ${fmtMin(Math.round(total / activeN))} per active day` : ''}</p>
            <div className="row">
                <b className="small grow">By subject</b>
                <div className="seg" role="group" aria-label="Period">
                    <button className={'btn sm' + (scope === 'week' ? ' on' : '')} onClick={() => setScope('week')}>This week</button>
                    <button className={'btn sm' + (scope === 'all' ? ' on' : '')} onClick={() => setScope('all')}>All time</button>
                </div>
            </div>
            {subjects.length === 0 ? <p className="muted small" style={{ margin: 0 }}>Type a subject before you start the timer and your minutes are grouped here.</p> : (
                <ul className="sg-subs">
                    {subjects.map(([name, min]) => (
                        <li key={name}><span>{name}</span><b>{fmtMin(min)}</b><div className="bar"><i style={{ width: (100 * min) / top + '%' }} /></div></li>
                    ))}
                </ul>
            )}
        </section>
    )
}

// Parent: StudyGroup. Child: nothing. Earlier weeks: the group total, the champion and your own minutes.
function History({ rows, now, uid }) {
    const ws = weekStart(now)
    const weeks = Array.from({ length: 12 }, (_, i) => {
        const from = iso(addDays(ws, -7 * (i + 1)))
        const to = iso(addDays(ws, -7 * (i + 1) + 6))
        const per = rows.map(r => ({ uid: r.uid, name: r.name, min: sumDays(r.days, from, to) }))
        const total = per.reduce((n, r) => n + r.min, 0)
        return { from, to, total, champ: [...per].sort((a, b) => b.min - a.min)[0], me: (per.find(r => r.uid === uid) || { min: 0 }).min }
    }).filter(w => w.total > 0)
    if (!weeks.length) return null
    return (
        <details className="card sg-hist">
            <summary><b>Past weeks</b> <span className="muted small">champions and totals</span></summary>
            <ul className="sg-hl">
                {weeks.map(w => (
                    <li key={w.from}>
                        <b>{fmtDay(w.from)} – {fmtDay(w.to)}</b>
                        <span>🏆 {w.champ.name} · {fmtMin(w.champ.min)}</span>
                        <span>👥 {fmtMin(w.total)}</span>
                        <span>You {fmtMin(w.me)}</span>
                    </li>
                ))}
            </ul>
        </details>
    )
}

/* ============================================================
   Page
   ============================================================ */
export default function StudyGroup() {
    const sync = useSyncState()
    const [todos] = useStore('todos', {})
    const stats = useStats()
    const user = sync.user
    const uid = user ? user.uid : ''
    const [s, , update] = useStore('studygroup', STUDY_DEFAULT)
    const [run] = useStore('studyrun', {})
    const [activity] = useStore('activity', {})
    const [focus] = useStore('focus', {})
    const [subject, setSubject] = useState(() => (getStore('studygroup', STUDY_DEFAULT).subjects || []).slice(-1)[0] || '')
    const now = useNow(1000)
    const [period, setPeriod] = useState('today')
    const [adding, setAdding] = useState(false)
    const [editing, setEditing] = useState(false)
    const [feed, setFeed] = useState({ id: '', list: EMPTY })
    const seen = useRef(null)
    const rank = useRef(null)
    const [shareFeed, setShareFeed] = useState({ id: '', list: EMPTY })
    const [sharing, setSharing] = useState(false)
    const [viewing, setViewing] = useState(null)
    const seenShares = useRef(null)
    const [profileId, setProfileId] = useState(null)
    const seenCheers = useRef(null)
    const seenSessions = useRef(null)

    const active = s.groups.find(g => g.id === s.active) || s.groups[0]
    const activeId = active ? active.id : ''
    const members = feed.id === activeId ? feed.list : EMPTY
    const shares = shareFeed.id === activeId ? shareFeed.list : EMPTY

    // Shares made before auto-sync existed: register them so they stay up to date
    useEffect(() => {
        if (!user || shareFeed.id !== activeId) return
        const known = new Set((s.shared || []).filter(x => x.g === activeId).map(x => x.id))
        const missing = shareFeed.list.filter(x => x.owner === uid && !known.has(x.id)).map(x => x.id)
        if (!missing.length) return
        update(d => {
            d.shared = d.shared || []
            missing.forEach(id => d.shared.push({ g: activeId, id }))
        })
        refreshShares(user)
    }, [shareFeed]) // eslint-disable-line react-hooks/exhaustive-deps
    
    // Live list of what the group shared
    useEffect(() => {
        if (!activeId || !uid) return
        let off = null
        let dead = false
        fb.watchShares(activeId, list => setShareFeed({ id: activeId, list }), () => {}).then(stop => {
            if (dead) stop()
            else off = stop
        }).catch(() => {})
        return () => {
            dead = true
            if (off) off()
        }
    }, [activeId, uid])

    // A friend shares something new
    useEffect(() => {
        if (shareFeed.id !== activeId) return
        const before = seenShares.current
        seenShares.current = { id: activeId, ids: new Set(shareFeed.list.map(x => x.id)) }
        if (!before || before.id !== activeId) return
        shareFeed.list.forEach(x => {
            if (x.owner === uid || before.ids.has(x.id)) return
            const who = members.find(m => m.uid === x.owner)
            notify({ title: `${who ? who.name : 'A friend'} shared something`, body: x.title, icon: '🎁' })
            play('add')
        })
    }, [shareFeed]) // eslint-disable-line react-hooks/exhaustive-deps
    // Live cards of the open group
    useEffect(() => {
        if (!activeId || !uid) return
        let off = null
        let dead = false
        fb.watchMembers(activeId, list => setFeed({ id: activeId, list }), () => {}).then(stop => {
            if (dead) stop()
            else off = stop
        }).catch(() => {})
        return () => {
            dead = true
            if (off) off()
        }
    }, [activeId, uid])

    const monthNow = iso(now).slice(0, 7)
    const myTier = useMemo(() => tierState(activeDaysIn(monthNow, activity, focus, s.days || {}, STREAK_MIN), monthNow).tier, [monthNow, activity, focus, s.days])

    // One row per member, with the running session counted in
    const rows = useMemo(() => {
    const monthFrom = monthNow + '-01'
    const t = now.getTime()
    const today = iso(now)
    const ws = iso(weekStart(now))
    return members.map(m => {
            const on = Boolean(m.studying) && t - m.studying < ONLINE_MAX
            const paused = !m.studying && typeof m.paused === 'number' && t - (m.updatedAt || 0) < ONLINE_MAX
            const live = on ? Math.min(MAX_SESSION, Math.floor((t - m.studying) / 60000)) : paused ? Math.min(MAX_SESSION, Math.floor(m.paused / 60000)) : 0
            const base = m.days || {}
            const days = { ...base, [today]: (base[today] || 0) + live }
            const { streak, best } = streakOf(days, today)
            const plannedToday = m.todos && iso(new Date(m.updatedAt || 0)) === today ? m.todos : null
            const tp = m.todos || {}
            const mine = m.uid === uid
            return {
                uid: m.uid, name: m.name || '?', on, paused, live, days, today: days[today], week: sumDays(days, ws, today), month: sumDays(days, monthFrom, today), tier: mine ? myTier : m.tier || 0, total: (m.total || 0) + live,
                streak, best, todos: plannedToday, profile: m.profile || {},
                plan: mine ? planOf(todos[ws]) : tp.week === ws ? tp.plan || {} : null, // your own plan is always live
                appStreak: mine ? stats.streak : tp.streak || 0,
            }
        })
    }, [members, now, todos, stats, uid, myTier, monthNow])

    const byName = (a, b) => a.name.localeCompare(b.name)
    const order = useMemo(() => [...rows].sort((a, b) => b[period] - a[period] || byName(a, b)), [rows, period])
    const todayOrder = useMemo(() => [...rows].sort((a, b) => b.today - a.today || byName(a, b)), [rows])
    const myRank = todayOrder.findIndex(r => r.uid === uid)
    const cheers = useFeed(fb.watchCheers, activeId, uid, EMPTY)
    const group = useFeed(fb.watchGroup, activeId, uid, null)
    const sessions = useFeed(fb.watchGroupEvents, activeId, uid, EMPTY)
    const goal = (group && group.goal) || 0
    const isOwner = Boolean(group) && group.owner === uid
    const block = group && group.block && group.block.start ? group.block : null
    const blockEnd = block ? block.start + block.min * 60000 : 0
    const joinBlock = () => { if (!runActive(getStore('studyrun', {}))) startSession(user, 'Group block') }
    const seenBlock = useRef(0)
    useEffect(() => {
        if (!block || blockEnd <= Date.now() || seenBlock.current === block.start) return
        seenBlock.current = block.start
        if (block.by !== uid) notify({ title: 'Group focus block', body: `${block.min} minutes, studying together.`, icon: '⏱', actions: [{ label: 'Join', onClick: joinBlock }] })
        const t = setTimeout(() => notify({ title: 'Focus block finished', body: 'Great work. Take a short break.', icon: '🎉' }), blockEnd - Date.now())
        return () => clearTimeout(t)
    }, [block && block.start]) // eslint-disable-line react-hooks/exhaustive-deps
    const weekTotal = rows.reduce((n, r) => n + r.week, 0)
    const groupDays = useMemo(() => {
        const out = {}
        members.forEach(m => Object.entries(m.days || {}).forEach(([k, v]) => { out[k] = (out[k] || 0) + v }))
        return out
    }, [members])

    // A friend cheers you
    useEffect(() => {
        if (cheers === EMPTY) return
        const before = seenCheers.current
        seenCheers.current = { id: activeId, at: Object.fromEntries(cheers.map(c => [c.id, c.at])) }
        if (!before || before.id !== activeId) return
        cheers.forEach(c => {
            if (c.to !== uid || c.at === before.at[c.id]) return
            const who = members.find(m => m.uid === c.from)
            notify({
                title: c.kind === 'nudge' ? `${who ? who.name : 'A friend'} nudged you ${NUDGE}` : `${who ? who.name : 'A friend'} cheered you ${CHEERS[c.kind] || '👏'}`,
                body: c.kind === 'nudge' ? 'You still have todos planned today. Open the dashboard!' : 'Keep going, they are counting on you!',
                icon: '💌',
            })
            play('cheer')
        })
    }, [cheers]) // eslint-disable-line react-hooks/exhaustive-deps

    // A friend plans a study session. Your own sessions from over a month ago are removed.
    useEffect(() => {
        if (sessions === EMPTY) return
        const before = seenSessions.current
        seenSessions.current = { id: activeId, ids: new Set(sessions.map(x => x.id)) }
        const old = iso(addDays(new Date(), -30))
        sessions.filter(x => x.owner === uid && x.date < old).forEach(x => fb.deleteGroupEvent(activeId, x.id).catch(() => {}))
        if (!before || before.id !== activeId) return
        sessions.forEach(x => {
            if (x.owner === uid || before.ids.has(x.id)) return
            const who = members.find(m => m.uid === x.owner)
            notify({ title: `${who ? who.name : 'A friend'} planned a session`, body: `${x.title} · ${x.date}${x.time ? ' ' + x.time : ''}`, icon: '📅' })
            play('add')
        })
    }, [sessions]) // eslint-disable-line react-hooks/exhaustive-deps

    // The group reaches its weekly goal (celebrated once per group and week)
    useEffect(() => {
        if (!goal || weekTotal < goal) return
        const key = `${activeId}|${iso(weekStart(now))}`
        if ((s.celebrated || {})[key]) return
        update(d => { d.celebrated = { ...(d.celebrated || {}), [key]: true } })
        notify({ title: 'Group goal reached!', body: `Together you studied ${fmtMin(weekTotal)} this week.`, icon: '🎉' })
        play('groupgoal')
    }, [goal, weekTotal]) // eslint-disable-line react-hooks/exhaustive-deps

    // A friend starts studying
    useEffect(() => {
        if (!members.length) return
        const before = seen.current
        seen.current = { id: activeId, map: Object.fromEntries(members.map(m => [m.uid, Boolean(m.studying)])) }
        if (!before || before.id !== activeId) return
        members.forEach(m => {
            if (m.uid !== uid && m.studying && !before.map[m.uid]) {
                notify({ title: `${m.name} is studying`, body: 'Join in and keep up!', icon: '📖' })
                play('friendon')
            }
        })
    }, [members]) // eslint-disable-line react-hooks/exhaustive-deps

    // You pass a friend today
    useEffect(() => {
        if (myRank < 0) return
        const before = rank.current
        rank.current = { id: activeId, rank: myRank }
        if (before && before.id === activeId && myRank < before.rank && todayOrder[myRank].today > 0) {
            const passed = todayOrder[myRank + 1]
            notify({ title: `You are #${myRank + 1} today`, body: passed ? `You just passed ${passed.name}.` : 'You took the lead!', icon: '🚀' })
            play('overtake')
        }
    }, [myRank]) // eslint-disable-line react-hooks/exhaustive-deps

    /* ----- actions ----- */
    const saveName = name => {
        update(d => { d.name = name })
        play('save')
        publish(user)
    }
    const addGroup = (id, name) => {
        update(d => {
            if (!d.groups.some(g => g.id === id)) d.groups.push({ id, name })
            d.active = id
        })
        setAdding(false)
        publish(user, [id])
    }
    const create = async name => {
        const bytes = crypto.getRandomValues(new Uint8Array(8))
        const code = Array.from(bytes, b => CODE_CHARS[b % CODE_CHARS.length]).join('')
        try {
            await fb.createGroup(code, name, user.uid)
            addGroup(code, name)
            play('save')
        } catch (e) {
            fail(e)
        }
    }
    const join = async code => {
        try {
            const info = await fb.groupInfo(code)
            if (!info) return notify({ title: 'No group with that code', body: 'Check the code with your friend.', icon: '🔎' })
            addGroup(code, info.name)
            play('save')
            notify({ title: `Joined ${info.name}`, body: 'Say hi and start a session!', icon: '👋' })
        } catch (e) {
            fail(e)
        }
    }
    const leave = () => {
        if (!window.confirm(`Leave "${active.name}"? Your card and shares are removed from it.`)) return
        shares.filter(x => x.owner === uid).forEach(x => fb.deleteShare(active.id, x.id).catch(() => {}))
        fb.leaveGroup(active.id, user.uid).catch(fail)
        update(d => {
            d.groups = d.groups.filter(g => g.id !== active.id)
            d.active = d.groups[0] ? d.groups[0].id : ''
            d.shared = (d.shared || []).filter(x => x.g !== active.id)
        })
        play('delete')
    }
    const copyCode = async () => {
        try {
            await navigator.clipboard.writeText(active.id)
            notify({ title: 'Invite code copied', body: `Send ${active.id} to your friend.`, icon: '📋' })
        } catch {
            notify({ title: 'Your invite code', body: active.id, icon: '📋' })
        }
    }
    const saveProfile = (name, profile) => {
        update(d => {
            d.name = name
            d.profile = profile
        })
        setEditing(false)
        play('save')
        publish(user)
    }
    const sendCheer = (toUid, kind) => cheerFriend(activeId, uid, toUid, kind, (cheers.find(c => c.id === `${uid}_${toUid}`) || {}).n || 0)
    const startBlock = min => {
        fb.setGroupBlock(activeId, { start: Date.now(), min, by: uid }).then(() => play('save')).catch(fail)
        joinBlock()
    }
    const cancelBlock = () => fb.setGroupBlock(activeId, null).catch(fail)
    const changeGoal = () => {
        const raw = window.prompt('Weekly goal for the whole group, in hours (0 removes it)', goal ? String(Math.round(goal / 60)) : '20')
        if (raw === null) return
        const hours = Number(raw)
        if (!Number.isFinite(hours) || hours < 0 || hours > 1000) return notify({ title: 'Enter a number of hours', body: 'For example 20.', icon: '🔢' })
        fb.setGroupGoal(activeId, Math.round(hours * 60)).then(() => play('save')).catch(fail)
    }
    const planSession = (title, date, time) => fb.saveGroupEvent(activeId, `${uid}_${newId()}`, { owner: uid, title, date, time, at: Date.now() }).then(() => play('save')).catch(fail)
    const dropSession = id => fb.deleteGroupEvent(activeId, id).then(() => play('delete')).catch(fail)
    const copySession = x => {
        setStore('events', cur => (cur.some(e => e.id === 'g_' + x.id) ? cur : [...cur, { id: 'g_' + x.id, title: `👥 ${x.title}`, date: x.date, time: x.time || '', remind: x.time ? 15 : 0, color: '#3ddc97', notes: active.name }]), [])
        play('add')
        notify({ title: 'Added to your calendar', body: x.title, icon: '📅' })
    }
    const putShare = (id, kind, title, data) => {
    shareToGroup(activeId, uid, id, kind, title, data)
    update(d => {
        d.shared = d.shared || []
        if (!d.shared.some(x => x.g === activeId && x.id === id)) d.shared.push({ g: activeId, id })
    })
}
const removeShare = id => {
    update(d => { d.shared = (d.shared || []).filter(x => !(x.g === activeId && x.id === id)) })
    return fb.deleteShare(activeId, id).then(() => play('delete')).catch(fail)
}

    /* ----- gates ----- */
    if (sync.phase === 'off') return <Notice title="Cloud sync is not set up" text="The Study Group needs Firebase. Follow FIREBASE_SETUP.md first." />
    if (!user) return <Notice title="Sign in first" text="Use the cloud button in the top bar to sign in. Your friends see you under the name you pick next." />
    if (!s.name) return <div className="sg"><style>{CSS}</style><NameForm initial="" onSave={saveName} /></div>

    /* ----- derived for the screen ----- */
    const today = iso(now)
    const topMin = Math.max(1, ...order.map(r => r[period]))
    const weekStartDate = weekStart(now)
    const cheered = {}
    cheers.forEach(c => { if (members.some(m => m.uid === c.from)) cheered[c.to] = (cheered[c.to] || 0) + (c.n || 0) })
    const profileRow = profileId ? rows.find(r => r.uid === profileId) : null
    const sharedByMe = new Set(shares.filter(x => x.owner === uid).map(x => x.id))
    const viewed = viewing ? shares.find(x => x.id === viewing) : null
    const viewedOwner = viewed ? (viewed.owner === uid ? 'you' : (members.find(m => m.uid === viewed.owner) || { name: 'a friend' }).name) : ''
    const sessionOn = runActive(run)
    const running = runRunning(run)
    const elapsed = runElapsed(run, now.getTime())
    const liveMin = Math.min(MAX_SESSION, Math.floor(elapsed / 60000))
    const myToday = (s.days[today] || 0) + liveMin
    const mine = streakOf({ ...s.days, [today]: myToday }, today)
    const me = todayOrder[myRank]
    const diff = (a, b) => a.today - b.today
    let coach = 'Create or join a group to compete with your friends.'
    if (active && me) {
        const lead = todayOrder[0]
        if (lead.today === 0) coach = 'Nobody has started today. Be the first and take the crown.'
        else if (myRank === 0) coach = todayOrder[1] ? `You lead today. ${todayOrder[1].name} is only ${fmtMin(diff(me, todayOrder[1]))} behind you, keep going!` : 'You lead today. Invite a friend to compete with you.'
        else {
            const ahead = todayOrder[myRank - 1]
            coach = diff(ahead, me) === 0 ? `${ahead.name} is level with you. One more minute puts you ahead!` : `${ahead.name} is ${fmtMin(diff(ahead, me))} ahead of you today. Catch up!`
        }
    }

    return (
        <div className="sg">
            <style>{CSS}</style>
            <header className="sg-head">
                <h1>Study Group</h1>
                <span className="muted">Studying as <b>{s.name}</b></span> <TitleChip tier={myTier} />
                                <button className="btn sm ghost" onClick={() => setEditing(true)}>Edit profile</button>
            </header>

            <section className="card sg-timer" aria-label="Study timer">
                <div>
                    <p className="muted small">{running ? '📖 You are studying' : sessionOn ? '⏸ Paused' : 'Ready when you are'}{run.subject ? ` · ${run.subject}` : ''}</p>
                    <div className={'sg-clock' + (running ? ' on' : '')}>{hms(elapsed)}</div>
                    {!sessionOn && (
                        <>
                            <input className="sg-subj" list="sg-subjects" value={subject} onChange={e => setSubject(e.target.value)} placeholder="Subject (optional)" maxLength={30} aria-label="Subject" />
                            <datalist id="sg-subjects">{(s.subjects || []).map(x => <option key={x} value={x} />)}</datalist>
                        </>
                    )}
                    <div className="row" style={{ gap: 8 }}>
                        {!sessionOn && <button className="btn primary" onClick={() => startSession(user, subject.trim())}>Start studying</button>}
                        {running && <button className="btn" onClick={() => pauseSession(user)}>Pause</button>}
                        {sessionOn && !running && <button className="btn primary" onClick={() => resumeSession(user)}>Resume</button>}
                        {sessionOn && <button className="btn danger" onClick={() => stopSession(user)}>Stop and save</button>}
                    </div>
                </div>
                <div className="sg-stats">
                    <div><b>{fmtMin(myToday)}</b><span>today</span></div>
                    <div><b>🔥 {mine.streak}</b><span>day streak · best {mine.best}</span></div>
                    <div className="sg-goal">
                        <div className="bar"><i className={myToday >= STREAK_MIN ? 'full' : ''} style={{ width: Math.min(100, (100 * myToday) / STREAK_MIN) + '%' }} /></div>
                        <span>{myToday >= STREAK_MIN ? 'Streak day secured ✅' : `${STREAK_MIN - myToday} min to keep today's streak`}</span>
                    </div>
                </div>
            </section>

            {active && (block && blockEnd > now.getTime() ? (
                <div className="sg-block on" role="status">
                    <span>⏱ Group focus block · <b>{hms(blockEnd - now.getTime())}</b> left</span>
                    {!sessionOn && <button className="btn sm primary" onClick={joinBlock}>Join</button>}
                    {isOwner && <button className="btn sm ghost" onClick={cancelBlock}>Cancel</button>}
                </div>
            ) : isOwner ? (
                <div className="sg-block">
                    <span>Study in sync with your group:</span>
                    <button className="btn sm" onClick={() => startBlock(25)}>25 min block</button>
                    <button className="btn sm" onClick={() => startBlock(50)}>50 min block</button>
                </div>
            ) : null)}

            <MyStudy s={s} update={update} liveToday={liveMin} now={now} />

            <div className="sg-tabs" role="tablist">
                {s.groups.map(g => (
                    <button key={g.id} role="tab" aria-selected={g.id === activeId} className={g.id === activeId ? 'on' : ''} onClick={() => update(d => { d.active = g.id })}>👥 {g.name}</button>
                ))}
                <button className="sg-plus" onClick={() => setAdding(!adding)}>+ Create or join a group</button>
            </div>
            {(adding || !s.groups.length) && <AddGroup onCreate={create} onJoin={join} />}

            {active && (
                <section className="card sg-board" aria-label="Leaderboard">
                    <div className="sg-bar">
                        <div>
                            <h2>{active.name}</h2>
                            <p className="muted small">Invite code: <b className="sg-code">{active.id}</b></p>
                        </div>
                        <div className="row">
                            <button className="btn sm" onClick={copyCode}>Copy code</button>
                            <button className="btn sm danger" onClick={leave}>Leave</button>
                        </div>
                    </div>
                    <p className="sg-coach">{coach}</p>
                    {rows.some(r => r.on || r.paused) && (
                        <div className="sg-live" aria-label="Studying now">
                            <span className="sg-pulse" aria-hidden="true" />
                            {rows.filter(r => r.on || r.paused).map(r => (
                                <button key={r.uid} className="sg-chip" onClick={() => setProfileId(r.uid)}><Avatar name={r.name} photo={r.profile.photo} size={20} /> {r.uid === uid ? 'You' : r.name} · {r.paused ? '⏸ ' : ''}{fmtMin(r.live)}</button>
                            ))}
                        </div>
                    )}
                    <div className="sg-goalbox">
                        <div className="row">
                            <b>Weekly group goal</b>
                            <span className="muted small grow">{goal ? `${fmtMin(weekTotal)} of ${fmtMin(goal)} together` : 'No goal yet'}</span>
                            {isOwner && <button className="btn sm" onClick={changeGoal}>{goal ? 'Change' : 'Set a goal'}</button>}
                        </div>
                        {goal > 0 && <div className="bar"><i className={weekTotal >= goal ? 'full' : ''} style={{ width: Math.min(100, (100 * weekTotal) / goal) + '%' }} /></div>}
                        <p className="muted small" style={{ margin: 0 }}>
                            {goal ? (weekTotal >= goal ? '🎉 Goal reached! Time to aim higher.' : `${fmtMin(goal - weekTotal)} to go. Every minute counts, ${s.name}!`) : isOwner ? 'Set a weekly target so everyone studies toward the same number.' : 'The group owner can set a weekly goal.'}
                        </p>
                    </div>
                    <div className="seg" role="group" aria-label="Period">
                        {Object.entries(PERIODS).map(([k, l]) => <button key={k} className={'btn sm' + (period === k ? ' on' : '')} onClick={() => setPeriod(k)}>{l}</button>)}
                    </div>
                    <ol className="sg-list">
                        {order.map((r, i) => (
                            <li key={r.uid} className={'sg-row' + (r.uid === uid ? ' me' : '')}>
                                <span className="sg-rank">{i + 1}</span>
                                <button className="sg-who" onClick={() => setProfileId(r.uid)} aria-label={`Open ${r.name}'s profile`}>
                                    <Avatar name={r.name} photo={r.profile.photo} size={48} />
                                    <div className="grow">
                                        <b>{r.name}{r.uid === uid ? ' (you)' : ''} <TitleChip tier={r.tier} /></b>
                                        <small className="muted">{r[period] === 0 ? '😴 Not started yet' : TITLES[i] || '🔥 In the race'}{r.on ? ' · 🟢 studying now' : r.paused ? ' · ⏸ paused' : ''}{r.todos && r.todos.total > 0 ? ` · 📝 ${r.todos.done}/${r.todos.total} today` : ''}</small>
                                    </div>
                                </button>
                                <div className="sg-chips">
                                    <span className="sg-chip" title={`Study streak (${STREAK_MIN}+ min a day). Best: ${r.best}`}>📚 {r.streak}d</span>
                                    <span className="sg-chip" title="Todo and focus streak">🔥 {r.appStreak}d</span>
                                    {cheered[r.uid] > 0 && <span className="sg-chip" title="Cheers received">💌 {cheered[r.uid]}</span>}
                                </div>
                                <div className="sg-meter">
                                    <b>{fmtMin(r[period])}</b>
                                    <div className="bar"><i style={{ width: (100 * r[period]) / topMin + '%' }} /></div>
                                </div>
                                {r.uid !== uid && (
                                    <span className="sg-cheers">
                                        {Object.entries(CHEERS).map(([k, e]) => <button key={k} className="icon-btn" title={`Cheer ${r.name}`} aria-label={`Cheer ${r.name} ${e}`} onClick={() => sendCheer(r.uid, k)}>{e}</button>)}
                                    </span>
                                )}
                            </li>
                        ))}
                    </ol>
                    {!order.length && <p className="muted small">Loading the group…</p>}
                    <div className="sg-sharehead">
                        <h3>Group activity</h3>
                        <span className="muted small">Minutes studied together, last 18 weeks</span>
                    </div>
                    <HeatGrid counts={groupDays} weeks={18} thresholds={HEAT_GROUP} unit="minute" />
                    <HeatLegend />
                    <Sessions list={sessions} uid={uid} isOwner={isOwner} members={members} onPlan={planSession} onDrop={dropSession} onCopy={copySession} />
                    <div className="sg-sharehead">
                        <h3>This week's plans</h3>
                        <span className="muted small">Saturday to Friday. Friends see your todo text.</span>
                    </div>
                    <WeekSummary rows={rows} friday={dayIndex(now) === 6} ws={weekStartDate} />
                    <History rows={rows} now={now} uid={uid} />
                    <div className="sg-plans">
                        {order.map(r => <WeekPlan key={r.uid} r={r} isMe={r.uid === uid} today={dayIndex(now)} ws={weekStartDate} onNudge={uid2 => sendCheer(uid2, 'nudge')} />)}
                    </div>
                    <div className="sg-sharehead">
                        <h3>Shared with the group</h3>
                        <button className="btn sm" onClick={() => setSharing(true)}>Share goals or a roadmap</button>
                    </div>
                    {!shares.length && <p className="muted small">Nothing shared yet. Share a goals table or a roadmap so your friends can follow your progress.</p>}
                    <ul className="sg-shares">
                        {shares.map(x => {
                            const who = members.find(m => m.uid === x.owner)
                            return (
                                <li key={x.id}>
                                    <div className="grow"><b>{x.title}</b><small className="muted">by {x.owner === uid ? 'you' : who ? who.name : 'a friend'}</small></div>
                                                                        <button className="btn sm" onClick={() => setViewing(x.id)}>Open</button>
                                    {x.owner === uid && <button className="btn sm danger" onClick={() => removeShare(x.id)}>Unshare</button>}
                                </li>
                            )
                        })}
                    </ul>
                </section>
            )}
            {sharing && active && <ShareModal groupName={active.name} uid={uid} mine={sharedByMe} onPut={putShare} onRemove={removeShare} onClose={() => setSharing(false)} />}
            {viewed && <ShareView share={viewed} ownerName={viewedOwner} onClose={() => setViewing(null)} />}
            {editing && <ProfileModal name={s.name} profile={s.profile} onSave={saveProfile} onClose={() => setEditing(false)} />}
            {profileRow && <ProfileView r={profileRow} isMe={profileRow.uid === uid} cheerCount={cheered[profileRow.uid] || 0} onCheer={sendCheer} onClose={() => setProfileId(null)} />}
        </div>
    )
}

const CSS = `
.sg-ttl{display:inline-block;font:600 11px var(--head);padding:2px 9px;border-radius:999px;border:1px solid var(--tc);background:color-mix(in srgb,var(--tc) 14%,var(--sf2));vertical-align:middle;white-space:nowrap}
.sg-subj{width:100%;margin-bottom:8px}
.sg-block{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:10px 14px;border-radius:10px;border:1px dashed var(--ln);background:var(--sf2)}
.sg-block.on{border:1px solid var(--ac);background:color-mix(in srgb,var(--ac) 10%,var(--sf2))}.sg-block span{flex:1;min-width:140px}
.sg-my{display:grid;gap:10px}
.sg-plot{position:relative;display:flex;gap:8px;align-items:stretch;height:130px;border-bottom:1px solid var(--ln)}
.sg-col{flex:1;display:flex;align-items:flex-end}.sg-col i{display:block;width:100%;border-radius:6px 6px 0 0;background:color-mix(in srgb,var(--ac) 55%,var(--ln));min-height:2px}
.sg-col i.now{background:var(--ac)}.sg-col i.hit{background:var(--ok)}
.sg-goalline{position:absolute;left:0;right:0;border-top:2px dashed var(--wip,#ffb454);pointer-events:none}.sg-goalline em{position:absolute;right:0;top:-17px;font:600 10px var(--head);color:var(--mu);font-style:normal}
.sg-xl{display:flex;gap:8px;margin-top:-4px}.sg-xl small{flex:1;text-align:center;font-size:11px;color:var(--mu)}.sg-xl small.now{color:var(--ac);font-weight:700}
.sg-subs{list-style:none;margin:0;padding:0;display:grid;gap:8px}.sg-subs li{display:grid;grid-template-columns:1fr auto;gap:2px 8px}.sg-subs .bar{grid-column:1/-1;margin:0}
.sg-hist summary{cursor:pointer}.sg-hl{list-style:none;margin:10px 0 0;padding:0;display:grid;gap:6px}
.sg-hl li{display:flex;gap:6px 14px;flex-wrap:wrap;padding:6px 10px;border-radius:8px;background:var(--sf2);font-size:13px}.sg-hl li b{min-width:150px}
.sg{max-width:1600px;margin:auto;padding:24px 20px 90px;display:grid;gap:18px}
.sg-head{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap}.sg-head h1{font-size:32px}
.sg-box{padding:20px;display:grid;gap:10px}
.sg-add form{flex-wrap:nowrap}
.sg-timer{padding:22px;display:grid;grid-template-columns:auto 1fr;gap:28px;align-items:center}
.sg-clock{font:700 56px var(--head);font-variant-numeric:tabular-nums;line-height:1.1;margin:4px 0 12px}.sg-clock.on{color:var(--ok)}
.sg-stats{display:grid;gap:12px}
.sg-stats>div{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}
.sg-stats b{font:700 24px var(--head)}.sg-stats span{color:var(--mu);font-size:14px}
.sg-goal{display:grid!important;gap:4px}
.sg-tabs{display:flex;gap:6px;flex-wrap:wrap;border-bottom:1px solid var(--ln);padding-bottom:8px}
.sg-tabs button{border:0;background:none;padding:5px 12px;border-radius:8px;cursor:pointer;color:var(--mu);font-weight:500}
.sg-tabs button:hover{background:var(--sf2);color:var(--tx)}.sg-tabs button.on{background:var(--sf2);color:var(--tx);box-shadow:inset 0 -2px 0 var(--ac)}
.sg-tabs .sg-plus{margin-left:auto;font-size:13px}
.sg-board{padding:20px;display:grid;gap:12px}
.sg-bar{display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap}.sg-bar h2{font-size:24px}
.sg-code{font-family:ui-monospace,monospace;letter-spacing:.12em;user-select:all}
.sg-coach{margin:0;padding:12px 14px;border-radius:10px;background:color-mix(in srgb,var(--ac) 12%,var(--sf2));border:1px solid var(--ln);font-weight:500}
.sg-list{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.sg-avatar{display:grid;place-items:center;width:36px;height:36px;border-radius:50%;background:var(--ac);color:#fff;font-weight:700;flex:none}
@media(max-width:640px){.sg-timer{grid-template-columns:1fr}.sg-clock{font-size:44px}}
.sg-sharehead{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-top:8px;border-top:1px solid var(--ln);padding-top:14px}
.sg-sharehead h3{font-size:18px}
.sg-shares{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.sg-shares li{display:flex;gap:10px;align-items:center;background:var(--sf2);border:1px solid var(--ln);border-radius:10px;padding:8px 12px}
.sg-shares .grow{display:grid;min-width:0}
.sg-full{position:fixed;inset:0;z-index:60;background:var(--bg);overflow:auto}
.sg-fullbar{position:sticky;top:0;z-index:5;display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 20px;background:color-mix(in srgb,var(--bg) 88%,transparent);backdrop-filter:blur(12px);border-bottom:1px solid var(--ln)}
.sg-fulltitle{display:grid;min-width:0}
.sg-fullbody{max-width:1600px;margin:auto;padding:20px}
.sg-row{display:grid;grid-template-columns:30px minmax(0,1fr) auto minmax(110px,150px) auto;gap:12px;align-items:center;background:var(--sf2);border:1px solid var(--ln);border-radius:10px;padding:12px 14px;transition:border-color .15s}
.sg-row:hover{border-color:var(--ac)}
.sg-row.me{border-color:var(--ac);box-shadow:0 0 0 1px var(--ac)}
.sg-rank{text-align:center;font:700 20px var(--head);color:var(--mu)}
.sg-list>li:first-child .sg-rank{color:#f5b301}
.sg-who{all:unset;cursor:pointer;display:flex;gap:12px;align-items:center;min-width:0;border-radius:8px}
.sg-who:focus-visible{outline:2px solid var(--ac);outline-offset:3px}
.sg-who .grow{display:grid;min-width:0}
.sg-chips{display:flex;gap:6px;flex-wrap:wrap}
.sg-chip{display:inline-flex;gap:4px;align-items:center;border:1px solid var(--ln);background:var(--sf);border-radius:999px;padding:1px 9px;font-size:13px;font-weight:600;white-space:nowrap}
.sg-meter{display:grid;gap:4px;text-align:right}.sg-meter b{font-variant-numeric:tabular-nums}
.sg-plans{display:grid;gap:12px}
.sg-plan{border:1px solid var(--ln);border-radius:10px;background:var(--sf2);padding:12px 14px;display:grid;gap:8px}
.sg-plan.me{border-color:var(--ac);box-shadow:0 0 0 1px var(--ac)}
.sg-plan header{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.sgw-grid{display:grid;grid-template-columns:repeat(7,minmax(118px,1fr));gap:8px;overflow-x:auto;padding-bottom:6px}
.sgw-col{background:var(--sf);border:1px solid var(--ln);border-radius:12px;padding:8px;display:flex;flex-direction:column;gap:8px;min-height:120px}
.sgw-col.today{border-color:var(--ac);box-shadow:0 0 0 1px var(--ac)}
.sgw-col.past h4{color:var(--mu)}
.sgw-head{display:flex;align-items:baseline;gap:6px;flex-wrap:wrap}
.sgw-head h4{font-size:14px}
.sgw-count{margin-left:auto;font-size:12px;font-weight:600;color:var(--mu);background:var(--sf2);border:1px solid var(--ln);border-radius:999px;padding:0 8px}
.sgw-count.all{color:var(--ok);border-color:var(--ok)}
.sgw-empty{margin:4px 0;text-align:center}
.sgw-list{list-style:none;margin:0;padding:0;display:grid;gap:6px}
.sgw-td{display:flex;gap:8px;align-items:flex-start;background:var(--sf2);border:1px solid var(--ln);border-radius:8px;padding:7px 8px}
.sgw-td input[type=checkbox]{margin-top:3px;flex:none}
.sgw-main{flex:1;min-width:0;display:grid;gap:5px;justify-items:start}
.sgw-text{line-height:1.35;word-break:break-word}
.sgw-td.done .sgw-text{text-decoration:line-through;color:var(--mu)}
.sgw-type{background:color-mix(in srgb,var(--c) 18%,transparent);color:color-mix(in srgb,var(--c) 65%,var(--tx));border-radius:999px;padding:1px 9px;font-size:12px;font-weight:600}
@media(max-width:640px){.sg-row{grid-template-columns:26px minmax(0,1fr)}.sg-chips,.sg-meter,.sg-cheers{grid-column:2/-1;text-align:left}}
.sg-summary{display:flex;gap:8px 18px;flex-wrap:wrap;align-items:center;padding:12px 14px;border-radius:10px;border:1px solid var(--ln);background:color-mix(in srgb,var(--ok) 10%,var(--sf2))}
.sg>*,.sg-board>*,.sg-plan,.sg-timer>*{min-width:0}
.sg-who b,.sg-who small,.sg-coach,.sg-plan header b,.sgw-text,.sg-shares b,.sg-shares small,.sg-fulltitle b{overflow-wrap:anywhere}
.sg-shares li{flex-wrap:wrap}
.sg-pv{display:flex;gap:14px;align-items:center;margin-bottom:8px}
.sg-photo{display:flex;gap:14px;align-items:center;margin-bottom:12px}
.sg-info{list-style:none;margin:8px 0;padding:0;display:grid;gap:4px;overflow-wrap:anywhere}
.sg-pstats{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px}
.sg-pstats>div{border:1px solid var(--ln);background:var(--sf2);border-radius:10px;padding:8px 10px;display:grid}
.sg-pstats b{font:700 18px var(--head)}.sg-pstats span{color:var(--mu);font-size:12px}
@media(max-width:640px){.sg{padding:16px 12px 90px}.sg-board{padding:14px}.sgw-grid{grid-template-columns:1fr}.sgw-col{min-height:0}}
.sg-live{display:flex;gap:6px;flex-wrap:wrap;align-items:center;padding:8px 12px;border-radius:10px;border:1px solid var(--ok);background:color-mix(in srgb,var(--ok) 8%,var(--sf2))}
.sg-live .sg-chip{cursor:pointer;color:var(--tx)}.sg-live .sg-avatar{font-size:10px}
.sg-pulse{width:10px;height:10px;border-radius:50%;background:var(--ok);animation:glow 1.4s ease-in-out infinite}
.sg-pheat{display:grid;gap:6px;margin-top:12px}
.sg-sform{display:grid;grid-template-columns:minmax(0,1fr) 150px 110px auto;gap:6px}
@media(max-width:640px){.sg-sform{grid-template-columns:1fr 1fr}.sg-sform input:first-child{grid-column:1/-1}}
.sg-row,.sg-plan,.sg-shares li{animation:rise .3s both}
.sg-coach{background:linear-gradient(135deg,color-mix(in srgb,var(--ac) 14%,var(--sf2)),color-mix(in srgb,var(--ok) 8%,var(--sf2)))}
`
