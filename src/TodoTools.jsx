import { useEffect, useMemo, useState } from 'react'
import BlockEditor, { cleanBlocks, countTodos } from './BlockEditor'
import {
    TYPES, TYPE_KEYS, addDays, dayIndex, emptyWeek, iso, isHttp, normalizeUrl, notify, parseISO, todayISO, useStore, weekStart,
} from './shared'
import { TODO_EVENT, findTodo, moveTodos } from './todoActions'
import { play } from './sound'

const longDay = k => parseISO(k).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })

/* ============================================================
   Shift tasks: pick a day, tick the todos, pick another day.
   Props: from (date to start on), ids (todos ticked at the start), onClose
   ============================================================ */
export function ShiftModal({ from, ids = [], onClose }) {
    const [todos] = useStore('todos', {})
    const [src, setSrc] = useState(from || todayISO())
    const [dest, setDest] = useState(() => iso(addDays(parseISO(from || todayISO()), 1)))
    const [picked, setPicked] = useState(() => new Set(ids))

    const list = useMemo(() => {
        const d = parseISO(src)
        return ((todos[iso(weekStart(d))] || emptyWeek())[dayIndex(d)]) || []
    }, [todos, src])
    const chosen = list.filter(t => picked.has(t.id))
    const same = src === dest

    const toggle = id => setPicked(cur => {
        const next = new Set(cur)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
    })
    const changeSrc = v => {
        if (!v) return
        setSrc(v)
        setPicked(new Set())
    }
    const quick = n => setDest(iso(addDays(parseISO(todayISO()), n)))

    const go = e => {
        e.preventDefault()
        if (!chosen.length || same || !dest) return
        const n = moveTodos(src, chosen.map(t => t.id), dest)
        play('move')
        notify({ title: `Moved ${n} todo${n === 1 ? '' : 's'}`, body: `${longDay(src)} → ${longDay(dest)}`, icon: '↪️' })
        onClose()
    }

    return (
        <div className="modal-back" onMouseDown={e => e.target === e.currentTarget && onClose()}>
            <form className="modal" onSubmit={go} role="dialog" aria-label="Shift todos to another day">
                <h2>↪️ Shift todos to another day</h2>
                <div className="row">
                    <label className="field grow"><span>From day</span><input type="date" value={src} onChange={e => changeSrc(e.target.value)} /></label>
                    <label className="field grow"><span>To day</span><input type="date" value={dest} onChange={e => setDest(e.target.value)} /></label>
                </div>
                <div className="row" style={{ marginBottom: 12 }}>
                    <span className="small muted">To:</span>
                    <button type="button" className="btn sm" onClick={() => quick(0)}>Today</button>
                    <button type="button" className="btn sm" onClick={() => quick(1)}>Tomorrow</button>
                    <button type="button" className="btn sm" onClick={() => setDest(iso(addDays(parseISO(src), 7)))}>Same day next week</button>
                </div>

                <div className="row" style={{ marginBottom: 6 }}>
                    <b className="grow">{longDay(src)}</b>
                    {list.length > 0 && (
                        <>
                            <button type="button" className="btn sm ghost" onClick={() => setPicked(new Set(list.filter(t => !t.done).map(t => t.id)))}>Select unfinished</button>
                            <button type="button" className="btn sm ghost" onClick={() => setPicked(new Set())}>Clear</button>
                        </>
                    )}
                </div>
                {list.length === 0 && <p className="muted small">No todos on this day.</p>}
                <ul className="sh-list">
                    {list.map(t => (
                        <li key={t.id}>
                            <label className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                                <input type="checkbox" checked={picked.has(t.id)} onChange={() => toggle(t.id)} style={{ marginTop: 3 }} />
                                <span className={t.done ? 'sh-done' : ''}>{(TYPES[t.type] || TYPES.task).icon} {t.text}</span>
                            </label>
                        </li>
                    ))}
                </ul>
                {same && <p className="small" style={{ color: 'var(--wip)' }}>Choose a different day to move them to.</p>}
                <div className="row" style={{ marginTop: 14 }}>
                    <span className="grow small muted">{chosen.length} selected{!same && chosen.length ? ` → ${longDay(dest)}` : ''}</span>
                    <button type="button" className="btn" onClick={onClose}>Cancel</button>
                    <button type="submit" className="btn primary" disabled={!chosen.length || same || !dest}>Move {chosen.length || ''}</button>
                </div>
                <style>{'.sh-list{list-style:none;margin:0;padding:0;display:grid;gap:6px;max-height:34vh;overflow:auto}.sh-list li{padding:6px 8px;border-radius:8px;background:var(--sf2);border:1px solid var(--ln)}.sh-done{text-decoration:line-through;color:var(--mu)}'}</style>
            </form>
        </div>
    )
}

/* ============================================================
   Todo details: a window in the middle of the screen with a title and free-form content
   (headings, lists, nested todos, toggles, code). Saved inside the todo as "details".
   Mounted once in App; open it with openTodoDetails(id) from todoActions.js
   ============================================================ */
function DetailsModal({ id, onClose }) {
    const [todos, , update] = useStore('todos', {})
    const hit = findTodo(todos, id)
    const [title, setTitle] = useState(hit ? hit.todo.text : '')
    const [link, setLink] = useState(hit ? hit.todo.link || '' : '')

    useEffect(() => {
        const onKey = e => { if (e.key === 'Escape' && !e.defaultPrevented) onClose() }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [onClose])

    // Edit the todo in place, wherever it lives (it can be moved to another day while this is open)
    const patch = fields => update(d => {
        const h = findTodo(d, id)
        if (h) Object.assign(h.todo, fields)
    })

    if (!hit) {
        return (
            <div className="modal-back" onMouseDown={e => e.target === e.currentTarget && onClose()}>
                <div className="modal" role="dialog" aria-label="Todo details">
                    <h2>This todo no longer exists</h2>
                    <div className="row"><span className="grow" /><button className="btn" onClick={onClose}>Close</button></div>
                </div>
            </div>
        )
    }

    const t = hit.todo
    const meta = TYPES[t.type] || TYPES.task
    const details = cleanBlocks(t.details)
    const c = countTodos(details)
    const date = iso(addDays(parseISO(hit.key), hit.day))

    return (
        <div className="modal-back td-back" onMouseDown={e => e.target === e.currentTarget && onClose()}>
            <div className="modal td-modal" role="dialog" aria-label="Todo details">
                <div className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                    <input type="checkbox" checked={t.done} style={{ marginTop: 10 }} aria-label="Done"
                        onChange={e => patch({ done: e.target.checked, doneOn: e.target.checked ? todayISO() : null })} />
                    <input className="td-title-in" value={title} aria-label="Todo title" maxLength={200}
                        onChange={e => setTitle(e.target.value)} onBlur={() => { const v = title.trim(); if (v && v !== t.text) patch({ text: v }); else setTitle(t.text) }}
                        onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} />
                    <button className="icon-btn" onClick={onClose} aria-label="Close" title="Close (Esc)">×</button>
                </div>
                <div className="row small muted" style={{ margin: '4px 0 10px' }}>
                    <span>{longDay(date)}</span>
                    {c.total > 0 && <span>· {c.done}/{c.total} sub-todos done</span>}
                </div>
                <div className="row" style={{ marginBottom: 10 }}>
                    <select value={t.type} onChange={e => patch({ type: e.target.value })} aria-label="Type" style={{ flex: '0 1 160px', borderLeft: `4px solid ${meta.color}` }}>
                        {TYPE_KEYS.map(k => <option key={k} value={k}>{TYPES[k].icon} {TYPES[k].label}</option>)}
                    </select>
                    <input value={link} placeholder="Link (optional)" aria-label="Link" inputMode="url" maxLength={500} style={{ flex: '1 1 160px' }}
                        onChange={e => setLink(e.target.value)} onBlur={() => { const v = normalizeUrl(link); setLink(v); patch(v ? { link: v } : { link: '' }) }} />
                    {isHttp(t.link || '') && <a className="btn sm" href={t.link} target="_blank" rel="noopener noreferrer">Open link</a>}
                </div>
                <div className="td-body">
                    <BlockEditor label="Todo details" value={details} onChange={blocks => patch({ details: blocks })} />
                </div>
                <div className="row" style={{ marginTop: 12 }}>
                    <span className="grow muted small">Saved automatically</span>
                    <button className="btn primary" onClick={onClose}>Done</button>
                </div>
                <style>{`.td-modal{width:min(720px,100%);max-height:calc(100vh - 40px);display:flex;flex-direction:column}.td-body{overflow:auto;flex:1;min-height:180px;border-top:1px solid var(--ln);padding-top:10px}.td-title-in{flex:1;font:700 21px var(--head)!important;border:0!important;background:none!important;padding:4px 6px!important}.td-title-in:focus{background:var(--sf2)!important}@media(max-width:640px){.td-back{align-items:center;padding:10px}.td-modal{border-radius:16px;max-height:92vh}}`}</style>
            </div>
        </div>
    )
}

export function TodoDetailsHost() {
    const [id, setId] = useState(null)
    useEffect(() => {
        const open = e => setId(e.detail)
        window.addEventListener(TODO_EVENT, open)
        return () => window.removeEventListener(TODO_EVENT, open)
    }, [])
    if (!id) return null
    return <DetailsModal key={id} id={id} onClose={() => setId(null)} />
}

// Small label for a todo row: "☑ 2/5" when its details hold todos
export function detailsBadge(todo) {
    const c = countTodos(todo.details)
    return c.total ? c : null
}
