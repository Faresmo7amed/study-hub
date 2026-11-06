import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { addTodoToday, clamp, getStore, notify, setStore, uid, useStore } from './shared'
import { play } from './sound'
import BlockEditor, { blocksText, blocksToMarkdown, mdToBlocks, newBlock, ops } from './BlockEditor'

/* ============================================================
   Notes, in the spirit of Google Keep
   - text notes and checklists, colours, labels, pinning
   - archive and trash (trash empties itself after 7 days)
   - search, grid / list layout
   ============================================================ */

const COLORS = { default: null, red: 4, orange: 28, yellow: 48, green: 140, teal: 175, blue: 210, purple: 265, pink: 330, gray: 220 }
const COLOR_KEYS = Object.keys(COLORS)
const TRASH_DAYS = 7

/* A note is a title plus "blocks" (see BlockEditor.jsx): text, headings, bullets, numbers, checkboxes, toggles, code,
   nested as deep as you like and mixed freely. Older notes (a text body or a checklist) are converted on first load. */
const flat = list => (list || []).flatMap(b => [b, ...flat(b.kids)])
const reid = list => list.map(b => ({ ...b, id: uid(), ...(b.kids ? { kids: reid(b.kids) } : {}) }))
const blank = () => ({
    id: uid(), title: '', blocks: [newBlock('p')], color: 'default', pinned: false, archived: false,
    trashed: null, labels: [], created: Date.now(), edited: Date.now(),
})
// What it does: converts an old note (body text or checklist items) into blocks. Notes that already have blocks pass through.
// When to use it: on anything that may come from older data, a template or an import.
const normalize = n => {
    if (Array.isArray(n.blocks)) return n
    const { body, items, ...rest } = n
    const blocks = items ? items.map(i => ({ ...newBlock('todo', i.t), done: !!i.done, ...(i.sent ? { sent: true } : {}) })) : mdToBlocks(body || '')
    return { ...rest, blocks: blocks.length ? blocks : [newBlock('p')] }
}
const blocksOf = n => normalize(n).blocks
const isBlank = n => !n.title.trim() && !blocksText(blocksOf(n)).trim()
const openTodos = n => flat(blocksOf(n)).filter(b => b.type === 'todo' && !b.done && !b.sent && (b.text || '').trim())
const cardStyle = c => (COLORS[c] != null ? { '--h': COLORS[c] } : undefined)

const rawSeed = () => {
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
const seedNotes = () => rawSeed().map(normalize)

/* ---------- review reminders, templates, markdown ---------- */
const REVIEW_STEPS = [1, 3, 7, 14, 30] // days until the next review, growing each time (spaced repetition)
const reviewDue = n => Boolean(n.review && n.review.due <= Date.now())
const reviewIn = (days, step) => ({ due: Date.now() + days * 86400000, step, notified: false })
const fmtDue = ts => {
    const d = Math.ceil((ts - Date.now()) / 86400000)
    return d <= 0 ? 'due now' : d === 1 ? 'tomorrow' : `in ${d} days`
}

const TEMPLATES = [
    { name: 'Daily study log', icon: '📓', make: () => ({ title: 'Study log · ' + new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), body: 'Goal today:\n\nWhat I studied:\n\nWhat I understood:\n\nWhat is still unclear:\n\nTomorrow:\n' }) },
    { name: 'Cornell notes', icon: '🧾', make: () => ({ title: 'Topic', body: 'Questions / cues:\n- \n\nNotes:\n\n\nSummary in two sentences:\n' }) },
    { name: 'Bug write-up', icon: '🐞', make: () => ({ title: 'Bug: ', body: 'Expected:\n\nActual:\n\nSteps to reproduce:\n1. \n\nHypothesis:\n\nRoot cause:\n\nFix:\n\nHow to spot it next time:\n' }) },
    { name: 'Revision checklist', icon: '✅', make: () => ({ title: 'Revision checklist', items: ['Skim the headings', 'Write the key points from memory', 'Do five practice questions', 'Fix what I got wrong', 'Explain it out loud'].map(t => ({ id: uid(), t, done: false })) }) },
]

const mdOf = n => {
    const lines = [`# ${n.title || 'Untitled note'}`]
    if (n.labels.length) lines.push(`Labels: ${n.labels.join(', ')}`)
    lines.push('')
    lines.push(blocksToMarkdown(blocksOf(n)))
    return lines.join('\n')
}
const download = (name, text) => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }))
    a.download = name
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
// Notes are separated by a line of "---". Without separators, every "# Heading" starts a new note.
const parseMd = (text, fallback) => {
    let blocks = text.replace(/\r/g, '').split(/\n-{3,}[ \t]*(?:\n|$)/).map(b => b.trim()).filter(Boolean)
    if (blocks.length === 1 && (blocks[0].match(/^# /gm) || []).length > 1) blocks = blocks[0].split(/^(?=# )/m).map(b => b.trim()).filter(Boolean)
    return blocks.map(b => {
        const lines = b.split('\n')
        let title = fallback
        if (/^# /.test(lines[0])) title = lines.shift().slice(2).trim()
        let labels = []
        const li = lines.findIndex(l => /^labels:/i.test(l.trim()))
        if (li >= 0 && li < 2) labels = lines.splice(li, 1)[0].replace(/^\s*labels:/i, '').split(',').map(x => x.trim()).filter(Boolean)
        const body = lines.join('\n').trim()
        const blocks = mdToBlocks(body)
        return { ...blank(), title, labels, blocks: blocks.length ? blocks : [newBlock('p')] }
    })
}

// A note can point at a topic of a roadmap. These read the roadmaps on demand, so Notes does not depend on the Roadmap page.
const roadmapsNow = () => getStore('roadmaps', { order: [], maps: {} }) || { order: [], maps: {} }
// Every topic and subtopic (at any level) of a roadmap as { id, label } for a picker; deeper levels get more arrows
const topicOptions = (list, depth = 0) => (list || []).flatMap(t => [{ id: t.id, label: '↳ '.repeat(depth) + (t.title || 'Untitled') }, ...topicOptions(t.subs, depth + 1)])
const topicTitle = link => {
    const m = link && roadmapsNow().maps[link.map]
    if (!m) return ''
    // Subtopics can have subtopics, so look through every level
    const find = list => {
        for (const t of list || []) {
            if (t.id === link.topic) return t
            const inner = find(t.subs)
            if (inner) return inner
        }
        return null
    }
    const hit = find(m.topics)
    return hit ? hit.title || 'Untitled' : ''
}
const openLinked = link => {
    setStore('roadmaps', cur => (cur && cur.maps && cur.maps[link.map] ? { ...cur, active: link.map } : cur), { order: [], maps: {} })
    window.location.hash = '/roadmap'
}

const URL_RE = /(https?:\/\/[^\s]+)/g
const linkify = text => text.split(URL_RE).map((part, i) => (i % 2 ? <a key={i} href={part} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>{part}</a> : part))
// Date.now() behind a helper: it is only ever called from event handlers, never while rendering
const stamp = () => Date.now()
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

/* ---------- the actions row used by cards, the composer and the editor ---------- */
function Toolbar({ note, onChange, labels, onArchive, onTrash, onDuplicate, onRestore, onDeleteForever, onSendTodos, onExport }) {
    const [pop, setPop] = useState(null)
    const [linkMap, setLinkMap] = useState((note.link && note.link.map) || '')
    const open = kind => e => setPop({ kind, anchor: e.currentTarget })
    const close = () => setPop(null)
    const toggleLabel = l => {
        play('tick')
        onChange({ ...note, labels: note.labels.includes(l) ? note.labels.filter(x => x !== l) : [...note.labels, l] })
    }
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
            <button className={'icon-btn' + (note.pinned ? ' on' : '')} onClick={() => { play('pin'); onChange({ ...note, pinned: !note.pinned, archived: false }) }} title={note.pinned ? 'Unpin' : 'Pin'} aria-pressed={note.pinned} aria-label="Pin">📌</button>
            <button className="icon-btn" onClick={open('color')} title="Colour" aria-label="Change colour">🎨</button>
            <button className="icon-btn" onClick={open('label')} title="Labels" aria-label="Edit labels">🏷️</button>
            <button className={'icon-btn' + (note.link ? ' on' : '')} onClick={open('link')} title="Link to a roadmap topic" aria-label="Link to a roadmap topic">🗺️</button>
            <button className={'icon-btn' + (note.review ? ' on' : '')} onClick={open('review')} title="Review reminder" aria-label="Review reminder">🔁</button>
            {onSendTodos && openTodos(note).length > 0 && <button className="icon-btn" onClick={onSendTodos} title="Add open items to today's todos" aria-label="Add open items to today's todos">📅</button>}
            {onExport && <button className="icon-btn" onClick={onExport} title="Export as Markdown" aria-label="Export as Markdown">⬇</button>}
            {onDuplicate && <button className="icon-btn" onClick={onDuplicate} title="Duplicate" aria-label="Duplicate">⧉</button>}
            {onArchive && <button className="icon-btn" onClick={onArchive} title={note.archived ? 'Unarchive' : 'Archive'} aria-label="Archive">🗄️</button>}
            {onTrash && <button className="icon-btn" onClick={onTrash} title="Move to trash" aria-label="Delete">🗑️</button>}
            {pop && pop.kind === 'color' && (
                <Pop anchor={pop.anchor} onClose={close} width={196}>
                    <div className="kp-swatches">
                        {COLOR_KEYS.map(c => (
                            <button key={c} className={'kp-sw' + (note.color === c ? ' on' : '')} data-c={c} style={cardStyle(c)} title={c} aria-label={c}
                                onClick={() => { play('tick'); onChange({ ...note, color: c }); close() }}>{note.color === c ? '✓' : ''}</button>
                        ))}
                    </div>
                </Pop>
            )}
            {pop && pop.kind === 'review' && (
                <Pop anchor={pop.anchor} onClose={close} width={230}>
                    <p className="muted small kp-pad">Remind me to review this note</p>
                    {REVIEW_STEPS.slice(0, 4).map((d, i) => (
                        <button key={d} className="kp-item kp-pick" onClick={() => { play('tick'); onChange({ ...note, review: reviewIn(d, i) }); close() }}>{d === 1 ? 'Tomorrow' : `In ${d} days`}</button>
                    ))}
                    {note.review && <p className="muted small kp-pad">Now: {fmtDue(note.review.due)}</p>}
                    {note.review && <button className="kp-item kp-pick" onClick={() => { onChange({ ...note, review: null }); close() }}>Remove reminder</button>}
                </Pop>
            )}
            {pop && pop.kind === 'link' && (() => {
                const store = roadmapsNow()
                const ids = (store.order || []).filter(id => store.maps[id])
                const mapId = store.maps[linkMap] ? linkMap : ''
                const topics = mapId ? topicOptions(store.maps[mapId].topics) : []
                return (
                    <Pop anchor={pop.anchor} onClose={close} width={260}>
                        <p className="muted small kp-pad">Link to a roadmap topic</p>
                        {!ids.length ? <p className="muted small kp-pad">No roadmaps yet. Open the Roadmap page once, then come back.</p> : (
                            <div className="kp-pad" style={{ display: 'grid', gap: 6 }}>
                                <select value={mapId} onChange={e => setLinkMap(e.target.value)} aria-label="Roadmap">
                                    <option value="">Choose a roadmap</option>
                                    {ids.map(id => <option key={id} value={id}>{store.maps[id].title || 'Untitled roadmap'}</option>)}
                                </select>
                                {mapId && (
                                    <select value={note.link && note.link.map === mapId ? note.link.topic : ''} aria-label="Topic"
                                        onChange={e => { if (e.target.value) { play('tick'); onChange({ ...note, link: { map: mapId, topic: e.target.value } }); close() } }}>
                                        <option value="">Choose a topic</option>
                                        {topics.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
                                    </select>
                                )}
                                {note.link && <button className="btn sm ghost" onClick={() => { onChange({ ...note, link: null }); close() }}>Remove link</button>}
                            </div>
                        )}
                    </Pop>
                )
            })()}
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

/* ---------- title + mixed blocks ---------- */
function NoteEditor({ note, onChange, autoFocus }) {
    const patch = p => onChange({ ...note, ...p, edited: Date.now() })
    return (
        <div className="kp-editor">
            <input className="kp-title" placeholder="Title" value={note.title} onChange={e => patch({ title: e.target.value })} autoFocus={autoFocus} aria-label="Title" />
            <BlockEditor label="Note content" value={blocksOf(note)} onChange={blocks => patch({ blocks })} />
        </div>
    )
}

/* ---------- composer ---------- */
function Composer({ labels, onAdd, onNewLabel }) {
    const [open, setOpen] = useState(false)
    const [draft, setDraft] = useState(blank)
    const [tpl, setTpl] = useState(null)
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
                <button className="icon-btn" onClick={() => { setDraft({ ...blank(), blocks: [newBlock('todo')] }); setOpen(true) }} title="New checklist" aria-label="New list">☑</button>
                <button className="icon-btn" onClick={e => setTpl(e.currentTarget)} title="New note from a template" aria-label="New note from a template">▤</button>
                {tpl && (
                    <Pop anchor={tpl} onClose={() => setTpl(null)} width={220}>
                        <p className="muted small kp-pad">Start from a template</p>
                        {TEMPLATES.map(t => (
                            <button key={t.name} className="kp-item kp-pick" onClick={() => { setDraft(normalize({ ...blank(), blocks: undefined, ...t.make() })); setTpl(null); setOpen(true) }}>{t.icon} {t.name}</button>
                        ))}
                    </Pop>
                )}
            </div>
        )
    }
    return (
        <div className="kp-compose open card kp-card" data-c={draft.color} style={cardStyle(draft.color)} ref={ref}>
            <NoteEditor note={draft} onChange={setDraft} autoFocus />
            {draft.labels.length > 0 && <div className="kp-labels">{draft.labels.map(l => <span key={l} className="kp-chip">{l}</span>)}</div>}
            <div className="kp-foot">
                <Toolbar note={draft} onChange={change} labels={labels} />
                <button className="btn sm ghost" onClick={finish}>Close</button>
            </div>
        </div>
    )
}

/* ---------- a note in the grid ---------- */
/* A small, read-only picture of the blocks for the card. Checkboxes work right on the card. */
const PREVIEW_ROWS = 16
// What it does: flattens the blocks depth-first into at most PREVIEW_ROWS rows, remembering each row's depth and list number.
// When to use it: to draw the small read-only picture of a note on a card.
const previewRows = (list, depth = 0, out = []) => {
    let n = 0
    for (const b of list) {
        if (out.length >= PREVIEW_ROWS) break
        n = b.type === 'number' ? n + 1 : 0
        out.push({ b, depth, n })
        if (b.kids && b.kids.length) previewRows(b.kids, depth + 1, out)
    }
    return out
}

function Preview({ note, onToggle, disabled }) {
    const blocks = blocksOf(note)
    const total = flat(blocks).length
    return (
        <div className="kp-list">
            {previewRows(blocks).map(({ b, depth, n }) => (
                <div key={b.id} className={'kp-b t-' + b.type + (b.done ? ' done' : '')} style={{ paddingLeft: depth * 16 }}>
                    {b.type === 'todo' && <input type="checkbox" checked={!!b.done} disabled={disabled} aria-label={`Mark "${b.text}" as done`} onClick={e => e.stopPropagation()} onChange={e => onToggle(b.id, e.target.checked)} />}
                    {b.type === 'bullet' && <span className="kp-mk">•</span>}
                    {b.type === 'number' && <span className="kp-mk">{n}.</span>}
                    {b.type === 'toggle' && <span className="kp-mk">▸</span>}
                    {b.type === 'divider' ? <hr /> : b.type === 'code' ? <pre>{b.text}</pre> : <span className="kp-bt">{linkify(b.text || '')}</span>}
                </div>
            ))}
            {total > PREVIEW_ROWS && <p className="muted small">+ {total - PREVIEW_ROWS} more</p>}
        </div>
    )
}

function NoteCard({ note, labels, onOpen, onChange, onNewLabel, actions, dnd }) {
    return (
        <article className={'kp-card card' + (dnd && dnd.over ? ' drop-' + dnd.over : '') + (dnd && dnd.dragging ? ' dragging' : '')} data-c={note.color} style={cardStyle(note.color)}
            draggable={!!dnd} onDragStart={dnd && dnd.start} onDragOver={dnd && dnd.hover} onDragLeave={dnd && dnd.leave} onDrop={dnd && dnd.drop} onDragEnd={dnd && dnd.end}>
            <div className="kp-hit" onClick={onOpen} role="button" tabIndex={0} aria-label={`Open note ${note.title || 'without title'}`}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } }}>
                {note.pinned && !note.trashed && <span className="kp-pin" title="Pinned">📌</span>}
                {note.title && <h3>{note.title}</h3>}
                <Preview note={note} disabled={!!note.trashed} onToggle={(id, v) => { const bl = structuredClone(blocksOf(note)); ops.setDone(bl, id, v); play(v ? 'check' : 'uncheck'); onChange({ ...note, blocks: bl, edited: Date.now() }) }} />
                {isBlank(note) && <p className="muted small">Empty note</p>}
                {note.labels.length > 0 && <div className="kp-labels">{note.labels.map(l => <span key={l} className="kp-chip">{l}</span>)}</div>}
                {(note.link || note.review) && !note.trashed && (
                    <div className="kp-labels">
                        {note.link && topicTitle(note.link) && <button className="kp-chip kp-linkchip" onClick={e => { e.stopPropagation(); openLinked(note.link) }} title="Open this roadmap">🗺️ {topicTitle(note.link)}</button>}
                        {note.review && (reviewDue(note) ? (
                            <button className="kp-chip kp-due" title="Mark as reviewed and schedule the next review"
                                onClick={e => {
                                    e.stopPropagation()
                                    const step = Math.min((note.review.step || 0) + 1, REVIEW_STEPS.length - 1)
                                    play('check')
                                    onChange({ ...note, review: reviewIn(REVIEW_STEPS[step], step) })
                                }}>🔁 Review due · mark reviewed ✓</button>
                        ) : <span className="kp-chip">🔁 {fmtDue(note.review.due)}</span>)}
                    </div>
                )}
            </div>
            <Toolbar note={note} labels={labels} onChange={(n, nl) => { onChange(n); if (nl) onNewLabel(nl) }} {...actions} />
        </article>
    )
}

function LabelsModal({ labels, setLabels, updateNotes, onClose }) {
    const [name, setName] = useState('')
    const add = e => {
        e.preventDefault()
        const v = name.trim()
        if (v && !labels.includes(v)) {
            setLabels([...labels, v])
            play('add')
        }
        setName('')
    }
    const rename = (old, next) => {
        const v = next.trim()
        if (!v || v === old || labels.includes(v)) return
        setLabels(labels.map(l => (l === old ? v : l)))
        updateNotes(list => { list.forEach(n => { n.labels = n.labels.map(l => (l === old ? v : l)) }) })
    }
    const remove = l => {
        play('delete')
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
    // A roadmap topic can open a note (see openNote in shared.js): its id is waiting in window.__openNoteId when this page mounts
    const [editId, setEditId] = useState(() => window.__openNoteId || null)
    const [showLabels, setShowLabels] = useState(false)
    const fileRef = useRef(null)

    // The id was read above when the page mounted. Clear it so it only opens once.
    useEffect(() => { window.__openNoteId = null }, [])

    // Convert notes written in the old format (text body or checklist) to blocks, once
    useEffect(() => {
        if (notes.some(n => !Array.isArray(n.blocks))) updateNotes(list => { list.forEach((n, i) => { if (!Array.isArray(n.blocks)) list[i] = normalize(n) }) })
    }, [notes]) // eslint-disable-line react-hooks/exhaustive-deps

    // Drag and drop like Google Keep: drop a card on another one to put it before or after it
    const dragId = useRef(null)
    const [dragging, setDragging] = useState(null)
    const [over, setOver] = useState(null) // { id, side: 'before' | 'after' }
    const moveNote = (fromId, toId, after) => updateNotes(list => {
        const from = list.findIndex(n => n.id === fromId)
        if (from < 0 || fromId === toId) return
        const [n] = list.splice(from, 1)
        const to = list.findIndex(x => x.id === toId)
        if (to < 0) { list.splice(from, 0, n); return }
        n.pinned = !!list[to].pinned // dropping into the pinned group pins it, like Keep
        list.splice(to + (after ? 1 : 0), 0, n)
    })
    const dndFor = n => ({
        dragging: dragging === n.id,
        over: over && over.id === n.id ? over.side : '',
        start: e => { dragId.current = n.id; setDragging(n.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', n.id) },
        hover: e => {
            if (!dragId.current || dragId.current === n.id) return
            e.preventDefault()
            const r = e.currentTarget.getBoundingClientRect()
            // Cards run down each column (like Google Keep): top half = before this card, bottom half = after it
            const after = e.clientY > r.top + r.height / 2
            const side = after ? 'after' : 'before'
            setOver(cur => (cur && cur.id === n.id && cur.side === side ? cur : { id: n.id, side }))
        },
        leave: e => { if (!e.currentTarget.contains(e.relatedTarget)) setOver(cur => (cur && cur.id === n.id ? null : cur)) },
        drop: e => {
            e.preventDefault()
            if (dragId.current) { moveNote(dragId.current, n.id, over && over.id === n.id && over.side === 'after'); play('tick') }
            dragId.current = null; setDragging(null); setOver(null)
        },
        end: () => { dragId.current = null; setDragging(null); setOver(null) },
    })

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
        save({ ...n, trashed: stamp(), pinned: false })
        play('delete')
        notify({
            title: 'Note moved to trash',
            body: n.title || 'Untitled note',
            icon: '🗑️',
            actions: [{ label: 'Undo', onClick: () => { save({ ...n, trashed: null }); play('undo') } }],
        })
    }
    const archive = n => {
        const archiving = !n.archived
        save({ ...n, archived: archiving, pinned: false })
        play('archive')
        if (archiving) {
            notify({
                title: 'Note archived',
                body: n.title || 'Untitled note',
                icon: '🗄️',
                actions: [{ label: 'Undo', onClick: () => { save(n); play('undo') } }],
            })
        }
    }
    const duplicate = n => {
        play('add')
        save({ ...n, id: uid(), title: n.title ? n.title + ' (copy)' : '', pinned: false, created: stamp(), edited: stamp(), blocks: reid(structuredClone(blocksOf(n))) })
    }
    const forever = id => updateNotes(list => list.filter(n => n.id !== id))
    // Turn the open items of a checklist into todos for today (each item is sent once)
    const sendToday = n => {
        const open = openTodos(n)
        if (!open.length) return
        open.forEach(b => addTodoToday({ text: b.text.trim(), type: 'task' }))
        const ids = new Set(open.map(b => b.id))
        const bl = structuredClone(blocksOf(n))
        flat(bl).forEach(b => { if (ids.has(b.id)) b.sent = true })
        save({ ...n, blocks: bl, edited: stamp() })
        play('add')
        notify({ title: `Added ${open.length} todo${open.length > 1 ? 's' : ''} to today`, body: n.title || 'From your note', icon: '📅' })
    }
    const exportNotes = list => {
        if (!list.length) return notify({ title: 'Nothing to export', body: 'There are no notes in this view.', icon: 'ℹ️' })
        download(list.length === 1 ? (list[0].title || 'note').replace(/[^\w-]+/g, '-').toLowerCase() + '.md' : 'notes.md', list.map(mdOf).join('\n\n---\n\n'))
        notify({ title: `Exported ${list.length} note${list.length > 1 ? 's' : ''}`, body: 'Saved as a Markdown file.', icon: '⬇️' })
    }
    const importFile = e => {
        const file = e.target.files && e.target.files[0]
        e.target.value = ''
        if (!file) return
        file.text().then(text => {
            const made = parseMd(text, file.name.replace(/\.[^.]+$/, ''))
            if (!made.length) return notify({ title: 'Nothing to import', body: 'The file is empty.', icon: 'ℹ️' })
            made.forEach(n => n.labels.forEach(addLabel))
            updateNotes(list => { list.unshift(...made) })
            play('save')
            notify({ title: `Imported ${made.length} note${made.length > 1 ? 's' : ''}`, body: file.name, icon: '⬆️' })
        })
    }

    const q = query.trim().toLowerCase()
    const matches = n => !q || [n.title, blocksText(blocksOf(n)), ...n.labels].join(' ').toLowerCase().includes(q)
    const inView = n => {
        if (view === 'trash') return !!n.trashed
        if (n.trashed) return false
        if (view === 'review') return reviewDue(n)
        if (q) return true
        if (view === 'archive') return n.archived
        if (n.archived) return false
        if (view.startsWith('label:')) return n.labels.includes(view.slice(6))
        return true
    }
    const shown = useMemo(() => notes.filter(n => inView(n) && matches(n)), [notes, view, query]) // eslint-disable-line react-hooks/exhaustive-deps
    const pinned = shown.filter(n => n.pinned)
    const others = shown.filter(n => !n.pinned)
    const counts = { archive: notes.filter(n => n.archived && !n.trashed).length, trash: notes.filter(n => n.trashed).length, review: notes.filter(n => !n.trashed && reviewDue(n)).length }
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
        <NoteCard key={n.id} note={n} labels={labels} dnd={n.trashed ? undefined : dndFor(n)} onOpen={() => !n.trashed && setEditId(n.id)} onChange={save} onNewLabel={addLabel}
            actions={n.trashed ? { onRestore: () => { save({ ...n, trashed: null }); play('undo') }, onDeleteForever: () => { forever(n.id); play('delete') } }
                : { onArchive: () => archive(n), onTrash: () => trash(n), onDuplicate: () => duplicate(n), onSendTodos: () => sendToday(n) }} />
    )

    const title = view === 'notes' ? 'Notes' : view === 'review' ? 'Due for review' : view === 'archive' ? 'Archive' : view === 'trash' ? 'Trash' : view.slice(6)
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
                {nav('review', '🔁', 'Due for review', counts.review)}
                {nav('archive', '🗄️', 'Archive', counts.archive)}
                {nav('trash', '🗑️', 'Trash', counts.trash)}
            </aside>

            <div className="kp-main">
                <div className="kp-top">
                    <h1>{title}</h1>
                    <input className="kp-search" type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search all notes" aria-label="Search notes" />
                    <button className="btn sm" onClick={() => exportNotes(shown)} title="Export the notes in this view as Markdown">Export</button>
                    <button className="btn sm" onClick={() => fileRef.current && fileRef.current.click()} title="Import notes from a Markdown file">Import</button>
                    <input ref={fileRef} type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" hidden onChange={importFile} />
                    <div className="seg">
                        <button className={'btn sm' + (layout === 'grid' ? ' on' : '')} onClick={() => setLayout('grid')}>Grid</button>
                        <button className={'btn sm' + (layout === 'list' ? ' on' : '')} onClick={() => setLayout('list')}>List</button>
                    </div>
                </div>

                {(view === 'notes' || view.startsWith('label:')) && !q && (
                    <Composer labels={labels} onAdd={n => { play('save'); save(view.startsWith('label:') && !n.labels.includes(view.slice(6)) ? { ...n, labels: [...n.labels, view.slice(6)] } : n) }} onNewLabel={addLabel} />
                )}
                {view === 'trash' && (
                    <div className="kp-banner">
                        <span>Notes in the trash are deleted after {TRASH_DAYS} days.</span>
                        {counts.trash > 0 && <button className="btn sm danger" onClick={() => { updateNotes(list => list.filter(n => !n.trashed)); play('delete') }}>Empty trash</button>}
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
                        {(editing.link || editing.review) && <div className="kp-labels">{editing.link && topicTitle(editing.link) && <button className="kp-chip kp-linkchip" onClick={() => openLinked(editing.link)}>🗺️ {topicTitle(editing.link)}</button>}{editing.review && <span className={'kp-chip' + (reviewDue(editing) ? ' kp-due' : '')}>🔁 Review {fmtDue(editing.review.due)}</span>}</div>}
                        <div className="kp-foot">
                            <Toolbar note={editing} labels={labels} onChange={(n, nl) => { save(n); if (nl) addLabel(nl) }}
                                onArchive={() => { archive(editing); setEditId(null) }}
                                onTrash={() => { trash(editing); setEditId(null) }} onDuplicate={() => duplicate(editing)}
                                onSendTodos={() => sendToday(editing)} onExport={() => exportNotes([editing])} />
                            <span className="muted small grow" style={{ textAlign: 'right' }}>Edited {fmtWhen(editing.edited)}</span>
                            <button className="btn sm ghost" onClick={closeEditor}>Close</button>
                        </div>
                    </div>
                </div>
            )}
            {showLabels && <LabelsModal labels={labels} setLabels={setLabels} updateNotes={updateNotes} onClose={() => setShowLabels(false)} />}
        </div>
    )
}

const CSS = `
.kp-pick{width:100%;text-align:left;background:none;border:0;color:inherit;cursor:pointer;font:inherit;padding:7px 12px}.kp-pick:hover{background:var(--sf2)}
.kp-linkchip,.kp-due{cursor:pointer;font:inherit}.kp-due{border-color:var(--ac);color:var(--ac);font-weight:600}
.kp{max-width:1600px;margin:auto;padding:24px 20px 90px;display:grid;grid-template-columns:210px minmax(0,1fr);gap:24px;align-items:start}
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
/* Keep-style masonry: CSS columns pack cards of different heights with no empty gaps. The order runs down each column. */
.kp-grid{column-width:250px;column-gap:14px}
.kp-grid.list{display:grid;grid-template-columns:1fr;gap:14px;align-items:start;max-width:640px;margin:0 auto;width:100%}
.kp-grid .kp-card{margin:0 0 14px;padding:14px 14px 6px;position:relative;box-shadow:none;break-inside:avoid}
.kp-grid.list .kp-card{margin:0}
.kp-grid .kp-card:hover,.kp-grid .kp-card:focus-within{box-shadow:var(--shadow)}
.kp-hit{cursor:pointer;display:block;outline-offset:4px;border-radius:8px}
.kp-hit h3{font-size:17px;margin-bottom:6px;padding-right:22px;word-break:break-word}
.kp-pin{position:absolute;top:10px;right:12px;font-size:14px}
.kp-text{margin:0;white-space:pre-wrap;word-break:break-word;display:-webkit-box;-webkit-line-clamp:12;-webkit-box-orient:vertical;overflow:hidden}
.kp-text a{color:var(--ac)}
.kp-list p{margin:2px 0}
.kp-b{display:flex;gap:7px;align-items:flex-start;padding:1px 0;word-break:break-word;line-height:1.45}
.kp-b input{margin-top:4px;flex:none}.kp-mk{flex:none;min-width:14px;color:var(--mu);font-weight:700}
.kp-b.done .kp-bt{text-decoration:line-through;color:var(--mu)}
.kp-b[class*=" t-h"]{font-weight:700;margin-top:4px}.kp-b.t-h1{font-size:18px}.kp-b.t-h2{font-size:16.5px}.kp-b.t-h3,.kp-b.t-h4,.kp-b.t-h5,.kp-b.t-h6{font-size:15px}
.kp-b pre{margin:0;font:12px/1.4 ui-monospace,Menlo,monospace;background:var(--bg);border:1px solid var(--ln);border-radius:6px;padding:4px 6px;white-space:pre-wrap;flex:1;min-width:0}
.kp-b hr{flex:1;border:0;border-top:1px solid var(--ln)}
.kp-grid .kp-card.drop-before{box-shadow:0 -4px 0 var(--ac)}.kp-grid .kp-card.drop-after{box-shadow:0 4px 0 var(--ac)}
.kp-card.dragging{opacity:.45}.kp-grid .kp-card[draggable=true]{cursor:grab}
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
