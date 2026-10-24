import { useEffect, useMemo, useRef, useState } from 'react'
import Database from './Database'
import { play } from './sound'
import {
    BADGES, DAYS, MONTH_TIERS, STUDY_DEFAULT, TYPES, TYPE_KEYS, activeDaysIn, addDays, clamp, dayIndex, emptyWeek, hms, isHttp, iso, monthKey, monthLength, monthTrophies, tierState,
    normalizeUrl, notify, pad, parseISO, quoteOfDay, QUOTES, setStore, startOfDay, systemNotify, todayISO, uid, until,
    useNow, useStats, useStore, weekStart,
} from './shared'
import { EVENT_COLORS, carryYesterday, openTodoDetails, removeEvent, toggleTodo } from './todoActions'
import { ShiftModal, detailsBadge } from './TodoTools'
import { STREAK_MIN } from './StudyGroup'
import { runRecurringNow } from './Rewards'
import Contributions from './Heatmap'

const fmtShort = d => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

/* ============================================================
   Today: date, live clock and how much of the day is gone
   ============================================================ */
function DayCard() {
    const now = useNow(1000)
    const [quote, setQuote] = useState(() => quoteOfDay())
    const start = startOfDay(now)
    const total = addDays(start, 1) - start
    const elapsed = now - start
    const pct = (elapsed / total) * 100
    const hour = now.getHours()
    const greeting = hour < 5 ? 'Still up' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
    const R = 52
    const C = 2 * Math.PI * R

    const anotherQuote = () => {
        let next = quote
        while (next === quote) next = QUOTES[Math.floor(Math.random() * QUOTES.length)]
        setQuote(next)
    }

    return (
        <section className="card dc" aria-label="Today">
            <div className="dc-text">
                <p className="muted">{greeting}</p>
                <h1>{now.toLocaleDateString(undefined, { weekday: 'long' })}</h1>
                <p className="dc-date">{now.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}</p>
                <p className="dc-clock" aria-label="Current time">{pad(now.getHours())}:{pad(now.getMinutes())}:{pad(now.getSeconds())}</p>
                <div className="dc-meta">
                    <span><b>{hms(elapsed)}</b> passed</span>
                    <span><b>{hms(total - elapsed)}</b> left</span>
                </div>
            </div>
            <div className="dc-ring" role="img" aria-label={`${pct.toFixed(1)} percent of today has passed`}>
                <svg viewBox="0 0 140 140">
                    <defs>
                        <linearGradient id="dcg" x1="0" y1="0" x2="1" y2="1">
                            <stop offset="0" stopColor="var(--ac2)" />
                            <stop offset="1" stopColor="var(--ok)" />
                        </linearGradient>
                    </defs>
                    {Array.from({ length: 24 }, (_, h) => (
                        <line key={h} x1="70" y1="5" x2="70" y2="12" transform={`rotate(${h * 15} 70 70)`}
                            className={'tick' + (h < hour ? ' on' : h === hour ? ' now' : '')} />
                    ))}
                    <circle cx="70" cy="70" r={R} fill="none" stroke="var(--ln)" strokeWidth="9" />
                    <circle cx="70" cy="70" r={R} className="dc-arc" strokeDasharray={C} strokeDashoffset={C * (1 - pct / 100)} />
                </svg>
                <div className="dc-pct"><b>{pct.toFixed(1)}%</b><span>of today</span></div>
            </div>
            <figure className="dc-quote">
                <blockquote key={quote} className="fadein">{quote}</blockquote>
                <button className="icon-btn" onClick={anotherQuote} title="Show another quote" aria-label="Show another quote">↻</button>
            </figure>
        </section>
    )
}

/* ============================================================
   Streak, daily goal, level and badges
   ============================================================ */
function Flame({ lit }) {
    return (
        <svg className={'flame' + (lit ? ' lit' : '')} viewBox="0 0 64 80" aria-hidden="true">
            <defs>
                <linearGradient id="fl" x1="0" y1="1" x2="0" y2="0">
                    <stop offset="0" stopColor="#ff4d4d" />
                    <stop offset=".6" stopColor="#ff9d2e" />
                    <stop offset="1" stopColor="#ffd75e" />
                </linearGradient>
            </defs>
            <path d="M32 3c3 14 21 22 21 45a21 21 0 0 1-42 0c0-10 5-17 10-22 0 8 4 12 8 12-3-13-1-26 3-35z" fill="url(#fl)" />
            <path d="M32 40c2 7 9 10 9 19a9 9 0 0 1-18 0c0-5 3-8 5-10 0 3 2 5 4 5-1-5-1-9 0-14z" fill="#fff6c9" opacity=".85" />
        </svg>
    )
}

function StreakCard() {
    const stats = useStats()
    const [activity] = useStore('activity', {})
    const [settings, , updateSettings] = useStore('settings', { dailyGoal: 3 })
    const today = todayISO()
    const doneToday = activity[today] || 0
    const goal = settings.dailyGoal || 3
    const ws = weekStart()
    const level = stats.level

    return (
        <section className="card st" aria-label="Streak and progress">
            <div className="st-top">
                <Flame lit={stats.streak > 0} />
                <div>
                    <div className="st-num"><b>{stats.streak}</b> day{stats.streak === 1 ? '' : 's'}</div>
                    <p className="muted small">
                        {stats.streak === 0 ? 'Finish one todo or focus session to start a streak.' : `Best streak: ${stats.best} · ${stats.done} todos done in total`}
                    </p>
                </div>
            </div>

            <div className="st-week" role="list" aria-label="This week">
                {DAYS.map((name, i) => {
                    const d = addDays(ws, i)
                    const key = iso(d)
                    const on = stats.active.has(key)
                    return (
                        <div key={key} role="listitem" className={'st-day' + (on ? ' on' : '') + (key === today ? ' today' : '') + (key > today ? ' future' : '')} title={`${name}${on ? ': active' : ''}`}>
                            <span>{on ? '✓' : ''}</span>
                            <small>{name.slice(0, 3)}</small>
                        </div>
                    )
                })}
            </div>

            <div>
                <div className="row">
                    <b className="small">Daily goal</b>
                    <span className="muted small grow">{Math.min(doneToday, 99)} of {goal} todos today</span>
                    <button className="icon-btn" onClick={() => updateSettings(s => { s.dailyGoal = clamp((s.dailyGoal || 3) - 1, 1, 20) })} aria-label="Lower daily goal">−</button>
                    <button className="icon-btn" onClick={() => updateSettings(s => { s.dailyGoal = clamp((s.dailyGoal || 3) + 1, 1, 20) })} aria-label="Raise daily goal">+</button>
                </div>
                <div className="bar"><i style={{ width: clamp((doneToday / goal) * 100, 0, 100) + '%' }} className={doneToday >= goal ? 'full' : ''} /></div>
            </div>

            <div>
                <div className="row">
                    <b className="small">Level {level.level} · {level.title}</b>
                    <span className="muted small grow" style={{ textAlign: 'right' }}>{level.into} / {level.span} XP</span>
                </div>
                <div className="bar"><i style={{ width: level.pct + '%' }} /></div>
            </div>

            <div className="st-badges" aria-label="Badges">
                {BADGES.map(b => (
                    <span key={b.id} className={'st-badge' + (b.test(stats) ? ' got' : '')} title={`${b.name}: ${b.desc}`}>{b.icon}</span>
                ))}
            </div>
        </section>
    )
}


/* ============================================================
   Monthly title: active days decide the title, six tiers per month
   ============================================================ */
function TitleCard() {
    const [activity] = useStore('activity', {})
    const [focus] = useStore('focus', {})
    const [study] = useStore('studygroup', STUDY_DEFAULT)
    const now = useNow(60000)
    const ym = monthKey(now)
    const days = study.days || {}
    const st = useMemo(() => tierState(activeDaysIn(ym, activity, focus, days, STREAK_MIN), ym), [ym, activity, focus, days])
    const trophies = useMemo(() => monthTrophies(activity, focus, days, STREAK_MIN).filter(t => t.ym !== ym), [ym, activity, focus, days])
    const len = monthLength(ym)
    const isActive = k => (activity[k] || 0) > 0 || (focus[k] || 0) > 0 || (days[k] || 0) >= STREAK_MIN
    const label = now.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    const monthName = ymKey => new Date(Number(ymKey.slice(0, 4)), Number(ymKey.slice(5, 7)) - 1, 1).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })

    return (
        <section className="card ttl" aria-label="Monthly title" style={st.cur ? { '--tc': st.cur.color } : undefined}>
            <div className="ttl-head">
                <span className="ttl-badge" aria-hidden="true">{st.cur ? st.cur.icon : '🌑'}</span>
                <div className="grow">
                    <p className="muted small">{label} · {st.count} active day{st.count === 1 ? '' : 's'}</p>
                    <h2>{st.cur ? st.cur.name : 'No title yet'}</h2>
                    <p className="muted small">
                        {st.next ? `${st.left} more active day${st.left === 1 ? '' : 's'} to become ${st.next.name}. A day counts when you finish a todo, a focus session, or study ${STREAK_MIN} minutes.` : 'Top title reached. Every day counted!'}
                    </p>
                </div>
            </div>
            <div className="bar"><i className={st.tier === MONTH_TIERS.length ? 'full' : ''} style={{ width: st.pct + '%' }} /></div>
            <ol className="ttl-tiers" aria-label="Titles of this month">
                {MONTH_TIERS.map((t, i) => (
                    <li key={t.name} className={'ttl-tier' + (st.tier > i ? ' got' : '')} style={{ '--tc': t.color }} title={`${t.name}: ${st.needs[i]} active days`}>
                        <span>{st.tier > i ? t.icon : '🔒'}</span>
                        <b>{t.name}</b>
                        <small>{st.needs[i]} days</small>
                    </li>
                ))}
            </ol>
            <div className="ttl-days" aria-label="Active days this month">
                {Array.from({ length: len }, (_, i) => {
                    const k = `${ym}-${pad(i + 1)}`
                    return <i key={k} className={(isActive(k) ? 'on' : '') + (k === iso(now) ? ' today' : '')} title={`${i + 1}${isActive(k) ? ': active' : ''}`} />
                })}
            </div>
            {trophies.length > 0 && (
                <div className="ttl-shelf" aria-label="Trophies from earlier months">
                    <span className="muted small">Trophies</span>
                    {trophies.slice(0, 12).map(t => <span key={t.ym} className="ttl-trophy" style={{ '--tc': t.cur.color }} title={`${t.count} active days`}>{t.cur.icon} {monthName(t.ym)} · {t.cur.name}</span>)}
                </div>
            )}
        </section>
    )
}

/* ============================================================
   Weekly review: how the week went, last week or this week so far
   ============================================================ */
function WeeklyReview() {
    const [todos] = useStore('todos', {})
    const [activity] = useStore('activity', {})
    const [focus] = useStore('focus', {})
    const [study] = useStore('studygroup', STUDY_DEFAULT)
    const [which, setWhich] = useState(-1)
    const now = useNow(60000)
    const ws = addDays(weekStart(now), which * 7)
    const week = todos[iso(ws)] || emptyWeek()
    const all = week.flat()
    const planned = all.length
    const done = all.filter(t => t.done).length
    const per = DAYS.map((name, i) => {
        const k = iso(addDays(ws, i))
        return { name, k, done: activity[k] || 0, sessions: focus[k] || 0, min: (study.days || {})[k] || 0 }
    })
    const sessions = per.reduce((n, d) => n + d.sessions, 0)
    const minutes = per.reduce((n, d) => n + d.min, 0)
    const activeDays = per.filter(d => d.done > 0 || d.sessions > 0 || d.min >= STREAK_MIN).length
    const best = [...per].sort((a, b) => b.done + b.sessions - (a.done + a.sessions))[0]
    const top = Math.max(1, ...per.map(d => d.done + d.sessions))
    const pct = planned ? Math.round((100 * done) / planned) : 0
    const verdict = !planned && !sessions && !minutes ? 'Nothing recorded for this week.'
        : pct >= 80 ? 'Great week. Keep this rhythm.' : pct >= 50 ? 'Solid week. A few todos slipped, plan fewer next time.' : 'A slow week. Pick two small todos tomorrow and restart.'
    const fmtM = m => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`)

    return (
        <section className="card side-card wr" aria-label="Weekly review">
            <div className="row">
                <h3 className="grow">Weekly review</h3>
                <div className="seg" role="group" aria-label="Which week">
                    <button className={'btn sm' + (which === -1 ? ' on' : '')} onClick={() => setWhich(-1)}>Last week</button>
                    <button className={'btn sm' + (which === 0 ? ' on' : '')} onClick={() => setWhich(0)}>So far</button>
                </div>
            </div>
            <div className="wr-grid">
                <div><b>{done}/{planned}</b><span>todos ({pct}%)</span></div>
                <div><b>{sessions}</b><span>focus sessions</span></div>
                <div><b>{fmtM(minutes)}</b><span>studied</span></div>
                <div><b>{activeDays}/7</b><span>active days</span></div>
            </div>
            <div className="wr-bars" aria-hidden="true">
                {per.map(d => <div key={d.k} title={`${d.name}: ${d.done} todos, ${d.sessions} sessions`}><i style={{ height: Math.max(4, (100 * (d.done + d.sessions)) / top) + '%' }} /><small>{d.name.slice(0, 1)}</small></div>)}
            </div>
            <p className="muted small" style={{ margin: 0 }}>{best && best.done + best.sessions > 0 ? `Best day: ${best.name}. ` : ''}{verdict}</p>
        </section>
    )
}

/* ============================================================
   Recurring todos: created automatically on the days you choose
   ============================================================ */
function RecurringCard() {
    const [list, , update] = useStore('recurring', [])
    const [text, setText] = useState('')
    const [type, setType] = useState('task')
    const [sel, setSel] = useState([0, 1, 2, 3, 4, 5, 6])
    const items = Array.isArray(list) ? list : []

    const add = e => {
        e.preventDefault()
        const v = text.trim()
        if (!v || !sel.length) return
        update(d => { (Array.isArray(d) ? d : []).push({ id: uid(), text: v, type, days: [...sel].sort(), last: '' }) })
        setText('')
        play('add')
        setTimeout(runRecurringNow, 50)
    }
    const label = days => (days.length === 7 ? 'Every day' : days.map(i => DAYS[i].slice(0, 3)).join(', '))

    return (
        <section className="card side-card" aria-label="Recurring todos">
            <h3>Recurring todos</h3>
            <form className="wk-add" onSubmit={add}>
                <input value={text} onChange={e => setText(e.target.value)} placeholder="e.g. Review flashcards" aria-label="Recurring todo" maxLength={120} />
                <div className="seg" role="group" aria-label="Repeat on">
                    {DAYS.map((name, i) => (
                        <button type="button" key={name} className={'btn sm' + (sel.includes(i) ? ' on' : '')} aria-pressed={sel.includes(i)} title={name}
                            onClick={() => setSel(sel.includes(i) ? sel.filter(x => x !== i) : [...sel, i])}>{name.slice(0, 1)}</button>
                    ))}
                </div>
                <div className="row">
                    <select value={type} onChange={e => setType(e.target.value)} aria-label="Type" style={{ flex: 1 }}>
                        {TYPE_KEYS.map(k => <option key={k} value={k}>{TYPES[k].icon} {TYPES[k].label}</option>)}
                    </select>
                    <button className="btn sm primary" type="submit" disabled={!text.trim() || !sel.length}>Repeat</button>
                </div>
            </form>
            {items.length === 0 ? <p className="muted small" style={{ margin: 0 }}>Todos you repeat appear on their days by themselves.</p> : (
                <ul className="rc-list">
                    {items.map(r => (
                        <li key={r.id}>
                            <span className="grow"><b>🔁 {r.text}</b><small className="muted">{label(r.days || [])}</small></span>
                            <button className="icon-btn" onClick={() => { update(d => d.filter(x => x.id !== r.id)); play('delete') }} aria-label={`Stop repeating ${r.text}`} title="Stop repeating (todos already created stay)">×</button>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    )
}

/* ============================================================
   Weekly board (Saturday to Friday)
   ============================================================ */

function TodoItem({ todo, day, onToggle, onEdit, onDelete, onDropOn, onShift }) {
    const [editing, setEditing] = useState(false)
    const [edge, setEdge] = useState(null) // 'top' | 'bottom' | null: where a dragged todo would land
    const [draft, setDraft] = useState(todo.text)
    const [linkDraft, setLinkDraft] = useState(todo.link || '')
    const meta = TYPES[todo.type] || TYPES.task
    const hasLink = isHttp(todo.link || '')
    const badge = detailsBadge(todo)
    const extras = (
        <>
            <button className="icon-btn td-open" onClick={() => openTodoDetails(todo.id)} aria-label={`Open details of ${todo.text}`} title="Open details window">Open</button>
            <button className="icon-btn td-open" onClick={() => onShift(todo)} aria-label={`Move ${todo.text} to another day`} title="Move to another day">→</button>
        </>
    )

    const startEdit = () => {
        setDraft(todo.text)
        setLinkDraft(todo.link || '')
        setEditing(true)
    }
    const save = () => {
        const v = draft.trim()
        const link = normalizeUrl(linkDraft)
        if (v && (v !== todo.text || link !== (todo.link || ''))) onEdit(todo.id, { text: v, link })
        setEditing(false)
    }

    return (
        <li className={'td' + (todo.done ? ' done' : '') + (edge ? ' drop-' + edge : '')} draggable={!editing}
            onDragStart={e => e.dataTransfer.setData('text/plain', JSON.stringify({ day, id: todo.id }))}
            onDragOver={e => {
                e.preventDefault()
                const r = e.currentTarget.getBoundingClientRect()
                setEdge(e.clientY < r.top + r.height / 2 ? 'top' : 'bottom')
            }}
            onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setEdge(null) }}
            onDrop={e => {
                e.preventDefault()
                e.stopPropagation() // the column's own drop handler would append to the end
                const where = edge
                setEdge(null)
                try {
                    const d = JSON.parse(e.dataTransfer.getData('text/plain'))
                    if (d.id !== todo.id) onDropOn(d.day, d.id, todo.id, where === 'bottom')
                } catch { return }
            }}
            onDragEnd={() => setEdge(null)}>
            <input type="checkbox" checked={todo.done} onChange={e => onToggle(todo.id, e.currentTarget)} aria-label={`Mark "${todo.text}" as done`} />
            <div className="td-main">
                {editing ? (
                    <div className="td-edit"
                        onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) save() }}
                        onKeyDown={e => {
                            if (e.key === 'Enter') save()
                            if (e.key === 'Escape') setEditing(false)
                        }}>
                        <input autoFocus value={draft} onChange={e => setDraft(e.target.value)} aria-label="Edit todo" />
                        <input value={linkDraft} onChange={e => setLinkDraft(e.target.value)} placeholder="Link (optional)" aria-label="Edit link, optional" inputMode="url" maxLength={500} />
                    </div>
                ) : hasLink ? (
                    <span className="td-title">
                        <a className="td-text td-link" href={todo.link} target="_blank" rel="noopener noreferrer" draggable={false} title={todo.link}>{todo.text}</a>
                        <button className="icon-btn td-pen" onClick={startEdit} aria-label="Edit todo and link" title="Edit">✎</button>
                        {extras}
                    </span>
                ) : (
                    <span className="td-title">
                        <button className="td-text" onClick={startEdit} title="Click to edit">{todo.text}</button>
                        <button className="icon-btn td-pen" onClick={startEdit} aria-label="Edit todo" title="Edit">✎</button>
                        {extras}
                    </span>
                )}
                {badge && <span className="td-pomo" title="Sub-todos done in the details">☑ {badge.done}/{badge.total}</span>}
                {todo.pomos > 0 && <span className="td-pomo" title="Focus sessions spent on this todo">🍅 {todo.pomos}</span>}
                {todo.rid && <span className="td-pomo" title="Repeats automatically">🔁</span>}
                <select className="td-type" value={todo.type} onChange={e => onEdit(todo.id, { type: e.target.value })} style={{ '--c': meta.color }} aria-label="Type">
                    {TYPE_KEYS.map(k => <option key={k} value={k}>{TYPES[k].icon} {TYPES[k].label}</option>)}
                </select>
            </div>
            <button className="icon-btn td-x" onClick={() => onDelete(todo.id)} aria-label="Delete todo">×</button>
        </li>
    )
}

function DayColumn({ day, date, list, isToday, isPast, filter, query = '', onAdd, onToggle, onEdit, onDelete, onMove, onShift }) {
    const [adding, setAdding] = useState(false)
    const [text, setText] = useState('')
    const [type, setType] = useState('task')
    const [link, setLink] = useState('')
    const [over, setOver] = useState(false)
    const q = query.trim().toLowerCase()
    const shown = list.filter(t => (filter === 'all' || t.type === filter) && (!q || t.text.toLowerCase().includes(q)))
    const done = list.filter(t => t.done).length

    const submit = e => {
        e.preventDefault()
        const v = text.trim()
        if (!v) return
        onAdd(day, { text: v, type, link: normalizeUrl(link) })
        setText('')
        setLink('')
    }

    return (
        <div className={'wk-col' + (isToday ? ' today' : '') + (isPast ? ' past' : '') + (over ? ' over' : '')}
            onDragOver={e => { e.preventDefault(); setOver(true) }}
            onDragLeave={() => setOver(false)}
            onDrop={e => {
                e.preventDefault()
                setOver(false)
                try {
                    const d = JSON.parse(e.dataTransfer.getData('text/plain'))
                    onMove(d.day, d.id, day)
                } catch {return null}
            }}>
            <div className="wk-col-head">
                <h3>{DAYS[day]}</h3>
                <span className="muted small">{fmtShort(date)}</span>
                {list.length > 0 && <span className={'wk-count' + (done === list.length ? ' all' : '')}>{done === list.length ? '✓ ' : ''}{done}/{list.length}</span>}
            </div>
            <ul className="wk-list">
                {shown.map(t => (
                    <TodoItem key={t.id} todo={t} day={day} onToggle={(id, el) => onToggle(day, id, el)}
                        onEdit={(id, patch) => onEdit(day, id, patch)} onDelete={id => onDelete(day, id)}
                        onDropOn={(from, id, targetId, after) => onMove(from, id, day, targetId, after)} onShift={t => onShift(iso(date), t.id)} />
                ))}
            </ul>
            {shown.length === 0 && !adding && <p className="muted small wk-empty">{list.length ? 'Nothing of this type.' : isPast ? 'Nothing planned.' : 'Plan something for this day.'}</p>}
            {adding ? (
                <form className="wk-add" onSubmit={submit}>
                    <input autoFocus value={text} onChange={e => setText(e.target.value)} placeholder="What will you do?" aria-label="New todo"
                        onKeyDown={e => e.key === 'Escape' && setAdding(false)} />
                    <input value={link} onChange={e => setLink(e.target.value)} placeholder="Link (optional)" aria-label="Link, optional" inputMode="url" maxLength={500}
                        onKeyDown={e => e.key === 'Escape' && setAdding(false)} />
                    <div className="row">
                        <select value={type} onChange={e => setType(e.target.value)} aria-label="Type" style={{ flex: 1 }}>
                            {TYPE_KEYS.map(k => <option key={k} value={k}>{TYPES[k].icon} {TYPES[k].label}</option>)}
                        </select>
                        <button className="btn sm primary" type="submit">Add</button>
                        <button className="btn sm ghost" type="button" onClick={() => setAdding(false)}>Done</button>
                    </div>
                </form>
            ) : (
                <button className="btn sm ghost wk-new" onClick={() => setAdding(true)}>+ Add todo</button>
            )}
        </div>
    )
}

function WeekBoard() {
    const [todos, , update] = useStore('todos', {})
    const [offset, setOffset] = useState(0)
    const [filter, setFilter] = useState('all')
    const [query, setQuery] = useState('')
    const [shift, setShift] = useState(null) // { from: 'YYYY-MM-DD', ids: [] } while the shift window is open
    const now = useNow(30000)
    const ws = addDays(weekStart(now), offset * 7)
    const key = iso(ws)
    const week = todos[key] || emptyWeek()
    const today = iso(startOfDay(now))
    const all = week.flat()
    const done = all.filter(t => t.done).length
    const title = offset === 0 ? 'This week' : offset === -1 ? 'Last week' : offset === 1 ? 'Next week' : 'Week of ' + fmtShort(ws)

    const ensure = draft => {
        if (!draft[key]) draft[key] = emptyWeek()
        return draft[key]
    }
    const add = (day, { text, type, link }) => {
        update(d => { ensure(d)[day].push({ id: uid(), text, type, ...(link ? { link } : {}), done: false, doneOn: null }) })
        play('add')
    }
    const edit = (day, id, patch) => update(d => {
        const t = ensure(d)[day].find(x => x.id === id)
        if (t) Object.assign(t, patch)
    })
    const remove = (day, id) => {
        const t = week[day].find(x => x.id === id)
        if (t && t.done && t.doneOn) setStore('activity', cur => ({ ...cur, [t.doneOn]: Math.max(0, (cur[t.doneOn] || 1) - 1) }), {})
        update(d => { ensure(d)[day] = ensure(d)[day].filter(x => x.id !== id) })
        play('delete')
    }
    // targetId: drop next to this todo (before it, or after it when `after` is true); omitted = append to the end
    const move = (from, id, to, targetId = null, after = false) => {
        if (from === to && !targetId) return
        update(d => {
            const w = ensure(d)
            const i = w[from].findIndex(t => t.id === id)
            if (i < 0) return
            const [item] = w[from].splice(i, 1)
            // Find the target after removing the item, so the index is correct for same-day moves
            const j = targetId ? w[to].findIndex(t => t.id === targetId) : -1
            if (j < 0) w[to].push(item)
            else w[to].splice(after ? j + 1 : j, 0, item)
        })
        play('move')
    }
    const carryOver = () => {
        const prev = todos[iso(addDays(ws, -7))]
        let count = 0
        if (prev) {
            update(d => {
                const cur = ensure(d)
                prev.forEach((list, i) => list.filter(t => !t.done).forEach(t => {
                    if (cur[i].some(x => x.text === t.text && x.type === t.type)) return
                    cur[i].push({ id: uid(), text: t.text, type: t.type, ...(t.link ? { link: t.link } : {}), ...(t.details ? { details: t.details } : {}), done: false, doneOn: null })
                    count += 1
                }))
            })
        }
        if (count) play('save')
        notify({ title: count ? `Carried over ${count} unfinished todo${count > 1 ? 's' : ''}` : 'Nothing to carry over', body: count ? 'They were copied to the same weekday this week.' : 'Last week has no unfinished todos.', icon: '↪️' })
    }

    const moveYesterday = () => {
        const n = carryYesterday()
        if (n) play('save')
        notify({ title: n ? `Moved ${n} unfinished todo${n > 1 ? 's' : ''} to today` : 'Nothing to move', body: n ? 'They were taken from yesterday.' : 'Yesterday has no unfinished todos.', icon: '↪️' })
    }

    // Shortcuts: n = new todo today, / = search
    useEffect(() => {
        const onKey = e => {
            if (e.ctrlKey || e.metaKey || e.altKey) return
            const el = e.target
            if (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))) return
            if (e.key === 'n') {
                const btn = document.querySelector('.wk-col.today .wk-new')
                if (btn) { e.preventDefault(); btn.click() }
            } else if (e.key === '/') {
                const box = document.getElementById('wk-search')
                if (box) { e.preventDefault(); box.focus() }
            }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [])

    return (
        <section className="card wk" id="section-week" aria-label="Weekly todos">
            <div className="wk-head">
                <div>
                    <h2>{title}</h2>
                    <p className="muted small">{fmtShort(ws)} to {fmtShort(addDays(ws, 6))}</p>
                </div>
                <div className="wk-prog">
                    <div className="bar"><i style={{ width: (all.length ? (100 * done) / all.length : 0) + '%' }} className={all.length && done === all.length ? 'full' : ''} /></div>
                    <span className="small muted">{done} of {all.length} done</span>
                </div>
                <div className="row">
                    <button className="btn sm" onClick={() => setOffset(offset - 1)} aria-label="Previous week">‹</button>
                    <button className="btn sm" onClick={() => setOffset(0)} disabled={offset === 0}>This week</button>
                    <button className="btn sm" onClick={() => setOffset(offset + 1)} aria-label="Next week">›</button>
                    <button className="btn sm" onClick={carryOver} title="Copy unfinished todos from the previous week">Carry over unfinished</button>
                    <button className="btn sm" onClick={moveYesterday} title="Move yesterday's unfinished todos to today">Yesterday → today</button>
                    <button className="btn sm" onClick={() => setShift({ from: today, ids: [] })} title="Pick todos from one day and move them to another day">Shift todos…</button>
                </div>
            </div>
            <div className="seg" role="group" aria-label="Filter by type">
                <button className={'btn sm' + (filter === 'all' ? ' on' : '')} onClick={() => setFilter('all')}>All</button>
                {TYPE_KEYS.map(k => (
                    <button key={k} className={'btn sm' + (filter === k ? ' on' : '')} onClick={() => setFilter(filter === k ? 'all' : k)}>{TYPES[k].icon} {TYPES[k].label}</button>
                ))}
                <input id="wk-search" className="wk-search" type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search todos ( / )" aria-label="Search todos"
                    onKeyDown={e => { if (e.key === 'Escape') { setQuery(''); e.currentTarget.blur() } }} />
            </div>
            <p className="muted small wk-keys">Shortcuts: <kbd>n</kbd> new todo today · <kbd>/</kbd> search · <kbd>Space</kbd> start or pause the focus timer</p>
            <div className="wk-grid">
                {DAYS.map((_, i) => {
                    const date = addDays(ws, i)
                    return (
                        <DayColumn key={i} day={i} date={date} list={week[i]} filter={filter} query={query}
                            isToday={iso(date) === today} isPast={iso(date) < today}
                            onAdd={add} onToggle={(day, id, el) => toggleTodo(key, day, id, el)} onEdit={edit} onDelete={remove} onMove={move} onShift={(from, id) => setShift({ from, ids: [id] })} />
                    )
                })}
            </div>
            {shift && <ShiftModal from={shift.from} ids={shift.ids} onClose={() => setShift(null)} />}
        </section>
    )
}

/* ============================================================
   Calendar + events
   ============================================================ */
const REMIND = [[0, 'At the time'], [5, '5 minutes before'], [10, '10 minutes before'], [15, '15 minutes before'], [30, '30 minutes before'], [60, '1 hour before'], [120, '2 hours before'], [1440, '1 day before']]

function EventModal({ initial, onClose }) {
    const [ev, setEv] = useState(initial)
    const set = (k, v) => setEv(cur => ({ ...cur, [k]: v }))
    const valid = ev.title.trim() && ev.date

    const save = e => {
        e.preventDefault()
        if (!valid) return
        const clean = { ...ev, title: ev.title.trim(), remind: Number(ev.remind) }
        setStore('events', cur => (clean.id ? cur.map(x => (x.id === clean.id ? clean : x)) : [...cur, { ...clean, id: uid() }]), [])
        play('save')
        onClose()
    }
    const remove = () => {
        removeEvent(initial)
        onClose()
    }

    return (
        <div className="modal-back" onMouseDown={e => e.target === e.currentTarget && onClose()}>
            <form className="modal" onSubmit={save} role="dialog" aria-label={ev.id ? 'Edit event' : 'New event'}>
                <h2>{ev.id ? 'Edit event' : 'New event'}</h2>
                <label className="field"><span>Title</span><input autoFocus value={ev.title} onChange={e => set('title', e.target.value)} placeholder="Mock interview, exam, study group…" /></label>
                <div className="row">
                    <label className="field grow"><span>Date</span><input type="date" value={ev.date} onChange={e => set('date', e.target.value)} /></label>
                    <label className="field grow"><span>Time (empty for all day)</span><input type="time" value={ev.time} onChange={e => set('time', e.target.value)} /></label>
                </div>
                <label className="field"><span>Remind me</span>
                    <select value={ev.remind} disabled={!ev.time} onChange={e => set('remind', e.target.value)}>
                        {REMIND.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                </label>
                <div className="field"><span>Colour</span>
                    <div className="row">
                        {EVENT_COLORS.map(c => (
                            <button key={c} type="button" className={'ev-swatch' + (ev.color === c ? ' on' : '')} style={{ background: c }} onClick={() => set('color', c)} aria-label={`Colour ${c}`} />
                        ))}
                    </div>
                </div>
                <label className="field"><span>Notes</span><textarea rows={3} value={ev.notes} onChange={e => set('notes', e.target.value)} /></label>
                <div className="row">
                    {ev.id && <button type="button" className="btn danger" onClick={remove}>Delete</button>}
                    <span className="grow" />
                    <button type="button" className="btn" onClick={onClose}>Cancel</button>
                    <button type="submit" className="btn primary" disabled={!valid}>Save event</button>
                </div>
            </form>
        </div>
    )
}

function CalendarCard() {
    const now = useNow(30000)
    const stats = useStats()
    const [events] = useStore('events', [])
    const [todos] = useStore('todos', {})
    const [cursor, setCursor] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1))
    const [selected, setSelected] = useState(todayISO())
    const [modal, setModal] = useState(null)
    const todayKey = iso(startOfDay(now))

    const byDate = useMemo(() => {
        const map = {}
        const sorted = [...events].sort((a, b) => (a.time || '').localeCompare(b.time || ''))
        sorted.forEach(e => {
            if (!map[e.date]) map[e.date] = []
            map[e.date].push(e)
        })
        return map
    }, [events])

    const gridStart = weekStart(cursor)
    const rows = addDays(gridStart, 35).getMonth() === cursor.getMonth() ? 6 : 5
    const cells = Array.from({ length: rows * 7 }, (_, i) => addDays(gridStart, i))
    const shift = n => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + n, 1))

    const selDate = parseISO(selected)
    const selWeek = todos[iso(weekStart(selDate))]
    const selTodos = (selWeek ? selWeek[dayIndex(selDate)] : null) || []
    const selEvents = byDate[selected] || []
    const newEvent = date => ({ title: '', date, time: '09:00', remind: 10, color: EVENT_COLORS[0], notes: '' })

    return (
        <section className="card cal" id="section-calendar" aria-label="Calendar">
            <div className="cal-head">
                <h2>{cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h2>
                <div className="row">
                    <button className="btn sm" onClick={() => shift(-1)} aria-label="Previous month">‹</button>
                    <button className="btn sm" onClick={() => { setCursor(new Date(now.getFullYear(), now.getMonth(), 1)); setSelected(todayKey) }}>Today</button>
                    <button className="btn sm" onClick={() => shift(1)} aria-label="Next month">›</button>
                    <button className="btn sm primary" onClick={() => setModal(newEvent(selected))}>+ Event</button>
                </div>
            </div>
            <div className="cal-grid" role="grid">
                {DAYS.map(n => <div key={n} className="cal-dow" role="columnheader">{n.slice(0, 3)}</div>)}
                {cells.map(d => {
                    const key = iso(d)
                    const evs = byDate[key] || []
                    const past = key < todayKey
                    const active = stats.active.has(key)
                    return (
                        <button key={key} role="gridcell" onClick={() => setSelected(key)} onDoubleClick={() => setModal(newEvent(key))}
                            className={'cal-cell' + (d.getMonth() !== cursor.getMonth() ? ' out' : '') + (key === todayKey ? ' today' : '') + (key === selected ? ' sel' : '') + (past ? ' past' : '')}
                            aria-label={d.toLocaleDateString(undefined, { dateStyle: 'full' }) + (evs.length ? `, ${evs.length} events` : '')}>
                            <span className="cal-n">{d.getDate()}</span>
                            {(() => { const n = (((todos[iso(weekStart(d))] || [])[dayIndex(d)]) || []).length; return n > 0 ? <span className="cal-todo-n" title={`${n} todo${n > 1 ? 's' : ''}`}>☑ {n}</span> : null })()}
                            {past && <span className={'cal-check' + (active ? ' hot' : '')} title={active ? 'Day passed, you were active' : 'Day passed'}>✓</span>}
                            <span className="cal-evs">
                                {evs.slice(0, 2).map(e => <i key={e.id} style={{ '--c': e.color }}>{e.time ? e.time + ' ' : ''}{e.title}</i>)}
                                {evs.length > 2 && <em>+{evs.length - 2} more</em>}
                            </span>
                        </button>
                    )
                })}
            </div>
            <div className="cal-legend small muted">
                <span><span className="cal-check hot">✓</span> passed and active</span>
                <span><span className="cal-check">✓</span> passed</span>
                <span>Double-click a day to add an event</span>
            </div>

            <div className="cal-day">
                <div className="row">
                    <h3 className="grow">{selDate.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</h3>
                    <span className="small muted">{selTodos.length ? `${selTodos.filter(t => t.done).length}/${selTodos.length} todos done` : 'No todos planned'}</span>
                    <button className="btn sm" onClick={() => setModal(newEvent(selected))}>+ Event</button>
                </div>
                {selEvents.length === 0 && <p className="muted small">No events on this day.</p>}
                <ul className="cal-evlist">
                    {selEvents.map(e => (
                        <li key={e.id} style={{ '--c': e.color }}>
                            <span className="cal-dot" />
                            <span className="cal-time">{e.time || 'All day'}</span>
                            <div className="grow"><b>{e.title}</b>{e.gid && <span className="cal-g" title="Synced with Google Calendar">G</span>}{e.notes && <p className="muted small">{e.notes}</p>}</div>
                            {e.time && Number(e.remind) > 0 && <span className="small muted" title="Reminder">⏳ {e.remind >= 60 ? e.remind / 60 + 'h' : e.remind + 'm'}</span>}
                            <button className="btn sm ghost" onClick={() => setModal(e)}>Edit</button>
                            <button className="btn sm ghost danger" onClick={() => removeEvent(e)} aria-label={`Delete ${e.title}`}>Delete</button>
                        </li>
                    ))}
                </ul>
                {selTodos.length > 0 && (
                    <>
                        <h4 className="cal-sub">Todos</h4>
                        <ul className="cal-todos">
                            {selTodos.map(t => (
                                <li key={t.id} className={t.done ? 'done' : ''}>
                                    <input type="checkbox" checked={t.done} onChange={e => toggleTodo(iso(weekStart(selDate)), dayIndex(selDate), t.id, e.currentTarget)} aria-label={`Mark "${t.text}" as done`} />
                                    <span className="grow">{(TYPES[t.type] || TYPES.task).icon} {t.text}</span>
                                    <button className="btn sm ghost" onClick={() => openTodoDetails(t.id)}>Open</button>
                                </li>
                            ))}
                        </ul>
                    </>
                )}
            </div>
            {modal && <EventModal initial={modal} onClose={() => setModal(null)} />}
        </section>
    )
}

function Upcoming() {
    const now = useNow(15000)
    const [events] = useStore('events', [])
    const list = events
        .map(e => ({ ...e, at: new Date(`${e.date}T${e.time || '23:59'}`).getTime() }))
        .filter(e => e.at >= now.getTime())
        .sort((a, b) => a.at - b.at)
        .slice(0, 5)

    return (
        <section className="card side-card" aria-label="Upcoming events">
            <h3>Upcoming</h3>
            {list.length === 0 && <p className="muted small">No upcoming events. Add one from the calendar and it will remind you.</p>}
            <ul className="up-list">
                {list.map(e => (
                    <li key={e.id} style={{ '--c': e.color }}>
                        <span className="cal-dot" />
                        <div className="grow">
                            <b>{e.title}</b>
                            <p className="muted small">{parseISO(e.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}{e.time ? ' · ' + e.time : ' · all day'}</p>
                        </div>
                        <span className="small up-in">{e.time ? until(e.at - now.getTime()) : e.date === iso(now) ? 'today' : ''}</span>
                        <button className="icon-btn" onClick={() => removeEvent(e)} title="Delete event" aria-label={`Delete ${e.title}`}>×</button>
                    </li>
                ))}
            </ul>
        </section>
    )
}

/* ============================================================
   Focus timer
   ============================================================ */
function Pomodoro() {
    const [mins, setMins] = useState(25)
    const [mode, setMode] = useState('focus')
    const [left, setLeft] = useState(25 * 60)
    const [running, setRunning] = useState(false)
    const [focus, , updateFocus] = useStore('focus', {})
    const [todos, , updateTodos] = useStore('todos', {})
    const [taskId, setTaskId] = useState('')
    const endRef = useRef(0)
    const tickRef = useRef(0) // last moment the page was alive while the timer ran
    const total = (mode === 'focus' ? mins : 5) * 60

    useEffect(() => {
        if (!running) return
        const finish = () => {
            setRunning(false)
            if (mode === 'focus') {
                updateFocus(d => { d[todayISO()] = (d[todayISO()] || 0) + 1 })
                if (taskId) {
                    const nowD = new Date()
                    updateTodos(d => {
                        const t = (((d[iso(weekStart(nowD))] || [])[dayIndex(nowD)]) || []).find(x => x.id === taskId)
                        if (t) t.pomos = (t.pomos || 0) + 1
                    })
                }
                notify({ title: 'Focus session complete', body: `${mins} minutes done. Take a 5 minute break.`, icon: '🍅' })
                systemNotify('Focus session complete', 'Take a 5 minute break.')
                play('focus')
                setMode('break')
                setLeft(5 * 60)
            } else {
                notify({ title: 'Break is over', body: 'Ready for another session?', icon: '⏰' })
                systemNotify('Break is over', 'Ready for another session?')
                play('breakover')
                setMode('focus')
                setLeft(mins * 60)
            }
        }
        const id = setInterval(() => {
            const t = Date.now()
            if (t - tickRef.current > 90000) {
                // The device slept (a normal tab ticks at least every minute): freeze at the last moment we were alive
                setLeft(Math.max(0, Math.round((endRef.current - tickRef.current) / 1000)))
                setRunning(false)
                notify({ title: 'Focus timer paused', body: 'The device was asleep, so that time was not counted.', icon: '⏸' })
                return
            }
            tickRef.current = t
            const remain = Math.max(0, Math.round((endRef.current - t) / 1000))
            setLeft(remain)
            if (remain === 0) finish()
        }, 250)
        return () => clearInterval(id)
    }, [running, mode, mins, taskId]) // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        const base = document.title
        if (running) document.title = `${pad(Math.floor(left / 60))}:${pad(left % 60)} · ${mode === 'focus' ? 'Focus' : 'Break'}`
        return () => { document.title = base }
    }, [running, left, mode])

    const toggle = () => {
        if (!running) {
            endRef.current = Date.now() + left * 1000
            tickRef.current = Date.now()
        }
        setRunning(!running)
    }
    const reset = () => {
        setRunning(false)
        setLeft((mode === 'focus' ? mins : 5) * 60)
    }
    const pickMins = m => {
        setMins(m)
        setMode('focus')
        setRunning(false)
        setLeft(m * 60)
    }
    const sessions = focus[todayISO()] || 0
    const nowD = new Date()
    const openToday = ((todos[iso(weekStart(nowD))] || [])[dayIndex(nowD)] || []).filter(t => !t.done)
    const toggleRef = useRef(toggle)
    toggleRef.current = toggle
    useEffect(() => {
        const onKey = e => {
            if (e.code !== 'Space' || e.ctrlKey || e.metaKey || e.altKey) return
            const el = e.target
            if (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(el.tagName))) return
            e.preventDefault()
            toggleRef.current()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [])

    return (
        <section className="card side-card" aria-label="Focus timer">
            <div className="row"><h3 className="grow">Focus timer</h3><span className="small muted">🍅 {sessions} today</span></div>
            <div className="seg" role="group" aria-label="Session length">
                {[15, 25, 50].map(m => <button key={m} className={'btn sm' + (mins === m && mode === 'focus' ? ' on' : '')} onClick={() => pickMins(m)}>{m} min</button>)}
            </div>
            <select className="pomo-task" value={taskId} onChange={e => setTaskId(e.target.value)} aria-label="Todo to focus on">
                <option value="">Focus on: no todo</option>
                {openToday.map(t => <option key={t.id} value={t.id}>{t.text.slice(0, 40)}{t.pomos ? ` · 🍅${t.pomos}` : ''}</option>)}
            </select>
            <div className={'pomo-time' + (mode === 'break' ? ' brk' : '')} aria-live="off">{pad(Math.floor(left / 60))}:{pad(left % 60)}</div>
            <p className="muted small" style={{ textAlign: 'center' }}>{mode === 'focus' ? 'Focus' : 'Break'}</p>
            <div className="bar"><i style={{ width: (100 * (total - left)) / total + '%' }} /></div>
            <div className="row" style={{ justifyContent: 'center' }}>
                <button className="btn primary" onClick={toggle}>{running ? 'Pause' : left < total ? 'Resume' : 'Start'}</button>
                <button className="btn" onClick={reset}>Reset</button>
            </div>
        </section>
    )
}

/* ============================================================
   Page
   ============================================================ */
export default function Dashboard() {
    const jump = id => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    return (
        <div className="dash">
            <style>{CSS}</style>
            <div className="dash-hero">
                <DayCard />
                <StreakCard />
            </div>
            <TitleCard />
            <div id="section-activity"><Contributions /></div>
            <nav className="dash-jump" aria-label="Jump to section">
                <button className="btn sm ghost" onClick={() => jump('section-activity')}>Activity</button>
                <button className="btn sm ghost" onClick={() => jump('section-week')}>Week</button>
                <button className="btn sm ghost" onClick={() => jump('section-calendar')}>Calendar</button>
                <button className="btn sm ghost" onClick={() => jump('section-database')}>Courses database</button>
            </nav>
            <WeekBoard />
            <div className="dash-grid">
                <CalendarCard />
                <aside className="dash-side">
                    <Upcoming />
                    <Pomodoro />
                    <WeeklyReview />
                    <RecurringCard />
                </aside>
            </div>
            <section id="section-database"><Database /></section>
        </div>
    )
}

const CSS = `
.ttl{display:grid;gap:12px;border-color:color-mix(in srgb,var(--tc,var(--ln)) 55%,var(--ln))}
.ttl-head{display:flex;gap:16px;align-items:center}.ttl-head h2{margin:0}.ttl-head p{margin:2px 0 0}
.ttl-badge{font-size:46px;line-height:1;filter:drop-shadow(0 0 10px color-mix(in srgb,var(--tc,transparent) 60%,transparent))}
.ttl-tiers{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px}
.ttl-tier{display:grid;justify-items:center;gap:1px;padding:8px 4px;border-radius:10px;border:1px solid var(--ln);background:var(--sf2);opacity:.55;text-align:center}
.ttl-tier span{font-size:22px}.ttl-tier small{color:var(--mu);font-size:11px}
.ttl-tier.got{opacity:1;border-color:var(--tc);background:color-mix(in srgb,var(--tc) 14%,var(--sf2))}
.ttl-days{display:flex;gap:3px;flex-wrap:wrap}.ttl-days i{width:14px;height:14px;border-radius:4px;background:var(--ln)}
.ttl-days i.on{background:var(--ok)}.ttl-days i.today{outline:2px solid var(--ac);outline-offset:1px}
.ttl-shelf{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.ttl-trophy{font-size:12px;padding:3px 10px;border-radius:999px;border:1px solid var(--tc);background:color-mix(in srgb,var(--tc) 12%,var(--sf2))}
@media(max-width:640px){.ttl-tiers{grid-template-columns:repeat(3,minmax(0,1fr))}}
.wr-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.wr-grid div{display:grid;padding:8px;border-radius:8px;background:var(--sf2)}
.wr-grid b{font:700 18px var(--head)}.wr-grid span{font-size:12px;color:var(--mu)}
.wr-bars{display:flex;gap:6px;align-items:flex-end;height:54px}.wr-bars div{flex:1;height:100%;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:2px}
.wr-bars i{display:block;width:100%;border-radius:4px 4px 0 0;background:linear-gradient(var(--ac),var(--ok))}.wr-bars small{font-size:10px;color:var(--mu)}
.rc-list{list-style:none;margin:0;padding:0;display:grid;gap:6px}.rc-list li{display:flex;gap:6px;align-items:center;padding:6px 8px;border-radius:8px;background:var(--sf2)}
.rc-list li span{display:grid;min-width:0}.rc-list small{font-size:11px}
.td-pomo{font-size:11px;color:var(--mu);white-space:nowrap}
.pomo-task{width:100%}
.wk-search{margin-left:auto;width:170px}.wk-keys{margin:2px 0 6px}.wk-keys kbd{font:600 11px var(--head);padding:1px 6px;border:1px solid var(--ln);border-radius:5px;background:var(--sf2)}
.dash{max-width:1600px;margin:auto;padding:24px 20px 90px;display:grid;grid-template-columns:minmax(0,1fr);gap:20px}
.dash-hero{display:grid;grid-template-columns:minmax(0,1.45fr) minmax(0,1fr);gap:20px}
.dash-jump{display:flex;flex-wrap:wrap;gap:6px;margin:-8px 0 -4px}
.dash-grid{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:20px;align-items:start}
.dash-side{display:grid;gap:20px}
.side-card{padding:18px;display:grid;gap:10px}
.dash>.card,.dash-hero>.card,.dash-grid>.card,.side-card{animation:rise .4s both}
.dash-hero>.card:nth-child(2),.dash-side>.card:nth-child(2){animation-delay:.08s}
.side-card h3{font-size:17px}
.dc{display:grid;grid-template-columns:1fr auto;gap:8px 28px;padding:26px 28px;position:relative;overflow:hidden;background:radial-gradient(circle at 100% 0,color-mix(in srgb,var(--ac) 14%,transparent),transparent 55%),var(--sf)}
.dc h1{font-size:46px;line-height:1.05;margin-top:2px}
.dc-date{font-size:17px;color:var(--mu);margin:2px 0 14px}
.dc-clock{font:700 38px var(--head);font-variant-numeric:tabular-nums;letter-spacing:.01em;margin:0}
.dc-meta{display:flex;gap:18px;flex-wrap:wrap;margin-top:8px;color:var(--mu);font-size:14px}
.dc-meta b{color:var(--tx);font-variant-numeric:tabular-nums}
.dc-ring{position:relative;width:190px;height:190px;align-self:center}
.dc-ring svg{width:100%;height:100%}
.dc-arc{fill:none;stroke:url(#dcg);stroke-width:9;stroke-linecap:round;transform:rotate(-90deg);transform-origin:70px 70px;transition:stroke-dashoffset 1s linear}
.tick{stroke:var(--ln);stroke-width:2.4;stroke-linecap:round}.tick.on{stroke:var(--ok)}.tick.now{stroke:var(--ac);animation:glow 1.4s ease-in-out infinite}
.dc-pct{position:absolute;inset:0;display:grid;place-content:center;text-align:center}
.dc-pct b{font:700 26px var(--head);font-variant-numeric:tabular-nums}.dc-pct span{font-size:12px;color:var(--mu)}
.dc-quote{grid-column:1/-1;margin:10px 0 0;padding-top:14px;border-top:1px solid var(--ln);display:flex;gap:10px;align-items:flex-start}
.dc-quote blockquote{margin:0;flex:1;font:italic 500 17px/1.45 var(--head);color:var(--tx)}
.st{padding:20px 22px;display:grid;gap:16px;align-content:start}
.st-top{display:flex;gap:16px;align-items:center}
.flame{width:56px;height:70px;filter:grayscale(1) opacity(.45);flex:none}
.flame.lit{filter:drop-shadow(0 0 10px rgba(255,140,40,.55));animation:flicker 1.1s ease-in-out infinite;transform-origin:50% 100%}
.st-num{font:600 18px var(--head)}.st-num b{font-size:44px;line-height:1;margin-right:4px}
.st-week{display:grid;grid-template-columns:repeat(7,1fr);gap:6px}
.st-day{display:grid;justify-items:center;gap:3px}
.st-day span{width:30px;height:30px;border-radius:50%;border:2px solid var(--ln);display:grid;place-items:center;font-weight:700;font-size:14px;color:#fff}
.st-day.on span{background:linear-gradient(135deg,var(--ok),color-mix(in srgb,var(--ok) 60%,#fff));border-color:var(--ok);animation:pop .35s both}
.st-day.today span{border-color:var(--ac);box-shadow:0 0 0 3px color-mix(in srgb,var(--ac) 25%,transparent)}
.st-day.on.today span{border-color:var(--ok)}
.st-day.future{opacity:.5}.st-day small{font-size:11px;color:var(--mu)}
.st-badges{display:flex;gap:6px;flex-wrap:wrap}
.st-badge{width:34px;height:34px;display:grid;place-items:center;border-radius:10px;border:1px solid var(--ln);font-size:18px;filter:grayscale(1);opacity:.35;transition:.2s}
.st-badge.got{filter:none;opacity:1;background:var(--sf2);border-color:var(--ac)}
.wk{padding:20px;display:grid;gap:14px}
.wk-head{display:flex;gap:16px 28px;align-items:center;flex-wrap:wrap}
.wk-head h2{font-size:24px}
.wk-prog{flex:1;min-width:160px;max-width:340px}
.wk-grid{display:grid;grid-template-columns:repeat(7,minmax(168px,1fr));gap:10px;overflow-x:auto;padding-bottom:8px}
.wk-col{background:var(--sf2);border:1px solid var(--ln);border-radius:12px;padding:10px;display:flex;flex-direction:column;gap:8px;min-height:240px;transition:border-color .15s,background .15s}
.wk-col.today{border-color:var(--ac);box-shadow:0 0 0 1px var(--ac)}
.wk-col.past h3{color:var(--mu)}
.wk-col.over{border-style:dashed;border-color:var(--ac);background:color-mix(in srgb,var(--ac) 8%,var(--sf2))}
.wk-col-head{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.wk-col-head h3{font-size:16px}
.wk-count{margin-left:auto;font-size:12px;font-weight:600;color:var(--mu);background:var(--sf);border:1px solid var(--ln);border-radius:999px;padding:0 8px}
.wk-count.all{color:var(--ok);border-color:var(--ok)}
.wk-list{list-style:none;margin:0;padding:0;display:grid;gap:6px}
.wk-empty{margin:4px 0;text-align:center}
.wk-new{margin-top:auto;justify-content:flex-start;color:var(--mu)}
.wk-add{display:grid;gap:6px;margin-top:auto}
.td{display:flex;gap:8px;align-items:flex-start;background:var(--sf);border:1px solid var(--ln);border-radius:8px;padding:7px 8px;cursor:grab}
.td:hover{border-color:var(--ac)}.td.drop-top{box-shadow:0 -3px 0 0 var(--ac)}.td.drop-bottom{box-shadow:0 3px 0 0 var(--ac)}.td input[type=checkbox]{margin-top:3px;flex:none}
.td-main{flex:1;min-width:0;display:grid;gap:5px;justify-items:start}
.td-text{all:unset;cursor:text;line-height:1.35;word-break:break-word}.td-text:focus-visible{outline:2px solid var(--ac);border-radius:4px}
.td.done .td-text{text-decoration:line-through;color:var(--mu)}
.td-title{display:flex;gap:6px;align-items:baseline;max-width:100%}
.td-link{cursor:pointer;color:var(--ac);text-decoration:underline;text-underline-offset:2px}.td-link:hover{filter:brightness(1.15)}
.td-pen{opacity:.45;padding:0 4px;font-size:13px}.td:hover .td-pen,.td-pen:focus-visible{opacity:1}
.td-open{opacity:.45;padding:0 6px;font-size:12px;font-weight:600;border:1px solid var(--ln);border-radius:6px;line-height:1.5;align-self:center}.td:hover .td-open,.td-open:focus-visible{opacity:1}
.td-title{flex-wrap:wrap}
.cal-g{display:inline-grid;place-items:center;width:16px;height:16px;border-radius:50%;margin-left:6px;font-size:10px;font-weight:700;background:#4285f4;color:#fff;vertical-align:middle}
.cal-sub{margin:10px 0 4px;font-size:14px;color:var(--mu)}
.cal-todos{list-style:none;margin:0;padding:0;display:grid;gap:4px}.cal-todos li{display:flex;gap:8px;align-items:center;padding:4px 8px;border-radius:8px;background:var(--sf2)}.cal-todos li.done .grow{text-decoration:line-through;color:var(--mu)}
.cal-todo-n{position:absolute;right:6px;bottom:4px;font-size:10px;font-weight:600;color:var(--mu)}
.td-edit{display:grid;gap:5px;width:100%}
.td-type{appearance:none;border:0;background:color-mix(in srgb,var(--c) 18%,transparent);color:color-mix(in srgb,var(--c) 65%,var(--tx));border-radius:999px;padding:1px 9px;font-size:12px;font-weight:600;cursor:pointer;width:auto}
.td-x{opacity:0;padding:0 6px}.td:hover .td-x,.td-x:focus-visible{opacity:1}
.cal{padding:20px;display:grid;gap:12px}
.cal-head{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}.cal-head h2{font-size:24px}
.cal-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px}
.cal-dow{text-align:center;font-size:12px;font-weight:600;color:var(--mu);padding:4px 0}
.cal-cell{position:relative;min-height:88px;text-align:left;border:1px solid var(--ln);background:var(--sf2);border-radius:10px;padding:6px;cursor:pointer;display:flex;flex-direction:column;gap:3px;overflow:hidden;transition:border-color .15s}
.cal-cell:hover{border-color:var(--ac)}
.cal-cell.out{opacity:.4}
.cal-cell.past .cal-n{color:var(--mu)}
.cal-cell.today{border-color:var(--ac);background:color-mix(in srgb,var(--ac) 10%,var(--sf2))}
.cal-cell.sel{box-shadow:0 0 0 2px var(--ac)}
.cal-n{font-weight:600;font-size:14px}
.cal-check{position:absolute;top:5px;right:6px;width:18px;height:18px;border-radius:50%;display:inline-grid;place-items:center;font-size:11px;font-weight:700;background:var(--ln);color:var(--sf)}
.cal-check.hot{background:var(--ok);color:#fff;animation:fade .4s}
.cal-evs{display:grid;gap:2px;min-width:0}
.cal-evs i{font-style:normal;font-size:11px;line-height:1.3;padding:1px 5px;border-radius:4px;background:color-mix(in srgb,var(--c) 22%,transparent);border-left:3px solid var(--c);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cal-evs em{font-style:normal;font-size:11px;color:var(--mu)}
.cal-legend{display:flex;gap:16px;flex-wrap:wrap;align-items:center}
.cal-legend .cal-check{position:static;width:16px;height:16px;font-size:10px;vertical-align:middle}
.cal-day{border-top:1px solid var(--ln);padding-top:14px;display:grid;gap:8px}
.cal-day h3{font-size:18px}
.cal-evlist,.up-list{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.cal-evlist li,.up-list li{display:flex;gap:10px;align-items:center;background:var(--sf2);border:1px solid var(--ln);border-left:4px solid var(--c);border-radius:8px;padding:8px 10px}
.cal-dot{width:9px;height:9px;border-radius:50%;background:var(--c);flex:none}
.cal-time{font-variant-numeric:tabular-nums;font-weight:600;font-size:13px;min-width:54px}
.cal-evlist p,.up-list p{margin:0}
.up-in{color:var(--ac);font-weight:600;white-space:nowrap}
.ev-swatch{width:26px;height:26px;border-radius:50%;border:2px solid transparent;cursor:pointer}.ev-swatch.on{border-color:var(--tx);box-shadow:0 0 0 2px var(--sf) inset}
.pomo-time{font:700 52px var(--head);font-variant-numeric:tabular-nums;text-align:center;line-height:1.1}
.pomo-time.brk{color:var(--ok)}
@media(max-width:1100px){.dash-hero,.dash-grid{grid-template-columns:minmax(0,1fr)}}
@media(max-width:640px){.dc{grid-template-columns:1fr}.dc-ring{justify-self:center}.dc h1{font-size:36px}.cal-cell{min-height:64px}.cal-evs i{display:none}}
`
