import { Fragment, useEffect, useLayoutEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { addDays, addTodoToday, confetti, getStore, isHttp, isStored, notify, openNote, setStore, startOfDay, todayISO, uid, useStore } from './shared'
import { play } from './sound'
import { Icon, IconPicker } from './Icons'
import BlockEditor, { blocksText, blocksToMarkdown, cleanBlocks, mdToBlocks } from './BlockEditor'
import RoadmapShare from './RoadmapShare'
import { cleanIcon } from './iconUtils'
import { clampK, connPath, edgePath, ensureStructure, fitView, layoutMap, readingOrder, startView, structureOk } from './roadmapLayout'

/* ============================================================
   Roadmap: a learning path drawn as a tree you can zoom and move around
   - threads are parallel paths side by side; the first topic of a thread sits in the middle and the rest stack below it
   - side topics branch to the right of a topic; subtopics fan out to its left (new column after 5)
   - connections link any two topics, even across threads (see roadmapLayout.js)
   - gates sit under a topic
   - the connector line fills with colour when a topic (and its gate) is done
   - click any square to open its study notes, checklist, resources and projects
   ============================================================ */

const noop = () => {}
const PR = { must: 'Mandatory', rec: 'Recommended', nice: 'Nice to have', opt: 'Optional', adv: 'Advanced' }
const STATUS = { todo: 'Not started', doing: 'In progress', done: 'Done' }
const RES_TYPES = ['Docs', 'Video', 'Article', 'Course', 'Book']
const RES_TO_TODO = { Docs: 'article', Video: 'video', Article: 'article', Course: 'course', Book: 'book' }
// Each priority has its own colour (you can change them with the Colours button)
const DEFAULT_COLORS = { must: '#7c6cff', rec: '#3b9dff', nice: '#f5a524', opt: '#2fbfa8', adv: '#e255a1' }

/* ---------- data ---------- */
const norm = (t, top = true) => {
    const o = { id: uid(), title: '', desc: '', when: '', status: 'todo', priority: 'rec', notes: '', ref: null, ...t }
    o.steps = (t.steps || []).map(x => ({ id: uid(), t: '', done: false, ...x }))
    o.subs = top ? (t.subs || []).map(x => norm(x, false)) : []
    o.res = (t.res || []).map(x => ({ id: uid(), type: 'Docs', t: '', url: '', ...x }))
    o.proj = (t.proj || []).map(x => ({ id: uid(), t: '', desc: '', done: false, ...x }))
    if (top) o.lane = typeof t.lane === 'string' ? t.lane : ''
    else delete o.lane
    o.gate = top && t.gate ? { name: '', desc: '', highlight: false, done: false, ...t.gate } : null
    if (!PR[o.priority]) o.priority = 'rec'
    if (!STATUS[o.status]) o.status = 'todo'
    if (typeof o.ref !== 'string' || !o.ref) o.ref = null // id of another roadmap this item points to
    // A subtopic can mirror a topic of another roadmap: its status follows (and writes to) that topic
    o.mirror = top || !t.mirror || typeof t.mirror.map !== 'string' || typeof t.mirror.topic !== 'string' ? null : { map: t.mirror.map, topic: t.mirror.topic }
    o.est = Math.max(0, Number(t.est) || 0)
    o.icon = cleanIcon(t.icon)
    o.due = /^\d{4}-\d{2}-\d{2}$/.test(t.due || '') ? t.due : '' // optional deadline
    o.doneAt = Number(t.doneAt) || 0 // when it was marked done: feeds the pace forecast
    // "Study content": blocks (headings, lists, toggles, todos, code). null = never edited, then the old notes text is shown.
    o.content = Array.isArray(t.content) ? cleanBlocks(t.content) : null
    return o
}

// Old roadmaps get one thread and one path; threads, lanes (paths) and conns (connections) are kept when present
const normMap = m => ensureStructure({
    id: m.id || uid(),
    title: String(m.title == null ? 'Untitled roadmap' : m.title),
    topics: (m.topics || []).map(t => norm(t)),
    threads: Array.isArray(m.threads) ? m.threads : [],
    lanes: Array.isArray(m.lanes) ? m.lanes : [],
    conns: Array.isArray(m.conns) ? m.conns : [],
})

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
const hoursLeft = (topics, st) => topics.reduce((n, t) => {
    const subs = t.subs.filter(s => s.est > 0)
    if (subs.length) return n + subs.reduce((k, s) => k + (st(s) === 'done' ? 0 : s.est), 0)
    return n + (st(t) === 'done' ? 0 : t.est || 0)
}, 0)
/*
  Linked roadmaps: an item with a "ref" is done when every topic and subtopic of that roadmap is done.
  A subtopic with a "mirror" copies the status of one topic of another roadmap (and writes to it when you tick it).
  "chain" lists the roadmaps we are already inside, so a loop (A -> B -> A) can never run forever.
*/
const mirrorTarget = (t, maps) => (t.mirror && maps[t.mirror.map] ? maps[t.mirror.map].topics.find(x => x.id === t.mirror.topic) || null : null)

function effStatus(t, maps, chain = []) {
    const mirrored = mirrorTarget(t, maps)
    if (mirrored && !chain.includes(t.mirror.map)) {
        const next = [...chain, t.mirror.map]
        const s = effStatus(mirrored, maps, next)
        return s === 'done' ? 'done' : s === 'doing' || prog(mirrored, maps, next) > 0 ? 'doing' : 'todo'
    }
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
const prog = (t, maps, chain = []) => {
    if (typeof t.pct === 'number') return t.pct // a shared snapshot carries the finished number
    const m = mirrorTarget(t, maps)
    if (m && !chain.includes(t.mirror.map)) return prog(m, maps, [...chain, t.mirror.map])
    if (t.ref && maps[t.ref] && !chain.includes(t.ref)) return mapProgress(maps[t.ref], maps, [...chain, t.ref]).pct
    const u = [...t.steps, ...t.subs.map(s => ({ done: effStatus(s, maps, chain) === 'done' }))]
    return u.length ? Math.round((100 * u.filter(x => x.done).length) / u.length) : effStatus(t, maps, chain) === 'done' ? 100 : 0
}
const reid = x => {
    if (!x || typeof x !== 'object') return
    if (x.id) x.id = uid()
    Object.values(x).forEach(reid)
}
// Gives every object of a roadmap a new id AND rewrites the references between them (topic -> lane, lane -> thread / topic, connections).
// When to use it: when a roadmap is copied or imported, so the copy never touches the original.
const reidMap = m => {
    const ids = new Map()
    const walk = x => {
        if (!x || typeof x !== 'object') return
        if (x.id) {
            const n = uid()
            ids.set(x.id, n)
            x.id = n
        }
        Object.values(x).forEach(walk)
    }
    walk(m)
    const f = v => ids.get(v) || v
    ;(m.topics || []).forEach(t => { if (t.lane) t.lane = f(t.lane) })
    ;(m.lanes || []).forEach(l => {
        l.thread = f(l.thread)
        if (l.from) l.from = f(l.from)
    })
    ;(m.conns || []).forEach(c => {
        c.from = f(c.from)
        c.to = f(c.to)
    })
    return m
}

// Removes a topic from a draft roadmap and keeps the tree valid: side paths that grew out of it move to the nearest
// topic of its own path, connections to it are removed, and an emptied side path disappears.
const dropTopic = (d, id) => {
    const t = d.topics.find(x => x.id === id)
    if (!t) return
    const lane = d.lanes.find(l => l.id === t.lane)
    const peers = d.topics.filter(x => x.lane === t.lane)
    const i = peers.indexOf(t)
    const heir = peers[i - 1] || peers[i + 1] || null
    d.lanes.forEach(l => { if (l.from === id) l.from = heir ? heir.id : lane ? lane.from : null })
    d.topics.splice(d.topics.indexOf(t), 1)
    d.conns = d.conns.filter(c => c.from !== id && c.to !== id)
    if (!heir && lane) {
        const otherRoots = d.lanes.some(l => l.thread === lane.thread && !l.from && l.id !== lane.id)
        if (lane.from || otherRoots) d.lanes = d.lanes.filter(l => l.id !== lane.id)
    }
}

/* eslint-disable react-refresh/only-export-components */
// What it does: returns the user's roadmaps, even if they were never saved yet.
export const loadRoadmaps = () => getStore('roadmaps', initialStore)

// What it does: lists every roadmap with its progress (id, title, done, total, pct).
// When to use it: for small summaries, like the sidebar card.
export const roadmapList = store => store.order.filter(id => store.maps[id]).map(id => ({ id, title: store.maps[id].title || 'Untitled roadmap', ...mapProgress(store.maps[id], store.maps) }))

// What it does: makes a roadmap the open one and goes to the Roadmap page.
// When to use it: from a link in another page.
export function openRoadmap(id) {
    setStore('roadmaps', cur => (cur.maps[id] ? { ...cur, active: id } : cur), loadRoadmaps)
    window.location.hash = '/roadmap'
}

// What it does: finds the first unfinished mandatory item (or any unfinished item) of the open roadmap.
export function nextUp(store) {
    const raw = store.maps[store.active] || store.maps[store.order[0]]
    if (!raw) return null
    const m = structureOk(raw) ? raw : ensureStructure(structuredClone(raw))
    const left = readingOrder(m).flatMap(x => [x.t, ...x.t.subs]).filter(t => effStatus(t, store.maps) !== 'done')
    const t = left.find(x => x.priority === 'must') || left[0]
    return t ? { title: t.title || 'Untitled', icon: t.icon || '', roadmap: m.title, pct: mapProgress(m, store.maps).pct } : null
}
// What it does: turns one roadmap into plain data for friends. Linked roadmaps are already counted in
// the status and percentages. Notes, resources, checklist text and projects stay private.
// When to use it: when sharing a roadmap with a group.
export function snapshotRoadmap(store, id) {
    const maps = store.maps
    const m = structureOk(maps[id]) ? maps[id] : ensureStructure(structuredClone(maps[id]))
    const item = (t, top) => ({
        id: t.id, title: (t.title || 'Untitled').slice(0, 80), desc: (t.desc || '').slice(0, 200), when: (t.when || '').slice(0, 40), est: t.est || 0, lane: top ? t.lane : undefined, icon: t.icon && t.icon.length <= 6000 ? t.icon : '',
        priority: t.priority, status: effStatus(t, maps), pct: prog(t, maps), ref: null, mirror: null,
        subs: top ? t.subs.map(s => item(s, false)) : [],
        gate: top && t.gate ? { name: t.gate.name, desc: t.gate.desc, highlight: t.gate.highlight, done: t.gate.done } : null,
    })
    const colors = { ...DEFAULT_COLORS, ...(getStore('settings', {}).roadmapColors || {}) }
    return { v: 2, roadmap: { id: m.id, title: m.title, colors, threads: m.threads, lanes: m.lanes, conns: m.conns, topics: m.topics.map(t => item(t, true)) } }
}
/* eslint-enable react-refresh/only-export-components */

// What it does: estimates when a roadmap will be finished from how many items you completed in the last 28 days.
// When to use it: under the progress bar. Items finished before this feature existed have no date, so they are not counted.
const forecast = (items, st) => {
    const left = items.filter(t => st(t) !== 'done')
    const since = Date.now() - 28 * 86400000
    const recent = items.filter(t => st(t) === 'done' && t.doneAt && t.doneAt >= since).length
    if (!left.length) return { left: 0, perWeek: 0, date: null }
    if (!recent) return { left: left.length, perWeek: 0, date: null }
    const perDay = recent / 28
    const days = Math.ceil(left.length / perDay)
    return { left: left.length, perWeek: Math.round(perDay * 7 * 10) / 10, date: days > 730 ? 'in more than two years' : 'around ' + addDays(startOfDay(new Date()), days).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) }
}

// What it does: turns a roadmap into a Markdown checklist (threads, topics, subtopics, steps, projects, resources, notes, connections).
const toMarkdown = (data, maps) => {
    const box = t => (effStatus(t, maps) === 'done' ? '[x]' : '[ ]')
    const meta = t => [t.when, t.est > 0 && `${t.est} h`, t.due && `due ${t.due}`, PR[t.priority]].filter(Boolean).join(' · ')
    const nameOf = id => (data.topics.find(x => x.id === id) || {}).title || 'Untitled'
    const out = [`# ${data.title || 'Roadmap'}`, '']
    const order = readingOrder(data)
    data.threads.forEach(th => {
        if (data.threads.length > 1) out.push(`# Thread: ${th.title || 'Untitled'}`, '')
        order.filter(x => x.thread === th.id).forEach(({ t, depth }, i) => {
            out.push(`## ${i + 1}. ${t.title || 'Untitled'} (${STATUS[effStatus(t, maps)]})${depth ? ' · side topic' : ''}`)
            if (t.desc) out.push(`_${t.desc}_`)
            out.push(`- ${box(t)} ${t.title || 'Untitled'}${meta(t) ? ' · ' + meta(t) : ''}`)
            t.subs.forEach(x => out.push(`  - ${box(x)} ${x.title || 'Untitled'}${meta(x) ? ' · ' + meta(x) : ''}`))
            if (t.steps.length) out.push('', '**Steps**', ...t.steps.map(x => `- [${x.done ? 'x' : ' '}] ${x.t}`))
            if (t.proj.length) out.push('', '**Projects**', ...t.proj.map(x => `- [${x.done ? 'x' : ' '}] ${x.t}${x.desc ? ' · ' + x.desc : ''}`))
            if (t.res.length) out.push('', '**Resources**', ...t.res.map(x => `- ${x.type}: ${x.url ? `[${x.t || x.url}](${x.url})` : x.t}`))
            if (t.gate) out.push('', `**Gate:** ${t.gate.name}${t.gate.done ? ' (passed)' : ''}${t.gate.desc ? ' · ' + t.gate.desc : ''}`)
            if (t.content && t.content.length) out.push('', blocksToMarkdown(t.content))
            else if (t.notes) out.push('', t.notes)
            out.push('')
        })
    })
    if (data.conns.length) out.push('# Connections', '', ...data.conns.map(c => `- ${nameOf(c.from)} → ${nameOf(c.to)}`), '')
    return out.join('\n')
}

/* ---------- map pieces ---------- */
function Node({ t, n, dim, maps, onOpen, onToggle, onGoRef, readOnly, onMoveTo, style, sel, pickable, tools }) {
    const linked = t.ref && maps[t.ref] ? maps[t.ref] : null
    const mirrored = !linked && t.mirror && maps[t.mirror.map] ? maps[t.mirror.map] : null
    const goto = linked || mirrored
    const status = effStatus(t, maps)
    const late = Boolean(t.due) && status !== 'done' && t.due < todayISO()
    const meta = n ? [t.when, t.est > 0 && `${t.est} h`].filter(Boolean).join(' · ') : ''
    return (
        <div id={'rm-n-' + t.id} style={style} className={`rm-node p-${t.priority} ${status}${n ? '' : ' s'}${dim ? ' dim' : ''}${goto ? ' linked' : ''}${t.icon ? ' has-ic' : ''}${sel ? ' sel' : ''}${pickable ? ' pickable' : ''}`}
            onDragOver={e => { if (onMoveTo) e.preventDefault() }}
            onDrop={e => { if (!onMoveTo) return; e.preventDefault(); onMoveTo(e.dataTransfer.getData('text/plain'), t.id) }}>
            {onMoveTo && <span className="rm-drag" draggable onDragStart={e => e.dataTransfer.setData('text/plain', t.id)} title="Drag onto another topic of the same path to reorder" aria-hidden="true">⠿</span>}
            <button className="rm-chk" disabled={!!linked || readOnly}
                title={linked ? 'Done automatically when the linked roadmap is finished' : status === 'done' ? 'Mark as not done' : 'Mark as done'}
                aria-label={`Toggle ${t.title || 'item'} done`} aria-pressed={status === 'done'} onClick={e => onToggle(t, e.currentTarget)}>✓</button>
            {goto && <button className="rm-go" onClick={() => onGoRef(goto.id)} title={`Open the ${goto.title} roadmap`} aria-label={`Open the ${goto.title} roadmap`}>↗</button>}
            {t.icon && <span className="rm-ic" aria-hidden="true"><Icon value={t.icon} size={n ? 20 : 16} /></span>}
            <button className="rm-body" onClick={() => onOpen(t.id)}>
                <b>{n ? n + '. ' : ''}{t.title || 'Untitled'}</b>
                {meta && <em>{meta}</em>}
                {n && t.desc && <small>{t.desc}</small>}
                <span className="rm-foot">
                    <span className="rm-pr">{PR[t.priority]}</span>
                    {t.due && <span className={'rm-due' + (late ? ' late' : '')}>⏰ {t.due}{late ? ' · overdue' : ''}</span>}
                    {goto && <span className="rm-ref">↗ {goto.title}</span>}
                </span>
                {(n || goto) && <span className="rm-bar"><i style={{ width: prog(t, maps) + '%' }} /></span>}
            </button>
            {tools && (
                <div className="rm-act" role="toolbar" aria-label={`Actions for ${t.title || 'topic'}`}>
                    <button onClick={() => tools.addBelow(t.id)} title="Add a topic below this one" aria-label="Add a topic below">＋↓</button>
                    <button onClick={() => tools.addSide(t.id)} title="Add a side topic beside this one" aria-label="Add a side topic">＋→</button>
                    <button onClick={() => tools.startLink(t.id)} title="Connect this topic to another topic" aria-label="Connect to another topic">🔗</button>
                </div>
            )}
        </div>
    )
}

function Gate({ t, onToggle, style }) {
    const g = t.gate
    return (
        <div className="rm-gate" style={style}>
            <i className="rm-gl" />
            <div className="rm-gr">
                <button className={'rm-dm' + (g.highlight ? ' key' : '') + (g.done ? ' on' : '')} aria-label={`Gate ${g.name || ''}: ${g.done ? 'passed' : 'not passed'}`} aria-pressed={g.done}
                    title={g.done ? 'Gate passed' : 'Mark gate as passed'} onClick={() => onToggle(t)} />
                <div><b>{g.name || 'Gate'}</b>{g.desc && <small>{g.desc}</small>}</div>
            </div>
        </div>
    )
}

/* ---------- the canvas ---------- */
/*
   What it does: draws a roadmap as a tree you can zoom and move around, like a design tool.
   - The canvas is as tall as the roadmap, so the normal mouse wheel just scrolls the page. Ctrl + wheel (or a pinch) zooms.
   - Drag the empty background, or hold Space and drag anywhere, or drag with the middle mouse button, to move in every direction.
   - Left and right arrows move, + and - zoom, 0 fits the width, 1 goes back to 100 % (when the canvas has focus).
   - In full screen the canvas has a fixed size, so the wheel also moves it up and down.
   Positions come from layoutMap() (fixed box sizes), so nothing is measured from the page.
   The zoom and move are applied straight to the element (not through React state), so they stay smooth on big roadmaps.
   Props: data (a repaired roadmap), maps, st(item), vis(item), hideSubs, readOnly, apiRef (receives { focusNode, fit }),
   full, setFull, mode ({ kind, from } | null), sel (open item id), acts (handlers, null when read-only)
*/
const typing = el => Boolean(el) && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))
const PADY = 20 // space above the roadmap inside the canvas
const MINH = 360 // an almost empty roadmap still gets a usable canvas
const NOACTS = { open: noop, toggle: noop, toggleGate: noop, goRef: noop }
const ITEM = '.rm-node,.rm-gate,.rm-th,.rm-addsub,.rm-addfirst,.rm-zoombar,.rm-banner,.rm-cx,.rm-chit,button,input,select,textarea,a'

function Canvas({ data, maps, st, vis, hideSubs, readOnly, apiRef, full, setFull, mode, sel, acts }) {
    const editable = !readOnly
    const A = acts || NOACTS
    const L = useMemo(() => layoutMap(data, { showSubs: !hideSubs, editable }), [data, hideSubs, editable])
    const vpRef = useRef(null)
    const worldRef = useRef(null)
    const labelRef = useRef(null)
    const view = useRef({ x: 0, y: 0, k: 1 })
    const latest = useRef({})
    const pointers = useRef(new Map())
    const drag = useRef(null)
    const pinch = useRef(null)
    const space = useRef(false)
    const hover = useRef(false)
    const firstFull = useRef(true)
    const shownMap = useRef('')
    const [selConn, setSelConn] = useState(null)
    const [armedThread, setArmedThread] = useState(null)
    const mark = useId().replace(/[^a-zA-Z0-9_-]/g, '')

    const size = () => {
        const r = vpRef.current.getBoundingClientRect()
        return { w: r.width, h: r.height, left: r.left, top: r.top }
    }
    // Writes the view straight to the page (no React state), so zoom and move stay smooth.
    // Outside full screen the canvas is exactly as tall as the roadmap at this zoom.
    const apply = (animate = false) => {
        const w = worldRef.current
        const vp = vpRef.current
        if (!w || !vp) return
        const v = view.current
        const { L: lay, full: isFull } = latest.current
        const boxH = Math.max(MINH, Math.ceil(lay.height * v.k + PADY * 2))
        vp.style.height = isFull ? '' : boxH + 'px'
        // Dragging up and down is allowed, but the roadmap can never leave the canvas completely
        if (!isFull) v.y = Math.min(boxH - 120, Math.max(120 - lay.height * v.k, v.y))
        w.classList.toggle('anim', animate)
        w.style.transform = `translate(${v.x}px,${v.y}px) scale(${v.k})`
        vp.style.backgroundPosition = `${v.x}px ${v.y}px`
        vp.style.backgroundSize = `${24 * v.k}px ${24 * v.k}px`
        if (labelRef.current) labelRef.current.textContent = Math.round(v.k * 100) + '%'
    }
    const pan = (dx, dy) => {
        view.current.x += dx
        view.current.y += dy
        apply()
    }
    // Zoom by a factor around a point of the canvas (cx, cy in pixels from its top-left corner).
    // Outside full screen the page is scrolled by the same amount, so the point under the pointer stays under the pointer.
    const zoomAt = (factor, cx, cy, animate = false) => {
        const v = view.current
        const k = clampK(v.k * factor)
        if (k === v.k) return
        const r = k / v.k
        const isFull = latest.current.full
        // Outside full screen the top edge of the canvas stays put and the page scrolls instead (see below)
        view.current = { k, x: cx - (cx - v.x) * r, y: isFull ? cy - (cy - v.y) * r : PADY + (v.y - PADY) * r }
        apply(animate)
        if (!isFull) window.scrollBy(0, (r - 1) * (cy - PADY))
    }
    const zoomCenter = factor => {
        const s = size()
        const cy = latest.current.full ? s.h / 2 : Math.min(s.h, Math.max(0, window.innerHeight / 2 - s.top))
        zoomAt(factor, s.w / 2, cy, true)
    }
    const fit = () => {
        const s = size()
        const lay = latest.current.L
        view.current = latest.current.full ? fitView(lay, s.w, s.h) : { k: clampK(Math.min(1, (s.w - 80) / lay.width)), x: 0, y: PADY }
        if (!latest.current.full) view.current.x = Math.max(20, (s.w - lay.width * view.current.k) / 2)
        apply(true)
    }
    const actual = () => zoomCenter(1 / view.current.k)
    // Bring a topic into view (used after adding one, and by "Continue"). drawer: keep it clear of the side panel.
    const focusNode = (id, opts = {}) => {
        const lay = latest.current.L
        const r = lay.nodes.get(id) || lay.subs.get(id)
        if (!r || !vpRef.current) return
        const s = size()
        const room = opts.drawer ? Math.max(260, Math.min(s.w, window.innerWidth - 520 - s.left)) : s.w
        const v = view.current
        if (latest.current.full) {
            const k = clampK(Math.min(1.2, Math.max(v.k, 0.7)))
            view.current = { k, x: room / 2 - (r.x + r.w / 2) * k, y: s.h / 2 - (r.y + r.h / 2) * k }
            apply(true)
            return
        }
        view.current = { k: v.k, x: room / 2 - (r.x + r.w / 2) * v.k, y: PADY }
        apply(true)
        const top = s.top + PADY + (r.y + r.h / 2) * v.k
        window.scrollBy({ top: top - window.innerHeight / 2, behavior: 'smooth' })
    }

    // The listeners below are added once, so they read the newest functions from here
    useLayoutEffect(() => {
        latest.current = { L, full, zoomAt, pan, zoomCenter, fit, actual, focusNode, apply }
    })
    useLayoutEffect(() => {
        if (apiRef) apiRef.current = { focusNode: (id, o) => latest.current.focusNode(id, o), fit: () => latest.current.fit() }
    }, [apiRef])

    // First view of a roadmap: readable size, centred, starting at the top
    useLayoutEffect(() => {
        if (shownMap.current === data.id) return
        shownMap.current = data.id
        view.current = startView(L, size().w)
        apply()
    })
    // The roadmap grew or shrank: the canvas height follows it
    useLayoutEffect(() => { apply() }, [L]) // eslint-disable-line react-hooks/exhaustive-deps
    // Entering or leaving full screen: show a sensible view for the new size
    useLayoutEffect(() => {
        if (firstFull.current) {
            firstFull.current = false
            return
        }
        if (full) vpRef.current.style.height = ''
        const s = size()
        view.current = full ? fitView(L, s.w, s.h) : startView(L, s.w)
        apply()
    }, [full]) // eslint-disable-line react-hooks/exhaustive-deps

    // Ctrl + wheel and trackpad pinch zoom. The plain wheel is left alone, so the page scrolls (the canvas is as tall as the roadmap).
    // Needs a non-passive listener to be allowed to stop the browser from zooming the whole page.
    useEffect(() => {
        const el = vpRef.current
        const onWheel = e => {
            const { zoomAt: zoom, pan: move, full: isFull } = latest.current
            const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1
            const dx = e.deltaX * unit
            const dy = e.deltaY * unit
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault()
                const r = el.getBoundingClientRect()
                const pinch = Math.abs(dy) < 40 // a pinch sends many tiny steps, a mouse wheel sends big ones
                zoom(Math.exp(-dy * (pinch ? 0.01 : 0.0015)), e.clientX - r.left, e.clientY - r.top)
            } else if (e.shiftKey || Math.abs(dx) > Math.abs(dy)) {
                e.preventDefault()
                move(-(dx || dy), 0)
            } else if (isFull) {
                e.preventDefault()
                move(0, -dy)
            }
        }
        el.addEventListener('wheel', onWheel, { passive: false })
        return () => el.removeEventListener('wheel', onWheel)
    }, [])

    // Hold Space to move the canvas with the mouse (only while the pointer is over it, and never while typing)
    useEffect(() => {
        const vp = vpRef.current
        const clear = () => {
            space.current = false
            vp.classList.remove('pan-ready')
        }
        const down = e => {
            if (e.code !== 'Space' || typing(e.target) || document.querySelector('.modal-back')) return
            if (!(hover.current || document.activeElement === vp)) return
            e.preventDefault()
            if (!space.current) {
                space.current = true
                vp.classList.add('pan-ready')
            }
        }
        const up = e => {
            if (e.code !== 'Space' || !space.current) return
            e.preventDefault()
            clear()
        }
        window.addEventListener('keydown', down)
        window.addEventListener('keyup', up)
        window.addEventListener('blur', clear)
        return () => {
            window.removeEventListener('keydown', down)
            window.removeEventListener('keyup', up)
            window.removeEventListener('blur', clear)
        }
    }, [])

    const onPointerDown = e => {
        if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) return
        const onItem = e.target.closest(ITEM)
        if (!(e.button === 1 || space.current || !onItem)) return
        e.preventDefault()
        setSelConn(null)
        vpRef.current.focus({ preventScroll: true })
        vpRef.current.setPointerCapture(e.pointerId)
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
        const v = view.current
        if (pointers.current.size === 1) {
            drag.current = { sx: e.clientX, sy: e.clientY, vx: v.x, vy: v.y }
            vpRef.current.classList.add('panning')
        } else if (pointers.current.size === 2) {
            const [a, b] = [...pointers.current.values()]
            const r = vpRef.current.getBoundingClientRect()
            pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, cx: (a.x + b.x) / 2 - r.left, cy: (a.y + b.y) / 2 - r.top, v: { ...v } }
            drag.current = null
        }
    }
    const onPointerMove = e => {
        if (!pointers.current.has(e.pointerId)) return
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
        if (pinch.current && pointers.current.size >= 2) {
            const [a, b] = [...pointers.current.values()]
            const r = vpRef.current.getBoundingClientRect()
            const p = pinch.current
            const k = clampK(p.v.k * (Math.hypot(a.x - b.x, a.y - b.y) / p.d))
            const cx = (a.x + b.x) / 2 - r.left
            const cy = (a.y + b.y) / 2 - r.top
            const wx = (p.cx - p.v.x) / p.v.k
            const wy = (p.cy - p.v.y) / p.v.k
            view.current = { k, x: cx - wx * k, y: cy - wy * k }
            apply()
        } else if (drag.current) {
            const d = drag.current
            view.current.x = d.vx + e.clientX - d.sx
            view.current.y = d.vy + e.clientY - d.sy
            apply()
        }
    }
    const onPointerEnd = e => {
        pointers.current.delete(e.pointerId)
        if (pointers.current.size < 2) pinch.current = null
        if (!pointers.current.size) {
            drag.current = null
            vpRef.current.classList.remove('panning')
        } else if (pointers.current.size === 1) {
            const [p] = [...pointers.current.values()]
            drag.current = { sx: p.x, sy: p.y, vx: view.current.x, vy: view.current.y }
        }
    }
    const onKeyDown = e => {
        if (typing(e.target) || e.target.closest('button') || e.ctrlKey || e.metaKey || e.altKey) return
        const step = e.shiftKey ? 240 : 80
        const k = e.key
        const isFull = latest.current.full
        if (k === 'ArrowLeft') pan(step, 0)
        else if (k === 'ArrowRight') pan(-step, 0)
        else if (k === 'ArrowUp' && isFull) pan(0, step)
        else if (k === 'ArrowDown' && isFull) pan(0, -step)
        else if (k === '+' || k === '=') zoomCenter(1.25)
        else if (k === '-' || k === '_') zoomCenter(1 / 1.25)
        else if (k === '0') fit()
        else if (k === '1') actual()
        else return
        e.preventDefault()
    }

    /* ----- what to draw ----- */
    const byId = new Map()
    data.topics.forEach(t => {
        byId.set(t.id, t)
        t.subs.forEach(s => byId.set(s.id, s))
    })
    const laneThread = new Map(data.lanes.map(l => [l.id, l.thread]))
    const stats = new Map(data.threads.map(th => [th.id, { done: 0, total: 0 }]))
    data.topics.forEach(t => {
        const s = stats.get(laneThread.get(t.lane))
        if (!s) return
        ;[t, ...t.subs].forEach(x => {
            s.total += 1
            if (st(x) === 'done') s.done += 1
        })
    })
    const passed = t => Boolean(t) && st(t) === 'done' && (!t.gate || t.gate.done)
    const edgeOn = e => {
        if (e.k === 'main' || e.k === 'side') return passed(byId.get(e.a))
        if (e.k === 'head') return Boolean(byId.get(e.b)) && st(byId.get(e.b)) !== 'todo'
        return Boolean(byId.get(e.b)) && st(byId.get(e.b)) === 'done'
    }
    const conn = selConn && data.conns.find(c => c.id === selConn)
    const connMid = conn && L.nodes.get(conn.from) && L.nodes.get(conn.to) ? connPath(L.nodes.get(conn.from), L.nodes.get(conn.to)).mid : null

    return (
        <div className={'rm-cv' + (full ? ' full' : '')}>
        {mode && (
            <div className="rm-dock rm-dock-top">
                <div className="rm-banner" role="status">
                    <span>{mode.kind === 'side' ? 'Side topic: click the topic it should branch from' : mode.from ? 'Connect: now click the topic it leads to' : 'Connect: click the topic to start from'}</span>
                    <button className="btn sm" onClick={A.cancelMode}>Cancel (Esc)</button>
                </div>
            </div>
        )}
        <div ref={vpRef} tabIndex={0} role="application" className={'rm-vp' + (mode ? ' moding' : '')}
            aria-label="Roadmap canvas. Hold Control and scroll to zoom. Drag the background, or hold Space and drag, to move. Left and right arrows move, plus and minus zoom, 0 fits the width."
            onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd} onKeyDown={onKeyDown}
            onMouseEnter={() => { hover.current = true }} onMouseLeave={() => { hover.current = false }}>
            <div className="rm-world" ref={worldRef} style={{ width: L.width, height: L.height }}>
                <svg className="rm-ov" width={L.width} height={L.height} aria-hidden="true">
                    <defs>
                        {['0', '1'].map(c => (
                            <marker key={c} id={`${mark}-${c}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto" markerUnits="userSpaceOnUse">
                                <path d="M0 0L10 5L0 10z" className={'rm-ar' + c} />
                            </marker>
                        ))}
                    </defs>
                    {L.edges.map(e => {
                        const d = edgePath(e, L)
                        if (!d) return null
                        const on = edgeOn(e)
                        const key = `${e.k}:${e.a}:${e.b}`
                        if (e.k === 'sub' || e.k === 'subcol') return <path key={key} className={'rm-sl' + (on ? ' on' : '')} d={d} />
                        return (
                            <g key={key}>
                                <path className="rm-base" d={d} />
                                <path className={'rm-fill' + (on ? ' on' : '')} pathLength={1} d={d} />
                            </g>
                        )
                    })}
                    {data.conns.map(c => {
                        const a = L.nodes.get(c.from)
                        const b = L.nodes.get(c.to)
                        if (!a || !b) return null
                        const p = connPath(a, b)
                        const on = passed(byId.get(c.from))
                        return (
                            <g key={c.id}>
                                <path className={'rm-cn' + (on ? ' on' : '') + (selConn === c.id ? ' sel' : '')} d={p.d} markerEnd={`url(#${mark}-${on ? '1' : '0'})`} />
                                {editable && <path className="rm-chit" d={p.d} onClick={e => { e.stopPropagation(); setSelConn(selConn === c.id ? null : c.id) }} />}
                            </g>
                        )
                    })}
                </svg>

                {L.threads.map(th => {
                    const s = stats.get(th.id) || { done: 0, total: 0 }
                    const pct = s.total ? Math.round((100 * s.done) / s.total) : 0
                    const i = data.threads.findIndex(x => x.id === th.id)
                    return (
                        <div key={th.id} className="rm-th" style={{ left: th.head.x, top: th.head.y, width: th.head.w, height: th.head.h }}>
                            {editable
                                ? <input className="rm-thi" value={th.title} placeholder="Thread name" aria-label="Thread name" maxLength={60} onChange={e => A.renameThread(th.id, e.target.value)} />
                                : <b className="rm-thi">{th.title || 'Thread'}</b>}
                            <span className="rm-thp" title={`${s.done} of ${s.total} items done in this thread`}>{pct}%</span>
                            <span className="rm-bar"><i style={{ width: pct + '%' }} /></span>
                            {editable && (
                                <div className="rm-thb" role="toolbar" aria-label="Thread actions">
                                    <button onClick={() => A.addThreadTopic(th.id)} title="Add a topic to this thread">＋ Topic</button>
                                    <button disabled={i < 1} onClick={() => A.moveThread(th.id, -1)} title="Move this thread left" aria-label="Move thread left">←</button>
                                    <button disabled={i >= data.threads.length - 1} onClick={() => A.moveThread(th.id, 1)} title="Move this thread right" aria-label="Move thread right">→</button>
                                    <button className="danger" disabled={data.threads.length < 2} aria-label="Delete thread" title="Delete this thread and its topics"
                                        onClick={() => { if (armedThread === th.id) { setArmedThread(null); A.deleteThread(th.id) } else setArmedThread(th.id) }}
                                        onBlur={() => setArmedThread(null)}>{armedThread === th.id ? 'Click again' : '🗑'}</button>
                                </div>
                            )}
                            {editable && !th.first && (
                                <button className="rm-addfirst" style={{ top: th.head.h + 22 }} onClick={() => A.addThreadTopic(th.id)}>+ Add the first topic</button>
                            )}
                        </div>
                    )
                })}

                {data.topics.map(t => {
                    const r = L.nodes.get(t.id)
                    if (!r) return null
                    const g = L.gates.get(t.id)
                    const ad = L.adds.get(t.id)
                    return (
                        <Fragment key={t.id}>
                            <Node t={t} n={r.n} maps={maps} style={{ left: r.x, top: r.y }} dim={!(vis(t) || t.subs.some(vis))} sel={sel === t.id} pickable={Boolean(mode)} readOnly={readOnly}
                                onMoveTo={editable ? A.reorder : undefined} onOpen={A.open} onToggle={A.toggle} onGoRef={A.goRef}
                                tools={editable ? { addBelow: A.addBelow, addSide: A.addSide, startLink: A.startLink } : null} />
                            {g && <Gate t={t} onToggle={A.toggleGate} style={{ left: g.x, top: g.y, width: g.w }} />}
                            {t.subs.map(s => {
                                const sr = L.subs.get(s.id)
                                if (!sr) return null
                                return <Node key={s.id} t={s} maps={maps} style={{ left: sr.x, top: sr.y }} dim={!vis(s)} sel={sel === s.id} readOnly={readOnly} onMoveTo={editable ? A.reorder : undefined} onOpen={A.open} onToggle={A.toggle} onGoRef={A.goRef} />
                            })}
                            {editable && ad && <button className="rm-addsub" style={{ left: ad.x, top: ad.y, width: ad.w }} onClick={() => A.addSub(t)}>+ Subtopic</button>}
                        </Fragment>
                    )
                })}

                {editable && conn && connMid && (
                    <button className="rm-cx" style={{ left: connMid.x, top: connMid.y }} onClick={() => { A.removeConn(conn.id); setSelConn(null) }}>✕ Remove connection</button>
                )}
            </div>

        </div>
        <div className="rm-dock rm-dock-bot">
            <div className="rm-zoombar" role="toolbar" aria-label="Zoom and view">
                <button onClick={() => zoomCenter(1 / 1.25)} title="Zoom out (-)" aria-label="Zoom out">−</button>
                <button className="rm-zl" onClick={actual} title="Back to 100 % (1)" aria-label="Reset zoom to 100 percent"><span ref={labelRef} /></button>
                <button onClick={() => zoomCenter(1.25)} title="Zoom in (+)" aria-label="Zoom in">＋</button>
                <button onClick={fit} title="Fit the roadmap to the width (0)">Fit</button>
                <button onClick={() => setFull(!full)} aria-pressed={full} title={full ? 'Leave full screen (Esc)' : 'Full screen'} aria-label={full ? 'Leave full screen' : 'Full screen'}>{full ? '⤡' : '⤢'}</button>
            </div>
            <p className="rm-hint" aria-hidden="true">Ctrl + scroll: zoom · Drag or hold Space + drag: move</p>
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

// Notes that were linked to this topic from the Notes page
function LinkedNotes({ topicId }) {
    const [notes] = useStore('notes', [])
    const list = (Array.isArray(notes) ? notes : []).filter(n => n.link && n.link.topic === topicId && !n.trashed)
    if (!list.length) return null
    return (
        <div>
            <div className="rm-lb">Linked notes</div>
            <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                {list.map(n => <button key={n.id} className="btn sm ghost" onClick={() => openNote(n.id)}>📝 {n.title || 'Untitled note'}</button>)}
            </div>
        </div>
    )
}

function Drawer({ data, maps, order, currentId, sel, setSel, api, onOpenRoadmap }) {
    const hit = sel && locate(data, sel)
    const [armed, setArmed] = useState(false)
    const lastSel = useRef(null)
    const nf = useRef(null)

    // Forget the "click again" warning when a different item opens
    useEffect(() => {
        if (sel !== lastSel.current) {
            lastSel.current = sel
            setArmed(false)
        }
    }, [sel])

    // Study content. Items that only have old notes text show that text as blocks; the first edit saves it as blocks.
    const topic = hit ? hit.t : null
    const content = useMemo(() => {
        if (!topic) return []
        return topic.content ? cleanBlocks(topic.content) : mdToBlocks(topic.notes)
    }, [topic && topic.id, topic && topic.content, topic && topic.notes]) // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (!nf.current) return
        const el = document.querySelector(`.rm-drawer [data-row="${nf.current}"] input[type=text]`)
        if (el) el.focus()
        nf.current = null
    })

    if (!hit) return <aside className="rm-drawer" aria-hidden="true" />
    const { t, p} = hit
    const close = () => setSel(null)

    const topText = (key, ph, extra) => <input type="text" value={t[key] || ''} placeholder={ph} aria-label={ph} onChange={e => api.patch(t.id, { [key]: e.target.value })} {...extra} />
    const linked = t.ref && maps[t.ref] ? maps[t.ref] : null
    const mirrored = !linked && t.mirror && maps[t.mirror.map] ? maps[t.mirror.map] : null
    const seg = (label, opts, key, disabled) => (
        <div>
            <div className="rm-lb">{label}</div>
            <div className="row">
                {Object.entries(opts).map(([v, l]) => <button key={v} disabled={disabled} className={'btn sm' + ((key === 'status' ? effStatus(t, maps) : t[key]) === v ? ' on' : '')} onClick={() => (key === 'status' ? api.setStatus(t, v) : api.patch(t.id, { [key]: v }))}>{l}</button>)}
            </div>
        </div>
    )
    const add = (key, item) => {
        nf.current = item.id
        api.addIn(t.id, key, item)
    }
    const sendToday = (label, type, url = '') => {
        if (!label.trim()) return
        addTodoToday({ text: label.trim(), type, link: isHttp(url) ? url : '' })
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
            <div className="rm-lb">Icon</div>
            <IconPicker value={t.icon} allowNone onChange={v => api.patch(t.id, { icon: v })} />
            {t.icon && <button className="btn sm" style={{ marginTop: 6 }} onClick={() => api.patch(t.id, { icon: '' })}>Remove icon</button>}
            <div className="row" style={{ marginTop: 8 }}>
                <div className="grow">{topText('desc', 'Short description')}</div>
                <div style={{ width: 140 }}>{topText('when', 'Timeframe')}</div>
            </div>
            <label className="field" style={{ marginTop: 8 }}><span>Estimate (hours)</span>
                <input type="number" min="0" step="0.5" value={t.est || ''} onChange={e => api.patch(t.id, { est: Math.max(0, Number(e.target.value) || 0) })} />
            </label>
            <label className="field" style={{ marginTop: 8 }}><span>Deadline (optional)</span>
                <input type="date" value={t.due || ''} onChange={e => api.patch(t.id, { due: e.target.value })} />
            </label>
            <LinkedNotes topicId={t.id} />
            <div>
                <div className="rm-lb">Linked roadmap</div>
                <select value={t.ref || ''} aria-label="Linked roadmap" onChange={e => api.setRef(t.id, e.target.value || null)}>
                    <option value="">None</option>
                    {order.filter(id => id !== currentId).map(id => {
                        const loops = reaches(maps, id, currentId)
                        return <option key={id} value={id} disabled={loops}>{maps[id].title || 'Untitled roadmap'}{loops ? ' (would loop back here)' : ''}</option>
                    })}
                </select>
                {!t.ref && <button className="btn sm" style={{ marginTop: 8 }} onClick={() => api.makeRoadmap(t.id)} title="Makes a new roadmap from this item. Progress you make there shows up here.">Create its own roadmap</button>}
                {mirrored && (
                    <div className="rm-linkbox">
                        <p className="small" style={{ margin: 0 }}>This subtopic follows a topic of <b>{mirrored.title}</b>. Tick it here or there, it is the same progress.</p>
                        <div className="row"><button className="btn sm" onClick={() => onOpenRoadmap(mirrored.id)}>Open roadmap →</button></div>
                    </div>
                )}
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
                <h3>Study content</h3>
                <p className="muted small" style={{ margin: '2px 0 8px' }}>Type like a notebook: headings, bulleted and numbered points, toggles, to-dos, code and dividers. Tab nests a line, Enter makes the next one.</p>
                <BlockEditor key={t.id} label="Study content" value={content} onChange={blocks => api.patch(t.id, { content: blocks })} />
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
                            <input type="checkbox" checked={effStatus(x, maps) === 'done'} disabled={!!(x.ref && maps[x.ref])} title={x.ref && maps[x.ref] ? 'Follows the linked roadmap' : undefined} aria-label="Done" onChange={e => { api.setStatus(x, e.target.checked ? 'done' : 'todo') }} />
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

            {!p && (
                <section>
                    <h3>Branches and connections</h3>
                    <p className="muted small" style={{ margin: '2px 0 8px' }}>Add the next topic under this one, or a side topic beside it. A connection links this topic to any other topic, even in another thread.</p>
                    <div className="row">
                        <button className="btn sm" onClick={() => api.addBelow(t.id)}>+ Topic below</button>
                        <button className="btn sm" onClick={() => api.addSide(t.id)}>+ Side topic</button>
                    </div>
                    {data.conns.filter(c => c.from === t.id || c.to === t.id).map(c => {
                        const other = data.topics.find(x => x.id === (c.from === t.id ? c.to : c.from))
                        return (
                            <div key={c.id} className="rm-it" style={{ marginTop: 8, alignItems: 'center' }}>
                                <span className="grow small">{c.from === t.id ? '→ leads to' : '← comes from'} <b>{other ? other.title || 'Untitled' : '?'}</b></span>
                                <button className="icon-btn" onClick={() => api.removeConn(c.id)} title="Remove connection" aria-label="Remove connection">×</button>
                            </div>
                        )
                    })}
                    <select value="" aria-label="Connect to another topic" style={{ marginTop: 8 }} onChange={e => { if (e.target.value) api.addConn(t.id, e.target.value) }}>
                        <option value="">Connect this topic to…</option>
                        {data.threads.map(th => (
                            <optgroup key={th.id} label={th.title || 'Untitled thread'}>
                                {data.topics.filter(x => x.id !== t.id && (data.lanes.find(l => l.id === x.lane) || {}).thread === th.id && !data.conns.some(c => c.from === t.id && c.to === x.id)).map(x => <option key={x.id} value={x.id}>{x.title || 'Untitled'}</option>)}
                            </optgroup>
                        ))}
                    </select>
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
                                <button className="btn sm ghost" title="Add to today's todos" onClick={() => sendToday(x.t || x.url, RES_TO_TODO[x.type] || 'task', x.url)}>→ Today</button>
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
    const [count, setCount] = useState(1)
    const [names, setNames] = useState(['', '', '', ''])
    const threadNames = Array.from({ length: count }, (_, i) => names[i].trim() || (count === 1 ? 'Main path' : `Thread ${i + 1}`))
    return (
        <div className="modal-back" onMouseDown={e => e.target === e.currentTarget && onClose()}>
            <form className="modal" role="dialog" aria-label="New roadmap" onSubmit={e => { e.preventDefault(); onCreate(title.trim(), template, threadNames) }}>
                <h2>New roadmap</h2>
                <label className="field"><span>Name</span>
                    <input autoFocus value={title} onChange={e => setTitle(e.target.value)} placeholder="Python, DevOps, Data science…" />
                </label>
                <div className="field"><span>Start from</span>
                    <div className="row">
                        <button type="button" className={'btn sm' + (template === 'blank' ? ' on' : '')} onClick={() => setTemplate('blank')}>Empty roadmap</button>
                        <button type="button" className={'btn sm' + (template === 'copy' ? ' on' : '')} onClick={() => setTemplate('copy')}>Copy of “{currentTitle || 'this roadmap'}” (with its threads)</button>
                    </div>
                </div>
                {template === 'blank' && (
                    <div className="field"><span>Threads: parallel paths that sit side by side</span>
                        <div className="row">
                            {[1, 2, 3, 4].map(n => <button key={n} type="button" className={'btn sm' + (count === n ? ' on' : '')} aria-pressed={count === n} onClick={() => setCount(n)}>{n}</button>)}
                        </div>
                        {Array.from({ length: count }, (_, i) => (
                            <input key={i} style={{ marginTop: 6 }} value={names[i]} maxLength={60} aria-label={`Name of thread ${i + 1}`} placeholder={count === 1 ? 'Main path' : `Thread ${i + 1} (for example Frontend)`}
                                onChange={e => setNames(cur => cur.map((x, j) => (j === i ? e.target.value : x)))} />
                        ))}
                    </div>
                )}
                <p className="muted small" style={{ margin: '4px 0 10px' }}>
                    After creating it: hover a topic and use <b>＋↓</b> to add the next topic, <b>＋→</b> for a side topic beside it, and <b>🔗</b> to connect it to any other topic, even in another thread.
                    The same actions are in the toolbar (<b>+ Thread</b>, <b>+ Side topic</b>, <b>Connect</b>).
                </p>
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
    const [mapQuery, setMapQuery] = useState('') // filters the roadmap tabs, not the topics
    const [pf, setPf] = useState(null)
    const [sf, setSf] = useState(null) // status filter: todo | doing | done
    const [hist, setHist] = useState({ u: 0, r: 0 })
    const past = useRef([])
    const future = useRef([])
    const lastStore = useRef(null)
    const lastChange = useRef(0)
    const restoring = useRef(false)
    const [hideSubs, setHideSubs] = useState(false)
    const [backup, setBackup] = useState(false)
    const [sharing, setSharing] = useState(false)
    const [creating, setCreating] = useState(false)
    const [colorsOpen, setColorsOpen] = useState(false)
    const [menu, setMenu] = useState(null) // null when closed, otherwise where the menu opens
    const [armed, setArmed] = useState(false)
    const [trail, setTrail] = useState([]) // roadmaps we came from when following a link
    const menuBtn = useRef(null)
    const prevPct = useRef(null)
    const canvasApi = useRef(null)
    const [mode, setMode] = useState(null) // null | { kind: 'side' | 'link', from }
    const [full, setFull] = useState(false)

    const maps = store.maps
    const activeId = maps[store.active] ? store.active : store.order[0]
    const rawData = maps[activeId] || { id: '', title: '', topics: [] }
    // A roadmap saved before threads existed is repaired on the fly (and saved properly on the first edit)
    const data = useMemo(() => (rawData.id && structureOk(rawData) ? rawData : ensureStructure(structuredClone(rawData))), [rawData])

    // Copies for other accounts (see RoadmapShare.jsx). Links to other roadmaps are cut, because those roadmaps do not exist for the receiver.
    const cutLinks = m => {
        m.topics.forEach(t => { t.ref = null; t.mirror = null; t.subs.forEach(x => { x.ref = null; x.mirror = null }) })
        return m
    }
    const exportForShare = () => cutLinks(JSON.parse(JSON.stringify(data)))
    const importShared = (raw, keepProgress) => {
        if (!raw || !Array.isArray(raw.topics)) throw new Error('This share does not contain a roadmap.')
        const copy = cutLinks(JSON.parse(JSON.stringify(normMap({ ...raw, id: uid() }))))
        reidMap(copy) // new ids everywhere (and the links between them), so the copy never touches the original
        if (!keepProgress) {
            copy.topics.forEach(t => {
                ;[t, ...t.subs].forEach(x => {
                    x.status = 'todo'
                    x.doneAt = 0
                    x.steps.forEach(st => { st.done = false })
                    x.proj.forEach(pr => { pr.done = false })
                })
                if (t.gate) t.gate.done = false
            })
        }
        const m = normMap(copy)
        setRoadmaps({ order: [...store.order, m.id], active: m.id, maps: { ...store.maps, [m.id]: m } })
        return m.title
    }
    const colors = { ...DEFAULT_COLORS, ...(settings.roadmapColors || {}) }
    const st = t => effStatus(t, maps)

    // Someone with the old single roadmap: save it as the first of their roadmaps
    useEffect(() => {
        if (!isStored('roadmaps') && isStored('roadmap')) setRoadmaps(getStore('roadmaps', initialStore))
    }, []) // eslint-disable-line react-hooks/exhaustive-deps

    // Edit the roadmap that is open
    const update = fn => updateStore(d => {
        const m = d.maps[activeId]
        if (m) {
            ensureStructure(m)
            fn(m)
        }
    })
    const focusSoon = id => setTimeout(() => canvasApi.current && canvasApi.current.focusNode(id, { drawer: true }), 70)

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
        // Change the status of an item. A mirrored subtopic writes to the topic it follows, so both roadmaps agree.
        setStatus: (item, status) => {
            updateStore(d => {
            const target = item.mirror && d.maps[item.mirror.map] && d.maps[item.mirror.map].topics.find(x => x.id === item.mirror.topic)
            const own = d.maps[activeId] && locate(d.maps[activeId], item.id)
            const h = target ? { t: target } : own
            if (h) {
                h.t.status = status
                h.t.doneAt = status === 'done' ? Date.now() : 0
            }
            })
            // three different sounds: done, in progress, not started (checkbox and panel buttons both end up here)
            play(status === 'done' ? 'statusdone' : status === 'doing' ? 'statuswip' : 'statustodo')
        },
        // Turns an item into its own roadmap. Its subtopics become the topics of the new roadmap and stay
        // connected: ticking one in either roadmap ticks it in both, and the item shows the new roadmap's progress.
        makeRoadmap: id => {
            const h = locate(data, id)
            if (!h) return
            const newId = uid()
            const pairs = []
            const seed = h.t.subs.map(sub => {
                const copy = JSON.parse(JSON.stringify(sub))
                copy.subs = []
                copy.mirror = null
                reid(copy)
                pairs.push([sub.id, copy.id])
                return copy
            })
            updateStore(d => {
                d.maps[newId] = normMap({ id: newId, title: h.t.title || 'New roadmap', topics: seed })
                d.order.push(newId)
                const x = d.maps[activeId] && locate(d.maps[activeId], id)
                if (x) {
                    x.t.ref = newId
                    pairs.forEach(([subId, topicId]) => {
                        const sub = x.t.subs.find(y => y.id === subId)
                        if (sub) {
                            sub.mirror = { map: newId, topic: topicId }
                            sub.ref = null
                        }
                    })
                }
                d.active = newId
            })
            setTrail(tr => [...tr, activeId])
            setSel(null)
            play('save')
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
                if (!h.p) {
                    // a topic only moves within its own path
                    const peers = d.topics.filter(x => x.lane === h.t.lane)
                    const other = peers[peers.indexOf(h.t) + dir]
                    if (!other) return
                    const a = d.topics.indexOf(h.t)
                    const b = d.topics.indexOf(other)
                    d.topics[a] = other
                    d.topics[b] = h.t
                    return
                }
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
                if (!h) return
                if (h.p) h.arr.splice(h.arr.indexOf(h.t), 1)
                else dropTopic(d, id)
            })
            play('delete')
        },
        reorder: (fromId, toId) => {
            if (!fromId || fromId === toId) return
            update(d => {
                const a = locate(d, fromId)
                const b = locate(d, toId)
                if (!a || !b || a.arr !== b.arr || (!a.p && a.t.lane !== b.t.lane)) return
                const i = a.arr.indexOf(a.t)
                const j = a.arr.indexOf(b.t)
                a.arr.splice(j, 0, a.arr.splice(i, 1)[0])
            })
            play('move')
        },
        // A new topic right under another one, on the same path
        addBelow: id => {
            const t = norm({})
            update(d => {
                const i = d.topics.findIndex(x => x.id === id)
                if (i < 0) return
                t.lane = d.topics[i].lane
                d.topics.splice(i + 1, 0, t)
            })
            play('add')
            setSel(t.id)
            focusSoon(t.id)
        },
        // A new topic beside another one, starting a side path (like Node.js beside TypeScript)
        addSide: id => {
            const t = norm({})
            const lane = { id: uid(), thread: '', from: id }
            update(d => {
                const p = d.topics.find(x => x.id === id)
                if (!p) return
                const pl = d.lanes.find(l => l.id === p.lane)
                lane.thread = pl ? pl.thread : d.threads[0].id
                t.lane = lane.id
                d.lanes.push(lane)
                d.topics.push(t)
            })
            play('branch')
            setSel(t.id)
            focusSoon(t.id)
        },
        // A new topic at the end of the main path of a thread
        addTopicTo: threadId => {
            const t = norm({})
            update(d => {
                const lane = d.lanes.find(l => l.thread === threadId && !l.from) || d.lanes[0]
                t.lane = lane.id
                d.topics.push(t)
            })
            play('add')
            setSel(t.id)
            focusSoon(t.id)
        },
        addThread: () => {
            const th = { id: uid(), title: `Thread ${data.threads.length + 1}` }
            const t = norm({})
            update(d => {
                const lane = { id: uid(), thread: th.id, from: null }
                d.threads.push(th)
                d.lanes.push(lane)
                t.lane = lane.id
                d.topics.push(t)
            })
            play('thread')
            setSel(t.id)
            focusSoon(t.id)
        },
        renameThread: (id, title) => update(d => {
            const th = d.threads.find(x => x.id === id)
            if (th) th.title = title
        }),
        moveThread: (id, dir) => {
            update(d => {
                const i = d.threads.findIndex(x => x.id === id)
                const j = i + dir
                if (i < 0 || j < 0 || j >= d.threads.length) return
                d.threads.splice(j, 0, d.threads.splice(i, 1)[0])
            })
            play('move')
        },
        // Deletes a thread with all its paths, topics and the connections that touched them
        deleteThread: id => {
            if (data.threads.length < 2) return
            const gone = new Set(data.topics.filter(t => (data.lanes.find(l => l.id === t.lane) || {}).thread === id).map(t => t.id))
            update(d => {
                const lanes = new Set(d.lanes.filter(l => l.thread === id).map(l => l.id))
                d.topics = d.topics.filter(t => !lanes.has(t.lane))
                d.lanes = d.lanes.filter(l => !lanes.has(l.id))
                d.threads = d.threads.filter(x => x.id !== id)
                d.conns = d.conns.filter(c => !gone.has(c.from) && !gone.has(c.to))
            })
            if (sel && (gone.has(sel) || data.topics.some(t => gone.has(t.id) && t.subs.some(s => s.id === sel)))) setSel(null)
            play('delete')
        },
        // A free connection from one topic to another (any thread). Returns true when it was made.
        addConn: (from, to) => {
            if (!from || !to || from === to) return false
            if (data.conns.some(c => c.from === from && c.to === to)) {
                notify({ title: 'Already connected', body: 'These two topics are already connected in this direction.', icon: '🔗' })
                return false
            }
            update(d => { d.conns.push({ id: uid(), from, to }) })
            play('connect')
            return true
        },
        removeConn: id => {
            update(d => { d.conns = d.conns.filter(c => c.id !== id) })
            play('unlink')
        },
    }

    const toggleDone = (t, el) => {
        if (t.ref && maps[t.ref]) return
        const done = st(t) !== 'done'
        api.setStatus(t, done ? 'done' : 'todo')
        if (done && el) {
            const r = el.getBoundingClientRect()
            confetti(r.left + r.width / 2, r.top + r.height / 2)
        }
    }
    const toggleGate = t => {
        api.patchGate(t.id, { done: !t.gate.done })
        play(t.gate.done ? 'uncheck' : 'gate')
    }
    // "Side topic" and "Connect" are two-click tools: the next click on a topic is used by the tool, not opened
    const pick = id => {
        if (!data.topics.some(x => x.id === id)) {
            notify({ title: 'Pick a main topic', body: 'Subtopics cannot start a branch or a connection.', icon: '☝️' })
            return
        }
        if (mode.kind === 'side') {
            setMode(null)
            api.addSide(id)
        } else if (!mode.from) {
            setMode({ kind: 'link', from: id })
            play('pick')
        } else if (mode.from === id) {
            setMode(null)
        } else {
            api.addConn(mode.from, id)
            setMode(null)
        }
    }
    const openItem = id => (mode ? pick(id) : setSel(id))
    const toggleMode = kind => {
        if (mode && mode.kind === kind) return setMode(null)
        setMode({ kind, from: null })
        setSel(null)
        play('pick')
    }
    const startLink = id => {
        setMode({ kind: 'link', from: id })
        setSel(null)
        play('pick')
    }
    // Adds a topic at the end of the path of the selected topic, or of the first thread when nothing is selected
    const addTopic = () => {
        const h = sel ? locate(data, sel) : null
        const t = norm({})
        update(d => {
            t.lane = h ? (h.p || h.t).lane : (d.lanes.find(l => !l.from && l.thread === d.threads[0].id) || d.lanes[0]).id
            d.topics.push(t)
        })
        play('add')
        setSel(t.id)
        focusSoon(t.id)
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
        setMenu(null)
        window.scrollTo({ top: 0, behavior: 'smooth' })
    }
    const goBack = () => {
        const last = trail[trail.length - 1]
        setTrail(trail.slice(0, -1))
        if (maps[last]) updateStore(d => { d.active = last })
        setSel(null)
        window.scrollTo({ top: 0, behavior: 'smooth' })
    }
    const createRoadmap = (title, template, threadNames = []) => {
        const id = uid()
        const base = template === 'copy' ? JSON.parse(JSON.stringify(data)) : { topics: [], threads: threadNames.map(n => ({ id: uid(), title: n })) }
        reidMap(base)
        updateStore(d => {
            d.maps[id] = normMap({ ...base, id, title: title || (template === 'copy' ? `${data.title} (copy)` : 'New roadmap') })
            d.order.push(id)
            d.active = id
        })
        setCreating(false)
        setTrail([])
        setSel(null)
        setMenu(null)
        play('save')
    }
    const deleteRoadmap = () => {
        if (store.order.length < 2) return
        const id = activeId
        updateStore(d => {
            delete d.maps[id]
            d.order = d.order.filter(x => x !== id)
            // items that pointed at the deleted roadmap become normal items again
            Object.values(d.maps).forEach(m => itemsOf(m).forEach(i => {
                if (i.ref === id) i.ref = null
                if (i.mirror && i.mirror.map === id) i.mirror = null
            }))
            d.active = d.order[0]
        })
        setSel(null)
        setTrail([])
        setMenu(null)
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

    // The menu is drawn on top of the page (fixed position), so the scrolling tab row can never hide it
    const toggleMenu = () => {
        if (menu) return setMenu(null)
        const r = menuBtn.current.getBoundingClientRect()
        setArmed(false)
        setMenu({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) })
    }
    useEffect(() => {
        if (!menu) return
        const close = () => setMenu(null)
        const onKey = e => { if (e.key === 'Escape') close() }
        window.addEventListener('resize', close)
        window.addEventListener('keydown', onKey)
        return () => {
            window.removeEventListener('resize', close)
            window.removeEventListener('keydown', onKey)
        }
    }, [menu])

    /* ----- undo and redo: snapshots of the whole roadmaps store, edits within 0.7 s count as one step ----- */
    useEffect(() => {
        if (restoring.current) {
            restoring.current = false
            lastStore.current = store
            return
        }
        if (lastStore.current && lastStore.current !== store) {
            const t = Date.now()
            if (t - lastChange.current > 700) {
                past.current.push(lastStore.current)
                if (past.current.length > 60) past.current.shift()
            }
            lastChange.current = t
            future.current = []
            setHist({ u: past.current.length, r: 0 })
        }
        lastStore.current = store
    }, [store])
    const undo = () => {
        if (!past.current.length) return
        future.current.push(store)
        restoring.current = true
        setRoadmaps(past.current.pop())
        setHist({ u: past.current.length, r: future.current.length })
        play('undo')
    }
    const redo = () => {
        if (!future.current.length) return
        past.current.push(store)
        restoring.current = true
        setRoadmaps(future.current.pop())
        setHist({ u: past.current.length, r: future.current.length })
        play('undo')
    }
    useEffect(() => {
        const onKey = e => {
            if (!(e.ctrlKey || e.metaKey) || e.altKey) return
            const el = e.target
            if (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))) return // let text fields keep their own undo
            const k = e.key.toLowerCase()
            if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo() }
            else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); redo() }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    })

    // Save every roadmap in the new structure once. It must run after the undo effect above, so it is not an undo step.
    useEffect(() => {
        if (!store.order.some(id => maps[id] && !structureOk(maps[id]))) return
        restoring.current = true
        updateStore(d => { Object.values(d.maps).forEach(m => ensureStructure(m)) })
    }, []) // eslint-disable-line react-hooks/exhaustive-deps

    const exportMarkdown = () => {
        const a = document.createElement('a')
        a.href = URL.createObjectURL(new Blob([toMarkdown(data, maps)], { type: 'text/markdown' }))
        a.download = (data.title || 'roadmap').replace(/[^\w-]+/g, '-').toLowerCase() + '.md'
        a.click()
        setTimeout(() => URL.revokeObjectURL(a.href), 1000)
        setMenu(null)
        notify({ title: 'Roadmap exported', body: a.download, icon: '⬇️' })
    }

    /* ----- derived ----- */
    const q = query.trim().toLowerCase()
    const matches = t => !q || JSON.stringify([t.title, t.desc, t.notes, blocksText(t.content), t.steps.map(s => s.t)]).toLowerCase().includes(q)
    const vis = t => (!pf || t.priority === pf) && (!sf || st(t) === sf) && matches(t)
    const all = itemsOf(data)
    const doneCount = all.filter(t => st(t) === 'done').length
    const must = all.filter(t => t.priority === 'must')
    const pct = all.length ? Math.round((100 * doneCount) / all.length) : 0

    const goNext = () => {
        const left = readingOrder(data).flatMap(x => [x.t, ...x.t.subs]).filter(t => st(t) !== 'done')
        const t = left.find(x => x.priority === 'must') || left[0]
        if (!t) return notify({ title: 'Everything is done', body: 'Add a new topic to keep going.', icon: '🏆' })
        if (canvasApi.current) canvasApi.current.focusNode(t.id)
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

    // Esc: cancel a tool first, then close the panel, then leave full screen
    useEffect(() => {
        const onKey = e => {
            if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector('.modal-back')) return
            if (mode) setMode(null)
            else if (sel) setSel(null)
            else if (full) setFull(false)
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [sel, mode, full])

    const canvasActs = {
        open: openItem, toggle: toggleDone, toggleGate, goRef: id => goRoadmap(id, true), reorder: api.reorder, addSub,
        addBelow: api.addBelow, addSide: api.addSide, startLink, removeConn: api.removeConn, renameThread: api.renameThread,
        moveThread: api.moveThread, deleteThread: api.deleteThread, addThreadTopic: api.addTopicTo, cancelMode: () => setMode(null),
    }

    const lastFrom = trail.length ? maps[trail[trail.length - 1]] : null

    return (
        <div className="rm" style={{ '--c-must': colors.must, '--c-rec': colors.rec, '--c-nice': colors.nice, '--c-opt': colors.opt, '--c-adv': colors.adv }}>
            <style>{CSS}</style>

            <div className="rm-tabbar">
                <div className="rm-tabs" role="tablist" aria-label="Roadmaps">
                    {store.order.filter(id => maps[id] && (maps[id].title || 'Untitled').toLowerCase().includes(mapQuery.trim().toLowerCase())).map(id => (
                        <button key={id} role="tab" aria-selected={id === activeId} className={'rm-tab' + (id === activeId ? ' on' : '')} onClick={() => goRoadmap(id)}>
                            <span className="rm-tabname">{maps[id].title || 'Untitled'}</span>
                            <small>{mapProgress(maps[id], maps).pct}%</small>
                        </button>
                    ))}
                    {mapQuery.trim() && !store.order.some(id => maps[id] && (maps[id].title || 'Untitled').toLowerCase().includes(mapQuery.trim().toLowerCase())) && <span className="muted small">No roadmap matches</span>}
                    <button className="rm-tab rm-newtab" onClick={() => setCreating(true)}>+ New roadmap</button>
                </div>
                <input className="rm-search rm-mapsearch" type="search" value={mapQuery} onChange={e => setMapQuery(e.target.value)} placeholder="Search roadmaps" aria-label="Search roadmaps"
                    onKeyDown={e => {
                        if (e.key === 'Escape') setMapQuery('')
                        if (e.key === 'Enter') {
                            const hit = store.order.find(id => maps[id] && (maps[id].title || 'Untitled').toLowerCase().includes(mapQuery.trim().toLowerCase()))
                            if (hit) goRoadmap(hit)
                        }
                    }} />
                <button ref={menuBtn} className="rm-tab rm-newtab rm-more" onClick={toggleMenu} aria-label="Roadmap actions" aria-haspopup="menu" aria-expanded={Boolean(menu)}>⋯</button>
            </div>
            {menu && createPortal(
                <>
                    <div className="rm-menuback" onClick={() => setMenu(null)} />
                    <div className="rm-menu" role="menu" style={{ top: menu.top, right: menu.right }}>
                        <button role="menuitem" onClick={() => createRoadmap(`${data.title} (copy)`, 'copy')}>⧉ Duplicate this roadmap</button>
                        <button role="menuitem" onClick={exportMarkdown}>⬇ Export as Markdown</button>
                        <button role="menuitem" disabled={store.order.indexOf(activeId) < 1} onClick={() => moveRoadmap(-1)}>← Move left</button>
                        <button role="menuitem" disabled={store.order.indexOf(activeId) >= store.order.length - 1} onClick={() => moveRoadmap(1)}>→ Move right</button>
                        <button role="menuitem" className="danger" disabled={store.order.length < 2} onClick={() => { if (armed) deleteRoadmap(); else setArmed(true) }}>{armed ? '⚠ Click again to delete' : '🗑 Delete this roadmap'}</button>
                    </div>
                </>,
                document.body,
            )}

            {lastFrom && (
                <div className="rm-back"><button className="btn sm" onClick={goBack}>← Back to {lastFrom.title || 'previous roadmap'}</button></div>
            )}

            <div className="rm-head">
                <input className="rm-title" value={data.title} onChange={e => update(d => { d.title = e.target.value })} aria-label="Roadmap title" />
                <div className="row">
                    <input className="rm-search" type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search topics" aria-label="Search topics" />
                    <button className="btn" onClick={undo} disabled={!hist.u} title="Undo (Ctrl+Z)" aria-label="Undo">↶</button>
                    <button className="btn" onClick={redo} disabled={!hist.r} title="Redo (Ctrl+Shift+Z)" aria-label="Redo">↷</button>
                    <button className="btn" onClick={goNext} title="Jump to the next unfinished topic">Continue</button>
                    <button className="btn" onClick={() => setHideSubs(!hideSubs)}>{hideSubs ? 'Show subtopics' : 'Hide subtopics'}</button>
                    <button className="btn primary" onClick={addTopic} title="Add a topic at the end of the selected topic's path (or the first thread)">Add topic</button>
                    <button className="btn" onClick={api.addThread} title="Add a new parallel thread next to the others">+ Thread</button>
                    <button className={'btn' + (mode && mode.kind === 'side' ? ' on' : '')} aria-pressed={Boolean(mode && mode.kind === 'side')} onClick={() => toggleMode('side')} title="Click a topic to start a side topic beside it">+ Side topic</button>
                    <button className={'btn' + (mode && mode.kind === 'link' ? ' on' : '')} aria-pressed={Boolean(mode && mode.kind === 'link')} onClick={() => toggleMode('link')} title="Connect two topics, even in different threads">🔗 Connect</button>
                    <button className="btn" onClick={() => setBackup(true)}>Backup</button>
                    <button className="btn" onClick={() => setSharing(true)} title="Give a copy of this roadmap to another account">Share</button>
                </div>
                <div className="rm-legend">
                    <span className="muted small">Priority (click to highlight):</span>
                    {Object.entries(PR).map(([k, v]) => (
                        <button key={k} className={`rm-ch p-${k}` + (pf === k ? ' act' : '')} onClick={() => setPf(pf === k ? null : k)} aria-pressed={pf === k}>{v}</button>
                    ))}
                    <button className="btn sm ghost" onClick={() => setColorsOpen(true)}>Colours</button>
                </div>
                <div className="rm-legend">
                    <span className="muted small">Status:</span>
                    {Object.entries(STATUS).map(([k, v]) => (
                        <button key={k} className={'rm-ch rm-sf' + (sf === k ? ' act' : '')} onClick={() => setSf(sf === k ? null : k)} aria-pressed={sf === k}>{v} · {all.filter(t => st(t) === k).length}</button>
                    ))}
                    {(pf || sf) && <button className="btn sm ghost" onClick={() => { setPf(null); setSf(null) }}>Clear filters</button>}
                </div>
                {all.length > 0 && (() => {
                    const f = forecast(all, st)
                    if (!f.left) return null
                    return <p className="muted small rm-pace">{f.date ? `Pace: ${f.perWeek} items a week. At this pace you finish ${f.date}.` : 'Finish a few items and a projected finish date appears here, based on your last 28 days.'}</p>
                })()}
                <div className="rm-pg">
                    <div className="rm-track"><i style={{ width: pct + '%' }} /></div>
                    <span className="small muted">{pct}% · {doneCount}/{all.length} items · mandatory {must.filter(t => st(t) === 'done').length}/{must.length}{hoursLeft(data.topics, st) > 0 ? ` · ~${Math.round(hoursLeft(data.topics, st))} h left` : ''}</span>
                </div>
            </div>

            <Canvas data={data} maps={maps} st={st} vis={vis} hideSubs={hideSubs} readOnly={false} apiRef={canvasApi} full={full} setFull={setFull} mode={mode} sel={sel} acts={canvasActs} />

            {sel && <div className="rm-scrim" onClick={() => setSel(null)} />}
            <Drawer data={data} maps={maps} order={store.order} currentId={activeId} sel={sel} setSel={setSel} api={api} onOpenRoadmap={id => goRoadmap(id, true)} />
            {backup && <BackupModal store={store} activeId={activeId} setRoadmaps={setRoadmaps} onClose={() => setBackup(false)} />}
            {sharing && <RoadmapShare title={data.title} exportMap={exportForShare} importMap={importShared} onClose={() => setSharing(false)} />}
            {creating && <NewRoadmapModal currentTitle={data.title} onCreate={createRoadmap} onClose={() => setCreating(false)} />}
            {colorsOpen && (
                <ColorsModal colors={colors} onClose={() => setColorsOpen(false)}
                    onChange={(k, v) => updateSettings(d => { d.roadmapColors = { ...DEFAULT_COLORS, ...(d.roadmapColors || {}), [k]: v } })}
                    onReset={() => updateSettings(d => { delete d.roadmapColors })} />
            )}
        </div>
    )
}

// What it does: shows a roadmap exactly like the Roadmap page (threads, side topics, connections, gates, filling lines), read-only.
// When to use it: for a roadmap snapshot a friend shared. It needs only the snapshot, not your store. Older snapshots (one path) still work.
export function RoadmapView({ data: raw }) {
    const data = useMemo(() => ensureStructure(structuredClone(raw)), [raw])
    const maps = useMemo(() => ({ [data.id]: data }), [data])
    const [full, setFull] = useState(false)
    const colors = { ...DEFAULT_COLORS, ...(data.colors || {}) }
    const st = t => effStatus(t, maps)
    const all = itemsOf(data)
    const doneCount = all.filter(t => st(t) === 'done').length
    const must = all.filter(t => t.priority === 'must')
    const pct = all.length ? Math.round((100 * doneCount) / all.length) : 0

    return (
        <div className="rm rm-view" style={{ '--c-must': colors.must, '--c-rec': colors.rec, '--c-nice': colors.nice, '--c-opt': colors.opt, '--c-adv': colors.adv }}>
            <style>{CSS}</style>
            <div className="rm-head">
                <h2 className="rm-vtitle">{data.title}</h2>
                <div className="rm-legend">
                    <span className="muted small">Priority:</span>
                    {Object.entries(PR).map(([k, v]) => <span key={k} className={`rm-ch p-${k}`}>{v}</span>)}
                </div>
                <div className="rm-pg">
                    <div className="rm-track"><i style={{ width: pct + '%' }} /></div>
                    <span className="small muted">{pct}% · {doneCount}/{all.length} items · mandatory {must.filter(t => st(t) === 'done').length}/{must.length}{hoursLeft(data.topics, st) > 0 ? ` · ~${Math.round(hoursLeft(data.topics, st))} h left` : ''}</span>
                </div>
            </div>
            <Canvas data={data} maps={maps} st={st} vis={() => true} hideSubs={false} readOnly apiRef={null} full={full} setFull={setFull} mode={null} sel={null} acts={null} />
        </div>
    )
}

const CSS = `
.rm{max-width:1600px;margin:0 auto;padding:20px 20px 120px}
.rm-head{display:flex;flex-wrap:wrap;gap:10px 16px;align-items:center;padding-bottom:14px;border-bottom:1px solid var(--ln)}
.rm-title{border:0!important;background:none!important;font:700 26px var(--head)!important;padding:2px 4px!important;flex:1 1 280px;min-width:0}
.rm-sf{border-color:var(--ln);color:var(--tx)}.rm-sf.act{border-color:var(--ac);background:color-mix(in srgb,var(--ac) 18%,var(--sf))}
.rm-pace{margin:6px 0 2px}
.rm-due{font-size:12px;font-weight:600;color:var(--mu)}.rm-due.late{color:#ff6b8b}
.rm-search{width:150px!important}.rm-mapsearch{flex:none}
.rm-legend{flex:1 1 100%;display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.rm-tabbar{display:flex;gap:6px;align-items:center;padding:2px 0 12px;margin-bottom:6px}
.rm-tabs{display:flex;gap:6px;align-items:center;overflow-x:auto;flex:1;min-width:0;padding-bottom:2px;scrollbar-width:thin}
.rm-more{padding:6px 14px}
.rm-tab{display:inline-flex;gap:8px;align-items:center;flex:none;border:1px solid var(--ln);background:var(--sf);color:var(--mu);border-radius:999px;padding:6px 14px;cursor:pointer;font-weight:500;white-space:nowrap}
.rm-tab:hover{border-color:var(--ac);color:var(--tx)}
.rm-tab.on{background:color-mix(in srgb,var(--ac) 16%,var(--sf));border-color:var(--ac);color:var(--tx);box-shadow:0 2px 10px color-mix(in srgb,var(--ac) 25%,transparent)}
.rm-tab small{font-size:11px;font-weight:600;color:var(--mu)}.rm-tab.on small{color:var(--ac)}
.rm-tabname{max-width:180px;overflow:hidden;text-overflow:ellipsis}
.rm-newtab{border-style:dashed;background:none}
.rm-menuback{position:fixed;inset:0;z-index:90}
.rm-menu{position:fixed;z-index:95;min-width:220px;max-width:calc(100vw - 16px);background:var(--sf);border:1px solid var(--ln);border-radius:10px;box-shadow:0 12px 40px rgba(0,0,0,.3);padding:6px;display:grid;animation:rise .12s}
.rm-menu button{border:0;background:none;text-align:left;padding:8px 10px;border-radius:6px;cursor:pointer;color:var(--tx)}
.rm-menu button:hover:not(:disabled){background:var(--sf2)}.rm-menu button:disabled{opacity:.4;cursor:not-allowed}.rm-menu .danger{color:var(--bad)}
.rm-back{margin-bottom:8px}
.rm-ch{font-size:12px;border:1.5px solid var(--mu);border-radius:6px;background:none;color:var(--tx);padding:2px 10px;cursor:pointer}
.rm-ch.act{box-shadow:0 0 0 2px var(--ac)}
.rm-pg{flex:1 1 100%;display:flex;align-items:center;gap:12px}
.rm-track{flex:1;height:8px;border-radius:9px;background:var(--ln);overflow:hidden}.rm-track i{display:block;height:100%;background:linear-gradient(90deg,var(--ok),color-mix(in srgb,var(--ok) 60%,#fff));transition:width .5s}
.rm-base{fill:none;stroke:var(--ln);stroke-width:3;stroke-dasharray:7 9;stroke-linecap:round}
.rm-fill{fill:none;stroke:var(--ok);stroke-width:5;stroke-linecap:round;stroke-dasharray:1;stroke-dashoffset:1;transition:stroke-dashoffset .8s ease;filter:drop-shadow(0 0 5px var(--ok))}.rm-fill.on{stroke-dashoffset:0}
.rm-sl{fill:none;stroke:var(--ln);stroke-width:2;stroke-dasharray:4 5}.rm-sl.on{stroke:var(--ok);stroke-dasharray:none;stroke-width:2.5}
.rm-node{position:absolute;width:230px;background:var(--sf);border:1.5px solid var(--mu);border-radius:8px;padding:10px 12px;transition:border-color .2s,background .2s,opacity .2s,transform .15s,box-shadow .2s}
.rm-node.s{width:170px;padding:8px 10px;border-radius:6px}
/* every priority has its own colour: a tint inside, a coloured border, and a different border style as a second clue */
.p-must{--pc:var(--c-must);border-width:2px;border-style:solid}
.p-rec{--pc:var(--c-rec);border-width:1.5px;border-style:solid}
.p-nice{--pc:var(--c-nice);border-width:1.5px;border-style:dashed}
.p-opt{--pc:var(--c-opt);border-width:1.5px;border-style:dotted}
.rm-node.doing{border-color:var(--wip)}.rm-node.done{border-color:var(--ok);background:color-mix(in srgb,var(--ok) 12%,var(--sf))}
.rm-node:hover{border-color:var(--ac);transform:translateY(-1px);box-shadow:var(--shadow)}.rm-node.dim{opacity:.25}
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
.rm-bar{height:4px;border-radius:4px;background:var(--ln);overflow:hidden;margin-top:4px}.rm-bar i{display:block;height:100%;background:linear-gradient(90deg,var(--ac),var(--ok));transition:width .4s}
.rm-gl{display:block;width:1.5px;height:14px;background:var(--mu);margin-left:14px}
.rm-gr{display:flex;gap:12px;align-items:flex-start;margin-left:6px}.rm-gr b{font-size:12px}.rm-gr small{display:block;color:var(--mu);font-size:12px;line-height:1.35}
.rm-dm{flex:none;width:16px;height:16px;transform:rotate(45deg);border:1.5px solid var(--mu);background:var(--sf);cursor:pointer;margin-top:4px;padding:0}
.rm-dm.key{border:2px solid var(--ac);background:color-mix(in srgb,var(--ac) 20%,var(--sf))}.rm-dm.on{background:var(--ok);border-color:var(--ok)}
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
.rm-vtitle{font:700 26px var(--head);flex:1 1 280px;margin:0}
.rm-view .rm-chk:disabled{opacity:1;cursor:default}
.rm-view .rm-body,.rm-view .rm-dm,.rm-view .rm-ch{cursor:default}
.p-must,.p-rec,.p-nice,.p-opt,.p-adv{border-color:var(--pc);background:color-mix(in srgb,var(--pc) 14%,var(--sf))}
.p-adv{--pc:var(--c-adv);border-width:3px;border-style:double}
.rm-ic{position:absolute;top:8px;right:34px;width:20px;height:20px;display:flex;align-items:center;justify-content:center;pointer-events:none}
.rm-ic>*{max-width:100%;max-height:100%;object-fit:contain}
.rm-node.linked .rm-ic{right:60px}
.rm-node.has-ic .rm-body b{padding-right:54px}
.rm-node.linked.has-ic .rm-body b{padding-right:80px}
/* ---- canvas (threads, side topics, connections, zoom and move) ---- */
.rm-cv{position:relative;margin-top:14px}
.rm-cv.full{position:fixed;inset:0;z-index:45;margin:0;background:var(--bg)}
.rm-vp{position:relative;overflow:hidden;height:360px;border:1px solid var(--ln);border-radius:12px;background-color:var(--bg);background-image:radial-gradient(circle,var(--ln) 1px,transparent 1.4px);background-size:24px 24px;touch-action:none;cursor:grab;user-select:none;-webkit-user-select:none;outline:none}
.rm-vp:focus-visible{box-shadow:0 0 0 2px var(--ac)}
.rm-vp.panning{cursor:grabbing}.rm-vp.moding{cursor:crosshair}
.rm-vp.pan-ready .rm-world>*{pointer-events:none}.rm-vp.pan-ready{cursor:grab}
.rm-cv.full .rm-vp{height:100%;border-radius:0;border:0}
.rm-dock{position:sticky;height:0;z-index:6;pointer-events:none}
.rm-dock-bot{bottom:14px}.rm-dock-top{top:76px}
.rm-cv.full .rm-dock{position:absolute;left:0;right:0}.rm-cv.full .rm-dock-bot{bottom:14px}.rm-cv.full .rm-dock-top{top:12px}
.rm-world{position:absolute;left:0;top:0;transform-origin:0 0}
.rm-world.anim{transition:transform .35s cubic-bezier(.2,.8,.2,1)}
.rm-ov{position:absolute;left:0;top:0;overflow:visible;pointer-events:none}
.rm-ar0{fill:var(--ac)}.rm-ar1{fill:var(--ok)}
.rm-cn{fill:none;stroke:var(--ac);stroke-width:2.5;stroke-dasharray:9 6;stroke-linecap:round;opacity:.85;transition:stroke .3s}
.rm-cn.on{stroke:var(--ok);opacity:1}.rm-cn.sel{stroke-width:4;opacity:1}
.rm-chit{fill:none;stroke:transparent;stroke-width:18;pointer-events:stroke;cursor:pointer}
.rm-cx{position:absolute;transform:translate(-50%,-50%);z-index:4;border:1.5px solid var(--bad);background:var(--sf);color:var(--bad);border-radius:8px;padding:4px 10px;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;box-shadow:var(--shadow)}
.rm-th{position:absolute;display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:4px 8px;padding:6px 12px 8px;border:2px solid var(--ac);border-radius:12px;background:color-mix(in srgb,var(--ac) 10%,var(--sf));box-shadow:var(--shadow)}
.rm-thi{min-width:0;border:0!important;background:none!important;padding:2px 0!important;font:700 15px var(--head)!important;color:var(--tx);text-overflow:ellipsis}
.rm-thi:focus{background:var(--sf2)!important}
.rm-thp{font-size:12px;font-weight:700;color:var(--ac)}
.rm-th>.rm-bar{grid-column:1/-1;margin:0}
.rm-thb{position:absolute;top:-30px;right:0;display:none;gap:2px;background:var(--sf);border:1px solid var(--ln);border-radius:8px;padding:2px;z-index:3}
.rm-th:hover .rm-thb,.rm-th:focus-within .rm-thb{display:flex}
.rm-thb button,.rm-act button{border:0;background:none;color:var(--tx);border-radius:6px;padding:3px 8px;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap}
.rm-thb button:hover:not(:disabled),.rm-act button:hover{background:var(--sf2);color:var(--ac)}
.rm-thb button:disabled{opacity:.35;cursor:not-allowed}.rm-thb .danger{color:var(--bad)}
.rm-addfirst{position:absolute;left:0;width:100%;border:1.5px dashed var(--ln);border-radius:8px;background:none;color:var(--mu);padding:10px;cursor:pointer;font-size:13px}.rm-addfirst:hover{border-color:var(--ac);color:var(--ac)}
.rm-node,.rm-th,.rm-addsub,.rm-addfirst,.rm-gate{box-sizing:border-box}
.rm-node{position:absolute;height:132px;padding:8px 12px}
.rm-node.s{height:50px;padding:6px 10px}
.rm-node.sel{box-shadow:0 0 0 3px var(--ac)}
.rm-node.pickable{cursor:crosshair}.rm-node.pickable:hover{box-shadow:0 0 0 3px var(--ac)}
.rm-body{position:relative;height:100%;overflow:hidden;align-content:start;gap:2px}
.rm-body b{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-size:15px;line-height:1.2}
.rm-node.s .rm-body b{-webkit-line-clamp:1;font-size:13px}
.rm-body em{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rm-body small{-webkit-line-clamp:2;line-height:1.25}
.rm-foot{display:flex;gap:8px;align-items:baseline;min-width:0;overflow:hidden;white-space:nowrap}
.rm-foot .rm-ref{overflow:hidden;text-overflow:ellipsis;min-width:0}
.rm-body .rm-bar{position:absolute;left:0;right:0;bottom:0;margin:0}
.rm-node.s .rm-body .rm-bar{display:none}
.rm-node.s.linked .rm-body .rm-bar{display:block}
.rm-drag{position:absolute;left:-1px;top:50%;transform:translateY(-50%);font-size:12px;color:var(--mu);cursor:grab;opacity:0;padding:2px 0;line-height:1;z-index:2}
.rm-node:hover>.rm-drag{opacity:.7}
.rm-node>.rm-chk,.rm-node>.rm-go,.rm-node>.rm-ic{z-index:2}
.rm-act{position:absolute;top:-17px;right:8px;display:none;gap:1px;background:var(--sf);border:1px solid var(--ln);border-radius:8px;padding:2px;z-index:3;box-shadow:var(--shadow)}
.rm-node:hover>.rm-act,.rm-node:focus-within>.rm-act{display:flex}
.rm-vp.moding .rm-act{display:none!important}
.rm-gate{position:absolute;height:54px}
.rm-addsub{position:absolute;height:34px;border:1.5px dashed var(--ln);border-radius:6px;background:none;color:var(--mu);padding:5px;cursor:pointer;font-size:13px}.rm-addsub:hover{border-color:var(--ac);color:var(--ac)}
.rm-zoombar{position:absolute;left:12px;bottom:0;pointer-events:auto;display:flex;gap:2px;align-items:center;background:var(--sf);border:1px solid var(--ln);border-radius:10px;padding:3px;box-shadow:var(--shadow)}
.rm-zoombar button{border:0;background:none;color:var(--tx);border-radius:7px;padding:5px 10px;font-size:13px;font-weight:600;cursor:pointer;min-width:30px}
.rm-zoombar button:hover{background:var(--sf2)}.rm-zoombar button[aria-pressed=true]{background:color-mix(in srgb,var(--ac) 18%,var(--sf));color:var(--ac)}
.rm-zl{min-width:54px!important;font-variant-numeric:tabular-nums}
.rm-banner{position:absolute;top:0;left:50%;transform:translateX(-50%);pointer-events:auto;display:flex;gap:12px;align-items:center;background:var(--sf);border:1.5px solid var(--ac);border-radius:10px;padding:6px 8px 6px 14px;box-shadow:var(--shadow);font-size:13px;max-width:calc(100% - 24px)}
.rm-hint{position:absolute;right:14px;bottom:0;margin:0;font-size:11px;color:var(--mu);pointer-events:none;opacity:.8;text-align:right}
@media(prefers-reduced-motion:reduce){.rm-world.anim{transition:none}}
@media(max-width:700px){.rm{padding:14px 10px 100px}.rm-hint{display:none}.rm-zoombar button{padding:5px 7px}}
`
