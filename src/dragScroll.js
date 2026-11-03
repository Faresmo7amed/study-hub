/* ============================================================
   Auto-scroll while dragging.
   Browsers do not let the mouse wheel scroll during a drag, so a todo or a note could only be dropped inside the
   part of the page already on screen. This scrolls the page (or the sidebar / panel under the pointer) when the
   pointer gets close to its top or bottom edge, and keeps going until you drop or let go.
   Imported once in App.jsx. It works for every drag in the app and needs no other changes.
   ============================================================ */

const ZONE = 150      // px from an edge where scrolling starts
const MAX_SPEED = 70  // px per frame at the very edge
const TOP_BAR = 64    // the sticky top bar covers the first pixels of the window

let pos = null
let raf = 0

// The nearest ancestor that can scroll vertically, or null (then the window scrolls)
const scrollerAt = (x, y) => {
    let el = document.elementFromPoint(x, y)
    while (el && el !== document.body && el !== document.documentElement) {
        const css = getComputedStyle(el)
        if (/(auto|scroll)/.test(css.overflowY) && el.scrollHeight > el.clientHeight + 2) return el
        el = el.parentElement
    }
    return null
}

// Eases in: a gentle start near the zone's border, fast at the edge
const speed = (dist) => Math.max(4, Math.round(MAX_SPEED * Math.pow(Math.min(1, (ZONE - dist) / ZONE), 1.4)))

function step() {
    raf = 0
    if (!pos) return
    const sc = scrollerAt(pos.x, pos.y)
    const top = sc ? sc.getBoundingClientRect().top : TOP_BAR
    const bottom = sc ? sc.getBoundingClientRect().bottom : window.innerHeight
    let dy = 0
    if (pos.y - top < ZONE) dy = -speed(Math.max(0, pos.y - top))
    else if (bottom - pos.y < ZONE) dy = speed(Math.max(0, bottom - pos.y))
    if (dy) {
        if (sc) sc.scrollTop += dy
        else window.scrollBy(0, dy)
    }
    raf = requestAnimationFrame(step)
}

const stop = () => {
    pos = null
    cancelAnimationFrame(raf)
    raf = 0
}

if (typeof document !== 'undefined' && !window.__dragScroll) {
    window.__dragScroll = true
    document.addEventListener('dragover', e => {
        pos = { x: e.clientX, y: e.clientY }
        if (!raf) raf = requestAnimationFrame(step)
    }, true)
    // If the browser delivers wheel events during a drag, honour them (many browsers do not)
    document.addEventListener('wheel', e => {
        if (!pos) return
        const sc = scrollerAt(e.clientX, e.clientY)
        if (sc) sc.scrollTop += e.deltaY
        else window.scrollBy(0, e.deltaY)
        e.preventDefault()
    }, { capture: true, passive: false })
    // Mouse wheel during a drag. Some browsers (Firefox) deliver it; Chrome and Edge usually do not while a native drag runs.
    document.addEventListener('wheel', e => {
        if (!pos) return
        const sc = scrollerAt(e.clientX, e.clientY)
        if (sc) sc.scrollTop += e.deltaY
        else window.scrollBy(0, e.deltaY)
    }, { capture: true, passive: true })
    document.addEventListener('dragend', stop, true)
    document.addEventListener('drop', stop, true)
    window.addEventListener('blur', stop)
}
