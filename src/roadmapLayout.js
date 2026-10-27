/* ============================================================
   Roadmap layout: threads, lanes, side topics and connections (pure code, no React)

   Vocabulary
   - thread:  a big parallel path with its own title ("Frontend", "Programming fundamentals")
   - lane:    one vertical column of topics. A thread has one root lane (from = null).
              A side lane (from = a topic id) branches to the right of that topic, like Node.js beside TypeScript.
   - conn:    a free connection between any two topics (also across threads): { id, from, to }

   Stored on each roadmap (all optional in old data, ensureStructure() fills them in):
       threads: [{ id, title }]
       lanes:   [{ id, thread, from }]
       conns:   [{ id, from, to }]
   and on every top-level topic:  lane: laneId   (subtopics have no lane)

   Picture of the layout (subtopics on the left of a topic, side lanes on the right):

                 [ Thread header ]
                        |
       [sub][sub]  [ Topic 1 ] ---- [ Side topic ] ---- [ Side of side ]
                        |
       [sub]       [ Topic 2 ]
                        |
                    [ Topic 3 ]

   Every box has a fixed size, so positions are computed (not measured from the page).
   That is what makes smooth zoom and pan possible.
   ============================================================ */

export const SZ = {
    TW: 230, TH: 132, // topic box
    SW: 180, SH: 50, // subtopic box
    GATE: 54, // extra height under a topic that has a gate
    GAPY: 30, // vertical gap between two topics of a lane
    SUBGAP: 10, SUBCOLGAP: 14, SUBOFF: 46, // subtopic rows, columns, distance to the topic
    COLMAX: 5, // subtopics per column before a new column starts
    SIDEGAP: 64, // horizontal gap between a lane and its side lanes
    THREADGAP: 150, // horizontal gap between two threads
    HEADW: 260, HEADH: 52, HEADGAP: 26, // thread header card
    PAD: 20,
}

const rid = () => Math.random().toString(36).slice(2, 9)
export const newId = rid

/* ---------- structure: make any roadmap valid ---------- */

// Fast check, used to decide whether a roadmap must be repaired before drawing
export function structureOk(m) {
    if (!m || !Array.isArray(m.topics)) return false
    if (!Array.isArray(m.threads) || !m.threads.length || !Array.isArray(m.lanes) || !Array.isArray(m.conns)) return false
    const th = new Set(m.threads.map(t => t.id))
    const lanes = new Map(m.lanes.map(l => [l.id, l]))
    const ids = new Set(m.topics.map(t => t.id))
    if (!m.threads.every(t => m.lanes.some(l => l.thread === t.id && !l.from))) return false
    if (!m.lanes.every(l => th.has(l.thread) && (!l.from || ids.has(l.from)))) return false
    if (!m.topics.every(t => lanes.has(t.lane))) return false
    return m.conns.every(c => ids.has(c.from) && ids.has(c.to))
}

// Repairs a roadmap IN PLACE and returns it: old roadmaps get one thread, one lane and no connections.
// Bad references (a lane growing out of a missing topic, a connection to a deleted topic, loops) are removed.
export function ensureStructure(m) {
    const topics = Array.isArray(m.topics) ? m.topics : (m.topics = [])
    const topicIds = new Set(topics.map(t => t.id))

    const seenT = new Set()
    const threads = []
    ;(Array.isArray(m.threads) ? m.threads : []).forEach(t => {
        if (!t || typeof t.id !== 'string' || !t.id || seenT.has(t.id)) return
        seenT.add(t.id)
        threads.push({ id: t.id, title: String(t.title == null ? '' : t.title).slice(0, 60) })
    })
    if (!threads.length) {
        threads.push({ id: rid(), title: 'Main path' })
        seenT.add(threads[0].id)
    }
    m.threads = threads

    const seenL = new Set()
    const lanes = []
    ;(Array.isArray(m.lanes) ? m.lanes : []).forEach(l => {
        if (!l || typeof l.id !== 'string' || !l.id || seenL.has(l.id)) return
        seenL.add(l.id)
        lanes.push({ id: l.id, thread: seenT.has(l.thread) ? l.thread : threads[0].id, from: topicIds.has(l.from) ? l.from : null })
    })
    threads.forEach(th => {
        if (!lanes.some(l => l.thread === th.id && !l.from)) {
            const l = { id: rid(), thread: th.id, from: null }
            lanes.push(l)
            seenL.add(l.id)
        }
    })
    m.lanes = lanes

    const defaultLane = lanes.find(l => l.thread === threads[0].id && !l.from).id
    topics.forEach(t => { if (!seenL.has(t.lane)) t.lane = defaultLane })

    // a lane cannot branch out of a topic that lives inside itself or inside its own side lanes
    const byId = new Map(lanes.map(l => [l.id, l]))
    const topicLane = new Map(topics.map(t => [t.id, t.lane]))
    lanes.forEach(l => {
        const seen = new Set([l.id])
        let cur = l
        while (cur.from) {
            const p = byId.get(topicLane.get(cur.from))
            if (!p) break
            if (seen.has(p.id)) {
                l.from = null
                break
            }
            seen.add(p.id)
            cur = p
        }
    })
    // a side lane always belongs to the thread of the topic it grows out of
    for (let pass = 0; pass <= lanes.length; pass++) {
        let changed = false
        lanes.forEach(l => {
            const p = l.from && byId.get(topicLane.get(l.from))
            if (p && p.thread !== l.thread) {
                l.thread = p.thread
                changed = true
            }
        })
        if (!changed) break
    }

    const seenC = new Set()
    const conns = []
    ;(Array.isArray(m.conns) ? m.conns : []).forEach(c => {
        if (!c || !topicIds.has(c.from) || !topicIds.has(c.to) || c.from === c.to) return
        const k = c.from + '>' + c.to
        if (seenC.has(k)) return
        seenC.add(k)
        conns.push({ id: typeof c.id === 'string' && c.id ? c.id : rid(), from: c.from, to: c.to })
    })
    m.conns = conns
    return m
}

/* ---------- reading order ---------- */

// Topics in the order a person would read them: thread by thread, each lane top to bottom,
// the side lanes of a topic right after it. Returns [{ t, thread, depth }].
export function readingOrder(m) {
    const byLane = new Map()
    m.lanes.forEach(l => byLane.set(l.id, []))
    m.topics.forEach(t => (byLane.get(t.lane) || byLane.get(m.lanes[0].id)).push(t))
    const kids = new Map()
    m.lanes.forEach(l => { if (l.from) kids.set(l.from, [...(kids.get(l.from) || []), l]) })
    const out = []
    const seen = new Set()
    const walk = (lane, depth) => {
        if (seen.has(lane.id)) return
        seen.add(lane.id)
        ;(byLane.get(lane.id) || []).forEach(t => {
            out.push({ t, thread: lane.thread, depth })
            ;(kids.get(t.id) || []).forEach(k => walk(k, depth + 1))
        })
    }
    m.threads.forEach(th => m.lanes.filter(l => l.thread === th.id && !l.from).forEach(l => walk(l, 0)))
    m.lanes.forEach(l => walk(l, 1)) // anything unreachable still shows up
    return out
}

/* ---------- layout ---------- */

// What it does: gives every topic, subtopic, gate and thread header a position, and lists the lines to draw.
// Options: showSubs (false = overview of topics only), editable (reserves a slot for the "+ Subtopic" button).
export function layoutMap(m, { showSubs = true, editable = false } = {}) {
    const { TW, TH, SW, SH, GATE, GAPY, SUBGAP, SUBCOLGAP, SUBOFF, COLMAX, SIDEGAP, THREADGAP, HEADW, HEADH, HEADGAP, PAD } = SZ

    const byLane = new Map()
    m.lanes.forEach(l => byLane.set(l.id, []))
    m.topics.forEach(t => (byLane.get(t.lane) || byLane.get(m.lanes[0].id)).push(t))
    const kids = new Map()
    m.lanes.forEach(l => { if (l.from) kids.set(l.from, [...(kids.get(l.from) || []), l]) })
    const visited = new Set()

    // Lays out one lane and everything that grows out of it. Coordinates are relative to the lane's own top-left corner.
    function lane(l) {
        visited.add(l.id)
        const tops = byLane.get(l.id) || []
        const rows = []
        let y = 0
        let leftW = 0
        tops.forEach(t => {
            const subs = t.subs || []
            const slots = showSubs ? subs.length + (editable ? 1 : 0) : 0
            const cols = Math.ceil(slots / COLMAX)
            const rowsN = Math.min(COLMAX, slots)
            const sw = cols ? cols * SW + (cols - 1) * SUBCOLGAP : 0
            const sh = rowsN ? rowsN * SH + (rowsN - 1) * SUBGAP : 0
            const cellH = TH + (t.gate ? GATE : 0)
            const rowH = Math.max(cellH, sh)
            rows.push({ t, y, cellH, rowH })
            if (sw) leftW = Math.max(leftW, sw + SUBOFF)
            y += rowH + GAPY
        })
        const spineX = leftW
        const parts = []
        const edges = []
        const placed = []
        let w = tops.length ? spineX + TW : 0
        let h = tops.length ? y - GAPY : 0

        rows.forEach((row, i) => {
            const t = row.t
            parts.push({ k: 'node', id: t.id, n: i + 1, x: spineX, y: row.y, w: TW, h: TH })
            if (t.gate) parts.push({ k: 'gate', id: t.id, x: spineX, y: row.y + TH, w: TW, h: GATE })
            if (i > 0) edges.push({ k: 'main', a: rows[i - 1].t.id, b: t.id })

            if (showSubs) {
                const subs = t.subs || []
                const at = j => ({ col: Math.floor(j / COLMAX), r: j % COLMAX })
                const pos = j => {
                    const { col, r } = at(j)
                    return { x: spineX - SUBOFF - SW - col * (SW + SUBCOLGAP), y: row.y + r * (SH + SUBGAP) }
                }
                subs.forEach((s, j) => {
                    const p = pos(j)
                    parts.push({ k: 'sub', id: s.id, parent: t.id, x: p.x, y: p.y, w: SW, h: SH })
                    const { col, r } = at(j)
                    edges.push(col === 0 ? { k: 'sub', a: t.id, b: s.id } : { k: 'subcol', a: subs[(col - 1) * COLMAX + r].id, b: s.id })
                })
                if (editable) {
                    const p = pos(subs.length)
                    parts.push({ k: 'add', id: t.id, x: p.x, y: p.y, w: SW, h: SH })
                }
            }

            // side lanes that grow out of this topic
            ;(kids.get(t.id) || []).forEach(k => {
                if (visited.has(k.id)) return
                const sub = lane(k)
                if (!sub.first) return
                let cx = spineX + TW + SIDEGAP
                let cy = row.y
                for (;;) {
                    let moved = false
                    for (const p of placed) {
                        const hitY = cy < p.y + p.h + GAPY && cy + sub.h + GAPY > p.y
                        const hitX = cx < p.x + p.w + SIDEGAP / 2 && cx + sub.w + SIDEGAP / 2 > p.x
                        if (hitY && hitX) {
                            if (p.from === t.id) cy = p.y + p.h + GAPY // a second branch of the same topic goes below the first
                            else cx = p.x + p.w + SIDEGAP // a long branch of an earlier topic: move right, never overlap
                            moved = true
                        }
                    }
                    if (!moved) break
                }
                placed.push({ x: cx, y: cy, w: sub.w, h: sub.h, from: t.id })
                sub.parts.forEach(p => parts.push({ ...p, x: p.x + cx, y: p.y + cy }))
                sub.edges.forEach(e => edges.push(e))
                edges.push({ k: 'side', a: t.id, b: sub.first })
                w = Math.max(w, cx + sub.w)
                h = Math.max(h, cy + sub.h)
            })
        })
        return { w, h, parts, edges, spineX, first: tops.length ? tops[0].id : null }
    }

    const nodes = new Map()
    const subs = new Map()
    const gates = new Map()
    const adds = new Map()
    const edges = []
    const threads = []
    let tx = 0
    let height = 0

    m.threads.forEach(th => {
        const roots = m.lanes.filter(l => l.thread === th.id && !l.from)
        let cx = PAD
        let firstSpine = null
        let firstTopic = null
        let tw = 0
        let th2 = 0
        roots.forEach(r => {
            if (visited.has(r.id)) return
            const res = lane(r)
            if (firstSpine === null) {
                firstSpine = cx + res.spineX
                firstTopic = res.first
            }
            res.parts.forEach(p => {
                const rect = { ...p, x: p.x + tx + cx, y: p.y + HEADH + HEADGAP }
                if (p.k === 'node') nodes.set(p.id, rect)
                else if (p.k === 'sub') subs.set(p.id, rect)
                else if (p.k === 'gate') gates.set(p.id, rect)
                else adds.set(p.id, rect)
            })
            res.edges.forEach(e => edges.push(e))
            cx += Math.max(res.w, TW) + SIDEGAP * 2
            tw = cx - SIDEGAP * 2
            th2 = Math.max(th2, res.h)
        })
        if (firstSpine === null) {
            firstSpine = PAD
            tw = PAD + TW
        }
        const head = { id: th.id, x: tx + firstSpine + TW / 2 - HEADW / 2, y: 0, w: HEADW, h: HEADH }
        if (firstTopic) edges.push({ k: 'head', a: th.id, b: firstTopic })
        threads.push({ id: th.id, title: th.title, head, x: tx, w: tw + PAD, first: firstTopic })
        height = Math.max(height, HEADH + HEADGAP + th2)
        tx += Math.max(tw + PAD, head.x + HEADW - tx) + THREADGAP
    })

    // keep everything at positive coordinates (a header can stick out to the left of a narrow thread)
    let minX = 0
    threads.forEach(t => { minX = Math.min(minX, t.head.x) })
    let width = Math.max(0, tx - THREADGAP)
    if (minX < 0) {
        const dx = PAD - minX
        ;[nodes, subs, gates, adds].forEach(map => map.forEach(r => { r.x += dx }))
        threads.forEach(t => { t.head.x += dx; t.x += dx })
        width += dx
    }
    return { nodes, subs, gates, adds, edges, threads, width: Math.max(width, TW + PAD * 2), height: height + PAD }
}

/* ---------- lines ---------- */

// Path of an automatic line (main path, side branch, subtopic, thread header). Returns null when an end is missing.
export function edgePath(e, L) {
    const { TW, TH, SH, GATE, SUBOFF, SW } = SZ
    if (e.k === 'head') {
        const th = L.threads.find(t => t.id === e.a)
        const b = L.nodes.get(e.b)
        if (!th || !b) return null
        const x = b.x + TW / 2
        return `M${x} ${th.head.y + th.head.h}V${b.y}`
    }
    const a = e.k === 'subcol' ? L.subs.get(e.a) : L.nodes.get(e.a)
    const b = e.k === 'main' || e.k === 'side' ? L.nodes.get(e.b) : L.subs.get(e.b)
    if (!a || !b) return null
    if (e.k === 'main') {
        const x = a.x + TW / 2
        return `M${x} ${a.y + TH + (L.gates.has(e.a) ? GATE : 0)}V${b.y}`
    }
    if (e.k === 'side') {
        const x1 = a.x + TW
        const y1 = a.y + TH / 2
        const mx = x1 + (b.x - x1 > 0 ? Math.min(SZ.SIDEGAP / 2, (b.x - x1) / 2) : 0)
        return `M${x1} ${y1}H${mx}V${b.y + TH / 2}H${b.x}`
    }
    if (e.k === 'sub') {
        const x1 = a.x
        const y1 = a.y + TH / 2
        const mx = x1 - SUBOFF / 2
        return `M${x1} ${y1}H${mx}V${b.y + SH / 2}H${b.x + SW}`
    }
    // subcol: sub in the next column, drawn as a short horizontal line from its neighbour
    const y = b.y + SH / 2
    return `M${a.x} ${y}H${b.x + SW}`
}

// Path of a free connection between two topic boxes, with the end point (for the arrow) and the middle point (for the remove button)
export function connPath(a, b) {
    const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 }
    const bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 }
    let p0
    let p1
    let c0
    let c1
    if (b.x >= a.x + a.w + 20) {
        p0 = { x: a.x + a.w, y: ac.y }
        p1 = { x: b.x, y: bc.y }
        const dx = Math.max(40, (p1.x - p0.x) / 2)
        c0 = { x: p0.x + dx, y: p0.y }
        c1 = { x: p1.x - dx, y: p1.y }
    } else if (b.x + b.w <= a.x - 20) {
        p0 = { x: a.x, y: ac.y }
        p1 = { x: b.x + b.w, y: bc.y }
        const dx = Math.max(40, (p0.x - p1.x) / 2)
        c0 = { x: p0.x - dx, y: p0.y }
        c1 = { x: p1.x + dx, y: p1.y }
    } else {
        // same column: loop out to the right so it never hides behind the main path
        p0 = { x: a.x + a.w, y: ac.y }
        p1 = { x: b.x + b.w, y: bc.y }
        c0 = { x: p0.x + 90, y: p0.y }
        c1 = { x: p1.x + 90, y: p1.y }
    }
    return {
        d: `M${p0.x} ${p0.y}C${c0.x} ${c0.y},${c1.x} ${c1.y},${p1.x} ${p1.y}`,
        mid: { x: 0.125 * p0.x + 0.375 * c0.x + 0.375 * c1.x + 0.125 * p1.x, y: 0.125 * p0.y + 0.375 * c0.y + 0.375 * c1.y + 0.125 * p1.y },
    }
}

/* ---------- view maths ---------- */

export const MIN_K = 0.15
export const MAX_K = 2.5
export const clampK = k => Math.min(MAX_K, Math.max(MIN_K, k))

// View to show everything inside a box of vw x vh pixels
export function fitView(L, vw, vh, pad = 40) {
    const k = clampK(Math.min((vw - pad * 2) / L.width, (vh - pad * 2) / L.height, 1))
    return { k, x: (vw - L.width * k) / 2, y: Math.max(pad / 2, (vh - L.height * k) / 2) }
}

// First view of a roadmap: readable size (at least 50 %), centred, starting at the top
export function startView(L, vw, pad = 40) {
    const k = clampK(Math.max(0.5, Math.min(1, (vw - pad * 2) / L.width)))
    return { k, x: Math.max(pad / 2, (vw - L.width * k) / 2), y: pad / 2 }
}
