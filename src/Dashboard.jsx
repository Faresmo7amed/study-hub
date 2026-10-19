import { useEffect, useMemo, useRef, useState } from 'react'
import Database from './Database'
import { play } from './sound'
import {
    BADGES, DAYS, TYPES, TYPE_KEYS, addDays, clamp, dayIndex, emptyWeek, hms, iso,
    notify, pad, parseISO, quoteOfDay, QUOTES, setStore, startOfDay, systemNotify, todayISO, uid, until,
    useNow, useStats, useStore, weekStart,
} from './shared'
import { EVENT_COLORS, removeEvent, toggleTodo } from './todoActions'
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
   Weekly board (Saturday to Friday)
   ============================================================ */

function TodoItem({ todo, day, onToggle, onEdit, onDelete }) {
    const [editing, setEditing] = useState(false)
    const [draft, setDraft] = useState(todo.text)
    const meta = TYPES[todo.type] || TYPES.task

    const save = () => {
        const v = draft.trim()
        if (v && v !== todo.text) onEdit(todo.id, { text: v })
        if (!v) setDraft(todo.text)
        setEditing(false)
    }

    return (
        <li className={'td' + (todo.done ? ' done' : '')} draggable={!editing}
            onDragStart={e => e.dataTransfer.setData('text/plain', JSON.stringify({ day, id: todo.id }))}>
            <input type="checkbox" checked={todo.done} onChange={e => onToggle(todo.id, e.currentTarget)} aria-label={`Mark "${todo.text}" as done`} />
            <div className="td-main">
                {editing ? (
                    <input autoFocus value={draft} onChange={e => setDraft(e.target.value)} onBlur={save} aria-label="Edit todo"
                        onKeyDown={e => {
                            if (e.key === 'Enter') save()
                            if (e.key === 'Escape') { setDraft(todo.text); setEditing(false) }
                        }} />
                ) : (
                    <button className="td-text" onClick={() => { setDraft(todo.text); setEditing(true) }} title="Click to edit">{todo.text}</button>
                )}
                <select className="td-type" value={todo.type} onChange={e => onEdit(todo.id, { type: e.target.value })} style={{ '--c': meta.color }} aria-label="Type">
                    {TYPE_KEYS.map(k => <option key={k} value={k}>{TYPES[k].icon} {TYPES[k].label}</option>)}
                </select>
            </div>
            <button className="icon-btn td-x" onClick={() => onDelete(todo.id)} aria-label="Delete todo">×</button>
        </li>
    )
}

function DayColumn({ day, date, list, isToday, isPast, filter, onAdd, onToggle, onEdit, onDelete, onMove }) {
    const [adding, setAdding] = useState(false)
    const [text, setText] = useState('')
    const [type, setType] = useState('task')
    const [over, setOver] = useState(false)
    const shown = filter === 'all' ? list : list.filter(t => t.type === filter)
    const done = list.filter(t => t.done).length

    const submit = e => {
        e.preventDefault()
        const v = text.trim()
        if (!v) return
        onAdd(day, { text: v, type })
        setText('')
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
                        onEdit={(id, patch) => onEdit(day, id, patch)} onDelete={id => onDelete(day, id)} />
                ))}
            </ul>
            {shown.length === 0 && !adding && <p className="muted small wk-empty">{list.length ? 'Nothing of this type.' : isPast ? 'Nothing planned.' : 'Plan something for this day.'}</p>}
            {adding ? (
                <form className="wk-add" onSubmit={submit}>
                    <input autoFocus value={text} onChange={e => setText(e.target.value)} placeholder="What will you do?" aria-label="New todo"
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
    const add = (day, { text, type }) => {
        update(d => { ensure(d)[day].push({ id: uid(), text, type, done: false, doneOn: null }) })
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
    const move = (from, id, to) => {
        if (from === to) return
        update(d => {
            const w = ensure(d)
            const i = w[from].findIndex(t => t.id === id)
            if (i >= 0) w[to].push(w[from].splice(i, 1)[0])
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
                    cur[i].push({ id: uid(), text: t.text, type: t.type, done: false, doneOn: null })
                    count += 1
                }))
            })
        }
        if (count) play('save')
        notify({ title: count ? `Carried over ${count} unfinished todo${count > 1 ? 's' : ''}` : 'Nothing to carry over', body: count ? 'They were copied to the same weekday this week.' : 'Last week has no unfinished todos.', icon: '↪️' })
    }

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
                </div>
            </div>
            <div className="seg" role="group" aria-label="Filter by type">
                <button className={'btn sm' + (filter === 'all' ? ' on' : '')} onClick={() => setFilter('all')}>All</button>
                {TYPE_KEYS.map(k => (
                    <button key={k} className={'btn sm' + (filter === k ? ' on' : '')} onClick={() => setFilter(filter === k ? 'all' : k)}>{TYPES[k].icon} {TYPES[k].label}</button>
                ))}
            </div>
            <div className="wk-grid">
                {DAYS.map((_, i) => {
                    const date = addDays(ws, i)
                    return (
                        <DayColumn key={i} day={i} date={date} list={week[i]} filter={filter}
                            isToday={iso(date) === today} isPast={iso(date) < today}
                            onAdd={add} onToggle={(day, id, el) => toggleTodo(key, day, id, el)} onEdit={edit} onDelete={remove} onMove={move} />
                    )
                })}
            </div>
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
    const selTodos = selWeek ? selWeek[dayIndex(selDate)] : []
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
                            <div className="grow"><b>{e.title}</b>{e.notes && <p className="muted small">{e.notes}</p>}</div>
                            {e.time && Number(e.remind) > 0 && <span className="small muted" title="Reminder">⏳ {e.remind >= 60 ? e.remind / 60 + 'h' : e.remind + 'm'}</span>}
                            <button className="btn sm ghost" onClick={() => setModal(e)}>Edit</button>
                            <button className="btn sm ghost danger" onClick={() => removeEvent(e)} aria-label={`Delete ${e.title}`}>Delete</button>
                        </li>
                    ))}
                </ul>
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
    const endRef = useRef(0)
    const total = (mode === 'focus' ? mins : 5) * 60

    useEffect(() => {
        if (!running) return
        const finish = () => {
            setRunning(false)
            if (mode === 'focus') {
                updateFocus(d => { d[todayISO()] = (d[todayISO()] || 0) + 1 })
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
            const remain = Math.max(0, Math.round((endRef.current - Date.now()) / 1000))
            setLeft(remain)
            if (remain === 0) finish()
        }, 250)
        return () => clearInterval(id)
    }, [running, mode, mins]) // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        const base = document.title
        if (running) document.title = `${pad(Math.floor(left / 60))}:${pad(left % 60)} · ${mode === 'focus' ? 'Focus' : 'Break'}`
        return () => { document.title = base }
    }, [running, left, mode])

    const toggle = () => {
        if (!running) endRef.current = Date.now() + left * 1000
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

    return (
        <section className="card side-card" aria-label="Focus timer">
            <div className="row"><h3 className="grow">Focus timer</h3><span className="small muted">🍅 {sessions} today</span></div>
            <div className="seg" role="group" aria-label="Session length">
                {[15, 25, 50].map(m => <button key={m} className={'btn sm' + (mins === m && mode === 'focus' ? ' on' : '')} onClick={() => pickMins(m)}>{m} min</button>)}
            </div>
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
                </aside>
            </div>
            <section id="section-database"><Database /></section>
        </div>
    )
}

const CSS = `
.dash{max-width:1400px;margin:auto;padding:24px 20px 90px;display:grid;gap:20px}
.dash-hero{display:grid;grid-template-columns:minmax(0,1.45fr) minmax(0,1fr);gap:20px}
.dash-jump{display:flex;gap:6px;margin:-8px 0 -4px}
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
.td:hover{border-color:var(--ac)}.td input[type=checkbox]{margin-top:3px;flex:none}
.td-main{flex:1;min-width:0;display:grid;gap:5px;justify-items:start}
.td-text{all:unset;cursor:text;line-height:1.35;word-break:break-word}.td-text:focus-visible{outline:2px solid var(--ac);border-radius:4px}
.td.done .td-text{text-decoration:line-through;color:var(--mu)}
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
