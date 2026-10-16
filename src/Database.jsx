import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { clamp, uid, useStore } from './shared'
import { play } from './sound'

/* ============================================================
   A small Notion-style database
   - tables with typed properties (text, select, status, relation, rollup, formula, ...)
   - two-way relations, rollups and a safe formula language
   - sort, filter, search, hide properties, resize columns, footer calculations
   ============================================================ */

const COLORS = { gray: '#7b8294', blue: '#3b82f6', green: '#22a06b', red: '#e5484d', orange: '#f08a24', yellow: '#d9a406', purple: '#8e6bf0', pink: '#e255a1', teal: '#17b8a6' }
const COLOR_KEYS = Object.keys(COLORS)
const STATUS = [
    { id: 'todo', name: 'Not started', color: 'gray' },
    { id: 'doing', name: 'In progress', color: 'blue' },
    { id: 'done', name: 'Done', color: 'green' },
]
const PROP_TYPES = [
    { id: 'text', name: 'Text', icon: '≡' },
    { id: 'number', name: 'Number', icon: '#' },
    { id: 'select', name: 'Select', icon: '◉' },
    { id: 'multiselect', name: 'Multi-select', icon: '☷' },
    { id: 'status', name: 'Status', icon: '◔' },
    { id: 'date', name: 'Date', icon: '▦' },
    { id: 'person', name: 'Person', icon: '☺' },
    { id: 'files', name: 'Files & media', icon: '⌁' },
    { id: 'checkbox', name: 'Checkbox', icon: '☑' },
    { id: 'url', name: 'URL', icon: '⛓' },
    { id: 'email', name: 'Email', icon: '@' },
    { id: 'phone', name: 'Phone', icon: '✆' },
    { id: 'formula', name: 'Formula', icon: 'Σ' },
    { id: 'relation', name: 'Relation', icon: '↗' },
    { id: 'rollup', name: 'Rollup', icon: '⌕' },
    { id: 'rating', name: 'Rating', icon: '★' },
    { id: 'created', name: 'Created time', icon: '◷' },
    { id: 'edited', name: 'Last edited time', icon: '◷' },
]
const typeMeta = id => (id === 'title' ? { id, name: 'Title', icon: 'Aa' } : PROP_TYPES.find(t => t.id === id) || PROP_TYPES[0])
const TEXTLIKE = ['text', 'url', 'email', 'phone']
const COMPUTED = ['rollup', 'formula', 'created', 'edited']
const ROLLUPS = {
    count: 'Count all', filled: 'Count values', empty: 'Count empty', checked: 'Count checked / done', unchecked: 'Count unchecked',
    percent_checked: 'Percent checked / done', sum: 'Sum', avg: 'Average', min: 'Min', max: 'Max', list: 'Show original',
}
const EMOJI = ['📄', '🎯', '📚', '🎓', '🎬', '▶️', '🏔️', '🟧', '🟦', '🟨', '🟩', '🟥', '⚛️', '🐍', '☕', '🧠', '💻', '🛠️', '🧪', '📝', '📊', '🔥', '⭐', '🚀', '🏆', '🧩', '🎨', '🔒', '🌐', '🗄️', '📱', '🎧']

/* ---------- seed data (the Goals / Tasks example) ---------- */
function seedDB() {
    const base = Date.now()
    const goals = [
        { id: 'g_html', icon: '🟧', name: 'HTML', status: 'done', rating: 5 },
        { id: 'g_css', icon: '🟦', name: 'CSS', status: 'todo', rating: 0 },
        { id: 'g_js', icon: '🟨', name: 'JavaScript', status: 'doing', rating: 0 },
    ]
    const tasks = [
        ['Elzero HTML Course', '🎬', 'g_html', true], ['Future Fullstack HTML Course', '🎬', 'g_html', true],
        ['Future Fullstack CSS Courses', '🎬', 'g_css', false], ['Scrimba HTML & CSS Course', '🏔️', ['g_html', 'g_css'], true],
        ['SuperSimpleDev HTML & CSS Course', '🎬', ['g_html', 'g_css'], true], ['Elzero JavaScript Course', '🎬', 'g_js', true],
        ['Scrimba Learn JavaScript Course', '🏔️', 'g_js', true], ['Scrimba Advanced JavaScript Course', '🏔️', 'g_js', false],
        ['Dave Gray Advanced JavaScript Course', '🎬', 'g_js', false], ['Procademy JavaScript Courses', '🎬', 'g_js', false],
        ['Codevolution JavaScript Courses', '🎬', 'g_js', false], ['Tarmeez Advanced JavaScript Course', '🎬', 'g_js', false],
    ]
    const goalRows = goals.map((g, i) => ({
        id: g.id, icon: g.icon, created: base - 100000 + i, edited: null, body: '',
        cells: { g_name: g.name, g_tasks: [], g_status: g.status, g_rating: g.rating },
    }))
    const taskRows = tasks.map(([name, icon, goalIds, done], i) => {
        const ids = [].concat(goalIds)
        ids.forEach(id => goalRows.find(g => g.id === id).cells.g_tasks.push('t' + i))
        return { id: 't' + i, icon, created: base - 50000 + i, edited: null, body: '', cells: { t_name: name, t_goals: ids, t_status: 'todo', t_done: done } }
    })
    return {
        order: ['goals', 'tasks'],
        active: 'goals',
        tables: {
            goals: {
                id: 'goals', name: 'Goals', icon: '🎯', sort: null, filters: [], calc: { g_name: 'count' }, rows: goalRows,
                props: [
                    { id: 'g_name', name: 'Name', type: 'title', width: 230 },
                    { id: 'g_tasks', name: 'Tasks', type: 'relation', width: 320, config: { target: 'tasks', reverse: 't_goals' } },
                    { id: 'g_prog', name: 'Progress Bar', type: 'rollup', width: 210, config: { rel: 'g_tasks', target: 't_done', fn: 'percent_checked' } },
                    { id: 'g_status', name: 'Processing', type: 'status', width: 150 },
                    { id: 'g_rating', name: 'Rating', type: 'rating', width: 140 },
                ],
            },
            tasks: {
                id: 'tasks', name: 'Tasks', icon: '✅', sort: null, filters: [], calc: { t_name: 'count', t_done: 'checked' }, rows: taskRows,
                props: [
                    { id: 't_name', name: 'Name', type: 'title', width: 330 },
                    { id: 't_goals', name: 'Related to Goals (Tags)', type: 'relation', width: 260, config: { target: 'goals', reverse: 'g_tasks' } },
                    { id: 't_status', name: 'Processing', type: 'status', width: 150 },
                    { id: 't_done', name: 'Done', type: 'checkbox', width: 90 },
                ],
            },
        },
    }
}

/* ============================================================
   Values: raw cell values, computed values and display text
   ============================================================ */
const isEmpty = v => v == null || v === '' || v === false || (Array.isArray(v) && v.length === 0)
const isDone = v => v === true || v === 'done'
const truthy = v => (Array.isArray(v) ? v.length > 0 : !!v)
const num = v => (Array.isArray(v) ? v.length : typeof v === 'boolean' ? +v : v == null || v === '' ? 0 : Number(v) || 0)
const titleOf = (table, id) => {
    const r = table && table.rows.find(x => x.id === id)
    return r ? r.cells[table.props[0].id] || 'Untitled' : ''
}
const optName = (prop, id) => ((prop.options || []).find(o => o.id === id) || {}).name || ''

function guard(stack, key, fn) {
    if (stack.includes(key)) throw new Error('Circular reference')
    return fn([...stack, key])
}

function valueOf(db, table, row, prop, stack = []) {
    switch (prop.type) {
        case 'created': return row.created
        case 'edited': return row.edited || row.created
        case 'rollup': return rollupOf(db, table, row, prop, stack)
        case 'formula': return formulaOf(db, table, row, prop, stack)
        default: return row.cells[prop.id]
    }
}

// Returns a primitive that formulas, sorting, filtering, search and CSV can use
function plain(db, prop, v) {
    if (v && v.error) return null
    if (prop.type === 'rollup') return v ? v.value : null
    switch (prop.type) {
        case 'select': return optName(prop, v)
        case 'multiselect': return (v || []).map(id => optName(prop, id))
        case 'status': return (STATUS.find(s => s.id === v) || {}).name || ''
        case 'relation': return (v || []).map(id => titleOf(db.tables[prop.config.target], id))
        case 'created': case 'edited': return v ? new Date(v).toISOString() : ''
        default: return v
    }
}

function rollupOf(db, table, row, prop, stack) {
    const { rel, target, fn } = prop.config || {}
    const relProp = table.props.find(p => p.id === rel)
    if (!relProp || relProp.type !== 'relation') return { error: 'Choose a relation' }
    const other = db.tables[relProp.config.target]
    const targetProp = other && other.props.find(p => p.id === target)
    if (!targetProp) return { error: 'Choose a property' }
    try {
        const linked = (row.cells[rel] || []).map(id => other.rows.find(r => r.id === id)).filter(Boolean)
        const vals = guard(stack, `${table.id}.${row.id}.${prop.id}`, st => linked.map(r => plain(db, targetProp, valueOf(db, other, r, targetProp, st))))
        const nums = vals.filter(v => typeof v === 'number' && !Number.isNaN(v))
        const n = vals.length
        switch (fn) {
            case 'filled': return { value: vals.filter(v => !isEmpty(v)).length, kind: 'number' }
            case 'empty': return { value: vals.filter(isEmpty).length, kind: 'number' }
            case 'checked': return { value: vals.filter(isDone).length, kind: 'number' }
            case 'unchecked': return { value: n - vals.filter(isDone).length, kind: 'number' }
            case 'percent_checked': return { value: n ? Math.round((100 * vals.filter(isDone).length) / n) : 0, kind: 'percent' }
            case 'sum': return { value: nums.reduce((a, b) => a + b, 0), kind: 'number' }
            case 'avg': return { value: nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100 : 0, kind: 'number' }
            case 'min': return { value: nums.length ? Math.min(...nums) : null, kind: 'number' }
            case 'max': return { value: nums.length ? Math.max(...nums) : null, kind: 'number' }
            case 'list': return { value: vals.filter(v => !isEmpty(v)).flat().map(String), kind: 'list' }
            default: return { value: n, kind: 'number' }
        }
    } catch (e) {
        return { error: e.message }
    }
}

/* ---------- formulas: numbers, "text", prop("Name"), + - * / %, comparisons, and/or, functions ---------- */
const FN = {
    if: (c, a, b) => (truthy(c) ? a : b),
    round: (x, d = 0) => { const f = 10 ** num(d); return Math.round(num(x) * f) / f },
    floor: x => Math.floor(num(x)),
    ceil: x => Math.ceil(num(x)),
    abs: x => Math.abs(num(x)),
    min: (...a) => Math.min(...a.flat().map(num)),
    max: (...a) => Math.max(...a.flat().map(num)),
    sum: (...a) => a.flat().reduce((s, x) => s + num(x), 0),
    length: x => (Array.isArray(x) || typeof x === 'string' ? x.length : String(x == null ? '' : x).length),
    concat: (...a) => a.flat().map(x => (x == null ? '' : x)).join(''),
    empty: x => isEmpty(x),
    not: x => !truthy(x),
    and: (...a) => a.every(truthy),
    or: (...a) => a.some(truthy),
    upper: x => String(x == null ? '' : x).toUpperCase(),
    lower: x => String(x == null ? '' : x).toLowerCase(),
    contains: (s, t) => (Array.isArray(s) ? s.includes(t) : String(s == null ? '' : s).includes(String(t == null ? '' : t))),
}

function evalFormula(expr, getProp) {
    const tokens = []
    const re = /\s*(?:(\d+(?:\.\d+)?)|"((?:[^"\\]|\\.)*)"|([A-Za-z_]\w*)|(>=|<=|==|!=|&&|\|\||[-+*/%(),<>!]))/y
    let i = 0
    while (i < expr.length) {
        re.lastIndex = i
        const m = re.exec(expr)
        if (!m) {
            if (/^\s*$/.test(expr.slice(i))) break
            throw new Error('Unexpected character: ' + expr.slice(i).trim()[0])
        }
        i = re.lastIndex
        if (m[1] !== undefined) tokens.push({ t: 'num', v: Number(m[1]) })
        else if (m[2] !== undefined) tokens.push({ t: 'str', v: m[2].replace(/\\(.)/g, '$1') })
        else if (m[3] !== undefined) tokens.push({ t: 'id', v: m[3] })
        else tokens.push({ t: 'op', v: m[4] })
    }
    if (!tokens.length) return ''

    let p = 0
    const peek = () => tokens[p]
    const next = () => tokens[p++]
    const isOp = v => peek() && peek().t === 'op' && peek().v === v
    const expect = v => {
        if (!isOp(v)) throw new Error(`Expected "${v}"`)
        next()
    }
    const add = (a, b) => (typeof a === 'string' || typeof b === 'string' ? String(a == null ? '' : a) + String(b == null ? '' : b) : num(a) + num(b))
    const eq = (a, b) => (Array.isArray(a) ? a.join() === (Array.isArray(b) ? b.join() : String(b)) : a === b || (typeof a !== typeof b && String(a) === String(b)))

    function parseOr() {
        let l = parseAnd()
        while (isOp('||')) { next(); const r = parseAnd(); l = truthy(l) || truthy(r) }
        return l
    }
    function parseAnd() {
        let l = parseCmp()
        while (isOp('&&')) { next(); const r = parseCmp(); l = truthy(l) && truthy(r) }
        return l
    }
    function parseCmp() {
        let l = parseAdd()
        while (peek() && peek().t === 'op' && ['>', '<', '>=', '<=', '==', '!='].includes(peek().v)) {
            const op = next().v
            const r = parseAdd()
            if (op === '==') l = eq(l, r)
            else if (op === '!=') l = !eq(l, r)
            else if (op === '>') l = num(l) > num(r)
            else if (op === '<') l = num(l) < num(r)
            else if (op === '>=') l = num(l) >= num(r)
            else l = num(l) <= num(r)
        }
        return l
    }
    function parseAdd() {
        let l = parseMul()
        while (isOp('+') || isOp('-')) {
            const op = next().v
            const r = parseMul()
            l = op === '+' ? add(l, r) : num(l) - num(r)
        }
        return l
    }
    function parseMul() {
        let l = parseUnary()
        while (isOp('*') || isOp('/') || isOp('%')) {
            const op = next().v
            const r = parseUnary()
            if (op === '*') l = num(l) * num(r)
            else if (op === '/') l = num(r) === 0 ? 0 : num(l) / num(r)
            else l = num(r) === 0 ? 0 : num(l) % num(r)
        }
        return l
    }
    function parseUnary() {
        if (isOp('-')) { next(); return -num(parseUnary()) }
        if (isOp('!')) { next(); return !truthy(parseUnary()) }
        return parsePrimary()
    }
    function parsePrimary() {
        const tok = next()
        if (!tok) throw new Error('Unexpected end')
        if (tok.t === 'num' || tok.t === 'str') return tok.v
        if (tok.t === 'op' && tok.v === '(') {
            const v = parseOr()
            expect(')')
            return v
        }
        if (tok.t === 'id') {
            if (isOp('(')) {
                next()
                const args = []
                if (!isOp(')')) {
                    do { args.push(parseOr()) } while (isOp(',') && next())
                }
                expect(')')
                if (tok.v === 'prop') return getProp(String(args[0]))
                if (!FN[tok.v]) throw new Error(`Unknown function ${tok.v}`)
                return FN[tok.v](...args)
            }
            if (tok.v === 'true') return true
            if (tok.v === 'false') return false
            throw new Error(`Unknown name ${tok.v}`)
        }
        throw new Error('Unexpected ' + tok.v)
    }

    const result = parseOr()
    if (p < tokens.length) throw new Error('Unexpected ' + tokens[p].v)
    return result
}

function formulaOf(db, table, row, prop, stack) {
    try {
        return guard(stack, `${table.id}.${row.id}.${prop.id}`, st => evalFormula((prop.config && prop.config.expr) || '', name => {
            const target = table.props.find(x => x.name === name)
            if (!target) throw new Error(`Unknown property "${name}"`)
            const v = valueOf(db, table, row, target, st)
            if (v && v.error) throw new Error(v.error)
            return plain(db, target, v)
        }))
    } catch (e) {
        return { error: e.message }
    }
}

/* ---------- rows: filter, search, sort, calculations ---------- */
const OPS = {
    contains: 'contains', eq: '=', gt: '>', lt: '<', is: 'is', has: 'includes', checked: 'is checked', unchecked: 'is unchecked',
    on: 'is', before: 'is before', after: 'is after', empty: 'is empty', filled: 'is not empty',
}
function opsFor(type) {
    if (type === 'checkbox') return ['checked', 'unchecked']
    if (['select', 'status'].includes(type)) return ['is', 'empty', 'filled']
    if (['multiselect', 'relation'].includes(type)) return ['has', 'empty', 'filled']
    if (['number', 'rating', 'formula', 'rollup'].includes(type)) return ['eq', 'gt', 'lt', 'empty', 'filled']
    if (type === 'date') return ['on', 'before', 'after', 'empty', 'filled']
    return ['contains', 'empty', 'filled']
}
const needsValue = op => !['checked', 'unchecked', 'empty', 'filled'].includes(op)

function matchFilter(db, table, row, prop, f) {
    const raw = valueOf(db, table, row, prop)
    const v = plain(db, prop, raw)
    const rawVal = prop.type === 'rollup' || prop.type === 'formula' ? v : raw
    switch (f.op) {
        case 'contains': return String(Array.isArray(v) ? v.join(' ') : v == null ? '' : v).toLowerCase().includes(String(f.value || '').toLowerCase())
        case 'eq': return num(v) === num(f.value)
        case 'gt': return num(v) > num(f.value)
        case 'lt': return num(v) < num(f.value)
        case 'is': return !f.value || rawVal === f.value
        case 'has': return !f.value || (rawVal || []).includes(f.value)
        case 'checked': return isDone(rawVal)
        case 'unchecked': return !isDone(rawVal)
        case 'on': return !f.value || rawVal === f.value
        case 'before': return !f.value || (!!rawVal && rawVal < f.value)
        case 'after': return !f.value || (!!rawVal && rawVal > f.value)
        case 'empty': return isEmpty(v)
        case 'filled': return !isEmpty(v)
        default: return true
    }
}

function rowText(db, table, row) {
    return table.props
        .filter(p => !COMPUTED.includes(p.type) && p.type !== 'checkbox')
        .map(p => {
            const v = plain(db, p, row.cells[p.id])
            return Array.isArray(v) ? v.join(' ') : v == null ? '' : String(v)
        })
        .join(' ')
        .toLowerCase()
}

function visibleRows(db, table, query) {
    let rows = table.rows
    const filters = table.filters || []
    filters.forEach(f => {
        const prop = table.props.find(p => p.id === f.prop)
        if (prop) rows = rows.filter(r => matchFilter(db, table, r, prop, f))
    })
    const q = query.trim().toLowerCase()
    if (q) rows = rows.filter(r => rowText(db, table, r).includes(q))
    if (table.sort) {
        const prop = table.props.find(p => p.id === table.sort.prop)
        if (prop) {
            const dir = table.sort.dir === 'desc' ? -1 : 1
            const key = r => plain(db, prop, valueOf(db, table, r, prop))
            rows = [...rows].sort((a, b) => {
                const x = key(a)
                const y = key(b)
                if (isEmpty(x) && isEmpty(y)) return 0
                if (isEmpty(x)) return 1
                if (isEmpty(y)) return -1
                const cmp = typeof x === 'number' && typeof y === 'number' ? x - y : String(Array.isArray(x) ? x.join() : x).localeCompare(String(Array.isArray(y) ? y.join() : y), undefined, { numeric: true })
                return cmp * dir
            })
        }
    }
    return rows
}

const CALCS = {
    none: 'None', count: 'Count all', filled: 'Count values', empty: 'Count empty', pct_filled: 'Percent filled', pct_empty: 'Percent empty',
    sum: 'Sum', avg: 'Average', min: 'Min', max: 'Max', checked: 'Checked', unchecked: 'Unchecked', pct_checked: 'Percent checked',
}
const CALC_SHORT = { count: 'Count', filled: 'Filled', empty: 'Empty', pct_filled: 'Filled', pct_empty: 'Empty', sum: 'Sum', avg: 'Avg', min: 'Min', max: 'Max', checked: 'Checked', unchecked: 'Unchecked', pct_checked: 'Checked' }
const calcsFor = type => ['none', 'count', 'filled', 'empty', 'pct_filled', 'pct_empty']
    .concat(['number', 'rating', 'rollup', 'formula'].includes(type) ? ['sum', 'avg', 'min', 'max'] : [])
    .concat(type === 'checkbox' ? ['checked', 'unchecked', 'pct_checked'] : [])

function calcValue(fn, vals) {
    const n = vals.length
    const nums = vals.filter(v => typeof v === 'number' && !Number.isNaN(v))
    const pct = k => (n ? ((100 * k) / n).toFixed(1).replace(/\.0$/, '') + '%' : '0%')
    switch (fn) {
        case 'count': return n
        case 'filled': return vals.filter(v => !isEmpty(v)).length
        case 'empty': return vals.filter(isEmpty).length
        case 'pct_filled': return pct(vals.filter(v => !isEmpty(v)).length)
        case 'pct_empty': return pct(vals.filter(isEmpty).length)
        case 'sum': return Math.round(nums.reduce((a, b) => a + b, 0) * 100) / 100
        case 'avg': return nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100 : 0
        case 'min': return nums.length ? Math.min(...nums) : '–'
        case 'max': return nums.length ? Math.max(...nums) : '–'
        case 'checked': return vals.filter(isDone).length
        case 'unchecked': return n - vals.filter(isDone).length
        case 'pct_checked': return pct(vals.filter(isDone).length)
        default: return ''
    }
}

/* ============================================================
   Mutations (every updater uses a block body so it never returns a value)
   ============================================================ */
const defaultConfig = type => (type === 'relation' ? { target: '', twoWay: true } : type === 'rollup' ? { rel: '', target: '', fn: 'count' } : type === 'formula' ? { expr: '', show: 'number' } : {})
const uniqueName = (table, base) => {
    let name = base
    let n = 2
    while (table.props.some(p => p.name === name)) name = `${base} ${n++}`
    return name
}

function makeApi(update) {
    // Run an edit, then play its sound
    const act = (sound, fn) => (...args) => {
        fn(...args)
        play(sound)
    }
    const findRow = (d, tid, rid) => d.tables[tid].rows.find(r => r.id === rid)
    const dropReverse = (d, prop) => {
        if (prop.type !== 'relation' || !prop.config || !prop.config.reverse) return
        const other = d.tables[prop.config.target]
        const rp = other && other.props.find(p => p.id === prop.config.reverse)
        if (rp) rp.config.reverse = null
    }
    return {
        setCell: (tid, rid, pid, value) => update(d => {
            const r = findRow(d, tid, rid)
            if (!r) return
            r.cells[pid] = value
            r.edited = Date.now()
        }),
        setRow: (tid, rid, patch) => update(d => {
            const r = findRow(d, tid, rid)
            if (r) Object.assign(r, patch, { edited: Date.now() })
        }),
        toggleLink: act('tick', (tid, rid, pid, targetId) => update(d => {
            const prop = d.tables[tid].props.find(p => p.id === pid)
            const row = findRow(d, tid, rid)
            if (!prop || !row) return
            const cur = new Set(row.cells[pid] || [])
            const on = !cur.has(targetId)
            if (on) cur.add(targetId)
            else cur.delete(targetId)
            row.cells[pid] = [...cur]
            const rev = prop.config.reverse
            if (!rev) return
            const other = findRow(d, prop.config.target, targetId)
            if (!other) return
            const back = new Set(other.cells[rev] || [])
            if (on) back.add(rid)
            else back.delete(rid)
            other.cells[rev] = [...back]
        })),
        addRow: act('add', (tid, id) => update(d => {
            const t = d.tables[tid]
            const row = { id, icon: '📄', created: Date.now(), edited: null, body: '', cells: {} }
            t.props.forEach(p => {
                if (p.type === 'status') row.cells[p.id] = 'todo'
                if (p.type === 'checkbox') row.cells[p.id] = false
            })
            t.rows.push(row)
        })),
        duplicateRow: act('add', (tid, rid) => update(d => {
            const t = d.tables[tid]
            const i = t.rows.findIndex(r => r.id === rid)
            if (i < 0) return
            const copy = JSON.parse(JSON.stringify(t.rows[i]))
            copy.id = uid()
            copy.created = Date.now()
            copy.edited = null
            t.props.forEach(p => {
                if (p.type === 'relation') delete copy.cells[p.id]
            })
            const title = t.props[0].id
            copy.cells[title] = (copy.cells[title] || 'Untitled') + ' (copy)'
            t.rows.splice(i + 1, 0, copy)
        })),
        deleteRow: act('delete', (tid, rid) => update(d => {
            d.tables[tid].rows = d.tables[tid].rows.filter(r => r.id !== rid)
            Object.values(d.tables).forEach(t => {
                t.props.forEach(p => {
                    if (p.type === 'relation' && p.config.target === tid) t.rows.forEach(r => { if (r.cells[p.id]) r.cells[p.id] = r.cells[p.id].filter(x => x !== rid) })
                })
            })
        })),
        addProp: act('save', (tid, { name, type, config }) => update(d => {
            const t = d.tables[tid]
            const id = uid()
            const prop = { id, name, type, width: type === 'checkbox' ? 100 : 180 }
            if (type === 'select' || type === 'multiselect') prop.options = []
            if (type === 'relation') {
                prop.config = { target: config.target, reverse: null }
                if (config.twoWay !== false && config.target !== tid) {
                    const rid = uid()
                    prop.config.reverse = rid
                    d.tables[config.target].props.push({ id: rid, name: `Related to ${t.name} (${name})`, type: 'relation', width: 230, config: { target: tid, reverse: id } })
                }
            }
            if (type === 'rollup' || type === 'formula') prop.config = { ...config }
            t.props.push(prop)
            if (type === 'status') t.rows.forEach(r => { r.cells[id] = 'todo' })
            if (type === 'checkbox') t.rows.forEach(r => { r.cells[id] = false })
        })),
        deleteProp: act('delete', (tid, pid) => update(d => {
            const t = d.tables[tid]
            const prop = t.props.find(p => p.id === pid)
            if (!prop || prop.type === 'title') return
            dropReverse(d, prop)
            t.props = t.props.filter(p => p.id !== pid)
            t.rows.forEach(r => { delete r.cells[pid] })
            if (t.sort && t.sort.prop === pid) t.sort = null
            t.filters = (t.filters || []).filter(f => f.prop !== pid)
            if (t.calc) delete t.calc[pid]
        })),
        patchProp: (tid, pid, patch) => update(d => {
            const prop = d.tables[tid].props.find(p => p.id === pid)
            if (prop) Object.assign(prop, patch)
        }),
        setConfig: (tid, pid, config) => update(d => {
            const prop = d.tables[tid].props.find(p => p.id === pid)
            if (prop) prop.config = { ...prop.config, ...config }
        }),
        changeType: (tid, pid, type) => update(d => {
            const t = d.tables[tid]
            const prop = t.props.find(p => p.id === pid)
            if (!prop || prop.type === 'title' || prop.type === 'relation') return
            const keep = TEXTLIKE.includes(prop.type) && TEXTLIKE.includes(type)
            if (!keep) t.rows.forEach(r => { delete r.cells[pid] })
            prop.type = type
            delete prop.options
            delete prop.config
            if (type === 'select' || type === 'multiselect') prop.options = []
            if (type === 'rollup' || type === 'formula') prop.config = defaultConfig(type)
            if (type === 'status') t.rows.forEach(r => { r.cells[pid] = 'todo' })
            if (type === 'checkbox') t.rows.forEach(r => { r.cells[pid] = false })
            if (t.calc) delete t.calc[pid]
            if (t.sort && t.sort.prop === pid) t.sort = null
        }),
        moveProp: act('move', (tid, pid, dir) => update(d => {
            const props = d.tables[tid].props
            const i = props.findIndex(p => p.id === pid)
            const j = i + dir
            if (i < 1 || j < 1 || j >= props.length) return
            const tmp = props[i]
            props[i] = props[j]
            props[j] = tmp
        })),
        setWidth: (tid, pid, width) => update(d => {
            const prop = d.tables[tid].props.find(p => p.id === pid)
            if (prop) prop.width = width
        }),
        setTable: (tid, patch) => update(d => { Object.assign(d.tables[tid], patch) }),
        setCalc: (tid, pid, fn) => update(d => {
            const t = d.tables[tid]
            t.calc = { ...(t.calc || {}), [pid]: fn }
        }),
        addOption: act('tick', (tid, pid, option) => update(d => {
            const prop = d.tables[tid].props.find(p => p.id === pid)
            if (prop) prop.options = [...(prop.options || []), option]
        })),
        editOption: (tid, pid, oid, patch) => update(d => {
            const prop = d.tables[tid].props.find(p => p.id === pid)
            const o = prop && (prop.options || []).find(x => x.id === oid)
            if (o) Object.assign(o, patch)
        }),
        deleteOption: act('delete', (tid, pid, oid) => update(d => {
            const t = d.tables[tid]
            const prop = t.props.find(p => p.id === pid)
            if (!prop) return
            prop.options = (prop.options || []).filter(o => o.id !== oid)
            t.rows.forEach(r => {
                const v = r.cells[pid]
                if (Array.isArray(v)) r.cells[pid] = v.filter(x => x !== oid)
                else if (v === oid) r.cells[pid] = null
            })
        })),
        addTable: act('save', (id, name) => update(d => {
            const pid = uid()
            const sid = uid()
            d.tables[id] = {
                id, name, icon: '📋', sort: null, filters: [], calc: {}, rows: [],
                props: [{ id: pid, name: 'Name', type: 'title', width: 280 }, { id: sid, name: 'Status', type: 'status', width: 150 }],
            }
            d.order.push(id)
            d.active = id
        })),
        deleteTable: act('delete', tid => update(d => {
            if (d.order.length <= 1) return
            delete d.tables[tid]
            d.order = d.order.filter(x => x !== tid)
            Object.values(d.tables).forEach(t => {
                const dead = t.props.filter(p => p.type === 'relation' && p.config.target === tid).map(p => p.id)
                t.props = t.props.filter(p => !dead.includes(p.id))
                t.rows.forEach(r => dead.forEach(id => { delete r.cells[id] }))
            })
            if (d.active === tid) d.active = d.order[0]
        })),
        setActive: id => update(d => { d.active = id }),
        reset: () => update(() => seedDB()),
    }
}

function exportCSV(db, table) {
    const cell = v => `"${String(v == null ? '' : Array.isArray(v) ? v.join('; ') : v).replace(/"/g, '""')}"`
    const head = table.props.map(p => cell(p.name)).join(',')
    const lines = table.rows.map(r => table.props.map(p => cell(plain(db, p, valueOf(db, table, r, p)))).join(','))
    const blob = new Blob([[head, ...lines].join('\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${table.name}.csv`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

/* ============================================================
   UI building blocks
   ============================================================ */
function Pop({ anchor, onClose, children, width = 260 }) {
    const ref = useRef(null)
    const [pos, setPos] = useState(null)

    useLayoutEffect(() => {
        const r = anchor.getBoundingClientRect()
        const h = ref.current ? ref.current.offsetHeight : 0
        const left = clamp(r.left, 8, Math.max(8, window.innerWidth - width - 12))
        const below = r.bottom + 4
        const top = below + h > window.innerHeight - 8 ? Math.max(8, r.top - h - 4) : below
        setPos({ left, top })
    }, [anchor, width])

    useEffect(() => {
        const onKey = e => { if (e.key === 'Escape') onClose() }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [onClose])

    return createPortal(
        <>
            <div className="nt-back" onMouseDown={onClose} />
            <div ref={ref} className="nt-pop" role="dialog" style={{ left: pos ? pos.left : -9999, top: pos ? pos.top : 0, width }}>{children}</div>
        </>,
        document.body,
    )
}

const Pill = ({ name, color, dot }) => (
    <span className="nt-pill" style={{ '--c': COLORS[color] || COLORS.gray }}>{dot && <i />}{name}</span>
)

function Segments({ pct }) {
    if (pct >= 100) return <span className="nt-fin">✅ Finished</span>
    const filled = Math.round(pct / 10)
    return (
        <span className="nt-seg">
            <span className="nt-segs" aria-hidden="true">{Array.from({ length: 10 }, (_, i) => <i key={i} className={i < filled ? 'on' : ''} />)}</span>
            <b>{pct}%</b>
        </span>
    )
}

function TextInput({ value, onSave, onCancel, type = 'text' }) {
    const [draft, setDraft] = useState(value == null ? '' : String(value))
    const cancelled = useRef(false)
    return (
        <input autoFocus className="nt-input" type={type} value={draft} onChange={e => setDraft(e.target.value)}
            onBlur={() => { if (!cancelled.current) onSave(draft) }}
            onKeyDown={e => {
                if (e.key === 'Enter') e.currentTarget.blur()
                if (e.key === 'Escape') {
                    cancelled.current = true
                    onCancel()
                }
            }} />
    )
}

function TypeList({ current, onPick, disabled = [] }) {
    return (
        <div className="nt-types">
            {PROP_TYPES.map(t => (
                <button key={t.id} className="nt-item" disabled={disabled.includes(t.id)} onClick={() => onPick(t.id)}>
                    <span className="nt-ti">{t.icon}</span><span className="grow">{t.name}</span>{current === t.id && <span>✓</span>}
                </button>
            ))}
        </div>
    )
}

function IconPop({ anchor, onClose, onPick }) {
    return (
        <Pop anchor={anchor} onClose={onClose} width={250}>
            <div className="nt-emoji">{EMOJI.map(e => <button key={e} onClick={() => onPick(e)}>{e}</button>)}</div>
        </Pop>
    )
}

function OptionPop({ anchor, onClose, options, value, multi, onChange, onCreate }) {
    const [q, setQ] = useState('')
    const ids = multi ? value || [] : value ? [value] : []
    const text = q.trim().toLowerCase()
    const shown = options.filter(o => o.name.toLowerCase().includes(text))
    const exact = options.find(o => o.name.toLowerCase() === text)

    const pick = id => {
        if (multi) onChange(ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id])
        else {
            onChange(value === id ? null : id)
            onClose()
        }
    }
    const create = () => {
        const id = uid()
        onCreate({ id, name: q.trim(), color: COLOR_KEYS[options.length % COLOR_KEYS.length] })
        if (multi) onChange([...ids, id])
        else {
            onChange(id)
            onClose()
        }
        setQ('')
    }

    return (
        <Pop anchor={anchor} onClose={onClose}>
            <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder={onCreate ? 'Search or create an option' : 'Search'}
                onKeyDown={e => {
                    if (e.key !== 'Enter' || !q.trim()) return
                    if (exact) pick(exact.id)
                    else if (onCreate) create()
                }} />
            <div className="nt-opts">
                {shown.map(o => (
                    <button key={o.id} className="nt-opt" onClick={() => pick(o.id)}>
                        <Pill name={o.name} color={o.color} dot={!onCreate} />
                        <span className="grow" />{ids.includes(o.id) && <span>✓</span>}
                    </button>
                ))}
                {onCreate && q.trim() && !exact && <button className="nt-opt" onClick={create}>Create <Pill name={q.trim()} color="gray" /></button>}
                {!shown.length && !(onCreate && q.trim()) && <p className="muted small nt-pad">No options.</p>}
            </div>
        </Pop>
    )
}

function RelationPop({ anchor, onClose, other, value, onToggle }) {
    const [q, setQ] = useState('')
    const rows = other.rows.filter(r => (r.cells[other.props[0].id] || '').toLowerCase().includes(q.trim().toLowerCase()))
    return (
        <Pop anchor={anchor} onClose={onClose} width={300}>
            <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder={`Link to ${other.name}…`} />
            <div className="nt-opts">
                {rows.map(r => (
                    <label key={r.id} className="nt-opt">
                        <input type="checkbox" checked={value.includes(r.id)} onChange={() => onToggle(r.id)} />
                        <span>{r.icon}</span><span className="grow nt-trunc">{r.cells[other.props[0].id] || 'Untitled'}</span>
                    </label>
                ))}
                {!rows.length && <p className="muted small nt-pad">{other.rows.length ? 'No matches.' : `${other.name} has no rows yet.`}</p>}
            </div>
        </Pop>
    )
}

function ChipsPop({ anchor, onClose, value, onChange, placeholder }) {
    const [text, setText] = useState('')
    const add = () => {
        const v = text.trim()
        if (v && !value.includes(v)) onChange([...value, v])
        setText('')
    }
    return (
        <Pop anchor={anchor} onClose={onClose}>
            <input autoFocus value={text} onChange={e => setText(e.target.value)} placeholder={placeholder} onKeyDown={e => e.key === 'Enter' && add()} />
            <div className="nt-opts">
                {value.map(v => (
                    <div key={v} className="nt-opt"><span className="grow nt-trunc">{v}</span>
                        <button className="icon-btn" onClick={() => onChange(value.filter(x => x !== v))} aria-label={`Remove ${v}`}>×</button></div>
                ))}
            </div>
        </Pop>
    )
}

const fmtDay = s => (s ? new Date(s + 'T00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '')
const hrefOf = (type, v) => (type === 'email' ? 'mailto:' + v : type === 'phone' ? 'tel:' + v : /^https?:\/\//.test(v) ? v : 'https://' + v)

/* ---------- one cell, any property type ---------- */
function Cell({ db, table, row, prop, api, block }) {
    const [anchor, setAnchor] = useState(null)
    const [editing, setEditing] = useState(false)
    const raw = valueOf(db, table, row, prop)
    const type = prop.type
    const close = () => setAnchor(null)
    const open = e => setAnchor(e.currentTarget)
    const set = v => api.setCell(table.id, row.id, prop.id, v)

    if (type === 'title') {
        return (
            <div className="nt-cell nt-titlecell">
                <button className="nt-icon" onClick={open} aria-label="Change icon">{row.icon}</button>
                {editing
                    ? <TextInput value={raw} onSave={v => { set(v.trim()); setEditing(false) }} onCancel={() => setEditing(false)} />
                    : <button className="nt-ttext" onClick={() => setEditing(true)}>{raw || <span className="muted">Untitled</span>}</button>}
                {!block && <button className="nt-openbtn" onClick={() => api.peek(row.id)}>Open</button>}
                {anchor && <IconPop anchor={anchor} onClose={close} onPick={ic => { api.setRow(table.id, row.id, { icon: ic }); close() }} />}
            </div>
        )
    }

    if (TEXTLIKE.includes(type) || type === 'number') {
        const text = raw == null ? '' : String(raw)
        return (
            <div className="nt-cell nt-click" onClick={() => setEditing(true)}>
                {editing
                    ? <TextInput type={type === 'number' ? 'number' : 'text'} value={raw}
                        onSave={v => { set(type === 'number' ? (v === '' ? null : Number(v)) : v); setEditing(false) }} onCancel={() => setEditing(false)} />
                    : type === 'text' || type === 'number' ? text
                        : text && <a href={hrefOf(type, text)} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>{text}</a>}
            </div>
        )
    }

    if (['select', 'multiselect', 'status'].includes(type)) {
        const options = type === 'status' ? STATUS : prop.options || []
        const ids = type === 'multiselect' ? raw || [] : raw ? [raw] : []
        return (
            <>
                <button className="nt-cell nt-click nt-fill" onClick={open} aria-label={`Edit ${prop.name}`}>
                    {ids.map(id => {
                        const o = options.find(x => x.id === id)
                        return o ? <Pill key={id} name={o.name} color={o.color} dot={type === 'status'} /> : null
                    })}
                </button>
                {anchor && (
                    <OptionPop anchor={anchor} onClose={close} options={options} value={raw} multi={type === 'multiselect'}
                        onChange={v => { set(v); if (type === 'status' && v === 'done') play('check') }} onCreate={type === 'status' ? null : o => api.addOption(table.id, prop.id, o)} />
                )}
            </>
        )
    }

    if (type === 'date') {
        return (
            <>
                <button className="nt-cell nt-click nt-fill" onClick={open} aria-label={`Edit ${prop.name}`}>{fmtDay(raw)}</button>
                {anchor && (
                    <Pop anchor={anchor} onClose={close} width={230}>
                        <input autoFocus type="date" value={raw || ''} onChange={e => set(e.target.value)} />
                        <div className="row nt-pad">
                            <button className="btn sm" onClick={() => { set(new Date().toLocaleDateString('en-CA')); close() }}>Today</button>
                            <button className="btn sm" onClick={() => { set(''); close() }}>Clear</button>
                        </div>
                    </Pop>
                )}
            </>
        )
    }

    if (type === 'checkbox') {
        return (
            <div className="nt-cell nt-center">
                <input type="checkbox" checked={!!raw} onChange={e => { set(e.target.checked); play(e.target.checked ? 'check' : 'uncheck') }} aria-label={prop.name} />
            </div>
        )
    }

    if (type === 'relation') {
        const other = prop.config && db.tables[prop.config.target]
        if (!other) return <div className="nt-cell nt-err">⚠ Missing table</div>
        const linked = (raw || []).map(id => other.rows.find(r => r.id === id)).filter(Boolean)
        return (
            <>
                <button className="nt-cell nt-click nt-fill" onClick={open} aria-label={`Edit ${prop.name}`}>
                    {linked.map(r => <span key={r.id} className="nt-rel">{r.icon} {r.cells[other.props[0].id] || 'Untitled'}</span>)}
                </button>
                {anchor && <RelationPop anchor={anchor} onClose={close} other={other} value={raw || []} onToggle={id => api.toggleLink(table.id, row.id, prop.id, id)} />}
            </>
        )
    }

    if (type === 'rating') {
        const n = raw || 0
        return (
            <div className="nt-cell nt-stars" role="radiogroup" aria-label={prop.name}>
                {[1, 2, 3, 4, 5].map(i => (
                    <button key={i} className={i <= n ? 'on' : ''} onClick={() => { set(n === i ? 0 : i); play('tick') }} aria-label={`${i} star${i > 1 ? 's' : ''}`}>★</button>
                ))}
            </div>
        )
    }

    if (type === 'person' || type === 'files') {
        const list = raw || []
        return (
            <>
                <button className="nt-cell nt-click nt-fill" onClick={open} aria-label={`Edit ${prop.name}`}>
                    {list.map(v => type === 'person'
                        ? <span key={v} className="nt-rel"><span className="nt-avatar">{v[0].toUpperCase()}</span> {v}</span>
                        : <a key={v} className="nt-rel" href={hrefOf('url', v)} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>⌁ {v.replace(/^https?:\/\//, '').slice(0, 28)}</a>)}
                </button>
                {anchor && <ChipsPop anchor={anchor} onClose={close} value={list} onChange={set} placeholder={type === 'person' ? 'Add a name and press Enter' : 'Paste a link and press Enter'} />}
            </>
        )
    }

    if (type === 'rollup') {
        if (raw.error) return <div className="nt-cell nt-err" title={raw.error}>⚠ {raw.error}</div>
        if (raw.kind === 'percent') return <div className="nt-cell"><Segments pct={raw.value} /></div>
        if (raw.kind === 'list') return <div className="nt-cell nt-fill">{raw.value.map((v, i) => <span key={i} className="nt-rel">{v}</span>)}</div>
        return <div className="nt-cell">{raw.value == null ? '' : raw.value}</div>
    }

    if (type === 'formula') {
        if (raw && raw.error) return <div className="nt-cell nt-err" title={raw.error}>⚠ {raw.error}</div>
        let out = String(raw == null ? '' : raw)
        if (typeof raw === 'boolean') out = <input type="checkbox" checked={raw} disabled aria-label="Formula result" />
        else if (Array.isArray(raw)) out = raw.map((v, i) => <span key={i} className="nt-rel">{v}</span>)
        else if (typeof raw === 'number') out = prop.config && prop.config.show === 'bar' ? <Segments pct={clamp(Math.round(raw), 0, 100)} /> : Number.isFinite(raw) ? String(Math.round(raw * 100) / 100) : '—'
        return <div className="nt-cell nt-fill">{out}</div>
    }

    // created / edited
    return <div className="nt-cell muted">{raw ? new Date(raw).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : ''}</div>
}

/* ---------- property configuration ---------- */
function ConfigForm({ db, table, type, config, onChange, creating }) {
    const set = patch => onChange({ ...config, ...patch })

    if (type === 'relation') {
        return (
            <>
                <label className="field"><span>Related table</span>
                    <select value={config.target || ''} disabled={!creating} onChange={e => set({ target: e.target.value })}>
                        <option value="">Choose a table</option>
                        {db.order.map(id => <option key={id} value={id}>{db.tables[id].icon} {db.tables[id].name}</option>)}
                    </select>
                </label>
                {creating && config.target && config.target !== table.id && (
                    <label className="row small"><input type="checkbox" checked={config.twoWay !== false} onChange={e => set({ twoWay: e.target.checked })} />
                        Also add a related property to {db.tables[config.target].name}</label>
                )}
            </>
        )
    }

    if (type === 'rollup') {
        const rels = table.props.filter(p => p.type === 'relation')
        const relProp = rels.find(p => p.id === config.rel)
        const other = relProp && db.tables[relProp.config.target]
        if (!rels.length) return <p className="muted small">Add a relation property first. A rollup summarises the rows it links to.</p>
        return (
            <>
                <label className="field"><span>Relation</span>
                    <select value={config.rel || ''} onChange={e => set({ rel: e.target.value, target: '' })}>
                        <option value="">Choose a relation</option>
                        {rels.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                </label>
                <label className="field"><span>Property</span>
                    <select value={config.target || ''} disabled={!other} onChange={e => set({ target: e.target.value })}>
                        <option value="">Choose a property</option>
                        {other && other.props.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                </label>
                <label className="field"><span>Calculate</span>
                    <select value={config.fn || 'count'} onChange={e => set({ fn: e.target.value })}>
                        {Object.entries(ROLLUPS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                </label>
            </>
        )
    }

    if (type === 'formula') {
        return (
            <>
                <label className="field"><span>Formula</span>
                    <textarea rows={3} value={config.expr || ''} placeholder={'round(prop("Done") / 10 * 100)'} onChange={e => set({ expr: e.target.value })} spellCheck="false" />
                </label>
                <p className="muted small">Use <code>prop("Name")</code> to read a property. Operators: + - * / % &gt; &lt; == != && ||. Functions: {Object.keys(FN).join(', ')}.</p>
                <label className="row small"><input type="checkbox" checked={config.show === 'bar'} onChange={e => set({ show: e.target.checked ? 'bar' : 'number' })} /> Show a 0 to 100 result as a progress bar</label>
            </>
        )
    }
    return null
}

function AddPropMenu({ anchor, onClose, db, table, api }) {
    const [type, setType] = useState(null)
    const [name, setName] = useState('')
    const [config, setConfig] = useState({})

    if (!type) {
        return (
            <Pop key="type" anchor={anchor} onClose={onClose} width={230}>
                <TypeList current={null} onPick={t => { setType(t); setName(uniqueName(table, typeMeta(t).name)); setConfig(defaultConfig(t)) }} />
            </Pop>
        )
    }
    const ready = name.trim() && (type !== 'relation' || config.target) && (type !== 'rollup' || (config.rel && config.target))
    return (
        <Pop key="config" anchor={anchor} onClose={onClose} width={300}>
            <div className="nt-pad">
                <label className="field"><span>{typeMeta(type).icon} {typeMeta(type).name} property name</span>
                    <input autoFocus value={name} onChange={e => setName(e.target.value)} /></label>
                <ConfigForm db={db} table={table} type={type} config={config} onChange={setConfig} creating />
                <div className="row">
                    <button className="btn sm" onClick={() => setType(null)}>Back</button>
                    <span className="grow" />
                    <button className="btn sm primary" disabled={!ready} onClick={() => { api.addProp(table.id, { name: name.trim(), type, config }); onClose() }}>Create property</button>
                </div>
            </div>
        </Pop>
    )
}

function OptionsEditor({ table, prop, api }) {
    return (
        <div className="nt-optedit">
            {(prop.options || []).map(o => (
                <div key={o.id} className="row">
                    <button className="nt-colordot" style={{ background: COLORS[o.color] }} title="Change colour" aria-label="Change colour"
                        onClick={() => api.editOption(table.id, prop.id, o.id, { color: COLOR_KEYS[(COLOR_KEYS.indexOf(o.color) + 1) % COLOR_KEYS.length] })} />
                    <input defaultValue={o.name} aria-label="Option name" onBlur={e => e.target.value.trim() && api.editOption(table.id, prop.id, o.id, { name: e.target.value.trim() })} />
                    <button className="icon-btn" onClick={() => api.deleteOption(table.id, prop.id, o.id)} aria-label="Delete option">×</button>
                </div>
            ))}
            {!(prop.options || []).length && <p className="muted small">No options yet. Create them from any cell.</p>}
        </div>
    )
}

function PropMenu({ anchor, onClose, db, table, prop, api }) {
    const [view, setView] = useState('main')
    const [name, setName] = useState(prop.name)
    const [armed, setArmed] = useState(false)
    const isTitle = prop.type === 'title'
    const idx = table.props.indexOf(prop)
    const meta = typeMeta(prop.type)
    const rename = () => name.trim() && name.trim() !== prop.name && api.patchProp(table.id, prop.id, { name: name.trim() })

    if (view === 'type') {
        return (
            <Pop key="type" anchor={anchor} onClose={onClose} width={230}>
                <TypeList current={prop.type} disabled={['relation']} onPick={t => { if (t !== prop.type) api.changeType(table.id, prop.id, t); onClose() }} />
            </Pop>
        )
    }
    return (
        <Pop key="main" anchor={anchor} onClose={() => { rename(); onClose() }} width={290}>
            <div className="nt-pad">
                <input value={name} onChange={e => setName(e.target.value)} onBlur={rename} onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()} aria-label="Property name" />
            </div>
            {!isTitle && prop.type !== 'relation' && (
                <button className="nt-item" onClick={() => { rename(); setView('type') }}>
                    <span className="nt-ti">{meta.icon}</span><span className="grow">Type</span><span className="muted">{meta.name} ›</span>
                </button>
            )}
            {prop.type === 'relation' && <p className="muted small nt-pad">Related to <b>{db.tables[prop.config.target] ? db.tables[prop.config.target].name : 'a deleted table'}</b>{prop.config.reverse ? ' (two-way)' : ''}</p>}
            {(prop.type === 'rollup' || prop.type === 'formula') && (
                <div className="nt-pad">
                    <ConfigForm db={db} table={table} type={prop.type} config={prop.config || {}} onChange={c => api.setConfig(table.id, prop.id, c)} />
                </div>
            )}
            {(prop.type === 'select' || prop.type === 'multiselect') && <div className="nt-pad"><OptionsEditor table={table} prop={prop} api={api} /></div>}
            <hr />
            <button className="nt-item" onClick={() => { api.setTable(table.id, { sort: { prop: prop.id, dir: 'asc' } }); onClose() }}><span className="nt-ti">↑</span>Sort ascending</button>
            <button className="nt-item" onClick={() => { api.setTable(table.id, { sort: { prop: prop.id, dir: 'desc' } }); onClose() }}><span className="nt-ti">↓</span>Sort descending</button>
            {!isTitle && <button className="nt-item" onClick={() => { api.patchProp(table.id, prop.id, { hidden: true }); onClose() }}><span className="nt-ti">⊘</span>Hide property</button>}
            {!isTitle && idx > 1 && <button className="nt-item" onClick={() => { api.moveProp(table.id, prop.id, -1); onClose() }}><span className="nt-ti">←</span>Move left</button>}
            {!isTitle && idx < table.props.length - 1 && <button className="nt-item" onClick={() => { api.moveProp(table.id, prop.id, 1); onClose() }}><span className="nt-ti">→</span>Move right</button>}
            {!isTitle && (
                <button className="nt-item danger" onClick={() => { if (armed) { api.deleteProp(table.id, prop.id); onClose() } else setArmed(true) }}>
                    <span className="nt-ti">🗑</span>{armed ? 'Click again to delete' : 'Delete property'}
                </button>
            )}
        </Pop>
    )
}

function Th({ db, table, prop, api }) {
    const [anchor, setAnchor] = useState(null)
    const sorted = table.sort && table.sort.prop === prop.id
    const startResize = e => {
        e.preventDefault()
        const x0 = e.clientX
        const w0 = prop.width || 180
        const move = ev => api.setWidth(table.id, prop.id, clamp(w0 + ev.clientX - x0, 90, 700))
        const up = () => {
            window.removeEventListener('mousemove', move)
            window.removeEventListener('mouseup', up)
        }
        window.addEventListener('mousemove', move)
        window.addEventListener('mouseup', up)
    }
    return (
        <th>
            <button className="nt-th" onClick={e => setAnchor(e.currentTarget)}>
                <span className="nt-ti">{typeMeta(prop.type).icon}</span>
                <span className="nt-trunc">{prop.name}</span>
                {sorted && <span className="nt-sorted" title="Sorted">{table.sort.dir === 'desc' ? '↓' : '↑'}</span>}
            </button>
            <span className="nt-resize" onMouseDown={startResize} role="separator" aria-label={`Resize ${prop.name}`} />
            {anchor && <PropMenu anchor={anchor} onClose={() => setAnchor(null)} db={db} table={table} prop={prop} api={api} />}
        </th>
    )
}

function CalcCell({ db, table, prop, rows, api }) {
    const [anchor, setAnchor] = useState(null)
    const fn = (table.calc || {})[prop.id] || 'none'
    const vals = fn === 'none' ? [] : rows.map(r => plain(db, prop, valueOf(db, table, r, prop)))
    return (
        <td className="nt-calc">
            <button onClick={e => setAnchor(e.currentTarget)}>
                {fn === 'none' ? <span className="nt-calc-empty">Calculate</span> : <><span>{CALC_SHORT[fn]}</span> <b>{calcValue(fn, vals)}</b></>}
            </button>
            {anchor && (
                <Pop anchor={anchor} onClose={() => setAnchor(null)} width={210}>
                    {calcsFor(prop.type).map(k => (
                        <button key={k} className="nt-item" onClick={() => { api.setCalc(table.id, prop.id, k); setAnchor(null) }}>
                            <span className="grow">{CALCS[k]}</span>{fn === k && <span>✓</span>}
                        </button>
                    ))}
                </Pop>
            )}
        </td>
    )
}

/* ---------- toolbar menus ---------- */
function FilterMenu({ anchor, onClose, db, table, api }) {
    const filters = table.filters || []
    const save = list => api.setTable(table.id, { filters: list })
    const patch = (id, p) => save(filters.map(f => (f.id === id ? { ...f, ...p } : f)))
    const add = () => save([...filters, { id: uid(), prop: table.props[0].id, op: 'contains', value: '' }])

    const valueInput = (f, prop) => {
        if (!needsValue(f.op)) return null
        if (['is', 'has'].includes(f.op)) {
            const options = prop.type === 'status' ? STATUS
                : prop.type === 'relation' ? (db.tables[prop.config.target] ? db.tables[prop.config.target].rows.map(r => ({ id: r.id, name: titleOf(db.tables[prop.config.target], r.id) })) : [])
                    : prop.options || []
            return (
                <select value={f.value || ''} onChange={e => patch(f.id, { value: e.target.value })} aria-label="Filter value">
                    <option value="">Choose…</option>
                    {options.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
            )
        }
        return <input type={['on', 'before', 'after'].includes(f.op) ? 'date' : 'text'} value={f.value || ''} onChange={e => patch(f.id, { value: e.target.value })} aria-label="Filter value" />
    }

    return (
        <Pop anchor={anchor} onClose={onClose} width={400}>
            <div className="nt-pad nt-filters">
                {filters.length === 0 && <p className="muted small">No filters. Rows must match every filter you add.</p>}
                {filters.map(f => {
                    const prop = table.props.find(p => p.id === f.prop) || table.props[0]
                    return (
                        <div key={f.id} className="nt-frow">
                            <select value={f.prop} aria-label="Property" onChange={e => {
                                const np = table.props.find(p => p.id === e.target.value)
                                patch(f.id, { prop: np.id, op: opsFor(np.type)[0], value: '' })
                            }}>
                                {table.props.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                            </select>
                            <select value={f.op} aria-label="Condition" onChange={e => patch(f.id, { op: e.target.value, value: '' })}>
                                {opsFor(prop.type).map(o => <option key={o} value={o}>{OPS[o]}</option>)}
                            </select>
                            {valueInput(f, prop)}
                            <button className="icon-btn" onClick={() => save(filters.filter(x => x.id !== f.id))} aria-label="Remove filter">×</button>
                        </div>
                    )
                })}
                <div className="row">
                    <button className="btn sm" onClick={add}>+ Add filter</button>
                    {filters.length > 0 && <button className="btn sm ghost" onClick={() => save([])}>Clear all</button>}
                </div>
            </div>
        </Pop>
    )
}

function SortMenu({ anchor, onClose, table, api }) {
    const sort = table.sort
    return (
        <Pop anchor={anchor} onClose={onClose} width={280}>
            <div className="nt-pad">
                <label className="field"><span>Sort by</span>
                    <select value={sort ? sort.prop : ''} onChange={e => api.setTable(table.id, { sort: e.target.value ? { prop: e.target.value, dir: sort ? sort.dir : 'asc' } : null })}>
                        <option value="">No sorting</option>
                        {table.props.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                </label>
                {sort && (
                    <div className="seg">
                        <button className={'btn sm' + (sort.dir === 'asc' ? ' on' : '')} onClick={() => api.setTable(table.id, { sort: { ...sort, dir: 'asc' } })}>Ascending</button>
                        <button className={'btn sm' + (sort.dir === 'desc' ? ' on' : '')} onClick={() => api.setTable(table.id, { sort: { ...sort, dir: 'desc' } })}>Descending</button>
                    </div>
                )}
            </div>
        </Pop>
    )
}

function PropsMenu({ anchor, onClose, table, api }) {
    return (
        <Pop anchor={anchor} onClose={onClose} width={260}>
            <p className="muted small nt-pad">Show or hide properties</p>
            {table.props.map(p => (
                <label key={p.id} className="nt-item" style={p.type === 'title' ? { opacity: 0.5 } : null}>
                    <input type="checkbox" checked={!p.hidden} disabled={p.type === 'title'} onChange={e => api.patchProp(table.id, p.id, { hidden: !e.target.checked })} />
                    <span className="nt-ti">{typeMeta(p.type).icon}</span><span className="grow nt-trunc">{p.name}</span>
                </label>
            ))}
        </Pop>
    )
}

function TableMenu({ anchor, onClose, db, table, api }) {
    const [armed, setArmed] = useState(false)
    const [reset, setReset] = useState(false)
    return (
        <Pop anchor={anchor} onClose={onClose} width={240}>
            <button className="nt-item" onClick={() => { exportCSV(db, table); onClose() }}><span className="nt-ti">⇩</span>Export as CSV</button>
            <button className="nt-item danger" disabled={db.order.length <= 1} onClick={() => { if (armed) { api.deleteTable(table.id); onClose() } else setArmed(true) }}>
                <span className="nt-ti">🗑</span>{armed ? 'Click again to delete' : 'Delete this database'}
            </button>
            <button className="nt-item danger" onClick={() => { if (reset) { api.reset(); onClose() } else setReset(true) }}>
                <span className="nt-ti">↺</span>{reset ? 'Click again to reset everything' : 'Reset to the example data'}
            </button>
        </Pop>
    )
}

function RowMenu({ anchor, onClose, table, row, api }) {
    const [armed, setArmed] = useState(false)
    return (
        <Pop anchor={anchor} onClose={onClose} width={200}>
            <button className="nt-item" onClick={() => { api.peek(row.id); onClose() }}><span className="nt-ti">↗</span>Open</button>
            <button className="nt-item" onClick={() => { api.duplicateRow(table.id, row.id); onClose() }}><span className="nt-ti">⧉</span>Duplicate</button>
            <button className="nt-item danger" onClick={() => { if (armed) { api.deleteRow(table.id, row.id); onClose() } else setArmed(true) }}>
                <span className="nt-ti">🗑</span>{armed ? 'Click again to delete' : 'Delete'}
            </button>
        </Pop>
    )
}

function Peek({ db, table, row, api, onClose }) {
    useEffect(() => {
        const onKey = e => { if (e.key === 'Escape' && !document.querySelector('.nt-pop')) onClose() }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [onClose])
    return (
        <aside className="nt-peek" aria-label="Row details">
            <div className="row">
                <button className="btn sm" onClick={onClose}>Close</button>
                <span className="grow muted small">{table.icon} {table.name}</span>
            </div>
            <div className="nt-bigtitle"><Cell db={db} table={table} row={row} prop={table.props[0]} api={api} block /></div>
            {table.props.slice(1).map(p => (
                <div key={p.id} className="nt-prow">
                    <div className="nt-plabel"><span className="nt-ti">{typeMeta(p.type).icon}</span><span className="nt-trunc">{p.name}</span></div>
                    <div className="nt-pval"><Cell db={db} table={table} row={row} prop={p} api={api} block /></div>
                </div>
            ))}
            <h4>Notes</h4>
            <textarea rows={9} value={row.body || ''} placeholder="Write notes about this item…" onChange={e => api.setRow(table.id, row.id, { body: e.target.value })} />
        </aside>
    )
}

/* ============================================================
   The database block
   ============================================================ */
export default function Database() {
    const [db, , update] = useStore('database', seedDB)
    const [query, setQuery] = useState('')
    const [peekId, setPeekId] = useState(null)
    const [menu, setMenu] = useState(null)
    const api = useMemo(() => ({ ...makeApi(update), peek: setPeekId }), [update])

    const table = db.tables[db.active] || db.tables[db.order[0]]
    const props = table.props.filter(p => !p.hidden || p.type === 'title')
    const hidden = table.props.length - props.length
    const rows = useMemo(() => visibleRows(db, table, query), [db, table, query])
    const peekRow = peekId && table.rows.find(r => r.id === peekId)
    const width = 34 + props.reduce((sum, p) => sum + (p.width || 180), 0) + 44
    const filterCount = (table.filters || []).length
    const sortProp = table.sort && table.props.find(p => p.id === table.sort.prop)
    const closeMenu = () => setMenu(null)
    const openMenu = (kind, extra) => e => setMenu({ kind, anchor: e.currentTarget, ...extra })
    const menuRow = menu && menu.rowId && table.rows.find(r => r.id === menu.rowId)

    const newTable = () => {
        const name = window.prompt('Name of the new database', 'Reading list')
        if (name && name.trim()) api.addTable(uid(), name.trim())
    }

    return (
        <section className="card nt" aria-label="Databases">
            <style>{CSS}</style>
            <div className="nt-tabs" role="tablist">
                {db.order.map(id => (
                    <button key={id} role="tab" aria-selected={id === table.id} className={id === table.id ? 'on' : ''} onClick={() => { api.setActive(id); setPeekId(null); setQuery('') }}>
                        {db.tables[id].icon} {db.tables[id].name}
                    </button>
                ))}
                <button onClick={newTable} className="nt-addtab" title="New database">+ New database</button>
            </div>

            <div className="nt-bar">
                <div className="nt-titlebar">
                    <button className="nt-ticon" onClick={openMenu('icon')} aria-label="Change database icon">{table.icon}</button>
                    <input className="nt-name" value={table.name} onChange={e => api.setTable(table.id, { name: e.target.value })} aria-label="Database name" />
                </div>
                <div className="nt-tools">
                    <button className={'btn sm ghost' + (filterCount ? ' on' : '')} onClick={openMenu('filter')}>Filter{filterCount ? ` · ${filterCount}` : ''}</button>
                    <button className={'btn sm ghost' + (sortProp ? ' on' : '')} onClick={openMenu('sort')}>Sort{sortProp ? ` · ${sortProp.name}` : ''}</button>
                    <button className={'btn sm ghost' + (hidden ? ' on' : '')} onClick={openMenu('props')}>Properties{hidden ? ` · ${hidden} hidden` : ''}</button>
                    <input className="nt-search" type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search…" aria-label="Search rows" />
                    <button className="btn sm primary" onClick={() => api.addRow(table.id, uid())}>New</button>
                    <button className="btn sm ghost" onClick={openMenu('table')} aria-label="More">···</button>
                </div>
            </div>

            <div className="nt-scroll">
                <table className="nt-table" style={{ width }}>
                    <colgroup>
                        <col style={{ width: 34 }} />
                        {props.map(p => <col key={p.id} style={{ width: p.width || 180 }} />)}
                        <col style={{ width: 44 }} />
                    </colgroup>
                    <thead>
                        <tr>
                            <th />
                            {props.map(p => <Th key={p.id} db={db} table={table} prop={p} api={api} />)}
                            <th><button className="nt-addp" onClick={openMenu('addprop')} aria-label="Add a property" title="Add a property">+</button></th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map(r => (
                            <tr key={r.id} className={peekId === r.id ? 'on' : ''}>
                                <td className="nt-gut"><button onClick={openMenu('row', { rowId: r.id })} aria-label="Row actions">⋮</button></td>
                                {props.map(p => <td key={p.id}><Cell db={db} table={table} row={r} prop={p} api={api} /></td>)}
                                <td />
                            </tr>
                        ))}
                        <tr className="nt-new">
                            <td colSpan={props.length + 2}>
                                <button onClick={() => api.addRow(table.id, uid())}>+ New row</button>
                                {!rows.length && table.rows.length > 0 && <span className="muted small"> No rows match the current search or filters.</span>}
                            </td>
                        </tr>
                    </tbody>
                    <tfoot>
                        <tr>
                            <td />
                            {props.map(p => <CalcCell key={p.id} db={db} table={table} prop={p} rows={rows} api={api} />)}
                            <td />
                        </tr>
                    </tfoot>
                </table>
            </div>

            {peekRow && <Peek db={db} table={table} row={peekRow} api={api} onClose={() => setPeekId(null)} />}
            {menu && menu.kind === 'icon' && <IconPop anchor={menu.anchor} onClose={closeMenu} onPick={ic => { api.setTable(table.id, { icon: ic }); closeMenu() }} />}
            {menu && menu.kind === 'filter' && <FilterMenu anchor={menu.anchor} onClose={closeMenu} db={db} table={table} api={api} />}
            {menu && menu.kind === 'sort' && <SortMenu anchor={menu.anchor} onClose={closeMenu} table={table} api={api} />}
            {menu && menu.kind === 'props' && <PropsMenu anchor={menu.anchor} onClose={closeMenu} table={table} api={api} />}
            {menu && menu.kind === 'table' && <TableMenu anchor={menu.anchor} onClose={closeMenu} db={db} table={table} api={api} />}
            {menu && menu.kind === 'addprop' && <AddPropMenu anchor={menu.anchor} onClose={closeMenu} db={db} table={table} api={api} />}
            {menu && menu.kind === 'row' && menuRow && <RowMenu anchor={menu.anchor} onClose={closeMenu} table={table} row={menuRow} api={api} />}
        </section>
    )
}

const CSS = `
.nt{padding:18px 20px 14px;display:grid;gap:12px;position:relative}
.nt-tabs{display:flex;gap:4px;flex-wrap:wrap;border-bottom:1px solid var(--ln);padding-bottom:8px}
.nt-tabs button{border:0;background:none;padding:5px 12px;border-radius:8px;cursor:pointer;color:var(--mu);font-weight:500}
.nt-tabs button:hover{background:var(--sf2);color:var(--tx)}.nt-tabs button.on{background:var(--sf2);color:var(--tx);box-shadow:inset 0 -2px 0 var(--ac)}
.nt-tabs .nt-addtab{margin-left:auto;font-size:13px}
.nt-bar{display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap}
.nt-titlebar{display:flex;align-items:center;gap:6px;min-width:0}
.nt-ticon{border:0;background:none;font-size:26px;cursor:pointer;border-radius:8px;padding:2px 6px}.nt-ticon:hover{background:var(--sf2)}
.nt-name{border:0!important;background:none!important;font:700 28px var(--head)!important;padding:2px 4px!important;width:auto;min-width:80px;field-sizing:content}
.nt-tools{display:flex;gap:4px;align-items:center;flex-wrap:wrap}
.nt-search{width:150px!important;padding:4px 10px!important;font-size:13px}
.btn.ghost.on{color:var(--ac);background:color-mix(in srgb,var(--ac) 10%,transparent);border-color:transparent;box-shadow:none}
.nt-scroll{overflow-x:auto;border-top:1px solid var(--ln);padding-bottom:4px}
.nt-table{border-collapse:collapse;table-layout:fixed;font-size:14px}
.nt-table th,.nt-table td{border-bottom:1px solid var(--ln);border-right:1px solid var(--ln);padding:0;text-align:left;vertical-align:top;position:relative}
.nt-table th:last-child,.nt-table td:last-child,.nt-table tr>:first-child{border-right:0}
.nt-table th{font-weight:500;color:var(--mu);height:36px}
.nt-th{all:unset;box-sizing:border-box;display:flex;align-items:center;gap:7px;width:100%;height:36px;padding:0 10px;cursor:pointer}
.nt-th:hover{background:var(--sf2);color:var(--tx)}.nt-th:focus-visible{outline:2px solid var(--ac);outline-offset:-2px}
.nt-ti{display:inline-grid;place-items:center;width:18px;font-size:14px;flex:none;opacity:.8}
.nt-sorted{color:var(--ac);font-weight:700}
.nt-resize{position:absolute;right:-3px;top:0;bottom:0;width:7px;cursor:col-resize;z-index:2}.nt-resize:hover{background:var(--ac);opacity:.5}
.nt-trunc{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.nt-addp{border:0;background:none;width:100%;height:36px;cursor:pointer;color:var(--mu);font-size:18px}.nt-addp:hover{background:var(--sf2);color:var(--tx)}
.nt-gut button{border:0;background:none;color:var(--mu);cursor:pointer;opacity:0;width:100%;height:36px}
.nt-table tr:hover .nt-gut button,.nt-gut button:focus-visible{opacity:1}
.nt-table tbody tr:hover{background:color-mix(in srgb,var(--ac) 4%,transparent)}.nt-table tbody tr.on{background:color-mix(in srgb,var(--ac) 8%,transparent)}
.nt-cell{display:flex;align-items:center;gap:5px;flex-wrap:wrap;min-height:36px;padding:5px 10px;width:100%;line-height:1.35;word-break:break-word}
.nt-click{cursor:pointer}.nt-fill{border:0;background:none;text-align:left;font:inherit;color:inherit}
.nt-fill:focus-visible{outline:2px solid var(--ac);outline-offset:-2px}
.nt-center{justify-content:center}
.nt-err{color:var(--bad);font-size:13px}
.nt-input{border:0!important;border-radius:0!important;padding:0!important;background:none!important;outline:none;box-shadow:none;height:100%;min-height:24px}
.nt-titlecell{flex-wrap:nowrap}.nt-ttext{border:0;background:none;font:inherit;font-weight:600;cursor:text;text-align:left;padding:0;flex:1;min-width:0;color:var(--tx)}
.nt-icon{border:0;background:none;cursor:pointer;font-size:17px;padding:0 2px;border-radius:5px;flex:none}.nt-icon:hover{background:var(--sf2)}
.nt-openbtn{border:1px solid var(--ln);background:var(--sf);border-radius:6px;font-size:12px;padding:0 8px;cursor:pointer;opacity:0;flex:none;color:var(--mu)}
.nt-table tr:hover .nt-openbtn,.nt-openbtn:focus-visible{opacity:1}
.nt-pill{display:inline-flex;align-items:center;gap:6px;padding:0 9px;border-radius:6px;font-size:13px;font-weight:500;background:color-mix(in srgb,var(--c) 28%,transparent);color:color-mix(in srgb,var(--c) 55%,var(--tx));line-height:1.6;white-space:nowrap}
.nt-pill i{width:8px;height:8px;border-radius:50%;background:var(--c)}
.nt-rel{display:inline-flex;align-items:center;gap:4px;max-width:100%;padding:0 6px;border-radius:5px;background:var(--sf2);border:1px solid var(--ln);font-size:13px;color:var(--tx);text-decoration:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
a.nt-rel:hover{border-color:var(--ac)}
.nt-avatar{display:inline-grid;place-items:center;width:16px;height:16px;border-radius:50%;background:var(--ac);color:#fff;font-size:10px;font-weight:700}
.nt-seg{display:inline-flex;align-items:center;gap:8px}.nt-seg b{font-weight:500;font-variant-numeric:tabular-nums}
.nt-segs{display:inline-flex;gap:2px}.nt-segs i{width:9px;height:12px;border-radius:2px;background:var(--ln)}.nt-segs i.on{background:var(--ok)}
.nt-fin{display:inline-flex;gap:6px;align-items:center;font-weight:500}
.nt-stars{gap:1px}.nt-stars button{border:0;background:none;cursor:pointer;font-size:17px;color:var(--ln);padding:0 1px;transition:transform .1s}
.nt-stars button.on{color:#f5b301}.nt-stars button:hover{transform:scale(1.2)}
.nt-new td{border-right:0}.nt-new button{border:0;background:none;color:var(--mu);cursor:pointer;padding:9px 12px;font:inherit}.nt-new button:hover{color:var(--tx)}
.nt-table tfoot td{border-bottom:0;border-right:0;height:34px}
.nt-calc button{border:0;background:none;cursor:pointer;width:100%;height:34px;padding:0 10px;text-align:left;font-size:13px;color:var(--mu)}
.nt-calc button:hover{background:var(--sf2)}.nt-calc button b{color:var(--tx);font-weight:500;margin-left:4px;font-variant-numeric:tabular-nums}
.nt-calc-empty{opacity:0}.nt-table tfoot tr:hover .nt-calc-empty{opacity:1}
.nt-back{position:fixed;inset:0;z-index:70}
.nt-pop{position:fixed;z-index:80;background:var(--sf);border:1px solid var(--ln);border-radius:10px;box-shadow:0 12px 40px rgba(0,0,0,.3);padding:6px;max-height:min(440px,calc(100vh - 20px));overflow:auto;animation:rise .12s}
.nt-pop>input,.nt-pop .nt-pad>input{margin-bottom:4px}
.nt-pad{padding:6px 6px 4px}
.nt-pop hr{border:0;border-top:1px solid var(--ln);margin:6px 0}
.nt-item,.nt-opt{display:flex;align-items:center;gap:8px;width:100%;border:0;background:none;padding:6px 8px;border-radius:6px;cursor:pointer;text-align:left;font:inherit;color:var(--tx)}
.nt-item:hover:not(:disabled),.nt-opt:hover{background:var(--sf2)}.nt-item:disabled{opacity:.4;cursor:not-allowed}
.nt-item.danger{color:var(--bad)}
.nt-opts{display:grid;gap:1px;max-height:260px;overflow:auto}
.nt-emoji{display:grid;grid-template-columns:repeat(8,1fr);gap:2px}.nt-emoji button{border:0;background:none;font-size:20px;cursor:pointer;border-radius:6px;padding:4px}.nt-emoji button:hover{background:var(--sf2)}
.nt-types{max-height:380px;overflow:auto}
.nt-colordot{width:20px;height:20px;border-radius:50%;border:0;cursor:pointer;flex:none}
.nt-optedit{display:grid;gap:6px}
.nt-filters{display:grid;gap:8px}.nt-frow{display:flex;gap:6px;align-items:center}.nt-frow select,.nt-frow input{flex:1;min-width:0;padding:5px 8px}
.nt-peek{position:fixed;top:0;right:0;bottom:0;width:min(480px,100%);background:var(--sf);border-left:1px solid var(--ln);box-shadow:-12px 0 40px rgba(0,0,0,.25);z-index:50;overflow:auto;padding:18px 20px 40px;animation:slide .2s}
.nt-bigtitle{margin:14px 0 8px}.nt-bigtitle .nt-ttext{font:700 26px var(--head)}.nt-bigtitle .nt-icon{font-size:26px}
.nt-prow{display:grid;grid-template-columns:150px 1fr;gap:8px;align-items:start;border-bottom:1px solid var(--ln);padding:2px 0}
.nt-plabel{display:flex;gap:6px;align-items:center;color:var(--mu);padding-top:9px;font-size:14px}.nt-pval{min-width:0}
.nt-peek h4{margin:18px 0 6px}
@media(max-width:640px){.nt-prow{grid-template-columns:1fr}.nt-plabel{padding-top:6px}}
`
