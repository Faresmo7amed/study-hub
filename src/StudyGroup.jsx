import { useEffect, useMemo, useRef, useState } from 'react'
import { addDays, getStore, hms, iso, notify, parseISO, setStore, todayISO, useNow, useStore, weekStart } from './shared'
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
const DEFAULT = { name: '', groups: [], active: '', days: {}, total: 0 }
const EMPTY = []
const PERIODS = { today: 'Today', week: 'This week', total: 'All time' }
const TITLES = ['👑 Top of the pack', '🥈 Chasing the crown', '🥉 On the podium']

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
function publish(user, ids) {
    const s = getStore('studygroup', DEFAULT)
    if (!user || !s.name) return
    const cutoff = iso(addDays(new Date(), -KEEP_DAYS))
    const card = {
        name: s.name,
        days: Object.fromEntries(Object.entries(s.days).filter(([k]) => k >= cutoff)),
        total: s.total,
        studying: getStore('studyrun', {}).start || 0,
        updatedAt: Date.now(),
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

/* ============================================================
   Page
   ============================================================ */
export default function StudyGroup() {
    const sync = useSyncState()
    const user = sync.user
    const uid = user ? user.uid : ''
    const [s, , update] = useStore('studygroup', DEFAULT)
    const [run] = useStore('studyrun', {})
    const now = useNow(1000)
    const [period, setPeriod] = useState('today')
    const [adding, setAdding] = useState(false)
    const [renaming, setRenaming] = useState(false)
    const [feed, setFeed] = useState({ id: '', list: EMPTY })
    const seen = useRef(null)
    const rank = useRef(null)

    const active = s.groups.find(g => g.id === s.active) || s.groups[0]
    const activeId = active ? active.id : ''
    const members = feed.id === activeId ? feed.list : EMPTY

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
            return { uid: m.uid, name: m.name || '?', on, today: days[today], week: sumDays(days, ws, today), total: (m.total || 0) + live, streak, best }
        })
    }, [members, now])

    const byName = (a, b) => a.name.localeCompare(b.name)
    const order = useMemo(() => [...rows].sort((a, b) => b[period] - a[period] || byName(a, b)), [rows, period])
    const todayOrder = useMemo(() => [...rows].sort((a, b) => b.today - a.today || byName(a, b)), [rows])
    const myRank = todayOrder.findIndex(r => r.uid === uid)

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
        setRenaming(false)
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
        if (!window.confirm(`Leave "${active.name}"? Your card is removed from it.`)) return
        fb.leaveGroup(active.id, user.uid).catch(fail)
        update(d => {
            d.groups = d.groups.filter(g => g.id !== active.id)
            d.active = d.groups[0] ? d.groups[0].id : ''
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

    /* ----- gates ----- */
    if (sync.phase === 'off') return <Notice title="Cloud sync is not set up" text="The Study Group needs Firebase. Follow FIREBASE_SETUP.md first." />
    if (!user) return <Notice title="Sign in first" text="Use the cloud button in the top bar to sign in. Your friends see you under the name you pick next." />
    if (!s.name) return <div className="sg"><style>{CSS}</style><NameForm initial="" onSave={saveName} /></div>

    /* ----- derived for the screen ----- */
    const today = iso(now)
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
                <button className="btn sm ghost" onClick={() => setRenaming(!renaming)}>Change name</button>
            </header>
            {renaming && <NameForm initial={s.name} onSave={saveName} onCancel={() => setRenaming(false)} />}

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
                    <div className="seg" role="group" aria-label="Period">
                        {Object.entries(PERIODS).map(([k, l]) => <button key={k} className={'btn sm' + (period === k ? ' on' : '')} onClick={() => setPeriod(k)}>{l}</button>)}
                    </div>
                    <ol className="sg-list">
                        {order.map((r, i) => (
                            <li key={r.uid} className={'sg-row' + (r.uid === uid ? ' me' : '')}>
                                <span className="sg-rank">{i + 1}</span>
                                <span className="sg-avatar">{r.name[0].toUpperCase()}</span>
                                <div className="grow">
                                    <b>{r.name}{r.uid === uid ? ' (you)' : ''}</b>
                                    <small className="muted">{r[period] === 0 ? '😴 Not started yet' : TITLES[i] || '🔥 In the race'}{r.on ? ' · 🟢 studying now' : ''}</small>
                                </div>
                                <span className="sg-streak" title={`Best streak: ${r.best}`}>🔥 {r.streak}</span>
                                <b className="sg-min">{fmtMin(r[period])}</b>
                            </li>
                        ))}
                    </ol>
                    {!order.length && <p className="muted small">Loading the group…</p>}
                </section>
            )}
        </div>
    )
}

const CSS = `
.sg{max-width:900px;margin:auto;padding:24px 20px 90px;display:grid;gap:18px}
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
`