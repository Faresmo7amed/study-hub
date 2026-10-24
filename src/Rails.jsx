import { useMemo, useState } from 'react'
import {
    DAYS, STUDY_DEFAULT, TYPES, TYPE_KEYS, addDays, addTodoToday, dayIndex, hms, isHttp, iso, normalizeUrl, parseISO, quoteOfDay,
    todayISO, uid, until, useNow, useStats, useStore, weekStart, fmt12
} from './shared'
import { EVENT_COLORS, openTodoDetails, removeEvent, toggleTodo, toggleEvent } from './todoActions'
import { loadRoadmaps, nextUp, openRoadmap, roadmapList } from './Roadmap'
import { MAX_SESSION, STREAK_MIN, fmtMin, pauseSession, resumeSession, runActive, runElapsed, runRunning, startSession, stopSession, streakOf } from './StudyGroup'
import { SocialLinks, openSettings } from './Settings'
import { useSyncState } from './sync'
import { play } from './sound'
import { Icon } from './Icons'

const useHidden = key => {
    const [settings] = useStore('settings', { dailyGoal: 3 })
    return Boolean((settings.hide || {})[key])
}

// Parent: LeftRail. A free-text pad, saved on this device only.
function Scratch() {
    const [text, setText] = useStore('scratch', '')
    if (useHidden('scratch')) return null
    return (
        <section className="card rail-card">
            <h3>Scratchpad</h3>
            <textarea value={text} onChange={e => setText(e.target.value)} placeholder="Quick thoughts, links, things to look up…" aria-label="Scratchpad" />
            <p className="muted small" style={{ margin: 0 }}>Saved on this device.</p>
        </section>
    )
}

// Parent: LeftRail. Start and stop a study session from any page. Minutes count for the streak and the Study Group.
function StudyCard() {
    const { user } = useSyncState()
    const [run] = useStore('studyrun', {})
    const [study] = useStore('studygroup', STUDY_DEFAULT)
    const active = runActive(run)
    const running = runRunning(run)
    const now = useNow(running ? 1000 : 60000)
    const hidden = useHidden('study')
    if (hidden) return null
    const today = todayISO()
    const elapsed = runElapsed(run, now.getTime())
    const mins = (study.days[today] || 0) + Math.min(MAX_SESSION, Math.floor(elapsed / 60000))
    const { streak } = streakOf({ ...study.days, [today]: mins }, today)
    return (
        <section className={'card rail-card rail-study' + (running ? ' on' : '')}>
            <div className="row"><h3 className="grow">Study timer</h3><span className="app-chip" title={`${STREAK_MIN} minutes a day keep the study streak`}>📚 {streak}d</span></div>
            <div className="rail-clock">{hms(elapsed)}</div>
            <div className="bar"><i className={mins >= STREAK_MIN ? 'full' : ''} style={{ width: Math.min(100, (100 * mins) / STREAK_MIN) + '%' }} /></div>
            <p className="muted small" style={{ margin: 0 }}>{fmtMin(mins)} today · {mins >= STREAK_MIN ? 'streak day secured ✅' : `${STREAK_MIN - mins} min to keep the streak`}</p>
            {!active && <button className="btn primary" onClick={() => startSession(user)}>Start studying</button>}
            {active && (
                <div className="row" style={{ gap: 6 }}>
                    {running ? <button className="btn grow" onClick={() => pauseSession(user)}>Pause</button> : <button className="btn primary grow" onClick={() => resumeSession(user)}>Resume</button>}
                    <button className="btn danger grow" onClick={() => stopSession(user)}>Stop and save</button>
                </div>
            )}
        </section>
    )
}

// What it does: shows today's todos with checkboxes, a quick-add box, the study timer and the scratchpad.
// When to use it: mounted once in App, on the left side. sheet=true shows it inside the phone panel.
export function LeftRail({ sheet = false }) {
    const now = useNow(30000)
    const [todos] = useStore('todos', {})
    const [text, setText] = useState('')
    const [type, setType] = useState('task')
    const [link, setLink] = useState('')
    const key = iso(weekStart(now))
    const day = dayIndex(now)
    const list = (todos[key] || [])[day] || []
    const done = list.filter(t => t.done).length

    const add = e => {
        e.preventDefault()
        const v = text.trim()
        if (!v) return
        addTodoToday({ text: v, type, link: normalizeUrl(link) })
        play('add')
        setText('')
        setLink('')
    }

    return (
        <aside className={'rail l' + (sheet ? ' sheet' : '')} aria-label="Today">
            <section className="card rail-card">
                <div className="row"><h3 className="grow">Today</h3><span className="small muted">{done}/{list.length}</span></div>
                {list.length > 0 && <div className="bar"><i className={done === list.length ? 'full' : ''} style={{ width: (100 * done) / list.length + '%' }} /></div>}
                <ul className="rail-todos">
                    {list.map(t => (
                        <li key={t.id} className={t.done ? 'done' : ''}>
                            <input type="checkbox" checked={t.done} onChange={e => toggleTodo(key, day, t.id, e.currentTarget)} aria-label={`Mark "${t.text}" as done`} />
                            <span>{(TYPES[t.type] || TYPES.task).icon} {isHttp(t.link || '')
                                ? <a className="rail-link" href={t.link} target="_blank" rel="noopener noreferrer" title={t.link}>{t.text}</a>
                                : t.text}</span>
                            <button className="icon-btn rail-open" onClick={() => openTodoDetails(t.id)} aria-label={`Open details of ${t.text}`} title="Open details">⤢</button>
                        </li>
                    ))}
                </ul>
                {!list.length && <p className="muted small" style={{ margin: 0 }}>Nothing planned today.</p>}
                <form className="rail-add" onSubmit={add}>
                    <input value={text} onChange={e => setText(e.target.value)} placeholder="Quick add for today" aria-label="Quick add todo" />
                    <input value={link} onChange={e => setLink(e.target.value)} placeholder="Link (optional)" aria-label="Quick add link, optional" inputMode="url" maxLength={500} />
                    <div className="row">
                        <select value={type} onChange={e => setType(e.target.value)} aria-label="Type" style={{ flex: 1 }}>
                            {TYPE_KEYS.map(k => <option key={k} value={k}>{TYPES[k].icon} {TYPES[k].label}</option>)}
                        </select>
                        <button className="btn sm primary" type="submit">Add</button>
                    </div>
                </form>
            </section>
            <StudyCard />
            <Scratch />
        </aside>
    )
}

/* ---------- mini calendar ---------- */
const DOW = ['Sa', 'Su', 'Mo', 'Tu', 'We', 'Th', 'Fr']
const monthStart = d => new Date(d.getFullYear(), d.getMonth(), 1)

// Parent: RightRail. A small month calendar: dots for events, a green mark for days you were active.
// Click a day to see its events, todos and study time, and to add an event for it.
function MiniCalendar() {
    const now = useNow(30000)
    const stats = useStats()
    const [events, setEvents] = useStore('events', [])
    const [todos] = useStore('todos', {})
    const [study] = useStore('studygroup', STUDY_DEFAULT)
    const [cursor, setCursor] = useState(() => monthStart(new Date()))
    const [sel, setSel] = useState(todayISO())
    const [title, setTitle] = useState('')
    const [time, setTime] = useState('')
    const todayKey = iso(now)

    const byDate = useMemo(() => {
        const map = {}
        ;[...events].sort((a, b) => (a.time || '').localeCompare(b.time || '')).forEach(e => { (map[e.date] = map[e.date] || []).push(e) })
        return map
    }, [events])

    const first = monthStart(cursor)
    const gridStart = weekStart(first)
    const rows = Math.ceil((dayIndex(first) + new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate()) / 7)
    const cells = Array.from({ length: rows * 7 }, (_, i) => addDays(gridStart, i))
    const shift = n => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + n, 1))

    const selDate = parseISO(sel)
    const dayTodos = ((todos[iso(weekStart(selDate))] || [])[dayIndex(selDate)]) || []
    const dayEvents = byDate[sel] || []
    const studied = (study.days || {})[sel] || 0
    const past = sel < todayKey

    const nextEvent = useMemo(() => events
        .map(e => ({ ...e, at: new Date(`${e.date}T${e.time || '23:59'}`).getTime() }))
        .filter(e => e.at >= now.getTime() && !e.done)
        .sort((a, b) => a.at - b.at)[0], [events, now])

    const hint = past
        ? (stats.active.has(sel) ? `You were active: ${dayTodos.filter(t => t.done).length} todos done${studied ? `, ${fmtMin(studied)} studied` : ''}.` : 'A quiet day.')
        : dayEvents.length || dayTodos.length ? `${dayEvents.length} event${dayEvents.length === 1 ? '' : 's'} and ${dayTodos.length} todo${dayTodos.length === 1 ? '' : 's'} planned.` : 'Free day. Add an event or plan a todo.'

    const add = e => {
        e.preventDefault()
        const v = title.trim()
        if (!v) return
        setEvents(cur => [...cur, { id: uid(), title: v, date: sel, time, remind: time ? 10 : 0, color: EVENT_COLORS[0], notes: '' }])
        play('add')
        setTitle('')
        setTime('')
    }

    if (useHidden('calendar')) return null
    return (
        <section className="card rail-card mc" aria-label="Mini calendar">
            <div className="row">
                <h3 className="grow">{cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h3>
                <button className="icon-btn" onClick={() => shift(-1)} aria-label="Previous month">‹</button>
                <button className="icon-btn" onClick={() => { setCursor(monthStart(now)); setSel(todayKey) }} aria-label="Go to today" title="Today">●</button>
                <button className="icon-btn" onClick={() => shift(1)} aria-label="Next month">›</button>
            </div>
            <div className="mc-grid" role="grid">
                {DOW.map((n, i) => <span key={n} className={'mc-dow' + (i === 0 || i === 6 ? ' end' : '')} role="columnheader">{n}</span>)}
                {cells.map(d => {
                    const key = iso(d)
                    const evs = byDate[key] || []
                    return (
                        <button key={key} role="gridcell" onClick={() => setSel(key)}
                            className={'mc-d' + (d.getMonth() !== cursor.getMonth() ? ' out' : '') + (key === todayKey ? ' today' : '') + (key === sel ? ' sel' : '') + (stats.active.has(key) ? ' act' : '')}
                            aria-label={d.toLocaleDateString(undefined, { dateStyle: 'full' }) + (evs.length ? `, ${evs.length} events` : '')}>
                            {d.getDate()}
                            {evs.length > 0 && <i style={{ background: evs[0].color }} />}
                        </button>
                    )
                })}
            </div>
            {nextEvent && <p className="mc-next small"><span aria-hidden="true">⏳</span> <b>{nextEvent.title}</b> {nextEvent.time ? until(nextEvent.at - now.getTime()) : parseISO(nextEvent.date).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</p>}
            <div className="mc-day">
                <b>{selDate.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</b>
                <p className="muted small" style={{ margin: 0 }}>{hint}</p>
                <ul className="rail-up">
                    {dayEvents.map(e => (
                        <li key={e.id} className="mc-ev" style={{ '--c': e.color }}>
                            <input type="checkbox" checked={!!e.done} onChange={() => toggleEvent(e.id)} aria-label={`Mark ${e.title} done`} />
                            <span className="small grow" style={e.done ? { textDecoration: 'line-through', opacity: 0.6 } : undefined}><b>{e.time ? fmt12(e.time) : 'All day'}</b> {e.title}{e.gid && <span className="cal-g" title="Synced with Google Calendar">G</span>}</span>
                            <button className="icon-btn" onClick={() => removeEvent(e)} aria-label={`Delete ${e.title}`} title="Delete event">×</button>
                        </li>
                    ))}
                </ul>
                {dayTodos.length > 0 && (
                    <ul className="rail-todos mc-todos" aria-label="Todos of this day">
                        {dayTodos.map(t => (
                            <li key={t.id} className={t.done ? 'done' : ''}>
                                <input type="checkbox" checked={t.done} onChange={e => toggleTodo(iso(weekStart(selDate)), dayIndex(selDate), t.id, e.currentTarget)} aria-label={`Mark "${t.text}" as done`} />
                                <span>{(TYPES[t.type] || TYPES.task).icon} {t.text}</span>
                                <button className="icon-btn rail-open" onClick={() => openTodoDetails(t.id)} aria-label={`Open details of ${t.text}`} title="Open details">⤢</button>
                            </li>
                        ))}
                    </ul>
                )}
                <form className="mc-add" onSubmit={add}>
                    <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Event" aria-label="Event title" maxLength={80} />
                    <input type="time" value={time} onChange={e => setTime(e.target.value)} aria-label="Event time (empty for all day)" />
                    <button className="btn sm primary" type="submit" disabled={!title.trim()}>Add</button>
                </form>
            </div>
        </section>
    )
}

/* ---------- roadmap progress ---------- */
// Parent: RightRail. Every roadmap with its percentage. Click one to open it.
function RoadmapCard() {
    const [store] = useStore('roadmaps', loadRoadmaps)
    const list = roadmapList(store)
    const next = nextUp(store)
    if (useHidden('roadmaps') || !list.length) return null
    return (
        <section className="card rail-card">
            <h3>Roadmaps</h3>
            <ul className="rail-up">
                {list.slice(0, 5).map(r => (
                    <li key={r.id}>
                        <button className="rail-rm" onClick={() => openRoadmap(r.id)} title={`Open ${r.title}`}>
                            <span className="grow">{r.title}</span><b>{r.pct}%</b>
                        </button>
                        <div className="bar"><i className={r.pct === 100 ? 'full' : ''} style={{ width: r.pct + '%' }} /></div>
                    </li>
                ))}
            </ul>
            {next && (
                <p className="small muted" style={{ margin: 0 }}>
                    Next up: <button className="rail-link" onClick={() => openRoadmap(store.active)}>{next.icon && <Icon value={next.icon} size={14} />} {next.title}</button>
                </p>
            )}
        </section>
    )
}

// What it does: shows streak, week progress, a mini calendar, upcoming events, roadmap progress, your links and a quote.
// When to use it: mounted once in App, on the right side. sheet=true shows it inside the phone panel.
export function RightRail({ sheet = false }) {
    const now = useNow(30000)
    const stats = useStats()
    const [events] = useStore('events', [])
    const [todos] = useStore('todos', {})
    const week = (todos[iso(weekStart(now))] || []).flat()
    const done = week.filter(t => t.done).length
    const lvl = stats.level
    const ws = weekStart(now)
    const upcoming = events
        .map(e => ({ ...e, at: new Date(`${e.date}T${e.time || '23:59'}`).getTime() }))
        .filter(e => e.at >= now.getTime() && !e.done)
        .sort((a, b) => a.at - b.at)
        .slice(0, 3)
    const hideLinks = useHidden('links')
    const hideQuote = useHidden('quote')

    return (
        <aside className={'rail r' + (sheet ? ' sheet' : '')} aria-label="Overview">
            <section className="card rail-card">
                <h3>Your week</h3>
                <div className="row">
                    <span className="app-chip">🔥 {stats.streak}d</span>
                    <span className="app-chip">Lv {lvl.level}</span>
                    <span className="small muted grow" style={{ textAlign: 'right' }}>{done}/{week.length} todos</span>
                </div>
                <div className="rail-days" role="list" aria-label="Active days this week">
                    {DAYS.map((name, i) => {
                        const key = iso(addDays(ws, i))
                        return <span key={key} role="listitem" title={`${name}${stats.active.has(key) ? ': active' : ''}`} className={(stats.active.has(key) ? 'on' : '') + (key === iso(now) ? ' now' : '')}>{name[0]}</span>
                    })}
                </div>
                <div className="bar"><i className={week.length && done === week.length ? 'full' : ''} style={{ width: (week.length ? (100 * done) / week.length : 0) + '%' }} /></div>
                <p className="small muted" style={{ margin: 0 }}>{lvl.into}/{lvl.span} XP to level {lvl.level + 1}</p>
            </section>
            <MiniCalendar />
            <section className="card rail-card">
                <h3>Upcoming</h3>
                {!upcoming.length && <p className="muted small" style={{ margin: 0 }}>No upcoming events.</p>}
                <ul className="rail-up">
                    {upcoming.map(e => (
                        <li key={e.id}>
                            <b>{e.title}</b>
                            <span className="small muted">{parseISO(e.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}{e.time ? ` · ${e.time} · ${until(e.at - now.getTime())}` : ' · all day'}</span>
                        </li>
                    ))}
                </ul>
            </section>
            <RoadmapCard />
            {!hideLinks && (
                <section className="card rail-card">
                    <div className="row"><h3 className="grow">My links</h3><button className="icon-btn" onClick={openSettings} aria-label="Edit links in settings" title="Edit in settings">⚙️</button></div>
                    <SocialLinks />
                </section>
            )}
            {!hideQuote && <section className="card rail-card"><blockquote className="rail-quote">{quoteOfDay(now)}</blockquote></section>}
        </aside>
    )
}

export const RAIL_CSS = `
.rail>*{min-width:0}
.rail-card{padding:14px;display:grid;gap:10px;animation:rise .35s both;min-width:0}
.rail-card .row{flex-wrap:nowrap}
.rail-card h3{font-size:16px}
.rail .bar{margin-top:0}
.rail-todos,.rail-up{list-style:none;margin:0;padding:0;display:grid;gap:6px}
.rail-todos li{display:flex;gap:8px;align-items:flex-start;overflow-wrap:anywhere}
.rail-todos li.done span{text-decoration:line-through;color:var(--mu)}
.rail-link{color:var(--ac);text-decoration:underline;text-underline-offset:2px}
.rail-todos li.done .rail-link{color:var(--mu);text-decoration:line-through}
.rail-todos input{margin-top:3px;flex:none}
.rail-todos li>span{flex:1;min-width:0}
.rail-open{flex:none;padding:0 5px;font-size:13px;opacity:.5}.rail-todos li:hover .rail-open,.rail-open:focus-visible{opacity:1}
@media(hover:none){.rail-open{opacity:.8}}
.mc-todos{padding-top:2px}
.rail-add{display:grid;gap:6px}
.rail textarea{min-height:90px}
.rail-up li{display:grid;gap:4px}
.rail-quote{margin:0;font:italic 500 14px/1.45 var(--head)}
.rail-days{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px}
.rail-days span{display:grid;place-items:center;height:24px;border-radius:6px;font-size:11px;font-weight:600;color:var(--mu);background:var(--sf2);border:1px solid var(--ln)}
.rail-days span.on{background:linear-gradient(135deg,var(--ok),color-mix(in srgb,var(--ok) 60%,#fff));border-color:var(--ok);color:#fff}
.rail-days span.now{box-shadow:0 0 0 2px var(--ac)}
.rail-study.on{border-color:var(--ok);box-shadow:0 0 0 1px var(--ok),var(--shadow)}
.rail-clock{font:700 34px var(--head);font-variant-numeric:tabular-nums;text-align:center;line-height:1.1}
.rail-study.on .rail-clock{color:var(--ok)}
.rail-rm{all:unset;cursor:pointer;display:flex;gap:8px;width:100%;font-size:14px;border-radius:6px}
.rail-rm:hover{color:var(--ac)}.rail-rm:focus-visible{outline:2px solid var(--ac);outline-offset:2px}
.rail-link{all:unset;cursor:pointer;color:var(--ac);font-weight:600}.rail-link:focus-visible{outline:2px solid var(--ac);outline-offset:2px;border-radius:4px}
.mc-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:2px}
.mc-dow{text-align:center;font-size:10px;font-weight:600;color:var(--mu);padding:2px 0}.mc-dow.end{opacity:.6}
.mc-d{position:relative;height:30px;min-width:0;padding:0;border:1px solid transparent;border-radius:8px;background:none;cursor:pointer;font-size:12px;display:grid;place-items:center;color:var(--tx);transition:background .15s,transform .1s}
.mc-d:hover{background:var(--sf2)}
.mc-d.out{opacity:.35}
.mc-d.act{background:color-mix(in srgb,var(--ok) 20%,transparent)}
.mc-d.today{border-color:var(--ac);font-weight:700}
.mc-d.sel{background:linear-gradient(135deg,var(--ac),var(--ac2));color:#fff;border-color:transparent;transform:scale(1.06)}
.mc-d i{position:absolute;bottom:3px;left:50%;width:5px;height:5px;margin-left:-2.5px;border-radius:50%}
.mc-next{margin:0;padding:6px 10px;border-radius:8px;background:color-mix(in srgb,var(--ac) 10%,var(--sf2));border:1px solid var(--ln)}
.mc-day{display:grid;gap:6px;border-top:1px solid var(--ln);padding-top:10px}
.mc-ev{display:flex!important;gap:6px;align-items:center;border-left:3px solid var(--c);padding-left:8px;background:var(--sf2);border-radius:6px}
.mc-add{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,80px) auto;gap:4px}
.mc-add input[type=time]{padding:7px 4px}
.sl-list{display:flex;gap:6px;flex-wrap:wrap}
.sl-chip{display:inline-flex;gap:5px;align-items:center;border:1px solid var(--ln);background:var(--sf2);border-radius:999px;padding:3px 11px;font-size:13px;font-weight:500;color:var(--tx);text-decoration:none;transition:border-color .15s,transform .15s}
.sl-chip:hover{border-color:var(--ac);transform:translateY(-1px)}
.rail.sheet{display:grid!important;position:static;width:auto;max-height:none;overflow:visible;padding:0}
`
