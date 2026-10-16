import { getStore } from './shared'

/* ============================================================
   Sounds, made in the browser with the Web Audio API.
   No audio files, so it works offline and costs nothing to host.
   Change a melody by editing its entry in SOUNDS below.
   Settings live in the local-only store key "sound" (they are not synced between devices).
   ============================================================ */

export const SOUND_DEFAULTS = { on: true, volume: 0.7, cats: { items: true, edits: true, rewards: true, reminders: true, focus: true } }

export const SOUND_CATS = {
    items: 'Checking items',
    edits: 'Adding, deleting and undoing',
    rewards: 'Achievements and streaks',
    reminders: 'Event reminders',
    focus: 'Focus timer',
}

export const SOUND_INFO = {
    check: { label: 'Check an item', cat: 'items' },
    uncheck: { label: 'Uncheck an item', cat: 'items' },
    add: { label: 'Add something', cat: 'edits' },
    save: { label: 'Save or create', cat: 'edits' },
    delete: { label: 'Delete', cat: 'edits' },
    undo: { label: 'Undo or restore', cat: 'edits' },
    move: { label: 'Move or reorder', cat: 'edits' },
    tick: { label: 'Small change', cat: 'edits' },
    pin: { label: 'Pin a note', cat: 'edits' },
    archive: { label: 'Archive', cat: 'edits' },
    complete: { label: 'Finish something big', cat: 'rewards' },
    goal: { label: 'Daily goal reached', cat: 'rewards' },
    streak: { label: 'Streak day', cat: 'rewards' },
    gate: { label: 'Gate passed', cat: 'rewards' },
    badge: { label: 'Badge unlocked', cat: 'rewards' },
    levelup: { label: 'Level up', cat: 'rewards' },
    reminder: { label: 'Event coming up', cat: 'reminders' },
    alarm: { label: 'Event starting', cat: 'reminders' },
    focus: { label: 'Focus session done', cat: 'focus' },
    breakover: { label: 'Break is over', cat: 'focus' },
}

let ctx = null
let master = null

function ensure() {
    if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext
        if (!AC) return null
        ctx = new AC()
        master = ctx.createGain()
        master.connect(ctx.destination)
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {})
    return ctx
}

// Browsers only allow audio after the first click or key press, so prepare it then.
// This is what lets an event reminder make a sound even if you have not clicked in a while.
if (typeof window !== 'undefined') {
    const unlock = () => { ensure() }
    window.addEventListener('pointerdown', unlock, { once: true })
    window.addEventListener('keydown', unlock, { once: true })
}

// One note: pitch (Hz), when it starts (s from now), how long it lasts (s)
function tone(freq, at, len, opts = {}) {
    const { type = 'sine', gain = 0.22, slideTo = null, attack = 0.008 } = opts
    const t0 = ctx.currentTime + at
    const osc = ctx.createOscillator()
    const amp = ctx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(freq, t0)
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + len)
    amp.gain.setValueAtTime(0.0001, t0)
    amp.gain.exponentialRampToValueAtTime(gain, t0 + attack)
    amp.gain.exponentialRampToValueAtTime(0.0001, t0 + len)
    osc.connect(amp)
    amp.connect(master)
    osc.start(t0)
    osc.stop(t0 + len + 0.05)
}

// A struck bell: a few partials that fade at different speeds
function bell(freq, at, len = 1.2, gain = 0.2) {
    const partials = [[1, 1], [2.01, 0.45], [3.02, 0.25], [4.2, 0.12]]
    partials.forEach(([ratio, level]) => tone(freq * ratio, at, len / (1 + ratio * 0.35), { gain: gain * level, attack: 0.004 }))
}

const N = { C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880, C6: 1046.5, E6: 1318.5, G6: 1568, C7: 2093 }

const SOUNDS = {
    check() {
        tone(880, 0, 0.1, { type: 'triangle', gain: 0.2 })
        tone(1318.5, 0.07, 0.18, { type: 'triangle', gain: 0.2 })
    },
    uncheck() {
        tone(520, 0, 0.12, { gain: 0.14, slideTo: 360 })
    },
    add() {
        tone(640, 0, 0.09, { gain: 0.12, slideTo: 960 })
    },
    save() {
        tone(784, 0, 0.1, { type: 'triangle', gain: 0.18 })
        tone(1174.7, 0.08, 0.22, { type: 'triangle', gain: 0.18 })
    },
    delete() {
        tone(300, 0, 0.16, { type: 'triangle', gain: 0.18, slideTo: 150 })
        tone(110, 0.02, 0.14, { gain: 0.22, slideTo: 55 })
    },
    undo() {
        tone(420, 0, 0.1, { gain: 0.16, slideTo: 640 })
        tone(640, 0.09, 0.14, { gain: 0.16, slideTo: 900 })
    },
    move() {
        tone(480, 0, 0.05, { type: 'triangle', gain: 0.1 })
    },
    tick() {
        tone(1500, 0, 0.035, { gain: 0.08 })
    },
    pin() {
        tone(1000, 0, 0.04, { type: 'square', gain: 0.04 })
        tone(1500, 0.03, 0.08, { gain: 0.12 })
    },
    archive() {
        tone(260, 0, 0.18, { type: 'triangle', gain: 0.16, slideTo: 190 })
        tone(130, 0.05, 0.15, { gain: 0.18, slideTo: 90 })
    },
    complete() {
        const run = [N.C5, N.E5, N.G5, N.C6]
        run.forEach((f, i) => tone(f, i * 0.085, 0.2, { type: 'triangle', gain: 0.2 }))
        bell(N.C6, 0.3, 1.1, 0.16)
    },
    goal() {
        bell(N.C6, 0, 1.4, 0.2)
        bell(N.E6, 0.12, 1.4, 0.18)
        bell(N.G6, 0.24, 1.6, 0.18)
    },
    streak() {
        const run = [N.G5, N.C6, N.E6]
        run.forEach((f, i) => tone(f, i * 0.09, 0.12, { type: 'triangle', gain: 0.22 }))
        tone(N.G6, 0.28, 0.5, { type: 'triangle', gain: 0.24 })
        bell(N.C7, 0.3, 1.2, 0.1)
    },
    gate() {
        tone(392, 0, 0.12, { type: 'triangle', gain: 0.2 })
        tone(N.C5, 0.1, 0.12, { type: 'triangle', gain: 0.2 })
        tone(N.G5, 0.2, 0.3, { type: 'triangle', gain: 0.22 })
        bell(N.G6, 0.25, 1.2, 0.14)
    },
    badge() {
        bell(N.G6, 0, 1.4, 0.2)
        bell(N.C7, 0.14, 1.4, 0.15)
    },
    levelup() {
        const scale = [N.C5, N.D5, N.E5, N.G5, N.A5, N.C6]
        scale.forEach((f, i) => tone(f, i * 0.07, 0.14, { type: 'triangle', gain: 0.2 }))
        tone(N.C6, 0.5, 0.9, { type: 'triangle', gain: 0.16 })
        tone(N.E6, 0.5, 0.9, { type: 'triangle', gain: 0.16 })
        tone(N.G6, 0.5, 0.9, { type: 'triangle', gain: 0.14 })
        bell(N.C7, 0.55, 1.4, 0.12)
    },
    reminder() {
        tone(N.E5, 0, 0.28, { gain: 0.2 })
        tone(N.A5, 0.2, 0.42, { gain: 0.2 })
    },
    alarm() {
        for (let i = 0; i < 3; i++) {
            tone(880, i * 0.38, 0.16, { type: 'triangle', gain: 0.3 })
            tone(1174.7, i * 0.38 + 0.17, 0.16, { type: 'triangle', gain: 0.3 })
        }
    },
    focus() {
        bell(784, 0, 1.8, 0.26)
        bell(784, 0.9, 1.8, 0.26)
        bell(N.C6, 1.8, 2.2, 0.26)
    },
    breakover() {
        tone(N.A5, 0, 0.2, { gain: 0.2 })
        tone(N.E6, 0.18, 0.34, { gain: 0.2 })
    },
}

// Reward sounds are the long ones. If two arrive together (a streak day and a badge, for example) they play one after the other.
const REWARD_SECONDS = { complete: 1.4, goal: 1.9, streak: 1.5, gate: 1.4, badge: 1.6, levelup: 1.9 }
let rewardFreeAt = 0

/*
  play('check')                  respects the master switch and the category switch
  play('streak', { force: true })  ignores the category switch (used by the preview buttons)
*/
export function play(name, { force = false } = {}) {
    try {
        const settings = getStore('sound', SOUND_DEFAULTS)
        const info = SOUND_INFO[name]
        if (!info || !SOUNDS[name] || !settings.on) return
        const cats = { ...SOUND_DEFAULTS.cats, ...(settings.cats || {}) }
        if (!force && cats[info.cat] === false) return
        const c = ensure()
        if (!c) return
        const volume = Math.min(1, Math.max(0, settings.volume == null ? 0.7 : settings.volume))
        let wait = 0
        if (!force && info.cat === 'rewards') {
            const now = performance.now()
            wait = Math.max(0, rewardFreeAt - now)
            rewardFreeAt = now + wait + (REWARD_SECONDS[name] || 1.5) * 1000
        }
        const start = () => {
            master.gain.setValueAtTime(volume * volume, ctx.currentTime)
            SOUNDS[name]()
            window.dispatchEvent(new CustomEvent('studyhub-sound', { detail: name }))
        }
        if (wait > 0) setTimeout(() => { try { ensure(); start() } catch {} }, wait)
        else start()
    } catch {}
}
