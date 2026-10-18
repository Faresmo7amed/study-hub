import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { addTodoToday, confetti, getStore, isStored, notify, uid, useStore } from './shared'
import { play } from './sound'

/* ============================================================
   Roadmap: a vertical, snake-shaped learning path
   - topics are squares, subtopics branch off the side, gates sit under a topic
   - the connector line fills with colour when a topic (and its gate) is done
   - click any square to open its study notes, checklist, resources and projects
   ============================================================ */

const PR = { must: 'Mandatory', rec: 'Recommended', nice: 'Nice to have', opt: 'Optional' }
const STATUS = { todo: 'Not started', doing: 'In progress', done: 'Done' }
const RES_TYPES = ['Docs', 'Video', 'Article', 'Course', 'Book']
const RES_TO_TODO = { Docs: 'article', Video: 'video', Article: 'article', Course: 'course', Book: 'book' }
// Each priority has its own colour (you can change them with the Colours button)
const DEFAULT_COLORS = { must: '#7c6cff', rec: '#3b9dff', nice: '#f5a524', opt: '#2fbfa8' }

/* ---------- data ---------- */
const norm = (t, top = true) => {
    const o = { id: uid(), title: '', desc: '', when: '', status: 'todo', priority: 'rec', notes: '', ref: null, ...t }
    o.steps = (t.steps || []).map(x => ({ id: uid(), t: '', done: false, ...x }))
    o.subs = top ? (t.subs || []).map(x => norm(x, false)) : []
    o.res = (t.res || []).map(x => ({ id: uid(), type: 'Docs', t: '', url: '', ...x }))
    o.proj = (t.proj || []).map(x => ({ id: uid(), t: '', desc: '', done: false, ...x }))
    o.gate = top && t.gate ? { name: '', desc: '', highlight: false, done: false, ...t.gate } : null
    if (!PR[o.priority]) o.priority = 'rec'
    if (!STATUS[o.status]) o.status = 'todo'
    if (typeof o.ref !== 'string' || !o.ref) o.ref = null // id of another roadmap this item points to
    return o
}

const normMap = m => ({ id: m.id || uid(), title: String(m.title == null ? 'Untitled roadmap' : m.title), topics: (m.topics || []).map(t => norm(t)) })

const seedMaps = () => {
    const fullstack = normMap({
        id: 'fullstack',
        title: 'Full-stack developer roadmap',
        topics: [
            {
                title: 'Foundations', desc: 'HTML, CSS, JavaScript, TypeScript and tooling', when: 'Weeks 1–5', priority: 'must', status: 'doing',
                notes: '## Goal\nBuild a responsive, accessible page without a framework.\n- Read the MDN guide, then build\n- Write a short note after each topic',
                steps: [{ t: 'Set up editor, Git and terminal' }, { t: 'Deploy a first page' }],
                res: [{ type: 'Docs', t: 'MDN Web Docs', url: 'https://developer.mozilla.org' }, { type: 'Course', t: 'JavaScript.info', url: 'https://javascript.info' }],
                proj: [{ t: 'Responsive portfolio page' }],
                // This subtopic points at the whole JavaScript roadmap: it is done when that roadmap is finished
                subs: [{ title: 'HTML and CSS', priority: 'must' }, { title: 'JavaScript', priority: 'must', ref: 'javascript', desc: 'Follows the JavaScript roadmap' }, { title: 'TypeScript', priority: 'rec' }, { title: 'Tailwind', priority: 'nice' }],
            },
            {
                title: 'React', desc: 'Components, state, routing, data and testing', when: 'Weeks 6–8', priority: 'must',
                notes: '## Mental model\nUI is a function of state. Ask what changed, why it rendered, and what runs after.',
                res: [{ type: 'Docs', t: 'React documentation', url: 'https://react.dev' }],
                gate: { name: 'Frontend Gate 1', desc: 'Build a feature in 3 h, with tests' },
                subs: [{ title: 'Router', priority: 'rec' }, { title: 'Data fetching', priority: 'must' }, { title: 'Testing', priority: 'rec' }, { title: 'Animation libraries', priority: 'opt' }],
            },
            {
                title: 'Frontend builds', desc: 'Real projects that combine everything so far', when: 'Weeks 9–16', priority: 'rec',
                proj: [{ t: 'Ship three projects to production' }],
                subs: [{ title: 'Storefront', priority: 'must' }, { title: 'Movie browser', priority: 'rec' }, { title: 'Dashboard', priority: 'nice' }],
            },
            {
                title: 'Backend', desc: 'Node, SQL, authentication, tests and Docker', when: 'Weeks 17–30', priority: 'must',
                gate: { name: 'Backend Gate', desc: '8 h API take-home, then start applying', highlight: true },
                subs: [{ title: 'Node and SQL', priority: 'must' }, { title: 'Authentication', priority: 'must' }, { title: 'Docker', priority: 'nice' }],
            },
        ],
    })
    const javascript = normMap({
        id: 'javascript',
        title: 'JavaScript',
        topics: [
            {
                title: 'Language basics', desc: 'The core of the language', priority: 'must',
                res: [{ type: 'Course', t: 'JavaScript.info', url: 'https://javascript.info' }],
                subs: [{ title: 'Types and variables', priority: 'must' }, { title: 'Control flow', priority: 'must' }, { title: 'Functions and scope', priority: 'must' }, { title: 'Objects and arrays', priority: 'must' }, { title: 'Modules', priority: 'rec' }],
            },
            {
                title: 'Asynchronous JavaScript', desc: 'Callbacks, promises and async/await', priority: 'must',
                gate: { name: 'Async Gate', desc: 'Build a small app that fetches and shows data' },
                subs: [{ title: 'Callbacks', priority: 'rec' }, { title: 'Promises', priority: 'must' }, { title: 'async / await', priority: 'must' }, { title: 'fetch and APIs', priority: 'must' }],
            },
            {
                title: 'The browser', desc: 'Talking to the page', priority: 'rec',
                subs: [{ title: 'The DOM', priority: 'must' }, { title: 'Events', priority: 'must' }, { title: 'Storage', priority: 'rec' }, { title: 'Web APIs', priority: 'nice' }],
            },
            {
                title: 'Tooling', desc: 'Make your code easier to ship', priority: 'rec',
                subs: [{ title: 'npm and package managers', priority: 'rec' }, { title: 'Testing', priority: 'rec' }, { title: 'Bundlers', priority: 'nice' }, { title: 'Linting and formatting', priority: 'nice' }],
            },
        ],
    })
    return { order: [fullstack.id, javascript.id], active: fullstack.id, maps: { [fullstack.id]: fullstack, [javascript.id]: javascript } }
}

// Someone who used the app before has a single roadmap in the old "roadmap" key: keep it as their first roadmap
const initialStore = () => {
    const legacy = getStore('roadmap', null)
    if (legacy && Array.isArray(legacy.topics)) {
        const m = normMap({ ...legacy, id: 'main' })
        return { order: [m.id], active: m.id, maps: { [m.id]: m } }
    }
    return seedMaps()
}

const locate = (d, id) => {
    for (const t of d.topics) {
        if (t.id === id) return { t, p: null, arr: d.topics }
        const s = t.subs.find(x => x.id === id)
        if (s) return { t: s, p: t, arr: t.subs }
    }
    return null
}
const itemsOf = m => m.topics.flatMap(t => [t, ...t.subs])

/*
  Linked roadmaps: an item with a "ref" is done when every topic and subtopic of that roadmap is done.
  "chain" lists the roadmaps we are already inside, so a loop (A -> B -> A) can never run forever.
*/
function effStatus(t, maps, chain = []) {
    if (!t.ref || !maps[t.ref] || chain.includes(t.ref)) return t.status
    const p = mapProgress(maps[t.ref], maps, [...chain, t.ref])
    return p.total && p.done === p.total ? 'done' : p.done > 0 ? 'doing' : 'todo'
}
function mapProgress(m, maps, chain = [m.id]) {
    const items = itemsOf(m)
    const done = items.filter(i => effStatus(i, maps, chain) === 'done').length
    return { done, total: items.length, pct: items.length ? Math.round((100 * done) / items.length) : 0 }
}
// Does roadmap "from" point (directly or through others) at roadmap "target"?
function reaches(maps, from, target, seen = new Set()) {
    if (from === target) return true
    if (seen.has(from) || !maps[from]) return false
    seen.add(from)
    return itemsOf(maps[from]).some(i => i.ref && reaches(maps, i.ref, target, seen))
}
const prog = (t, maps) => {
    if (t.ref && maps[t.ref]) return mapProgress(maps[t.ref], maps).pct
    const u = [...t.steps, ...t.subs.map(s => ({ done: effStatus(s, maps) === 'done' }))]
    return u.length ? Math.round((100 * u.filter(x => x.done).length) / u.length) : effStatus(t, maps) === 'done' ? 100 : 0
}
const reid = x => {
    if (!x || typeof x !== 'object') return
    if (x.id) x.id = uid()
    Object.values(x).forEach(reid)
}
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const md = s => esc(s || '')
    .split('\n')
    .map(l => (/^#{1,3} /.test(l) ? '<h4>' + l.replace(/^#+ /, '') + '</h4>' : /^[-*] /.test(l) ? '<li>' + l.slice(2) + '</li>' : l.trim() ? '<p>' + l + '</p>' : ''))
    .join('')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/`(.+?)`/g, '<code>$1</code>')

const NS = 'http://www.w3.org/2000/svg'
const svgEl = (tag, attrs) => {
    const n = document.createElementNS(NS, tag)
    Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v))
    return n
}

/* ---------- map pieces ---------- */
function Node({ t, n, dim, maps, onOpen, onToggle, onGoRef }) {
    const linked = t.ref && maps[t.ref] ? maps[t.ref] : null
    const status = effStatus(t, maps)
    return (
        <div id={'rm-n-' + t.id} className={`rm-node p-${t.priority} ${status}${n ? '' : ' s'}${dim ? ' dim' : ''}${linked ? ' linked' : ''}`}>
            <button className="rm-chk" disabled={!!linked}
                title={linked ? 'Done automatically when the linked roadmap is finished' : status === 'done' ? 'Mark as not done' : 'Mark as done'}
                aria-label={`Toggle ${t.title || 'item'} done`} aria-pressed={status === 'done'} onClick={e => onToggle(t, e.currentTarget)}>✓</button>
            {linked && <button className="rm-go" onClick={() => onGoRef(linked.id)} title={`Open the ${linked.title} roadmap`} aria-label={`Open the ${linked.title} roadmap`}>↗</button>}
            <button className="rm-body" onClick={() => onOpen(t.id)}>
                <b>{n ? n + '. ' : ''}{t.title || 'Untitled'}</b>
                {n && t.when && <em>{t.when}</em>}
                {n && t.desc && <small>{t.desc}</small>}
                {linked && <span className="rm-ref">↗ {linked.title}</span>}
                <span className="rm-pr">{PR[t.priority]}</span>
                {(n || linked) && <span className="rm-bar"><i style={{ width: prog(t, maps) + '%' }} /></span>}
            </button>
        </div>
    )
}

function Gate({ t, onToggle }) {
    const g = t.gate
    return (
        <div className="rm-gate">
            <i className="rm-gl" />
            <div className="rm-gr">
                <button className={'rm-dm' + (g.highlight ? ' key' : '') + (g.done ? ' on' : '')} aria-label={`Gate ${g.name || ''}: ${g.done ? 'passed' : 'not passed'}`} aria-pressed={g.done}
                    title={g.done ? 'Gate passed' : 'Mark gate as passed'} onClick={() => onToggle(t)} />
                <div><b>{g.name || 'Gate'}</b>{g.desc && <small>{g.desc}</small>}</div>
            </div>
        </div>
    )
}

/* ---------- side drawer ---------- */
function Row({ id, children, onRemove }) {
    return (
        <div className="rm-it" data-row={id}>{children}<button className="icon-btn" onClick={onRemove} title="Delete" aria-label="Delete">×</button></div>
    )
}

function Drawer({ data, maps, order, currentId, sel, setSel, api, onOpenRoadmap }) {
    const hit = sel && locate(data, sel)
    const [reading, setReading] = useState(true)
    const [armed, setArmed] = useState(false)
    const lastSel = useRef(null)
    const nf = useRef(null)

    // Choose read mode when a different item opens
    useEffect(() => {
        if (sel !== lastSel.current) {
            lastSel.current = sel
            setReading(!!(hit && hit.t.notes))
            setArmed(false)
        }
    }, [sel]) // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (!nf.current) return
        const el = document.querySelector(`.rm-drawer [data-row="${nf.current}"] input[type=text]`)
        if (el) el.focus()
        nf.current = null
    })

    if (!hit) return <aside className="rm-drawer" aria-hidden="true" />
    const { t, p, arr } = hit
    const close = () => setSel(null)

    const text = (obj, key, ph, extra) => <input type="text" value={obj[key] || ''} placeholder={ph} aria-label={ph} onChange={e => api.patchItem(t.id, key, obj, e.target.value)} {...extra} />
    const topText = (key, ph, extra) => <input type="text" value={t[key] || ''} placeholder={ph} aria-label={ph} onChange={e => api.patch(t.id, { [key]: e.target.value })} {...extra} />
    const linked = t.ref && maps[t.ref] ? maps[t.ref] : null
    const seg = (label, opts, key, disabled) => (
        <div>
            <div className="rm-lb">{label}</div>
            <div className="row">
                {Object.entries(opts).map(([v, l]) => <button key={v} disabled={disabled} className={'btn sm' + ((key === 'status' ? effStatus(t, maps) : t[key]) === v ? ' on' : '')} onClick={() => api.patch(t.id, { [key]: v })}>{l}</button>)}
            </div>
        </div>
    )
    const add = (key, item) => {
        nf.current = item.id
        api.addIn(t.id, key, item)
    }
    const sendToday = (label, type) => {
        if (!label.trim()) return
        addTodoToday({ text: label.trim(), type })
        play('add')
        notify({ title: 'Added to today', body: label.trim(), icon: '📌' })
    }
    return (
        <aside className="rm-drawer open" role="dialog" aria-label={t.title || 'Details'}>
            <div className="row">
                {p && <button className="btn sm" onClick={() => setSel(p.id)}>← {p.title || 'Parent'}</button>}
                <button className="btn sm" onClick={close}>Close</button>
                <span className="grow" />
                <button className="btn sm" title="Move earlier" onClick={() => api.move(t.id, -1)}>↑</button>
                <button className="btn sm" title="Move later" onClick={() => api.move(t.id, 1)}>↓</button>
                <button className="btn sm" onClick={() => { api.duplicate(t.id) }}>Duplicate</button>
                <button className="btn sm danger" onClick={() => { if (armed) { api.remove(t.id); setSel(p ? p.id : null) } else setArmed(true) }}>{armed ? 'Click again to delete' : 'Delete'}</button>
            </div>

            {topText('title', p ? 'Subtopic title' : 'Topic title', { className: 'rm-h', autoFocus: !t.title })}
            <div className="row" style={{ marginTop: 8 }}>
                <div className="grow">{topText('desc', 'Short description')}</div>
                <div style={{ width: 140 }}>{topText('when', 'Timeframe')}</div>
            </div>
            <div>
                <div className="rm-lb">Linked roadmap</div>
                <select value={t.ref || ''} aria-label="Linked roadmap" onChange={e => api.setRef(t.id, e.target.value || null)}>
                    <option value="">None</option>
                    {order.filter(id => id !== currentId).map(id => {
                        const loops = reaches(maps, id, currentId)
                        return <option key={id} value={id} disabled={loops}>{maps[id].title || 'Untitled roadmap'}{loops ? ' (would loop back here)' : ''}</option>
                    })}
                </select>
                {linked && (() => {
                    const p = mapProgress(linked, maps)
                    return (
                        <div className="rm-linkbox">
                            <div className="rm-bar"><i style={{ width: p.pct + '%' }} /></div>
                            <div className="row">
                                <span className="small grow">{p.done} of {p.total} items done in <b>{linked.title}</b></span>
                                <button className="btn sm" onClick={() => onOpenRoadmap(linked.id)}>Open roadmap →</button>
                            </div>
                            <p className="muted small" style={{ margin: 0 }}>This item is done when every topic and subtopic of that roadmap is done.</p>
                        </div>
                    )
                })()}
            </div>
            {seg('Status', STATUS, 'status', !!linked)}
            {seg('Priority', PR, 'priority')}

            <section>
                <div className="row">
                    <h3 className="grow">Study notes</h3>
                    <button className="btn sm" onClick={() => setReading(!reading)}>{reading ? 'Edit' : 'Read'}</button>
                </div>
                {reading
                    ? <div className="rm-md" dangerouslySetInnerHTML={{ __html: md(t.notes) || '<p>No notes yet. Choose Edit to write what you need to study. Markdown headings, lists, bold and code work.</p>' }} />
                    : <textarea rows={7} value={t.notes || ''} placeholder={'# Heading\n- point\n**bold** and `code`'} aria-label="Study notes" onChange={e => api.patch(t.id, { notes: e.target.value })} />}
            </section>

            <section>
                <h3>Checklist · {prog(t, maps)}%</h3>
                {t.steps.map(x => (
                    <Row key={x.id} id={x.id} onRemove={() => api.removeIn(t.id, 'steps', x.id)}>
                        <input type="checkbox" checked={x.done} aria-label="Done" onChange={e => { api.patchItem(t.id, 'done', x, e.target.checked, 'steps'); play(e.target.checked ? 'check' : 'uncheck') }} />
                        <div className="col"><input type="text" value={x.t} placeholder="Step to learn" aria-label="Step" onChange={e => api.patchItem(t.id, 't', x, e.target.value, 'steps')} /></div>
                        <button className="btn sm ghost" title="Add to today's todos" onClick={() => sendToday(x.t, 'task')}>→ Today</button>
                    </Row>
                ))}
                <button className="btn sm" onClick={() => add('steps', { id: uid(), t: '', done: false })}>+ Add</button>
            </section>

            {!p && (
                <section>
                    <h3>Subtopics</h3>
                    {t.subs.map(x => (
                        <Row key={x.id} id={x.id} onRemove={() => api.removeIn(t.id, 'subs', x.id)}>
                            <input type="checkbox" checked={effStatus(x, maps) === 'done'} disabled={!!(x.ref && maps[x.ref])} title={x.ref && maps[x.ref] ? 'Follows the linked roadmap' : undefined} aria-label="Done" onChange={e => { api.patchItem(t.id, 'status', x, e.target.checked ? 'done' : 'todo', 'subs'); play(e.target.checked ? 'check' : 'uncheck') }} />
                            <div className="col">
                                <input type="text" value={x.title} placeholder="Subtopic title" aria-label="Subtopic title" onChange={e => api.patchItem(t.id, 'title', x, e.target.value, 'subs')} />
                                <select value={x.priority} aria-label="Priority" onChange={e => api.patchItem(t.id, 'priority', x, e.target.value, 'subs')}>
                                    {Object.entries(PR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                                </select>
                            </div>
                            <button className="btn sm" onClick={() => setSel(x.id)}>Open</button>
                        </Row>
                    ))}
                    <button className="btn sm" onClick={() => add('subs', norm({ priority: 'rec' }, false))}>+ Add</button>
                </section>
            )}

            <section>
                <h3>Resources</h3>
                {t.res.map(x => (
                    <Row key={x.id} id={x.id} onRemove={() => api.removeIn(t.id, 'res', x.id)}>
                        <div className="col">
                            <div className="row" style={{ flexWrap: 'nowrap' }}>
                                <select value={x.type} style={{ width: 110 }} aria-label="Type" onChange={e => api.patchItem(t.id, 'type', x, e.target.value, 'res')}>
                                    {RES_TYPES.map(o => <option key={o}>{o}</option>)}
                                </select>
                                <input type="text" value={x.t} placeholder="Resource title" aria-label="Resource title" onChange={e => api.patchItem(t.id, 't', x, e.target.value, 'res')} />
                            </div>
                            <div className="row" style={{ flexWrap: 'nowrap' }}>
                                <input type="text" value={x.url} placeholder="https://…" aria-label="URL" onChange={e => api.patchItem(t.id, 'url', x, e.target.value, 'res')} />
                                {/^https?:\/\//.test(x.url) && <a className="rm-link" href={x.url} target="_blank" rel="noopener noreferrer">Open</a>}
                                <button className="btn sm ghost" title="Add to today's todos" onClick={() => sendToday(x.t || x.url, RES_TO_TODO[x.type] || 'task')}>→ Today</button>
                            </div>
                        </div>
                    </Row>
                ))}
                <button className="btn sm" onClick={() => add('res', { id: uid(), type: 'Docs', t: '', url: '' })}>+ Add</button>
            </section>

            <section>
                <h3>Projects</h3>
                {t.proj.map(x => (
                    <Row key={x.id} id={x.id} onRemove={() => api.removeIn(t.id, 'proj', x.id)}>
                        <input type="checkbox" checked={x.done} aria-label="Done" onChange={e => { api.patchItem(t.id, 'done', x, e.target.checked, 'proj'); play(e.target.checked ? 'complete' : 'uncheck') }} />
                        <div className="col">
                            <input type="text" value={x.t} placeholder="Project name" aria-label="Project name" onChange={e => api.patchItem(t.id, 't', x, e.target.value, 'proj')} />
                            <input type="text" value={x.desc} placeholder="What to build and how to know it works" aria-label="Project description" onChange={e => api.patchItem(t.id, 'desc', x, e.target.value, 'proj')} />
                        </div>
                        <button className="btn sm ghost" title="Add to today's todos" onClick={() => sendToday(x.t, 'project')}>→ Today</button>
                    </Row>
                ))}
                <button className="btn sm" onClick={() => add('proj', { id: uid(), t: '', desc: '', done: false })}>+ Add</button>
            </section>

            {!p && (
                <section>
                    <h3>Gate</h3>
                    <label className="row">
                        <input type="checkbox" checked={!!t.gate} onChange={e => api.patch(t.id, { gate: e.target.checked ? { name: 'Gate', desc: '', highlight: false, done: false } : null })} />
                        This topic ends with a gate
                    </label>
                    {t.gate && (
                        <div className="rm-gform">
                            <input type="text" value={t.gate.name} placeholder="Gate name" aria-label="Gate name" onChange={e => api.patchGate(t.id, { name: e.target.value })} />
                            <input type="text" value={t.gate.desc} placeholder="Criteria to pass" aria-label="Criteria" onChange={e => api.patchGate(t.id, { desc: e.target.value })} />
                            <label className="row"><input type="checkbox" checked={t.gate.done} onChange={e => api.patchGate(t.id, { done: e.target.checked })} /> Gate passed (fills the line to the next topic)</label>
                            <label className="row"><input type="checkbox" checked={t.gate.highlight} onChange={e => api.patchGate(t.id, { highlight: e.target.checked })} /> Key gate</label>
                        </div>
                    )}
                </section>
            )}
        </aside>
    )
}

function BackupModal({ store, activeId, setRoadmaps, onClose }) {
    const [scope, setScope] = useState('all')
    const make = sc => JSON.stringify(sc === 'all' ? store : store.maps[activeId], null, 2)
    const [text, setText] = useState(() => make('all'))
    const [armed, setArmed] = useState(false)
    const [msg, setMsg] = useState('')

    const pickScope = sc => {
        setScope(sc)
        setText(make(sc))
    }

    const importJSON = () => {
        try {
            const d = JSON.parse(text)
            if (d && d.maps && Array.isArray(d.order)) {
                // a whole set of roadmaps: replaces everything
                const maps = {}
                d.order.forEach(id => { if (d.maps[id]) maps[id] = normMap({ ...d.maps[id], id }) })
                const order = Object.keys(maps)
                if (!order.length) throw new Error('No roadmaps found in this file')
                setRoadmaps({ order, active: maps[d.active] ? d.active : order[0], maps })
                notify({ title: `Imported ${order.length} roadmap${order.length > 1 ? 's' : ''}`, icon: '📥' })
            } else if (d && Array.isArray(d.topics)) {
                // one roadmap: added next to the others
                const m = normMap({ ...d, id: uid() })
                setRoadmaps({ order: [...store.order, m.id], active: m.id, maps: { ...store.maps, [m.id]: m } })
                notify({ title: 'Roadmap added', body: m.title, icon: '📥' })
            } else {
                throw new Error('Expected a roadmap ("topics") or a set of roadmaps ("maps" and "order")')
            }
            play('save')
            onClose()
        } catch (e) {
            setMsg('Invalid JSON: ' + e.message)
        }
    }
    const download = () => {
        const a = document.createElement('a')
        a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
        a.download = scope === 'all' ? 'roadmaps.json' : `${(store.maps[activeId].title || 'roadmap').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.json`
        a.click()
        setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    }
    const copy = async () => {
        try {
            await navigator.clipboard.writeText(text)
            setMsg('Copied to the clipboard')
        } catch {
            setMsg('Select the text and press Ctrl+C')
        }
    }

    return (
        <div className="modal-back" onMouseDown={e => e.target === e.currentTarget && onClose()}>
            <div className="modal" style={{ width: 'min(680px,100%)' }} role="dialog" aria-label="Backup and restore">
                <h2>Backup and restore roadmaps</h2>
                <div className="row" style={{ marginBottom: 8 }}>
                    <span className="small muted">Export</span>
                    <button className={'btn sm' + (scope === 'all' ? ' on' : '')} onClick={() => pickScope('all')}>All roadmaps</button>
                    <button className={'btn sm' + (scope === 'this' ? ' on' : '')} onClick={() => pickScope('this')}>Only this roadmap</button>
                </div>
                <textarea rows={13} value={text} onChange={e => setText(e.target.value)} spellCheck="false" aria-label="Roadmap JSON" style={{ font: '12px/1.4 ui-monospace,monospace' }} />
                <p className="muted small" style={{ margin: '6px 0 0' }}>Importing a whole set replaces every roadmap. Importing a single roadmap adds it to your list.</p>
                <div className="row" style={{ marginTop: 10 }}>
                    <button className="btn primary" onClick={importJSON}>Import JSON</button>
                    <button className="btn" onClick={copy}>Copy</button>
                    <button className="btn" onClick={download}>Download</button>
                    <button className="btn danger" onClick={() => { if (armed) { setRoadmaps(seedMaps()); play('save'); onClose() } else setArmed(true) }}>{armed ? 'Click again to reset' : 'Reset to the examples'}</button>
                    <span className="grow small muted">{msg}</span>
                    <button className="btn" onClick={onClose}>Close</button>
                </div>
            </div>
        </div>
    )
}

function NewRoadmapModal({ currentTitle, onCreate, onClose }) {
    const [title, setTitle] = useState('')
    const [template, setTemplate] = useState('blank')
    return (
        <div className="modal-back" onMouseDown={e => e.target === e.currentTarget && onClose()}>
            <form className="modal" role="dialog" aria-label="New roadmap" onSubmit={e => { e.preventDefault(); onCreate(title.trim(), template) }}>
                <h2>New roadmap</h2>
                <label className="field"><span>Name</span>
                    <input autoFocus value={title} onChange={e => setTitle(e.target.value)} placeholder="Python, DevOps, Data science…" />
                </label>
                <div className="field"><span>Start from</span>
                    <div className="row">
                        <button type="button" className={'btn sm' + (template === 'blank' ? ' on' : '')} onClick={() => setTemplate('blank')}>Empty roadmap</button>
                        <button type="button" className={'btn sm' + (template === 'copy' ? ' on' : '')} onClick={() => setTemplate('copy')}>Copy of “{currentTitle || 'this roadmap'}”</button>
                    </div>
                </div>
                <div className="row"><span className="grow" /><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="submit" className="btn primary">Create roadmap</button></div>
            </form>
        </div>
    )
}

function ColorsModal({ colors, onChange, onReset, onClose }) {
    return (
        <div className="modal-back" onMouseDown={e => e.target === e.currentTarget && onClose()}>
            <div className="modal" role="dialog" aria-label="Priority colours">
                <h2>Priority colours</h2>
                <p className="muted small" style={{ marginTop: -6 }}>Each square is tinted with the colour of its priority. The border style (solid, dashed, dotted) stays as a second clue.</p>
                {Object.entries(PR).map(([k, label]) => (
                    <label key={k} className="row" style={{ marginBottom: 10 }}>
                        <input type="color" value={colors[k]} onChange={e => onChange(k, e.target.value)} aria-label={`${label} colour`} style={{ width: 44, height: 32, padding: 0, border: 0, background: 'none', cursor: 'pointer' }} />
                        <span className={`rm-sample p-${k}`} style={{ '--pc': colors[k] }}>{label}</span>
                    </label>
                ))}
                <div className="row" style={{ marginTop: 12 }}>
                    <button className="btn" onClick={onReset}>Reset to default colours</button>
                    <span className="grow" /><button className="btn primary" onClick={onClose}>Done</button>
                </div>
            </div>
        </div>
    )
}

/* ============================================================
   Page
   ============================================================ */
export default function Roadmap() {
    const [store, setRoadmaps, updateStore] = useStore('roadmaps', initialStore)
    const [settings, , updateSettings] = useStore('settings', { dailyGoal: 3 })
    const [sel, setSel] = useState(null)
    const [query, setQuery] = useState('')
    const [pf, setPf] = useState(null)
    const [hideSubs, setHideSubs] = useState(false)
    const [backup, setBackup] = useState(false)
    const [creating, setCreating] = useState(false)
    const [colorsOpen, setColorsOpen] = useState(false)
    const [menu, setMenu] = useState(false)
    const [armed, setArmed] = useState(false)
    const [trail, setTrail] = useState([]) // roadmaps we came from when following a link
    const mapRef = useRef(null)
    const rowsRef = useRef(null)
    const mainSvg = useRef(null)
    const subSvg = useRef(null)
    const drawRef = useRef(null)
    const prevPct = useRef(null)

    const maps = store.maps
    const activeId = maps[store.active] ? store.active : store.order[0]
    const data = maps[activeId] || { id: '', title: '', topics: [] }
    const colors = { ...DEFAULT_COLORS, ...(settings.roadmapColors || {}) }
    const st = t => effStatus(t, maps)

    // Someone with the old single roadmap: save it as the first of their roadmaps
    useEffect(() => {
        if (!isStored('roadmaps') && isStored('roadmap')) setRoadmaps(getStore('roadmaps', initialStore))
    }, []) // eslint-disable-line react-hooks/exhaustive-deps

    // Edit the roadmap that is open
    const update = fn => updateStore(d => {
        const m = d.maps[activeId]
        if (m) fn(m)
    })

    /* ----- mutations (updaters use block bodies so they never return a value) ----- */
    const api = {
        patch: (id, p) => update(d => {
            const h = locate(d, id)
            if (h) Object.assign(h.t, p)
        }),
        patchGate: (id, p) => update(d => {
            const h = locate(d, id)
            if (h && h.t.gate) Object.assign(h.t.gate, p)
        }),
        // Edit one field of an item that lives in a list of the selected topic ("steps", "res", "proj", "subs")
        patchItem: (id, key, item, value, list) => update(d => {
            const h = locate(d, id)
            if (!h) return
            const target = list ? h.t[list].find(x => x.id === item.id) : h.t
            if (target) target[key] = value
        }),
        // Point an item at another roadmap (or clear it). A link that would loop back is refused.
        setRef: (id, ref) => {
            if (ref && (ref === activeId || reaches(maps, ref, activeId))) return
            update(d => {
                const h = locate(d, id)
                if (h) h.t.ref = ref || null
            })
            play('tick')
        },
        addIn: (id, key, item) => {
            update(d => {
                const h = locate(d, id)
                if (h) h.t[key].push(item)
            })
            play('add')
        },
        removeIn: (id, key, itemId) => {
            update(d => {
                const h = locate(d, id)
                if (h) h.t[key] = h.t[key].filter(x => x.id !== itemId)
            })
            play('delete')
        },
        move: (id, dir) => {
            update(d => {
                const h = locate(d, id)
                if (!h) return
                const i = h.arr.indexOf(h.t)
                const j = i + dir
                if (j < 0 || j >= h.arr.length) return
                h.arr.splice(j, 0, h.arr.splice(i, 1)[0])
            })
            play('move')
        },
        duplicate: id => {
            update(d => {
                const h = locate(d, id)
                if (!h) return
                const copy = JSON.parse(JSON.stringify(h.t))
                reid(copy)
                copy.title = (copy.title || 'Untitled') + ' (copy)'
                h.arr.splice(h.arr.indexOf(h.t) + 1, 0, copy)
            })
            play('add')
        },
        remove: id => {
            update(d => {
                const h = locate(d, id)
                if (h) h.arr.splice(h.arr.indexOf(h.t), 1)
            })
            play('delete')
        },
    }

    const toggleDone = (t, el) => {
        if (t.ref && maps[t.ref]) return
        const done = st(t) !== 'done'
        api.patch(t.id, { status: done ? 'done' : 'todo' })
        const isTopic = data.topics.some(x => x.id === t.id)
        play(done ? (isTopic ? 'complete' : 'check') : 'uncheck')
        if (done && el) {
            const r = el.getBoundingClientRect()
            confetti(r.left + r.width / 2, r.top + r.height / 2)
        }
    }
    const toggleGate = t => {
        api.patchGate(t.id, { done: !t.gate.done })
        play(t.gate.done ? 'uncheck' : 'gate')
    }
    const openItem = id => setSel(id)
    const addTopic = () => {
        const t = norm({})
        update(d => { d.topics.push(t) })
        play('add')
        setSel(t.id)
        setTimeout(() => {
            const el = document.getElementById('rm-n-' + t.id)
            if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' })
        }, 50)
    }
    const addSub = topic => {
        const s = norm({ priority: 'rec' }, false)
        api.addIn(topic.id, 'subs', s)
        setSel(s.id)
    }

    /* ----- several roadmaps ----- */
    const goRoadmap = (id, push = false) => {
        if (!maps[id] || id === activeId) return
        setTrail(t => (push ? [...t, activeId] : []))
        updateStore(d => { d.active = id })
        setSel(null)
        setQuery('')
        setPf(null)
        setMenu(false)
        window.scrollTo({ top: 0, behavior: 'smooth' })
    }
    const goBack = () => {
        const last = trail[trail.length - 1]
        setTrail(trail.slice(0, -1))
        if (maps[last]) updateStore(d => { d.active = last })
        setSel(null)
        window.scrollTo({ top: 0, behavior: 'smooth' })
    }
    const createRoadmap = (title, template) => {
        const id = uid()
        const base = template === 'copy' ? JSON.parse(JSON.stringify(data)) : { topics: [] }
        reid(base)
        updateStore(d => {
            d.maps[id] = normMap({ ...base, id, title: title || (template === 'copy' ? `${data.title} (copy)` : 'New roadmap') })
            d.order.push(id)
            d.active = id
        })
        setCreating(false)
        setTrail([])
        setSel(null)
        setMenu(false)
        play('save')
    }
    const deleteRoadmap = () => {
        if (store.order.length < 2) return
        const id = activeId
        updateStore(d => {
            delete d.maps[id]
            d.order = d.order.filter(x => x !== id)
            // items that pointed at the deleted roadmap become normal items again
            Object.values(d.maps).forEach(m => itemsOf(m).forEach(i => { if (i.ref === id) i.ref = null }))
            d.active = d.order[0]
        })
        setSel(null)
        setTrail([])
        setMenu(false)
        setArmed(false)
        play('delete')
    }
    const moveRoadmap = dir => {
        updateStore(d => {
            const i = d.order.indexOf(activeId)
            const j = i + dir
            if (i < 0 || j < 0 || j >= d.order.length) return
            d.order.splice(j, 0, d.order.splice(i, 1)[0])
        })
        play('move')
    }

    /* ----- derived ----- */
    const q = query.trim().toLowerCase()
    const matches = t => !q || JSON.stringify([t.title, t.desc, t.notes, t.steps.map(s => s.t)]).toLowerCase().includes(q)
    const vis = t => (!pf || t.priority === pf) && matches(t)
    const all = itemsOf(data)
    const doneCount = all.filter(t => st(t) === 'done').length
    const must = all.filter(t => t.priority === 'must')
    const pct = all.length ? Math.round((100 * doneCount) / all.length) : 0

    const goNext = () => {
        const left = all.filter(t => st(t) !== 'done')
        const t = left.find(x => x.priority === 'must') || left[0]
        if (!t) return notify({ title: 'Everything is done', body: 'Add a new topic to keep going.', icon: '🏆' })
        const el = document.getElementById('rm-n-' + t.id)
        if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' })
        notify({ title: 'Next up', body: t.title || 'Untitled', icon: '🎯' })
    }

    // Celebrate when a whole roadmap becomes finished, and say where that counts as done too
    useEffect(() => {
        const now = Object.fromEntries(store.order.filter(id => maps[id]).map(id => [id, mapProgress(maps[id], maps).pct]))
        const prev = prevPct.current
        prevPct.current = now
        if (!prev) return
        Object.keys(now).forEach(id => {
            if (now[id] !== 100 || prev[id] === undefined || prev[id] >= 100 || !maps[id].topics.length) return
            const users = store.order.filter(o => o !== id && maps[o] && itemsOf(maps[o]).some(i => i.ref === id)).map(o => maps[o].title)
            play('levelup')
            notify({
                title: `${maps[id].title} roadmap complete`,
                body: users.length ? `Also marked as done in: ${users.join(', ')}` : 'Every topic and subtopic is done.',
                icon: '🏆',
            })
        })
    }, [store]) // eslint-disable-line react-hooks/exhaustive-deps

    /* ----- connector lines: drawn from the real position of every square ----- */
    drawRef.current = () => {
        const map = mapRef.current
        const svg = mainSvg.current
        const ls = subSvg.current
        if (!map || !svg || !ls) return
        const m = map.getBoundingClientRect()
        const cells = [...map.querySelectorAll('.rm-cell')]
        const mobile = window.innerWidth < 700
        const want = Math.max(0, cells.length - 1)
        if (svg.children.length !== want * 2) {
            svg.replaceChildren()
            for (let i = 0; i < want; i++) svg.append(svgEl('path', { class: 'rm-base' }), svgEl('path', { class: 'rm-fill', pathLength: 1 }))
        }
        cells.slice(0, -1).forEach((cell, i) => {
            const A = cell.getBoundingClientRect()
            const R = cell.parentNode.getBoundingClientRect()
            const B = cells[i + 1].querySelector('.rm-node').getBoundingClientRect()
            const x1 = A.left + A.width / 2 - m.left
            const y0 = (mobile ? R.bottom : A.bottom) - m.top
            const y1 = R.bottom - m.top
            const x2 = B.left + B.width / 2 - m.left
            const y2 = B.top - m.top
            const d = Math.max(30, (y2 - y1) * 0.6)
            const D = `M${x1} ${y0}V${y1}C${x1} ${y1 + d},${x2} ${y2 - d},${x2} ${y2}`
            const t = data.topics[i]
            svg.children[2 * i].setAttribute('d', D)
            svg.children[2 * i + 1].setAttribute('d', D)
            svg.children[2 * i + 1].classList.toggle('on', !!t && st(t) === 'done' && (!t.gate || t.gate.done))
        })
        ls.replaceChildren()
        if (hideSubs || mobile) return
        data.topics.forEach(t => {
            const row = document.getElementById('rm-r-' + t.id)
            if (!row) return
            const box = row.querySelector('.rm-cell .rm-node').getBoundingClientRect()
            const toRight = row.classList.contains('l')
            t.subs.forEach(s => {
                const el = document.getElementById('rm-n-' + s.id)
                if (!el) return
                const e = el.getBoundingClientRect()
                const xs = (toRight ? box.right : box.left) - m.left
                const xe = (toRight ? e.left : e.right) - m.left
                const ys = box.top + box.height / 2 - m.top
                const ye = e.top + e.height / 2 - m.top
                ls.append(svgEl('path', { class: 'rm-sl' + (st(s) === 'done' ? ' on' : ''), d: `M${xs} ${ys}H${(xs + xe) / 2}V${ye}H${xe}` }))
            })
        })
    }
    useLayoutEffect(() => { drawRef.current() })
    useEffect(() => {
        const redraw = () => drawRef.current()
        const ro = new ResizeObserver(redraw)
        if (rowsRef.current) ro.observe(rowsRef.current)
        window.addEventListener('resize', redraw)
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(redraw)
        return () => {
            ro.disconnect()
            window.removeEventListener('resize', redraw)
        }
    }, [])

    useEffect(() => {
        if (!sel) return
        const onKey = e => {
            if (e.key === 'Escape' && !e.defaultPrevented && !document.querySelector('.modal-back')) setSel(null)
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [sel])

    const lastFrom = trail.length ? maps[trail[trail.length - 1]] : null

    return (
        <div className="rm" style={{ '--c-must': colors.must, '--c-rec': colors.rec, '--c-nice': colors.nice, '--c-opt': colors.opt }}>
            <style>{CSS}</style>

            <div className="rm-tabs" role="tablist" aria-label="Roadmaps">
                {store.order.filter(id => maps[id]).map(id => (
                    <button key={id} role="tab" aria-selected={id === activeId} className={'rm-tab' + (id === activeId ? ' on' : '')} onClick={() => goRoadmap(id)}>
                        <span className="rm-tabname">{maps[id].title || 'Untitled'}</span>
                        <small>{mapProgress(maps[id], maps).pct}%</small>
                    </button>
                ))}
                <button className="rm-tab rm-newtab" onClick={() => setCreating(true)}>+ New roadmap</button>
                <span className="rm-menuwrap">
                    <button className="rm-tab rm-newtab" onClick={() => { setMenu(!menu); setArmed(false) }} aria-label="Roadmap actions" aria-expanded={menu}>⋯</button>
                    {menu && (
                        <>
                            <div className="rm-menuback" onClick={() => setMenu(false)} />
                            <div className="rm-menu" role="menu">
                                <button role="menuitem" onClick={() => { createRoadmap(`${data.title} (copy)`, 'copy') }}>Duplicate this roadmap</button>
                                <button role="menuitem" disabled={store.order.indexOf(activeId) < 1} onClick={() => moveRoadmap(-1)}>Move left</button>
                                <button role="menuitem" disabled={store.order.indexOf(activeId) >= store.order.length - 1} onClick={() => moveRoadmap(1)}>Move right</button>
                                <button role="menuitem" className="danger" disabled={store.order.length < 2} onClick={() => { if (armed) deleteRoadmap(); else setArmed(true) }}>{armed ? 'Click again to delete' : 'Delete this roadmap'}</button>
                            </div>
                        </>
                    )}
                </span>
            </div>

            {lastFrom && (
                <div className="rm-back"><button className="btn sm" onClick={goBack}>← Back to {lastFrom.title || 'previous roadmap'}</button></div>
            )}

            <div className="rm-head">
                <input className="rm-title" value={data.title} onChange={e => update(d => { d.title = e.target.value })} aria-label="Roadmap title" />
                <div className="row">
                    <input className="rm-search" type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search topics" aria-label="Search topics" />
                    <button className="btn" onClick={goNext} title="Jump to the next unfinished topic">Continue</button>
                    <button className="btn" onClick={() => setHideSubs(!hideSubs)}>{hideSubs ? 'Show subtopics' : 'Hide subtopics'}</button>
                    <button className="btn primary" onClick={addTopic}>Add topic</button>
                    <button className="btn" onClick={() => setBackup(true)}>Backup</button>
                </div>
                <div className="rm-legend">
                    <span className="muted small">Priority (click to highlight):</span>
                    {Object.entries(PR).map(([k, v]) => (
                        <button key={k} className={`rm-ch p-${k}` + (pf === k ? ' act' : '')} onClick={() => setPf(pf === k ? null : k)} aria-pressed={pf === k}>{v}</button>
                    ))}
                    <button className="btn sm ghost" onClick={() => setColorsOpen(true)}>Colours</button>
                </div>
                <div className="rm-pg">
                    <div className="rm-track"><i style={{ width: pct + '%' }} /></div>
                    <span className="small muted">{pct}% · {doneCount}/{all.length} items · mandatory {must.filter(t => st(t) === 'done').length}/{must.length}</span>
                </div>
            </div>

            <div className={'rm-map' + (hideSubs ? ' nosub' : '')} ref={mapRef}>
                <svg className="rm-ov" ref={mainSvg} aria-hidden="true" />
                <svg className="rm-ov" ref={subSvg} aria-hidden="true" />
                <div className="rm-rows" ref={rowsRef}>
                    {data.topics.length === 0 && <p className="muted" style={{ textAlign: 'center', padding: '60px 0' }}>No topics yet. Add your first topic to start the path.</p>}
                    {data.topics.map((t, i) => (
                        <div key={t.id} id={'rm-r-' + t.id} className={'rm-row ' + (i % 2 ? 'r' : 'l')}>
                            <div className="rm-cell">
                                <Node t={t} n={i + 1} maps={maps} dim={!(vis(t) || t.subs.some(vis))} onOpen={openItem} onToggle={toggleDone} onGoRef={id => goRoadmap(id, true)} />
                                {t.gate && <Gate t={t} onToggle={toggleGate} />}
                            </div>
                            <div className="rm-subs">
                                {t.subs.map(s => <Node key={s.id} t={s} maps={maps} dim={!vis(s)} onOpen={openItem} onToggle={toggleDone} onGoRef={id => goRoadmap(id, true)} />)}
                                <button className="rm-addsub" onClick={() => addSub(t)}>+ Subtopic</button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {sel && <div className="rm-scrim" onClick={() => setSel(null)} />}
            <Drawer data={data} maps={maps} order={store.order} currentId={activeId} sel={sel} setSel={setSel} api={api} onOpenRoadmap={id => goRoadmap(id, true)} />
            {backup && <BackupModal store={store} activeId={activeId} setRoadmaps={setRoadmaps} onClose={() => setBackup(false)} />}
            {creating && <NewRoadmapModal currentTitle={data.title} onCreate={createRoadmap} onClose={() => setCreating(false)} />}
            {colorsOpen && (
                <ColorsModal colors={colors} onClose={() => setColorsOpen(false)}
                    onChange={(k, v) => updateSettings(d => { d.roadmapColors = { ...DEFAULT_COLORS, ...(d.roadmapColors || {}), [k]: v } })}
                    onReset={() => updateSettings(d => { delete d.roadmapColors })} />
            )}
        </div>
    )
}

const CSS = `
.rm{max-width:960px;margin:0 auto;padding:20px 20px 120px}
.rm-head{display:flex;flex-wrap:wrap;gap:10px 16px;align-items:center;padding-bottom:14px;border-bottom:1px solid var(--ln)}
.rm-title{border:0!important;background:none!important;font:700 26px var(--head)!important;padding:2px 4px!important;flex:1 1 280px;min-width:0}
.rm-search{width:150px!important}
.rm-legend{flex:1 1 100%;display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.rm-tabs{display:flex;gap:6px;align-items:center;overflow-x:auto;padding:2px 0 12px;margin-bottom:6px;scrollbar-width:thin}
.rm-tab{display:inline-flex;gap:8px;align-items:center;flex:none;border:1px solid var(--ln);background:var(--sf);color:var(--mu);border-radius:999px;padding:6px 14px;cursor:pointer;font-weight:500;white-space:nowrap}
.rm-tab:hover{border-color:var(--ac);color:var(--tx)}
.rm-tab.on{background:color-mix(in srgb,var(--ac) 16%,var(--sf));border-color:var(--ac);color:var(--tx)}
.rm-tab small{font-size:11px;font-weight:600;color:var(--mu)}.rm-tab.on small{color:var(--ac)}
.rm-tabname{max-width:180px;overflow:hidden;text-overflow:ellipsis}
.rm-newtab{border-style:dashed;background:none}
.rm-menuwrap{position:relative;flex:none}
.rm-menuback{position:fixed;inset:0;z-index:30}
.rm-menu{position:absolute;right:0;top:calc(100% + 6px);z-index:31;min-width:210px;background:var(--sf);border:1px solid var(--ln);border-radius:10px;box-shadow:0 12px 40px rgba(0,0,0,.3);padding:6px;display:grid;animation:rise .12s}
.rm-menu button{border:0;background:none;text-align:left;padding:8px 10px;border-radius:6px;cursor:pointer;color:var(--tx)}
.rm-menu button:hover:not(:disabled){background:var(--sf2)}.rm-menu button:disabled{opacity:.4;cursor:not-allowed}.rm-menu .danger{color:var(--bad)}
.rm-back{margin-bottom:8px}
.rm-ch{font-size:12px;border:1.5px solid var(--mu);border-radius:6px;background:none;color:var(--tx);padding:2px 10px;cursor:pointer}
.rm-ch.act{box-shadow:0 0 0 2px var(--ac)}
.rm-pg{flex:1 1 100%;display:flex;align-items:center;gap:12px}
.rm-track{flex:1;height:8px;border-radius:9px;background:var(--ln);overflow:hidden}.rm-track i{display:block;height:100%;background:var(--ok);transition:width .5s}
.rm-map{position:relative;padding:44px 0 40px}
.rm-ov{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible}
.rm-base{fill:none;stroke:var(--ln);stroke-width:3;stroke-dasharray:7 9;stroke-linecap:round}
.rm-fill{fill:none;stroke:var(--ok);stroke-width:5;stroke-linecap:round;stroke-dasharray:1;stroke-dashoffset:1;transition:stroke-dashoffset .8s ease;filter:drop-shadow(0 0 5px var(--ok))}.rm-fill.on{stroke-dashoffset:0}
.rm-sl{fill:none;stroke:var(--ln);stroke-width:2;stroke-dasharray:4 5}.rm-sl.on{stroke:var(--ok);stroke-dasharray:none;stroke-width:2.5}
.rm-rows{position:relative;display:flex;flex-direction:column;gap:70px}
.rm-row{display:flex;align-items:flex-start;gap:56px}.rm-row.l{padding-left:2%}.rm-row.r{flex-direction:row-reverse;padding-right:2%}
.rm-cell{width:230px;flex:none}
.rm-subs{display:flex;flex-direction:column;gap:12px;padding-top:6px}.nosub .rm-subs{display:none}
.rm-node{position:relative;width:230px;background:var(--sf);border:1.5px solid var(--mu);border-radius:8px;padding:10px 12px;transition:border-color .2s,background .2s,opacity .2s}
.rm-node.s{width:170px;padding:8px 10px;border-radius:6px}
/* every priority has its own colour: a tint inside, a coloured border, and a different border style as a second clue */
.p-must,.p-rec,.p-nice,.p-opt{border-color:var(--pc);background:color-mix(in srgb,var(--pc) 14%,var(--sf))}
.p-must{--pc:var(--c-must);border-width:2px;border-style:solid}
.p-rec{--pc:var(--c-rec);border-width:1.5px;border-style:solid}
.p-nice{--pc:var(--c-nice);border-width:1.5px;border-style:dashed}
.p-opt{--pc:var(--c-opt);border-width:1.5px;border-style:dotted}
.rm-node.doing{border-color:var(--wip)}.rm-node.done{border-color:var(--ok);background:color-mix(in srgb,var(--ok) 12%,var(--sf))}
.rm-node:hover{border-color:var(--ac)}.rm-node.dim{opacity:.25}
.rm-sample{padding:4px 16px;border-radius:8px;font-weight:600}
.rm-chk{position:absolute;top:8px;right:8px;width:20px;height:20px;border-radius:5px;border:1.5px solid var(--mu);background:none;color:transparent;font-size:12px;font-weight:700;cursor:pointer;padding:0}
.rm-node.done>.rm-chk{background:var(--ok);border-color:var(--ok);color:#fff}
.rm-body{all:unset;cursor:pointer;display:grid;gap:3px;width:100%}.rm-body:focus-visible{outline:2px solid var(--ac);outline-offset:6px;border-radius:6px}
.rm-body b{font:600 16px/1.25 var(--head);padding-right:26px}.rm-node.s .rm-body b{font-size:14px}
.rm-body em{font-style:normal;font-size:12px;color:var(--mu)}
.rm-body small{font-size:12px;color:var(--mu);display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}
.rm-pr{font-size:11px;color:color-mix(in srgb,var(--pc) 70%,var(--tx));font-weight:600}
.rm-ref{font-size:12px;font-weight:600;color:var(--ac)}
.rm-go{position:absolute;top:8px;right:34px;width:20px;height:20px;border-radius:5px;border:1.5px solid var(--ac);background:none;color:var(--ac);font-size:12px;font-weight:700;cursor:pointer;padding:0;line-height:1}
.rm-go:hover{background:var(--ac);color:#fff}
.rm-node.linked .rm-body b{padding-right:54px}
.rm-chk:disabled{opacity:.55;cursor:not-allowed}
.rm-linkbox{display:grid;gap:8px;margin-top:10px;padding:12px;border:1px solid var(--ln);border-radius:8px;background:var(--sf2)}
.rm-linkbox .rm-bar{margin:0}
.rm-bar{height:4px;border-radius:4px;background:var(--ln);overflow:hidden;margin-top:4px}.rm-bar i{display:block;height:100%;background:var(--ok);transition:width .4s}
.rm-gl{display:block;width:1.5px;height:14px;background:var(--mu);margin-left:14px}
.rm-gr{display:flex;gap:12px;align-items:flex-start;margin-left:6px}.rm-gr b{font-size:12px}.rm-gr small{display:block;color:var(--mu);font-size:12px;line-height:1.35}
.rm-dm{flex:none;width:16px;height:16px;transform:rotate(45deg);border:1.5px solid var(--mu);background:var(--sf);cursor:pointer;margin-top:4px;padding:0}
.rm-dm.key{border:2px solid var(--ac);background:color-mix(in srgb,var(--ac) 20%,var(--sf))}.rm-dm.on{background:var(--ok);border-color:var(--ok)}
.rm-addsub{width:170px;border:1.5px dashed var(--ln);border-radius:6px;background:none;color:var(--mu);padding:5px;cursor:pointer;font-size:13px}.rm-addsub:hover{border-color:var(--ac);color:var(--ac)}
.rm-scrim{position:fixed;inset:0;background:rgba(8,10,20,.5);z-index:50}
.rm-drawer{position:fixed;top:0;right:0;bottom:0;width:min(520px,100%);background:var(--sf);border-left:1px solid var(--ln);z-index:55;overflow:auto;padding:20px;transform:translateX(105%);transition:transform .25s;visibility:hidden}
.rm-drawer.open{transform:none;visibility:visible}
.rm-drawer section{margin-top:22px}.rm-drawer h3{font-size:16px;margin-bottom:8px}
.rm-h{font:700 22px var(--head)!important;margin-top:14px}
.rm-lb{font-size:12px;color:var(--mu);margin:14px 0 4px}
.rm-it{display:flex;gap:8px;align-items:flex-start;margin-bottom:8px}.rm-it .col{flex:1;display:grid;gap:6px;min-width:0}
.rm-it>input[type=checkbox]{margin-top:9px}
.rm-md{background:var(--bg);border:1px solid var(--ln);border-radius:8px;padding:6px 16px;min-height:60px}.rm-md h4{margin:14px 0 4px;font-size:16px}.rm-md p{margin:8px 0}.rm-md li{display:list-item;margin-left:18px}.rm-md code{background:var(--ln);padding:1px 5px;border-radius:5px}
.rm-link{color:var(--ac);text-decoration:none;font-weight:600;padding:6px 4px}
.rm-gform{display:grid;gap:8px;margin-top:8px}
@media(max-width:700px){.rm-row.l,.rm-row.r{flex-direction:column;gap:14px;padding:0}.rm-row.r{align-items:flex-end}.rm-subs{flex-direction:row;flex-wrap:wrap;padding:0}.rm-row.r .rm-subs{justify-content:flex-end}}
`
