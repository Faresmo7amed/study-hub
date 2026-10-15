import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { clamp, notify, uid, useStore } from './shared'
import { play } from './sound'

/* ============================================================
   Notes, in the spirit of Google Keep
   - text notes and checklists, colours, labels, pinning
   - archive and trash (trash empties itself after 7 days)
   - search, grid / list layout
   ============================================================ */

const COLORS = { default: null, red: 4, orange: 28, yellow: 48, green: 140, teal: 175, blue: 210, purple: 265, pink: 330, gray: 220 }
const COLOR_KEYS = Object.keys(COLORS)
const TRASH_DAYS = 7

const blank = () => ({
    id: uid(), title: '', body: '', items: null, color: 'default', pinned: false, archived: false,
    trashed: null, labels: [], created: Date.now(), edited: Date.now(),
})
const isBlank = n => !n.title.trim() && !(n.items ? n.items.some(i => i.t.trim()) : n.body.trim())
const toList = n => ({
    ...n,
    body: '',
    items: n.body.split('\n').filter(l => l.trim()).map(t => ({ id: uid(), t, done: false })).concat(n.body.trim() ? [] : [{ id: uid(), t: '', done: false }]),
})
const toText = n => ({ ...n, items: null, body: n.items.map(i => i.t).filter(Boolean).join('\n') })
const cardStyle = c => (COLORS[c] != null ? { '--h': COLORS[c] } : undefined)

const seedNotes = () => {
    const now = Date.now()
    return [
        {
            ...blank(), id: 'n1', title: 'This week\'s study plan', color: 'yellow', pinned: true, labels: ['Study'], created: now - 3000,
            items: [{ id: 'a', t: 'Finish the React hooks chapter', done: true }, { id: 'b', t: 'Rebuild the todo app without a library', done: false }, { id: 'c', t: 'Read the MDN guide on fetch', done: false }],
        },
        { ...blank(), id: 'n2', title: 'Debugging checklist', body: '1. Reproduce the bug\n2. Read the error out loud\n3. Form a hypothesis\n4. Change one thing at a time\n5. Write down the root cause', color: 'blue', labels: ['Study'], created: now - 2000 },
        { ...blank(), id: 'n3', title: 'Project idea', body: 'A flashcards app that turns my own notes into quiz questions. Start with a simple spaced repetition schedule.\nhttps://developer.mozilla.org', color: 'green', labels: ['Ideas'], created: now - 1000 },
    ]
}

const URL_RE = /(https?:\/\/[^\s]+)/g
const linkify = text => text.split(URL_RE).map((part, i) => (i % 2 ? <a key={i} href={part} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>{part}</a> : part))
const fmtWhen = ts => new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

/* ---------- popover ---------- */
function Pop({ anchor, onClose, children, width = 220 }) {
    const ref = useRef(null)
    const [pos, setPos] = useState(null)
    useLayoutEffect(() => {
        const r = anchor.getBoundingClientRect()
        const h = ref.current ? ref.current.offsetHeight : 0
        const left = clamp(r.left, 8, Math.max(8, window.innerWidth - width - 12))
        const top = r.bottom + 4 + h > window.innerHeight - 8 ? Math.max(8, r.top - h - 4) : r.bottom + 4
        setPos({ left, top })
    }, [anchor, width])
    useEffect(() => {
        const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
        window.addEventListener('keydown', onKey, true)
        return () => window.removeEventListener('keydown', onKey, true)
    }, [onClose])
    return createPortal(
        <>
            <div className="kp-back" onMouseDown={onClose} />
            <div ref={ref} className="kp-pop" role="dialog" style={{ left: pos ? pos.left : -9999, top: pos ? pos.top : 0, width }}>{children}</div>
        </>,
        document.body,
    )
}

function AutoText({ value, onChange, placeholder, autoFocus }) {
    const ref = useRef(null)
    useLayoutEffect(() => {
        const el = ref.current
        el.style.height = 'auto'
        el.style.height = el.scrollHeight + 'px'
    }, [value])
    return <textarea ref={ref} className="kp-body" rows={2} value={value} placeholder={placeholder} autoFocus={autoFocus} onChange={e => onChange(e.target.value)} />
}

/* ---------- the actions row used by cards, the composer and the editor ---------- */
function Toolbar({ note, onChange, labels, onToggleList, onArchive, onTrash, onDuplicate, onRestore, onDeleteForever }) {
    const [pop, setPop] = useState(null)
    const open = kind => e => setPop({ kind, anchor: e.currentTarget })
    const close = () => setPop(null)
    const toggleLabel = l => onChange({ ...note, labels: note.labels.includes(l) ? note.labels.filter(x => x !== l) : [...note.labels, l] })
    const [newLabel, setNewLabel] = useState('')

    if (note.trashed) {
        return (
            <div className="kp-tools">
                <button className="icon-btn" onClick={onRestore} title="Restore" aria-label="Restore">↩</button>
                <button className="icon-btn" onClick={onDeleteForever} title="Delete forever" aria-label="Delete forever">✕</button>
            </div>
        )
    }
    return (
        <div className="kp-tools">
            {onToggleList && <button className="icon-btn" onClick={onToggleList} title={note.items ? 'Hide checkboxes' : 'Show checkboxes'} aria-label="Toggle checklist">☑</button>}
            <button className={'icon-btn' + (note.pinned ? ' on' : '')} onClick={() => onChange({ ...note, pinned: !note.pinned, archived: false })} title={note.pinned ? 'Unpin' : 'Pin'} aria-pressed={note.pinned} aria-label="Pin">📌</button>
            <button className="icon-btn" onClick={open('color')} title="Colour" aria-label="Change colour">🎨</button>
            <button className="icon-btn" onClick={open('label')} title="Labels" aria-label="Edit labels">🏷️</button>
            {onDuplicate && <button className="icon-btn" onClick={onDuplicate} title="Duplicate" aria-label="Duplicate">⧉</button>}
            {onArchive && <button className="icon-btn" onClick={onArchive} title={note.archived ? 'Unarchive' : 'Archive'} aria-label="Archive">🗄️</button>}
            {onTrash && <button className="icon-btn" onClick={onTrash} title="Move to trash" aria-label="Delete">🗑️</button>}
            {pop && pop.kind === 'color' && (
                <Pop anchor={pop.anchor} onClose={close} width={196}>
                    <div className="kp-swatches">
                        {COLOR_KEYS.map(c => (
                            <button key={c} className={'kp-sw' + (note.color === c ? ' on' : '')} data-c={c} style={cardStyle(c)} title={c} aria-label={c}
                                onClick={() => { onChange({ ...note, color: c }); close() }}>{note.color === c ? '✓' : ''}</button>
                        ))}
                    </div>
                </Pop>
            )}
            {pop && pop.kind === 'label' && (
                <Pop anchor={pop.anchor} onClose={close} width={230}>
                    <p className="muted small kp-pad">Label note</p>
                    {labels.map(l => (
                        <label key={l} className="kp-item"><input type="checkbox" checked={note.labels.includes(l)} onChange={() => toggleLabel(l)} /> {l}</label>
                    ))}
                    {!labels.length && <p className="muted small kp-pad">No labels yet. Create one below.</p>}
                    <form className="kp-pad" onSubmit={e => {
                        e.preventDefault()
                        const v = newLabel.trim()
                        if (!v) return
                        onChange({ ...note, labels: note.labels.includes(v) ? note.labels : [...note.labels, v] }, v)
                        setNewLabel('')
                    }}>
                        <input value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder="Create a label" aria-label="New label" />
                    </form>
                </Pop>
            )}
        </div>
    )
}

/* ---------- title + body or checklist ---------- */
function NoteEditor({ note, onChange, autoFocus }) {
    const focusId = useRef(null)
    const patch = p => onChange({ ...note, ...p, edited: Date.now() })

    useEffect(() => {
        if (!focusId.current) return
        const el = document.querySelector(`[data-item="${focusId.current}"]`)
        if (el) el.focus()
        focusId.current = null
    })

    const setItem = (id, p) => patch({ items: note.items.map(i => (i.id === id ? { ...i, ...p } : i)) })
    const addAfter = id => {
        const it = { id: uid(), t: '', done: false }
        const i = note.items.findIndex(x => x.id === id)
        const next = [...note.items]
        next.splice(i < 0 ? next.length : i + 1, 0, it)
        focusId.current = it.id
        patch({ items: next })
    }
    const removeItem = (id, focusPrev) => {
        const i = note.items.findIndex(x => x.id === id)
        if (focusPrev && i > 0) focusId.current = note.items[i - 1].id
        patch({ items: note.items.filter(x => x.id !== id) })
    }

    const row = it => (
        <div key={it.id} className={'kp-item' + (it.done ? ' done' : '')}>
            <input type="checkbox" checked={it.done} onChange={e => { setItem(it.id, { done: e.target.checked }); play(e.target.checked ? 'check' : 'uncheck') }} aria-label="Done" />
            <input data-item={it.id} className="kp-itext" value={it.t} placeholder="List item" aria-label="List item" onChange={e => setItem(it.id, { t: e.target.value })}
                onKeyDown={e => {
                    if (e.key === 'Enter') { e.preventDefault(); addAfter(it.id) }
                    if (e.key === 'Backspace' && !it.t && note.items.length > 1) { e.preventDefault(); removeItem(it.id, true) }
                }} />
            <button className="icon-btn" onClick={() => removeItem(it.id, false)} aria-label="Delete item">×</button>
        </div>
    )

    return (
        <div className="kp-editor">
            <input className="kp-title" placeholder="Title" value={note.title} onChange={e => patch({ title: e.target.value })} autoFocus={autoFocus && !note.items} aria-label="Title" />
            {note.items ? (
                <div>
                    {note.items.filter(i => !i.done).map(row)}
                    <button className="kp-additem" onClick={() => addAfter(null)}>+ List item</button>
                    {note.items.some(i => i.done) && (
                        <>
                            <p className="kp-doneh muted small">{note.items.filter(i => i.done).length} completed</p>
                            {note.items.filter(i => i.done).map(row)}
                        </>
                    )}
                </div>
            ) : (
                <AutoText value={note.body} onChange={v => patch({ body: v })} placeholder="Take a note…" autoFocus={autoFocus} />
            )}
        </div>
    )
}

/* ---------- composer ---------- */
function Composer({ labels, onAdd, onNewLabel }) {
    const [open, setOpen] = useState(false)
    const [draft, setDraft] = useState(blank)
    const ref = useRef(null)

    const finish = () => {
        if (!isBlank(draft)) onAdd(draft)
        setDraft(blank())
        setOpen(false)
    }

    useEffect(() => {
        if (!open) return
        const onDown = e => {
            if (ref.current && !ref.current.contains(e.target) && !e.target.closest('.kp-pop') && !e.target.closest('.kp-back')) finish()
        }
        const onKey = e => {
            if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) finish()
        }
        document.addEventListener('mousedown', onDown)
        window.addEventListener('keydown', onKey)
        return () => {
            document.removeEventListener('mousedown', onDown)
            window.removeEventListener('keydown', onKey)
        }
    })

    const change = (n, newLabel) => {
        setDraft(n)
        if (newLabel) onNewLabel(newLabel)
    }

    if (!open) {
        return (
            <div className="kp-compose card" ref={ref}>
                <button className="kp-fake" onClick={() => setOpen(true)}>Take a note…</button>
                <button className="icon-btn" onClick={() => { setDraft(toList(blank())); setOpen(true) }} title="New list" aria-label="New list">☑</button>
            </div>
        )
    }
    return (
        <div className="kp-compose open card kp-card" data-c={draft.color} style={cardStyle(draft.color)} ref={ref}>
            <NoteEditor note={draft} onChange={setDraft} autoFocus />
            {draft.labels.length > 0 && <div className="kp-labels">{draft.labels.map(l => <span key={l} className="kp-chip">{l}</span>)}</div>}
            <div className="kp-foot">
                <Toolbar note={draft} onChange={change} labels={labels}
                    onToggleList={() => setDraft(draft.items ? toText(draft) : toList(draft))} />
                <button className="btn sm ghost" onClick={finish}>Close</button>
            </div>
        </div>
    )
}

/* ---------- a note in the grid ---------- */
function NoteCard({ note, labels, onOpen, onChange, onNewLabel, actions }) {
    const open = note.items ? note.items.filter(i => !i.done) : []
    const done = note.items ? note.items.filter(i => i.done) : []
    return (
        <article className="kp-card card" data-c={note.color} style={cardStyle(note.color)}>
            <div className="kp-hit" onClick={onOpen} role="button" tabIndex={0} aria-label={`Open note ${note.title || 'without title'}`}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } }}>
                {note.pinned && !note.trashed && <span className="kp-pin" title="Pinned">📌</span>}
                {note.title && <h3>{note.title}</h3>}
                {note.items ? (
                    <div className="kp-list">
                        {open.slice(0, 8).map(i => (
                            <div key={i.id} className="kp-item">
                                <input type="checkbox" checked={false} disabled={!!note.trashed} aria-label={`Mark "${i.t}" as done`} onClick={e => e.stopPropagation()}
                                    onChange={() => { play('check'); onChange({ ...note, items: note.items.map(x => (x.id === i.id ? { ...x, done: true } : x)), edited: Date.now() }) }} />
                                <span>{i.t}</span>
                            </div>
                        ))}
                        {open.length > 8 && <p className="muted small">+ {open.length - 8} more</p>}
                        {done.length > 0 && <p className="muted small">✓ {done.length} completed item{done.length > 1 ? 's' : ''}</p>}
                    </div>
                ) : (
                    note.body && <p className="kp-text">{linkify(note.body)}</p>
                )}
                {isBlank(note) && <p className="muted small">Empty note</p>}
                {note.labels.length > 0 && <div className="kp-labels">{note.labels.map(l => <span key={l} className="kp-chip">{l}</span>)}</div>}
            </div>
            <Toolbar note={note} labels={labels} onChange={(n, nl) => { onChange(n); if (nl) onNewLabel(nl) }} {...actions} />
        </article>
    )
}

function LabelsModal({ labels, setLabels, notes, updateNotes, onClose }) {
    const [name, setName] = useState('')
    const add = e => {
        e.preventDefault()
        const v = name.trim()
        if (v && !labels.includes(v)) setLabels([...labels, v])
        setName('')
    }
    const rename = (old, next) => {
        const v = next.trim()
        if (!v || v === old || labels.includes(v)) return
        setLabels(labels.map(l => (l === old ? v : l)))
        updateNotes(list => { list.forEach(n => { n.labels = n.labels.map(l => (l === old ? v : l)) }) })
    }
    const remove = l => {
        setLabels(labels.filter(x => x !== l))
        updateNotes(list => { list.forEach(n => { n.labels = n.labels.filter(x => x !== l) }) })
    }
    return (
        <div className="modal-back" onMouseDown={e => e.target === e.currentTarget && onClose()}>
            <div className="modal" role="dialog" aria-label="Edit labels">
                <h2>Edit labels</h2>
                <form className="row" onSubmit={add} style={{ marginBottom: 12 }}>
                    <input value={name} onChange={e => setName(e.target.value)} placeholder="Create a new label" aria-label="New label" />
                    <button className="btn primary" type="submit">Add</button>
                </form>
                {labels.map(l => (
                    <div key={l} className="row" style={{ marginBottom: 6 }}>
                        <input defaultValue={l} aria-label={`Rename ${l}`} onBlur={e => rename(l, e.target.value)} />
                        <button className="btn sm danger" onClick={() => remove(l)}>Delete</button>
                    </div>
                ))}
                {!labels.length && <p className="muted">No labels yet.</p>}
                <div className="row" style={{ marginTop: 14 }}><span className="grow" /><button className="btn" onClick={onClose}>Done</button></div>
            </div>
        </div>
    )
}

/* ============================================================
   Page
   ============================================================ */
export default function Notes() {
    const [notes, , updateNotes] = useStore('notes', seedNotes)
    const [labels, setLabels] = useStore('labels', ['Study', 'Ideas'])
    const [view, setView] = useState('notes')
    const [query, setQuery] = useState('')
    const [layout, setLayout] = useState('grid')
    const [editId, setEditId] = useState(null)
    const [showLabels, setShowLabels] = useState(false)

    // Empty the trash after 7 days
    useEffect(() => {
        const limit = Date.now() - TRASH_DAYS * 86400000
        if (notes.some(n => n.trashed && n.trashed < limit)) updateNotes(list => list.filter(n => !(n.trashed && n.trashed < limit)))
    }, []) // eslint-disable-line react-hooks/exhaustive-deps

    const save = n => updateNotes(list => {
        const i = list.findIndex(x => x.id === n.id)
        if (i >= 0) list[i] = n
        else list.unshift(n)
    })
    const addLabel = l => { if (!labels.includes(l)) setLabels([...labels, l]) }
    const trash = n => {
        save({ ...n, trashed: Date.now(), pinned: false })
        notify({ title: 'Note moved to trash', body: 'Open Trash to restore it.', icon: '🗑️' })
    }
    const duplicate = n => save({ ...n, id: uid(), title: n.title ? n.title + ' (copy)' : '', pinned: false, created: Date.now(), edited: Date.now(), items: n.items ? n.items.map(i => ({ ...i, id: uid() })) : null })
    const forever = id => updateNotes(list => list.filter(n => n.id !== id))

    const q = query.trim().toLowerCase()
    const matches = n => !q || [n.title, n.body, ...(n.items || []).map(i => i.t), ...n.labels].join(' ').toLowerCase().includes(q)
    const inView = n => {
        if (view === 'trash') return !!n.trashed
        if (n.trashed) return false
        if (q) return true
        if (view === 'archive') return n.archived
        if (n.archived) return false
        if (view.startsWith('label:')) return n.labels.includes(view.slice(6))
        return true
    }
    const shown = useMemo(() => notes.filter(n => inView(n) && matches(n)), [notes, view, query]) // eslint-disable-line react-hooks/exhaustive-deps
    const pinned = shown.filter(n => n.pinned)
    const others = shown.filter(n => !n.pinned)
    const counts = { archive: notes.filter(n => n.archived && !n.trashed).length, trash: notes.filter(n => n.trashed).length }
    const editing = editId && notes.find(n => n.id === editId)

    const closeEditor = () => {
        if (editing && isBlank(editing)) forever(editing.id)
        setEditId(null)
    }
    useEffect(() => {
        if (!editId) return
        const onKey = e => { if (e.key === 'Escape') closeEditor() }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    })

    const cardFor = n => (
        <NoteCard key={n.id} note={n} labels={labels} onOpen={() => !n.trashed && setEditId(n.id)} onChange={save} onNewLabel={addLabel}
            actions={n.trashed ? { onRestore: () => save({ ...n, trashed: null }), onDeleteForever: () => forever(n.id) }
                : { onArchive: () => save({ ...n, archived: !n.archived, pinned: false }), onTrash: () => trash(n), onDuplicate: () => duplicate(n) }} />
    )

    const title = view === 'notes' ? 'Notes' : view === 'archive' ? 'Archive' : view === 'trash' ? 'Trash' : view.slice(6)
    const nav = (id, icon, label, count) => (
        <button key={id} className={view === id ? 'on' : ''} onClick={() => { setView(id); setQuery('') }}>
            <span aria-hidden="true">{icon}</span> <span className="grow">{label}</span>{count > 0 && <small>{count}</small>}
        </button>
    )

    return (
        <div className="kp">
            <style>{CSS}</style>
            <aside className="kp-side" aria-label="Notes navigation">
                {nav('notes', '🗒️', 'Notes')}
                {labels.map(l => nav('label:' + l, '🏷️', l, notes.filter(n => n.labels.includes(l) && !n.trashed && !n.archived).length))}
                <button onClick={() => setShowLabels(true)}><span aria-hidden="true">✎</span> Edit labels</button>
                {nav('archive', '🗄️', 'Archive', counts.archive)}
                {nav('trash', '🗑️', 'Trash', counts.trash)}
            </aside>

            <div className="kp-main">
                <div className="kp-top">
                    <h1>{title}</h1>
                    <input className="kp-search" type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search all notes" aria-label="Search notes" />
                    <div className="seg">
                        <button className={'btn sm' + (layout === 'grid' ? ' on' : '')} onClick={() => setLayout('grid')}>Grid</button>
                        <button className={'btn sm' + (layout === 'list' ? ' on' : '')} onClick={() => setLayout('list')}>List</button>
                    </div>
                </div>

                {(view === 'notes' || view.startsWith('label:')) && !q && (
                    <Composer labels={labels} onAdd={n => save(view.startsWith('label:') && !n.labels.includes(view.slice(6)) ? { ...n, labels: [...n.labels, view.slice(6)] } : n)} onNewLabel={addLabel} />
                )}
                {view === 'trash' && (
                    <div className="kp-banner">
                        <span>Notes in the trash are deleted after {TRASH_DAYS} days.</span>
                        {counts.trash > 0 && <button className="btn sm danger" onClick={() => updateNotes(list => list.filter(n => !n.trashed))}>Empty trash</button>}
                    </div>
                )}

                {shown.length === 0 && (
                    <p className="kp-empty muted">
                        {q ? 'No notes match your search.' : view === 'trash' ? 'Trash is empty.' : view === 'archive' ? 'Archived notes appear here.' : 'Notes you add appear here. Use the box above to write your first one.'}
                    </p>
                )}
                {pinned.length > 0 && <h2 className="kp-sec">Pinned</h2>}
                {pinned.length > 0 && <div className={'kp-grid ' + layout}>{pinned.map(cardFor)}</div>}
                {pinned.length > 0 && others.length > 0 && <h2 className="kp-sec">Others</h2>}
                {others.length > 0 && <div className={'kp-grid ' + layout}>{others.map(cardFor)}</div>}
            </div>

            {editing && (
                <div className="modal-back" onMouseDown={e => e.target === e.currentTarget && closeEditor()}>
                    <div className="kp-modal card kp-card" data-c={editing.color} style={cardStyle(editing.color)} role="dialog" aria-label="Edit note">
                        <NoteEditor note={editing} onChange={(n) => save(n)} autoFocus />
                        {editing.labels.length > 0 && <div className="kp-labels">{editing.labels.map(l => <span key={l} className="kp-chip">{l}</span>)}</div>}
                        <div className="kp-foot">
                            <Toolbar note={editing} labels={labels} onChange={(n, nl) => { save(n); if (nl) addLabel(nl) }}
                                onToggleList={() => save(editing.items ? toText(editing) : toList(editing))}
                                onArchive={() => { save({ ...editing, archived: !editing.archived, pinned: false }); setEditId(null) }}
                                onTrash={() => { trash(editing); setEditId(null) }} onDuplicate={() => duplicate(editing)} />
                            <span className="muted small grow" style={{ textAlign: 'right' }}>Edited {fmtWhen(editing.edited)}</span>
                            <button className="btn sm ghost" onClick={closeEditor}>Close</button>
                        </div>
                    </div>
                </div>
            )}
            {showLabels && <LabelsModal labels={labels} setLabels={setLabels} notes={notes} updateNotes={updateNotes} onClose={() => setShowLabels(false)} />}
        </div>
    )
}

const CSS = `
.kp{max-width:1400px;margin:auto;padding:24px 20px 90px;display:grid;grid-template-columns:210px minmax(0,1fr);gap:24px;align-items:start}
.kp-side{position:sticky;top:78px;display:grid;gap:2px}
.kp-side button{display:flex;align-items:center;gap:10px;border:0;background:none;padding:9px 14px;border-radius:999px;cursor:pointer;text-align:left;color:var(--tx);font-weight:500}
.kp-side button:hover{background:var(--sf2)}.kp-side button.on{background:color-mix(in srgb,var(--ac) 16%,transparent);color:var(--ac)}
.kp-side small{color:var(--mu);font-weight:600}
.kp-main{min-width:0;display:grid;gap:18px}
.kp-top{display:flex;gap:14px;align-items:center;flex-wrap:wrap}.kp-top h1{font-size:30px;margin-right:auto}
.kp-search{max-width:280px}
.kp-compose{max-width:620px;width:100%;margin:0 auto;padding:6px 10px;display:flex;align-items:center;gap:6px}
.kp-fake{flex:1;text-align:left;border:0;background:none;padding:10px 6px;color:var(--mu);cursor:text;font-size:15px}
.kp-compose.open{display:block;padding:12px 14px}
.kp-card{background:var(--sf);border:1px solid var(--ln);transition:box-shadow .15s,border-color .15s}
.kp-card[data-c]:not([data-c=default]){--s:75%;background:color-mix(in srgb,hsl(var(--h) var(--s) 55%) 20%,var(--sf));border-color:color-mix(in srgb,hsl(var(--h) var(--s) 55%) 38%,var(--ln))}
.kp-card[data-c=gray]{--s:10%}
.kp-editor{display:grid;gap:4px}
.kp-title{border:0!important;background:none!important;font:700 18px var(--head)!important;padding:6px 4px!important}
.kp-body{border:0!important;background:none!important;resize:none;padding:6px 4px!important;min-height:60px;line-height:1.5;outline:none;overflow:hidden}
.kp-title:focus,.kp-itext:focus{outline:none}
.kp-item{display:flex;align-items:center;gap:8px;padding:2px 0}.kp-item input[type=checkbox]{flex:none}
.kp-itext{border:0!important;background:none!important;padding:4px!important;flex:1}
.kp-item.done .kp-itext,.kp-item.done{text-decoration:line-through;color:var(--mu)}
.kp-additem{border:0;background:none;color:var(--mu);cursor:pointer;padding:4px 2px;font:inherit}.kp-additem:hover{color:var(--tx)}
.kp-doneh{margin:8px 0 2px}
.kp-foot{display:flex;gap:6px;align-items:center;margin-top:8px;flex-wrap:wrap}
.kp-tools{display:flex;gap:0;align-items:center;flex-wrap:wrap}
.kp-tools .icon-btn{font-size:15px}.kp-tools .icon-btn.on{background:color-mix(in srgb,var(--ac) 18%,transparent)}
.kp-labels{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
.kp-chip{font-size:12px;padding:1px 9px;border-radius:999px;background:color-mix(in srgb,var(--tx) 9%,transparent)}
.kp-sec{font:600 13px var(--body);color:var(--mu);margin:6px 0 -6px}
.kp-grid{columns:250px;column-gap:14px}
.kp-grid.list{columns:1;max-width:640px;margin:0 auto;width:100%}
.kp-grid .kp-card{break-inside:avoid;margin-bottom:14px;padding:14px 14px 6px;position:relative;box-shadow:none}
.kp-grid .kp-card:hover,.kp-grid .kp-card:focus-within{box-shadow:var(--shadow)}
.kp-hit{cursor:pointer;display:block;outline-offset:4px;border-radius:8px}
.kp-hit h3{font-size:17px;margin-bottom:6px;padding-right:22px;word-break:break-word}
.kp-pin{position:absolute;top:10px;right:12px;font-size:14px}
.kp-text{margin:0;white-space:pre-wrap;word-break:break-word;display:-webkit-box;-webkit-line-clamp:12;-webkit-box-orient:vertical;overflow:hidden}
.kp-text a{color:var(--ac)}
.kp-list p{margin:2px 0}
.kp-grid .kp-tools{opacity:0;transition:opacity .15s;margin:6px -6px 0}
.kp-grid .kp-card:hover .kp-tools,.kp-grid .kp-card:focus-within .kp-tools{opacity:1}
@media(hover:none){.kp-grid .kp-tools{opacity:1}}
.kp-banner{display:flex;gap:12px;align-items:center;justify-content:center;color:var(--mu);background:var(--sf2);border-radius:10px;padding:10px}
.kp-empty{text-align:center;padding:60px 0}
.kp-modal{width:min(620px,100%);max-height:calc(100vh - 40px);overflow:auto;padding:16px 18px;border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,.4);animation:rise .2s}
.kp-back{position:fixed;inset:0;z-index:90}
.kp-pop{position:fixed;z-index:95;background:var(--sf);border:1px solid var(--ln);border-radius:10px;box-shadow:0 12px 40px rgba(0,0,0,.3);padding:6px;animation:rise .12s}
.kp-pad{padding:6px}
.kp-pop .kp-item{padding:6px 8px;border-radius:6px;cursor:pointer}.kp-pop .kp-item:hover{background:var(--sf2)}
.kp-swatches{display:grid;grid-template-columns:repeat(5,1fr);gap:6px;padding:4px}
.kp-sw{width:30px;height:30px;border-radius:50%;border:2px solid var(--ln);cursor:pointer;font-weight:700;color:var(--tx);background:var(--sf);display:grid;place-items:center}
.kp-sw[data-c]:not([data-c=default]){--s:75%;background:color-mix(in srgb,hsl(var(--h) var(--s) 55%) 55%,var(--sf))}.kp-sw[data-c=gray]{--s:10%}
.kp-sw.on{border-color:var(--ac)}
@media(max-width:860px){.kp{grid-template-columns:1fr}.kp-side{position:static;display:flex;overflow-x:auto;gap:4px;padding-bottom:4px}.kp-side button{white-space:nowrap}}
`
