/* ============================================================
   Auto-scroll while dragging.
   Browsers do not let the mouse wheel scroll during a drag, so a todo or a note could only be dropped inside the
   part of the page already on screen. This scrolls the page (or the sidebar / panel under the pointer) when the
   pointer gets close to its top or bottom edge, and keeps going until you drop or let go.
   Imported once in App.jsx. It works for every drag in the app and needs no other changes.
   ============================================================ */

const ZONE = 90       // px from an edge where scrolling starts
const MAX_SPEED = 26  // px per frame at the very edge
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

const speed = (dist) => Math.round(MAX_SPEED * Math.min(1, (ZONE - dist) / ZONE))

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
    document.addEventListener('dragend', stop, true)
    document.addEventListener('drop', stop, true)
    window.addEventListener('blur', stop)
}
