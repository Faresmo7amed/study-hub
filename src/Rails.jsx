import { useState } from 'react'
import { TYPES, TYPE_KEYS, addTodoToday, dayIndex, iso, parseISO, quoteOfDay, until, useNow, useStats, useStore, weekStart } from './shared'
import { toggleTodo } from './Dashboard'
import { loadRoadmaps, nextUp } from './Roadmap'
import { play } from './sound'
import { Icon } from './Icons'

// Parent: LeftRail. A free-text pad, saved on this device only.
function Scratch() {
    const [text, setText] = useStore('scratch', '')
    return (
        <section className="card rail-card">
            <h3>Scratchpad</h3>
            <textarea value={text} onChange={e => setText(e.target.value)} placeholder="Quick thoughts, links, things to look up…" aria-label="Scratchpad" />
            <p className="muted small" style={{ margin: 0 }}>Saved on this device.</p>
        </section>
    )
}

// What it does: shows today's todos with checkboxes, a quick-add box and the scratchpad.
// When to use it: mounted once in App, on the left side.
export function LeftRail() {
    const now = useNow(30000)
    const [todos] = useStore('todos', {})
    const [text, setText] = useState('')
    const [type, setType] = useState('task')
    const key = iso(weekStart(now))
    const day = dayIndex(now)
    const list = (todos[key] || [])[day] || []
    const done = list.filter(t => t.done).length

    const add = e => {
        e.preventDefault()
        const v = text.trim()
        if (!v) return
        addTodoToday({ text: v, type })
        play('add')
        setText('')
    }

    return (
        <aside className="rail l" aria-label="Today">
            <section className="card rail-card">
                <div className="row"><h3 className="grow">Today</h3><span className="small muted">{done}/{list.length}</span></div>
                {list.length > 0 && <div className="bar"><i className={done === list.length ? 'full' : ''} style={{ width: (100 * done) / list.length + '%' }} /></div>}
                <ul className="rail-todos">
                    {list.map(t => (
                        <li key={t.id} className={t.done ? 'done' : ''}>
                            <input type="checkbox" checked={t.done} onChange={() => toggleTodo(key, day, t.id, null)} aria-label={`Mark "${t.text}" as done`} />
                            <span>{(TYPES[t.type] || TYPES.task).icon} {t.text}</span>
                        </li>
                    ))}
                </ul>
                {!list.length && <p className="muted small" style={{ margin: 0 }}>Nothing planned today.</p>}
                <form className="rail-add" onSubmit={add}>
                    <input value={text} onChange={e => setText(e.target.value)} placeholder="Quick add for today" aria-label="Quick add todo" />
                    <div className="row">
                        <select value={type} onChange={e => setType(e.target.value)} aria-label="Type" style={{ flex: 1 }}>
                            {TYPE_KEYS.map(k => <option key={k} value={k}>{TYPES[k].icon} {TYPES[k].label}</option>)}
                        </select>
                        <button className="btn sm primary" type="submit">Add</button>
                    </div>
                </form>
            </section>
            <Scratch />
        </aside>
    )
}

// What it does: shows streak, week progress, upcoming events, the next roadmap topic and a quote.
// When to use it: mounted once in App, on the right side.
export function RightRail() {
    const now = useNow(30000)
    const stats = useStats()
    const [events] = useStore('events', [])
    const [todos] = useStore('todos', {})
    const [roadmaps] = useStore('roadmaps', loadRoadmaps)
    const week = (todos[iso(weekStart(now))] || []).flat()
    const done = week.filter(t => t.done).length
    const lvl = stats.level
    const upcoming = events
        .map(e => ({ ...e, at: new Date(`${e.date}T${e.time || '23:59'}`).getTime() }))
        .filter(e => e.at >= now.getTime())
        .sort((a, b) => a.at - b.at)
        .slice(0, 3)
    const next = nextUp(roadmaps)

    return (
        <aside className="rail r" aria-label="Overview">
            <section className="card rail-card">
                <h3>Your week</h3>
                <div className="row">
                    <span className="app-chip">🔥 {stats.streak}d</span>
                    <span className="app-chip">Lv {lvl.level}</span>
                    <span className="small muted grow" style={{ textAlign: 'right' }}>{done}/{week.length} todos</span>
                </div>
                <div className="bar"><i className={week.length && done === week.length ? 'full' : ''} style={{ width: (week.length ? (100 * done) / week.length : 0) + '%' }} /></div>
                <p className="small muted" style={{ margin: 0 }}>{lvl.into}/{lvl.span} XP to level {lvl.level + 1}</p>
            </section>
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
            {next && (
                <section className="card rail-card">
                    <h3>Next up</h3>
                    <button className="btn" style={{ whiteSpace: 'normal', textAlign: 'left' }} onClick={() => { window.location.hash = '/roadmap' }}>{next.icon && <Icon value={next.icon} size={16} />} {next.title}</button>
                    <p className="small muted" style={{ margin: 0 }}>{next.roadmap} · {next.pct}% done</p>
                    <div className="bar"><i style={{ width: next.pct + '%' }} /></div>
                </section>
            )}
            <section className="card rail-card">
                <blockquote className="rail-quote">{quoteOfDay(now)}</blockquote>
            </section>
        </aside>
    )
}