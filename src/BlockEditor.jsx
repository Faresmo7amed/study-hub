import { useEffect, useRef, useState } from 'react'
import { uid } from './shared'

/* ============================================================
   Block editor ("Study content" and todo details)
   Data: an array of blocks, each { id, type, text, done?, open?, kids? }
   - types: p, h1-h6, bullet, number, todo, toggle, code, divider
   - any block except code and divider can hold nested blocks in "kids"
     (a toggle holding bullets, numbers or todos; a todo holding sub-todos...)
   The editor is controlled: <BlockEditor value={blocks} onChange={setBlocks} />
   ============================================================ */

const MAX_DEPTH = 8
const HEADS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']
export const BLOCK_TYPES = [
    ['p', 'Text'], ['h1', 'Heading 1'], ['h2', 'Heading 2'], ['h3', 'Heading 3'], ['h4', 'Heading 4'], ['h5', 'Heading 5'], ['h6', 'Heading 6'],
    ['bullet', 'Bulleted list'], ['number', 'Numbered list'], ['todo', 'To-do'], ['toggle', 'Toggle'], ['code', 'Code'], ['divider', 'Divider'],
]
const TYPE_IDS = BLOCK_TYPES.map(([id]) => id)
const LISTY = ['bullet', 'number', 'todo']
const CAN_NEST = t => t !== 'code' && t !== 'divider'
const HAS_TEXT = t => t !== 'divider'

export const newBlock = (type = 'p', text = '') => {
    const b = { id: uid(), type, text }
    if (type === 'todo') b.done = false
    if (type === 'toggle') b.open = true
    return b
}

/* ---------- pure helpers (also used by other files) ---------- */

// Makes any value safe to render: keeps known types, string text, limited depth
export function cleanBlocks(list, depth = 0) {
    if (!Array.isArray(list) || depth > MAX_DEPTH) return []
    return list.filter(b => b && typeof b === 'object').map(b => {
        const type = TYPE_IDS.includes(b.type) ? b.type : 'p'
        const out = { id: typeof b.id === 'string' && b.id ? b.id : uid(), type, text: typeof b.text === 'string' ? b.text.slice(0, 20000) : '' }
        if (type === 'todo') out.done = !!b.done
        if (type === 'toggle') out.open = b.open !== false
        const kids = CAN_NEST(type) ? cleanBlocks(b.kids, depth + 1) : []
        if (kids.length) out.kids = kids
        return out
    })
}

// Old study notes were one Markdown-like string. This turns them into blocks.
export function mdToBlocks(md) {
    const out = []
    String(md || '').split('\n').forEach(line => {
        const raw = line.replace(/\s+$/, '')
        if (!raw.trim()) return
        let m
        if ((m = raw.match(/^(#{1,6})\s+(.*)$/))) out.push(newBlock('h' + m[1].length, m[2]))
        else if ((m = raw.match(/^\s*[-*]\s+\[( |x|X)\]\s+(.*)$/))) out.push({ ...newBlock('todo', m[2]), done: m[1] !== ' ' })
        else if ((m = raw.match(/^\s*[-*]\s+(.*)$/))) out.push(newBlock('bullet', m[1]))
        else if ((m = raw.match(/^\s*\d+[.)]\s+(.*)$/))) out.push(newBlock('number', m[1]))
        else if (/^---+$/.test(raw.trim())) out.push(newBlock('divider'))
        else out.push(newBlock('p', raw))
    })
    return out
}

export function blocksToMarkdown(blocks, depth = 0) {
    const pad = '  '.repeat(depth)
    const out = []
    let n = 0
    ;(blocks || []).forEach(b => {
        n = b.type === 'number' ? n + 1 : 0
        const t = b.text || ''
        if (HEADS.includes(b.type)) out.push(`${'#'.repeat(Number(b.type[1]))} ${t}`)
        else if (b.type === 'bullet') out.push(`${pad}- ${t}`)
        else if (b.type === 'number') out.push(`${pad}${n}. ${t}`)
        else if (b.type === 'todo') out.push(`${pad}- [${b.done ? 'x' : ' '}] ${t}`)
        else if (b.type === 'toggle') out.push(`${pad}- ▸ ${t}`)
        else if (b.type === 'code') out.push('```', t, '```')
        else if (b.type === 'divider') out.push('---')
        else out.push(`${pad}${t}`)
        if (b.kids && b.kids.length) out.push(blocksToMarkdown(b.kids, depth + 1))
    })
    return out.join('\n')
}

// All the text of the blocks in one string (for search)
export function blocksText(blocks) {
    return (blocks || []).map(b => `${b.text || ''} ${blocksText(b.kids)}`).join(' ')
}

// How many todo blocks there are (at any depth) and how many are done
export function countTodos(blocks) {
    let done = 0
    let total = 0
    ;(blocks || []).forEach(b => {
        if (b.type === 'todo') {
            total += 1
            if (b.done) done += 1
        }
        const k = countTodos(b.kids)
        done += k.done
        total += k.total
    })
    return { done, total }
}

/* ---------- tree edits (all work on a clone) ---------- */
function find(list, id, parent = null, depth = 0) {
    for (let i = 0; i < list.length; i++) {
        if (list[i].id === id) return { list, i, parent, depth }
        if (list[i].kids) {
            const hit = find(list[i].kids, id, list[i], depth + 1)
            if (hit) return hit
        }
    }
    return null
}
const subtreeDepth = b => 1 + Math.max(0, ...(b.kids || []).map(subtreeDepth))

export const ops = {
    patch(blocks, id, patch) {
        const h = find(blocks, id)
        if (h) Object.assign(h.list[h.i], patch)
    },
    setType(blocks, id, type) {
        const h = find(blocks, id)
        if (!h) return
        const b = h.list[h.i]
        b.type = type
        if (type === 'todo' && typeof b.done !== 'boolean') b.done = false
        if (type !== 'todo') delete b.done
        if (type === 'toggle' && typeof b.open !== 'boolean') b.open = true
        if (type !== 'toggle') delete b.open
        if (!CAN_NEST(type) && b.kids) {
            // a code or divider block cannot hold children: lift them out after it
            h.list.splice(h.i + 1, 0, ...b.kids)
            delete b.kids
        }
        if (type === 'divider') b.text = ''
    },
    insertAfter(blocks, id, block) {
        const h = find(blocks, id)
        if (h) h.list.splice(h.i + 1, 0, block)
        else blocks.push(block)
    },
    remove(blocks, id) {
        const h = find(blocks, id)
        if (h) h.list.splice(h.i, 1)
    },
    // becomes the last child of the block above it
    indent(blocks, id) {
        const h = find(blocks, id)
        if (!h || h.i === 0) return false
        const prev = h.list[h.i - 1]
        if (!CAN_NEST(prev.type) || h.depth + subtreeDepth(h.list[h.i]) >= MAX_DEPTH) return false
        const [b] = h.list.splice(h.i, 1)
        prev.kids = [...(prev.kids || []), b]
        if (prev.type === 'toggle') prev.open = true
        return true
    },
    // moves out of its parent, to just below it
    outdent(blocks, id) {
        const h = find(blocks, id)
        if (!h || !h.parent) return false
        const [b] = h.list.splice(h.i, 1)
        if (!h.list.length) delete h.parent.kids
        const p = find(blocks, h.parent.id)
        p.list.splice(p.i + 1, 0, b)
        return true
    },
    move(blocks, id, dir) {
        const h = find(blocks, id)
        if (!h) return false
        const j = h.i + dir
        if (j < 0 || j >= h.list.length) return false
        ;[h.list[h.i], h.list[j]] = [h.list[j], h.list[h.i]]
        return true
    },
    addChild(blocks, id, block) {
        const h = find(blocks, id)
        if (!h) return false
        const b = h.list[h.i]
        if (!CAN_NEST(b.type) || h.depth + 1 >= MAX_DEPTH) return false
        b.kids = [...(b.kids || []), block]
        if (b.type === 'toggle') b.open = true
        return true
    },
}

/* ---------- the editor ---------- */
const GUTTER = { bullet: '•' }
const SHORTCUTS = [
    [/^(#{1,6}) $/, m => 'h' + m[1].length],
    [/^[-*] $/, () => 'bullet'],
    [/^\d+[.)] $/, () => 'number'],
    [/^\[ ?\] $/, () => 'todo'],
    [/^> $/, () => 'toggle'],
    [/^```$/, () => 'code'],
]

function AutoText({ value, onChange, onKeyDown, className, placeholder, id, readOnly, rows = 1 }) {
    const ref = useRef(null)
    useEffect(() => {
        const el = ref.current
        if (!el) return
        el.style.height = '0px'
        el.style.height = el.scrollHeight + 'px'
    }, [value])
    return <textarea ref={ref} data-bid={id} className={className} rows={rows} value={value} placeholder={placeholder} readOnly={readOnly}
        onChange={onChange} onKeyDown={onKeyDown} spellCheck={false} aria-label="Block text" />
}

function Rows({ list, depth, ctx, numbered = true }) {
    let n = 0
    return list.map((b, idx) => {
        n = numbered && b.type === 'number' ? n + 1 : 0
        return <Row key={b.id} b={b} idx={idx} count={list.length} depth={depth} num={n} ctx={ctx} />
    })
}

function Row({ b, idx, count, depth, num, ctx }) {
    const { change, readOnly, setFocus } = ctx
    const kids = b.kids || []
    const t = b.type
    const isHead = HEADS.includes(t)
    const open = t !== 'toggle' || b.open !== false
    const tc = countTodos(kids)

    const edit = fn => change(blocks => fn(blocks))

    const onText = e => {
        let v = e.target.value
        if (t === 'p') {
            for (const [re, to] of SHORTCUTS) {
                const m = v.match(re)
                if (m) {
                    edit(bl => { ops.setType(bl, b.id, to(m)); ops.patch(bl, b.id, { text: '' }) })
                    return
                }
            }
        }
        if (v.length > 20000) v = v.slice(0, 20000)
        edit(bl => ops.patch(bl, b.id, { text: v }))
    }

    const onKey = e => {
        if (readOnly) return
        const el = e.currentTarget
        const atStart = el.selectionStart === 0 && el.selectionEnd === 0
        const atEnd = el.selectionStart === el.value.length && el.selectionEnd === el.value.length
        if (e.key === 'Tab') {
            e.preventDefault()
            if (t === 'code' && !e.shiftKey) {
                const s = el.selectionStart
                const v = el.value.slice(0, s) + '  ' + el.value.slice(el.selectionEnd)
                edit(bl => ops.patch(bl, b.id, { text: v }))
                requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = s + 2 })
                return
            }
            setFocus(b.id)
            edit(bl => { if (e.shiftKey) ops.outdent(bl, b.id); else ops.indent(bl, b.id) })
        } else if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            if (t === 'code') {
                if (!(e.ctrlKey || e.metaKey)) return // a normal newline inside code
            }
            e.preventDefault()
            if (t === 'p' && el.value.trim() === '---') {
                edit(bl => { ops.setType(bl, b.id, 'divider'); ops.insertAfter(bl, b.id, newBlock('p')) })
                return
            }
            if (LISTY.includes(t) && !el.value.trim()) {
                // an empty list item ends the list: step out, or become plain text
                setFocus(b.id)
                edit(bl => { if (!ops.outdent(bl, b.id)) ops.setType(bl, b.id, 'p') })
                return
            }
            const pos = t === 'code' ? el.value.length : el.selectionStart
            const head = el.value.slice(0, pos)
            const tail = t === 'code' ? '' : el.value.slice(el.selectionEnd)
            const nextType = LISTY.includes(t) ? t : 'p'
            const nb = newBlock(nextType, tail)
            setFocus(nb.id, true)
            edit(bl => {
                ops.patch(bl, b.id, { text: head })
                // a list item that already has children passes the new item in as its first child
                const keepsKids = open && (t === 'toggle' || (LISTY.includes(t) && kids.length > 0))
                if (keepsKids) ops.patch(bl, b.id, { kids: [nb, ...kids] })
                else ops.insertAfter(bl, b.id, nb)
            })
        } else if (e.key === 'Backspace' && atStart && !e.nativeEvent.isComposing) {
            if (!el.value) {
                e.preventDefault()
                if (t !== 'p') edit(bl => ops.setType(bl, b.id, 'p'))
                else {
                    const all = [...ctx.root.current.querySelectorAll('[data-bid]')]
                    const prev = all[all.indexOf(el) - 1]
                    if (prev) setFocus(prev.dataset.bid)
                    if (!kids.length) edit(bl => ops.remove(bl, b.id))
                }
            }
        } else if ((e.key === 'ArrowUp' && atStart) || (e.key === 'ArrowDown' && atEnd)) {
            const all = [...ctx.root.current.querySelectorAll('[data-bid]')]
            const next = all[all.indexOf(el) + (e.key === 'ArrowUp' ? -1 : 1)]
            if (next) {
                e.preventDefault()
                next.focus()
            }
        }
    }

    return (
        <div className={'be-block' + (b.done ? ' done' : '')} data-depth={depth}>
            <div className={'be-row t-' + t}>
                <span className="be-lead">
                    {t === 'toggle' && <button type="button" className="be-caret" aria-expanded={open} aria-label={open ? 'Collapse' : 'Expand'} onClick={() => edit(bl => ops.patch(bl, b.id, { open: !open }))}>{open ? '▾' : '▸'}</button>}
                    {t === 'bullet' && <span className="be-mark" aria-hidden="true">{GUTTER.bullet}</span>}
                    {t === 'number' && <span className="be-mark" aria-hidden="true">{num}.</span>}
                    {t === 'todo' && <input type="checkbox" checked={!!b.done} disabled={readOnly} aria-label="Done" onChange={e => edit(bl => ops.patch(bl, b.id, { done: e.target.checked }))} />}
                </span>
                {t === 'divider'
                    ? <hr className="be-hr" tabIndex={readOnly ? -1 : 0} data-bid={b.id} onKeyDown={e => { if (!readOnly && (e.key === 'Backspace' || e.key === 'Delete')) { e.preventDefault(); edit(bl => ops.remove(bl, b.id)) } }} />
                    : <AutoText id={b.id} value={b.text} readOnly={readOnly} onChange={onText} onKeyDown={onKey}
                        className={'be-input' + (isHead ? ' be-' + t : '') + (t === 'code' ? ' be-code' : '') + (t === 'toggle' ? ' be-toggle' : '')}
                        rows={t === 'code' ? 3 : 1}
                        placeholder={isHead ? `Heading ${t[1]}` : t === 'code' ? 'Code (Ctrl+Enter for a new block below)' : t === 'toggle' ? 'Toggle title' : t === 'todo' ? 'To-do' : idx === 0 && depth === 0 ? "Type, or use '# ', '- ', '1. ', '[] ', '> ', '```', '---'" : ''} />}
                {t === 'todo' && tc.total > 0 && <span className="be-count" title="Sub-todos done">{tc.done}/{tc.total}</span>}
                {t === 'toggle' && !open && kids.length > 0 && <span className="be-count">{kids.length}</span>}
                {!readOnly && (
                    <span className="be-actions">
                        <select value={t} aria-label="Block type" title="Change block type" onChange={e => edit(bl => ops.setType(bl, b.id, e.target.value))}>
                            {BLOCK_TYPES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                        </select>
                        <button type="button" className="icon-btn" disabled={idx === 0} onClick={() => edit(bl => ops.move(bl, b.id, -1))} aria-label="Move up" title="Move up">↑</button>
                        <button type="button" className="icon-btn" disabled={idx === count - 1} onClick={() => edit(bl => ops.move(bl, b.id, 1))} aria-label="Move down" title="Move down">↓</button>
                        <button type="button" className="icon-btn" disabled={idx === 0} onClick={() => edit(bl => ops.indent(bl, b.id))} aria-label="Nest under the block above" title="Nest (Tab)">⇥</button>
                        <button type="button" className="icon-btn" disabled={depth === 0} onClick={() => edit(bl => ops.outdent(bl, b.id))} aria-label="Move out one level" title="Move out (Shift+Tab)">⇤</button>
                        {CAN_NEST(t) && <button type="button" className="icon-btn" onClick={() => { const nb = newBlock(t === 'toggle' ? 'bullet' : LISTY.includes(t) ? t : 'p'); setFocus(nb.id); edit(bl => ops.addChild(bl, b.id, nb)) }} aria-label="Add a nested block" title="Add nested block">＋</button>}
                        <button type="button" className="icon-btn be-del" onClick={() => edit(bl => ops.remove(bl, b.id))} aria-label="Delete block" title="Delete block">×</button>
                    </span>
                )}
            </div>
            {kids.length > 0 && open && (
                <div className="be-kids">
                    <Rows list={kids} depth={depth + 1} ctx={ctx} />
                </div>
            )}
            {t === 'toggle' && open && !readOnly && (
                <div className="be-inside">
                    <span className="muted small">Add inside:</span>
                    {[['bullet', '• Bullet'], ['number', '1. Number'], ['todo', '☐ To-do'], ['p', 'Text']].map(([ty, label]) => (
                        <button key={ty} type="button" className="btn sm ghost" onClick={() => { const nb = newBlock(ty); setFocus(nb.id); edit(bl => ops.addChild(bl, b.id, nb)) }}>{label}</button>
                    ))}
                </div>
            )}
        </div>
    )
}

// What it does: edits a list of blocks. Parent passes value (array) and onChange(newArray).
// When to use it: any place that needs rich notes. readOnly shows the content without editing controls.
export default function BlockEditor({ value, onChange, readOnly = false, label = 'Content' }) {
    const blocks = Array.isArray(value) ? value : []
    const root = useRef(null)
    const focusRef = useRef(null)
    const [tick, setTick] = useState(0)
    const latest = useRef(blocks)
    latest.current = blocks

    const setFocus = (id, start = false) => { focusRef.current = { id, start } }
    // Every edit works on a clone, so the parent always receives a new array
    const change = fn => {
        const next = structuredClone(latest.current)
        fn(next)
        latest.current = next
        onChange(next)
        setTick(x => x + 1)
    }

    // After an edit that created or moved a block, put the cursor in it
    useEffect(() => {
        const want = focusRef.current
        if (!want || !root.current) return
        focusRef.current = null
        const el = root.current.querySelector(`[data-bid="${want.id}"]`)
        if (el) {
            el.focus()
            if (el.setSelectionRange && el.tagName === 'TEXTAREA') {
                const end = want.start ? 0 : el.value.length
                try { el.setSelectionRange(end, end) } catch { /* not a text field */ }
            }
        }
    }, [tick, value])

    const add = type => {
        const nb = newBlock(type)
        setFocus(nb.id)
        change(bl => { bl.push(nb) })
    }

    const ctx = { change, readOnly, setFocus, root }
    return (
        <div className="be" ref={root} role="group" aria-label={label}>
            <style>{CSS}</style>
            {blocks.length === 0 && readOnly && <p className="muted small">Nothing here yet.</p>}
            <Rows list={blocks} depth={0} ctx={ctx} />
            {!readOnly && (
                <div className="be-add">
                    <button type="button" className="btn sm" onClick={() => add('p')}>+ Text</button>
                    <select aria-label="Add a heading" value="" onChange={e => { if (e.target.value) add(e.target.value) }}>
                        <option value="">+ Heading…</option>
                        {HEADS.map(h => <option key={h} value={h}>Heading {h[1]}</option>)}
                    </select>
                    <button type="button" className="btn sm" onClick={() => add('bullet')}>• Bullets</button>
                    <button type="button" className="btn sm" onClick={() => add('number')}>1. Numbers</button>
                    <button type="button" className="btn sm" onClick={() => add('todo')}>☐ To-do</button>
                    <button type="button" className="btn sm" onClick={() => add('toggle')}>▸ Toggle</button>
                    <button type="button" className="btn sm" onClick={() => add('code')}>{'</>'} Code</button>
                    <button type="button" className="btn sm" onClick={() => add('divider')}>— Divider</button>
                </div>
            )}
        </div>
    )
}

const CSS = `
.be{display:grid;gap:2px;min-width:0}
.be-block{min-width:0}
.be-row{display:flex;gap:6px;align-items:flex-start;border-radius:8px;padding:1px 2px;min-width:0;position:relative}
.be-row:hover,.be-row:focus-within{background:color-mix(in srgb,var(--ac) 6%,transparent)}
.be-lead{flex:none;width:22px;display:flex;justify-content:center;padding-top:6px;color:var(--mu)}
.be-row.t-p .be-lead,.be-row.t-code .be-lead,.be-row.t-divider .be-lead,.be-row[class*=" t-h"] .be-lead{width:4px}
.be-mark{font-weight:700;font-size:14px;line-height:1.5;min-width:20px;text-align:right}
.be-caret{border:0;background:none;cursor:pointer;color:var(--mu);font-size:15px;padding:0 2px;line-height:1.6}
.be-input{flex:1;min-width:0;border:0!important;background:none!important;padding:5px 4px!important;resize:none;overflow:hidden;line-height:1.5;outline:none;box-shadow:none;border-radius:6px!important}
.be-input:focus{background:color-mix(in srgb,var(--ac) 7%,transparent)!important}
.be-h1{font:700 30px/1.25 var(--head)!important}.be-h2{font:700 25px/1.3 var(--head)!important}.be-h3{font:700 21px/1.3 var(--head)!important}
.be-h4{font:700 18px/1.4 var(--head)!important}.be-h5{font:700 16px/1.4 var(--head)!important}.be-h6{font:700 14px/1.4 var(--head)!important;text-transform:uppercase;letter-spacing:.04em;color:var(--mu)}
.be-code{font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace!important;background:var(--bg)!important;border:1px solid var(--ln)!important;padding:8px 10px!important;white-space:pre;overflow-x:auto!important;tab-size:2}
.be-toggle{font-weight:600}
.be-hr{flex:1;border:0;border-top:2px solid var(--ln);margin:14px 4px;outline-offset:6px}
.be-block.done>.be-row .be-input{text-decoration:line-through;color:var(--mu)}
.be-count{flex:none;font-size:11px;font-weight:600;color:var(--mu);border:1px solid var(--ln);border-radius:999px;padding:0 7px;margin-top:6px;white-space:nowrap}
.be-kids{margin-left:11px;padding-left:12px;border-left:1px solid var(--ln)}
.be-inside{display:flex;gap:4px;align-items:center;flex-wrap:wrap;margin:2px 0 4px 33px}
.be-actions{position:absolute;right:2px;top:-16px;z-index:3;display:flex;align-items:center;gap:0;padding:2px 4px;background:var(--sf);border:1px solid var(--ln);border-radius:9px;box-shadow:0 4px 14px rgba(0,0,0,.18);opacity:0;pointer-events:none;transition:opacity .12s}
.be-row:hover .be-actions,.be-row:focus-within .be-actions{opacity:1;pointer-events:auto}
@media(hover:none){.be-row:hover .be-actions{opacity:0;pointer-events:none}.be-row:focus-within .be-actions{opacity:1;pointer-events:auto}}
.be-actions select{width:auto!important;padding:2px 4px!important;font-size:12px;height:26px}
.be-actions .icon-btn{padding:1px 6px;font-size:14px}.be-actions .icon-btn:disabled{opacity:.3;cursor:default}
.be-del:hover{color:var(--bad)!important}
.be-add{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:10px;padding-top:10px;border-top:1px dashed var(--ln)}
.be-add select{width:auto!important;padding:4px 8px!important;font-size:13px}
@media(max-width:640px){.be-h1{font-size:25px!important}.be-h2{font-size:22px!important}}
`
