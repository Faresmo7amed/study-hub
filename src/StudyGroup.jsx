import { useEffect, useMemo, useRef, useState } from 'react'
import { DAYS, TYPES, addDays, computeStats, dayIndex, getStore, hms, iso, notify, onStoreChange, parseISO, setStore, todayISO, useNow, useStats, useStore, weekStart } from './shared'
import { DatabaseView, loadBlocks, snapshotBlock } from './Database'
import { RoadmapView, loadRoadmaps, snapshotRoadmap } from './Roadmap'
import * as fb from './firebase'
import { useSyncState } from './sync'
import { play } from './sound'

/* ============================================================
   Study Group
   - you study with a timer, minutes are saved per day in the synced key "studygroup"
   - your "card" (name, daily minutes, studying now) is copied to every group you joined
   - friends read the cards live; streaks and rankings are computed on each device
   ============================================================ */

const STREAK_MIN = 30           // minutes of study that make a day count for the streak
const KEEP_DAYS = 120           // how many days of history go into your card
const MAX_SESSION = 360         // a forgotten timer never adds more than 6 hours
const ONLINE_MAX = 12 * 3600000 // "studying now" expires after 12 hours
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const DEFAULT = { name: '', groups: [], active: '', days: {}, total: 0, profile: {}, celebrated: {}, shared: [] }
const EMPTY = []
const PERIODS = { today: 'Today', week: 'This week', total: 'All time' }
const TITLES = ['👑 Top of the pack', '🥈 Chasing the crown', '🥉 On the podium']
const CHEERS = { clap: '👏', fire: '🔥', muscle: '💪' }
const NUDGE = '👉'
const COOLDOWN = 20000 // ms before you can cheer the same friend again
// [key, label, hint, max length]
const PROFILE_FIELDS = [
    ['focus', 'Studying', 'ITI prep, React, IELTS…', 60],
    ['bio', 'Bio', 'A line about you', 160],
    ['city', 'City', 'Alexandria', 40],
    ['email', 'Email', 'name@example.com', 80],
    ['link', 'Link', 'github.com/you', 100],
]
const isHttp = v => /^https?:\/\//i.test(v)

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
const fmtMin = m => {
    const n = Math.round(m)
    return n >= 60 ? `${Math.floor(n / 60)}h ${n % 60}m` : `${n}m`
}

// Minutes between two ISO dates, both included
const sumDays = (days, from, to) => Object.entries(days).reduce((sum, [k, v]) => (k >= from && k <= to ? sum + v : sum), 0)

function streakOf(days, today) {
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
    const s = getStore('studygroup', DEFAULT)
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
        studying: getStore('studyrun', {}).start || 0,
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

/* The running session is stored on this device only ("studyrun"), so a reload does not lose it */
function startSession(user) {
    if (getStore('studyrun', {}).start) return
    setStore('studyrun', { start: Date.now() }, {})
    play('studystart')
    publish(user)
}

function stopSession(user) {
    const start = getStore('studyrun', {}).start
    if (!start) return
    const minutes = Math.min(MAX_SESSION, Math.floor((Date.now() - start) / 60000))
    const today = todayISO()
    const before = getStore('studygroup', DEFAULT).days[today] || 0
    setStore('studyrun', {}, {})
    if (minutes > 0) {
        setStore('studygroup', cur => ({ ...cur, days: { ...cur.days, [today]: (cur.days[today] || 0) + minutes }, total: cur.total + minutes }), DEFAULT)
    }
    play('studyend')
    if (before < STREAK_MIN && before + minutes >= STREAK_MIN) {
        const { streak } = streakOf(getStore('studygroup', DEFAULT).days, today)
        notify({ title: streak > 1 ? `${streak}-day study streak` : 'Study streak started', body: `${STREAK_MIN} minutes done today. Come back tomorrow!`, icon: '🔥' })
        play('streak')
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
    const list = getStore('studygroup', DEFAULT).shared || []
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
    return null
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
                        <h2 style={{ margin: 0 }}>{r.name}{isMe ? ' (you)' : ''}</h2>
                        {p.focus && <p className="muted" style={{ margin: 0 }}>📖 {p.focus}</p>}
                        {r.on && <p style={{ margin: 0 }}>🟢 studying now</p>}
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

function WeekSummary({ rows, friday }) {
    const minutes = rows.reduce((n, r) => n + r.week, 0)
    const all = rows.flatMap(r => (r.plan ? Object.values(r.plan).flat() : []))
    const done = all.filter(x => x.d).length
    const top = [...rows].sort((a, b) => b.week - a.week)[0]
    return (
        <div className="sg-summary">
            <b>{friday ? '🏁 Week wrap-up' : '📊 Week so far'}</b>
            <span>⏱️ {fmtMin(minutes)} studied together</span>
            <span>✅ {done}/{all.length} todos done</span>
            {top && top.week > 0 && <span>👑 {top.name} leads with {fmtMin(top.week)}</span>}
        </div>
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
    const [s, , update] = useStore('studygroup', DEFAULT)
    const [run] = useStore('studyrun', {})
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

    const active = s.groups.find(g => g.id === s.active) || s.groups[0]
    const activeId = active ? active.id : ''
    const members = feed.id === activeId ? feed.list : EMPTY
    const shares = shareFeed.id === activeId ? shareFeed.list : EMPTY

    // Live cards of the open group
    
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

    // One row per member, with the running session counted in
    const rows = useMemo(() => {
    const t = now.getTime()
    const today = iso(now)
    const ws = iso(weekStart(now))
    return members.map(m => {
            const on = Boolean(m.studying) && t - m.studying < ONLINE_MAX
            const live = on ? Math.min(MAX_SESSION, Math.floor((t - m.studying) / 60000)) : 0
            const base = m.days || {}
            const days = { ...base, [today]: (base[today] || 0) + live }
            const { streak, best } = streakOf(days, today)
            const plannedToday = m.todos && iso(new Date(m.updatedAt || 0)) === today ? m.todos : null
            const tp = m.todos || {}
            const mine = m.uid === uid
            return {
                uid: m.uid, name: m.name || '?', on, today: days[today], week: sumDays(days, ws, today), total: (m.total || 0) + live,
                streak, best, todos: plannedToday, profile: m.profile || {},
                plan: mine ? planOf(todos[ws]) : tp.week === ws ? tp.plan || {} : null, // your own plan is always live
                appStreak: mine ? stats.streak : tp.streak || 0,
            }
        })
    }, [members, now, todos, stats, uid])

    const byName = (a, b) => a.name.localeCompare(b.name)
    const order = useMemo(() => [...rows].sort((a, b) => b[period] - a[period] || byName(a, b)), [rows, period])
    const todayOrder = useMemo(() => [...rows].sort((a, b) => b.today - a.today || byName(a, b)), [rows])
    const myRank = todayOrder.findIndex(r => r.uid === uid)
    const cheers = useFeed(fb.watchCheers, activeId, uid, EMPTY)
    const group = useFeed(fb.watchGroup, activeId, uid, null)
    const goal = (group && group.goal) || 0
    const isOwner = Boolean(group) && group.owner === uid
    const weekTotal = rows.reduce((n, r) => n + r.week, 0)

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
    const changeGoal = () => {
        const raw = window.prompt('Weekly goal for the whole group, in hours (0 removes it)', goal ? String(Math.round(goal / 60)) : '20')
        if (raw === null) return
        const hours = Number(raw)
        if (!Number.isFinite(hours) || hours < 0 || hours > 1000) return notify({ title: 'Enter a number of hours', body: 'For example 20.', icon: '🔢' })
        fb.setGroupGoal(activeId, Math.round(hours * 60)).then(() => play('save')).catch(fail)
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
    const elapsed = run.start ? now.getTime() - run.start : 0
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
                <span className="muted">Studying as <b>{s.name}</b></span>
                                <button className="btn sm ghost" onClick={() => setEditing(true)}>Edit profile</button>
            </header>

            <section className="card sg-timer" aria-label="Study timer">
                <div>
                    <p className="muted small">{run.start ? '📖 You are studying' : 'Ready when you are'}</p>
                    <div className={'sg-clock' + (run.start ? ' on' : '')}>{hms(elapsed)}</div>
                    <button className={'btn ' + (run.start ? 'danger' : 'primary')} onClick={() => (run.start ? stopSession(user) : startSession(user))}>
                        {run.start ? 'Stop and save' : 'Start studying'}
                    </button>
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
                                        <b>{r.name}{r.uid === uid ? ' (you)' : ''}</b>
                                        <small className="muted">{r[period] === 0 ? '😴 Not started yet' : TITLES[i] || '🔥 In the race'}{r.on ? ' · 🟢 studying now' : ''}{r.todos && r.todos.total > 0 ? ` · 📝 ${r.todos.done}/${r.todos.total} today` : ''}</small>
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
                        <h3>This week's plans</h3>
                        <span className="muted small">Saturday to Friday. Friends see your todo text.</span>
                    </div>
                    <WeekSummary rows={rows} friday={dayIndex(now) === 6} />
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
.sg{max-width:1100px;margin:auto;padding:24px 20px 90px;display:grid;gap:18px}
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
.sg-row{display:flex;gap:12px;align-items:center;background:var(--sf2);border:1px solid var(--ln);border-radius:10px;padding:10px 12px}
.sg-row.me{border-color:var(--ac);box-shadow:0 0 0 1px var(--ac)}
.sg-row .grow{display:grid;min-width:0}
.sg-rank{width:26px;text-align:center;font:700 18px var(--head);color:var(--mu)}
.sg-avatar{display:grid;place-items:center;width:36px;height:36px;border-radius:50%;background:var(--ac);color:#fff;font-weight:700;flex:none}
.sg-streak{font-weight:600;white-space:nowrap}.sg-min{font-variant-numeric:tabular-nums;min-width:64px;text-align:right}
@media(max-width:640px){.sg-timer{grid-template-columns:1fr}.sg-clock{font-size:44px}}
.sg-sharehead{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-top:8px;border-top:1px solid var(--ln);padding-top:14px}
.sg-sharehead h3{font-size:18px}
.sg-shares{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.sg-shares li{display:flex;gap:10px;align-items:center;background:var(--sf2);border:1px solid var(--ln);border-radius:10px;padding:8px 12px}
.sg-shares .grow{display:grid;min-width:0}
.sg-view{width:min(620px,100%)}
.sg-items{list-style:none;margin:10px 0 0;padding:0;display:grid;gap:12px}
.sg-items details{margin-top:6px;font-size:14px}
.sg-items details ul{margin:6px 0 0;padding-left:20px;display:grid;gap:3px}
.sg-full{position:fixed;inset:0;z-index:60;background:var(--bg);overflow:auto}
.sg-fullbar{position:sticky;top:0;z-index:5;display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 20px;background:color-mix(in srgb,var(--bg) 88%,transparent);backdrop-filter:blur(12px);border-bottom:1px solid var(--ln)}
.sg-fulltitle{display:grid;min-width:0}
.sg-fullbody{max-width:1400px;margin:auto;padding:20px}
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
.sg .bar{height:8px;border-radius:8px;background:var(--ln);overflow:hidden}
.sg .bar i{display:block;height:100%;border-radius:8px;background:var(--ac);transition:width .5s}.sg .bar i.full{background:var(--ok)}
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
`