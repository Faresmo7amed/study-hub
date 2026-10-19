import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'

/* ============================================================
   Persistent store
   - Every key lives in memory and in localStorage
   - useStore(key, initial) re-renders every component that reads the same key,
     so the Dashboard, Notes and Roadmap pages always agree with each other
   ============================================================ */
const PREFIX = 'studyhub.v1.'
const cache = new Map()
const listeners = new Map()

const resolveInitial = initial => (typeof initial === 'function' ? initial() : initial)

function read(key, initial) {
    if (!cache.has(key)) {
        let value = resolveInitial(initial)
        try {
            const raw = localStorage.getItem(PREFIX + key)
            if (raw !== null) value = JSON.parse(raw)
        } catch {return null}
        cache.set(key, value)
    }
    return cache.get(key)
}

function emit(key) {
    const subs = listeners.get(key)
    if (subs) subs.forEach(fn => fn())
}

function subscribe(key, fn) {
    if (!listeners.has(key)) listeners.set(key, new Set())
    listeners.get(key).add(fn)
    return () => listeners.get(key).delete(fn)
}

export const getStore = (key, initial) => read(key, initial)

/*
  Keys that belong to the user and are synced to the cloud.
  Everything else (theme, backup reminder, fired reminders, the sync bookkeeping itself) stays on the device.
*/
// 'roadmap' is the old single-roadmap key. It is still synced so that other devices can migrate it to 'roadmaps'.
export const SYNC_KEYS = ['todos', 'activity', 'focus', 'events', 'game', 'settings', 'database', 'notes', 'labels', 'roadmap', 'roadmaps', 'studygroup']

// Default of the synced "studygroup" key. It lives here so every file that reads the key agrees on its shape.
export const STUDY_DEFAULT = { name: '', groups: [], active: '', days: {}, total: 0, profile: {}, celebrated: {}, shared: [] }

const changeHooks = new Set()
export const onStoreChange = fn => {
    changeHooks.add(fn)
    return () => changeHooks.delete(fn)
}

export function setStore(key, next, initial, silent = false) {
    const value = typeof next === 'function' ? next(read(key, initial)) : next
    cache.set(key, value)
    try { localStorage.setItem(PREFIX + key, JSON.stringify(value)) } catch {return null}
    emit(key)
    if (!silent) changeHooks.forEach(fn => fn(key))
}

// Used by the sync layer: write a value that came from the cloud without marking it as a local change
export const applyRemote = (key, value) => setStore(key, value, undefined, true)

export function removeKey(key) {
    try { localStorage.removeItem(PREFIX + key) } catch {return null}
    cache.delete(key)
    emit(key)
}

// Keys that have really been saved on this device (the built-in example data is not saved until you change it)
export function storedKeys() {
    try {
        return SYNC_KEYS.filter(k => localStorage.getItem(PREFIX + k) !== null)
    } catch {
        return []
    }
}
export const hasLocalData = () => storedKeys().length > 0

// Has this key ever been saved on this device? (example data is not saved until you change something)
export function isStored(key) {
    try {
        return localStorage.getItem(PREFIX + key) !== null
    } catch {
        return false
    }
}

export function clearLocalData() {
    try {
        const doomed = []
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i)
            if (k && k.startsWith(PREFIX) && k !== PREFIX + 'theme') doomed.push(k)
        }
        doomed.forEach(k => localStorage.removeItem(k))
    } catch {return null}
    cache.clear()
}

if (typeof window !== 'undefined') {
    // Keep several open tabs in sync
    window.addEventListener('storage', e => {
        if (!e.key || !e.key.startsWith(PREFIX)) return
        const key = e.key.slice(PREFIX.length)
        cache.delete(key)
        emit(key)
    })
}

/* Backup: every key of the app in one object, and the way back */
export function exportAll() {
    const data = {}
    try {
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i)
            if (key && key.startsWith(PREFIX)) data[key.slice(PREFIX.length)] = JSON.parse(localStorage.getItem(key))
        }
    } catch {return null}
    cache.forEach((value, key) => { if (!(key in data)) data[key] = value })
    delete data.sync // account bookkeeping, never part of a backup
    return { app: 'studyhub', version: 1, exportedAt: new Date().toISOString(), data }
}

export function downloadBackup() {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([JSON.stringify(exportAll(), null, 2)], { type: 'application/json' }))
    a.download = `studyhub-backup-${todayISO()}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    setStore('meta', cur => ({ ...cur, lastBackup: Date.now() }), {})
}

export function checkBackup(obj) {
    if (!obj || obj.app !== 'studyhub' || typeof obj.data !== 'object' || obj.data === null) {
        throw new Error('This file is not a Study Hub backup.')
    }
    return obj
}

export function importAll(obj) {
    checkBackup(obj)
    Object.entries(obj.data).forEach(([key, value]) => { if (key !== 'sync') setStore(key, value) })
}

/*
  const [value, set, update] = useStore('todos', {})
  set(next)           replace the value
  update(draft => {}) mutate a clone of the value (the store keeps it immutable)
*/
export function useStore(key, initial) {
    const sub = useCallback(cb => subscribe(key, cb), [key])
    const value = useSyncExternalStore(sub, () => read(key, initial))
    const set = useCallback(next => setStore(key, next, initial), [key]) // eslint-disable-line react-hooks/exhaustive-deps
    const update = useCallback(fn => setStore(key, cur => {
        const draft = structuredClone(cur)
        const out = fn(draft)
        return out === undefined ? draft : out
    }, initial), [key]) // eslint-disable-line react-hooks/exhaustive-deps
    return [value, set, update]
}

/* ============================================================
   Small helpers
   ============================================================ */
export const uid = () => Math.random().toString(36).slice(2, 9)
export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n))
export const pad = n => String(n).padStart(2, '0')

// Links typed by the user: only web links are ever shown or opened, so a link can never run code
export const isHttp = v => /^https?:\/\//i.test(v)
export const normalizeUrl = v => {
    const s = String(v || '').trim()
    return !s ? '' : isHttp(s) ? s : 'https://' + s.replace(/^[a-z]+:\/\//i, '')
}

export function useNow(ms = 1000) {
    const [now, setNow] = useState(() => new Date())
    useEffect(() => {
        const id = setInterval(() => setNow(new Date()), ms)
        return () => clearInterval(id)
    }, [ms])
    return now
}

/* ============================================================
   Dates (weeks run Saturday -> Friday)
   ============================================================ */
export const DAYS = ['Saturday', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const todayISO = () => iso(new Date())
export const parseISO = s => {
    const [y, m, d] = s.split('-').map(Number)
    return new Date(y, m - 1, d)
}
export const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate())
export const addDays = (d, n) => {
    const x = new Date(d)
    x.setDate(x.getDate() + n)
    return x
}

// getDay(): Sun 0 ... Fri 5, Sat 6  ->  Sat 0, Sun 1 ... Fri 6
export const dayIndex = d => (d.getDay() + 1) % 7
export const weekStart = (d = new Date()) => addDays(startOfDay(d), -dayIndex(d))

export const hms = ms => {
    const s = Math.max(0, Math.floor(ms / 1000))
    return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`
}

export const until = ms => {
    if (ms <= 0) return 'now'
    const m = Math.round(ms / 60000)
    if (m < 1) return 'in under a minute'
    if (m < 60) return `in ${m} min`
    const h = Math.floor(m / 60)
    if (h < 24) return `in ${h}h ${m % 60 ? pad(m % 60) + 'm' : ''}`.trim()
    const d = Math.floor(h / 24)
    return `in ${d} day${d > 1 ? 's' : ''}`
}

/* ============================================================
   Todo types, XP, levels, badges, streaks
   ============================================================ */
export const TYPES = {
    course: { label: 'Course', icon: '🎓', xp: 20, color: '#7c6cff' },
    video: { label: 'Video', icon: '🎬', xp: 10, color: '#ff5d5d' },
    book: { label: 'Book', icon: '📚', xp: 20, color: '#f5a524' },
    article: { label: 'Article', icon: '📰', xp: 10, color: '#3ab0ff' },
    task: { label: 'Task', icon: '✅', xp: 10, color: '#44c08a' },
    project: { label: 'Project', icon: '🛠️', xp: 30, color: '#e255a1' },
    practice: { label: 'Practice', icon: '💪', xp: 15, color: '#17b8a6' },
}
export const TYPE_KEYS = Object.keys(TYPES)

export const emptyWeek = () => Array.from({ length: 7 }, () => [])

const threshold = level => 40 * (level - 1) * level
const TITLES = ['Newcomer', 'Learner', 'Explorer', 'Builder', 'Craftsperson', 'Architect', 'Mentor', 'Master']

export function levelInfo(xp) {
    let level = 1
    while (xp >= threshold(level + 1)) level += 1
    const base = threshold(level)
    const next = threshold(level + 1)
    return {
        level,
        title: TITLES[Math.min(level - 1, TITLES.length - 1)],
        into: xp - base,
        span: next - base,
        pct: Math.round((100 * (xp - base)) / (next - base)),
    }
}

export function computeStats(todos, activity, focus) {
    let done = 0
    let xp = 0
    const byType = {}
    for (const week of Object.values(todos)) {
        for (const day of week) {
            for (const t of day) {
                if (!t.done) continue
                done += 1
                byType[t.type] = (byType[t.type] || 0) + 1
                xp += (TYPES[t.type] || TYPES.task).xp
            }
        }
    }
    const active = new Set([
        ...Object.keys(activity).filter(k => activity[k] > 0),
        ...Object.keys(focus).filter(k => focus[k] > 0),
    ])
    const sessions = Object.values(focus).reduce((a, b) => a + b, 0)
    xp += active.size * 5 + sessions * 8

    // Current streak: today counts if done, otherwise the streak survives until the day ends
    let cursor = startOfDay(new Date())
    if (!active.has(iso(cursor))) cursor = addDays(cursor, -1)
    let streak = 0
    while (active.has(iso(cursor))) {
        streak += 1
        cursor = addDays(cursor, -1)
    }

    // Best streak ever
    let best = 0
    let run = 0
    const sorted = [...active].sort()
    sorted.forEach(day => {
        const prev = iso(addDays(parseISO(day), -1))
        run = active.has(prev) ? run + 1 : 1
        best = Math.max(best, run)
    })

    return { done, byType, xp, active, sessions, streak, best: Math.max(best, streak), level: levelInfo(xp) }
}

export function useStats() {
    const [todos] = useStore('todos', {})
    const [activity] = useStore('activity', {})
    const [focus] = useStore('focus', {})
    return useMemo(() => computeStats(todos, activity, focus), [todos, activity, focus])
}

export const BADGES = [
    { id: 'first', icon: '🌱', name: 'First step', desc: 'Complete your first todo', test: s => s.done >= 1 },
    { id: 'ten', icon: '⚡', name: 'Momentum', desc: 'Complete 10 todos', test: s => s.done >= 10 },
    { id: 'hundred', icon: '💯', name: 'Centurion', desc: 'Complete 100 todos', test: s => s.done >= 100 },
    { id: 's3', icon: '🔥', name: 'On fire', desc: 'Reach a 3-day streak', test: s => s.best >= 3 },
    { id: 's7', icon: '🗓️', name: 'Week warrior', desc: 'Reach a 7-day streak', test: s => s.best >= 7 },
    { id: 's30', icon: '👑', name: 'Unstoppable', desc: 'Reach a 30-day streak', test: s => s.best >= 30 },
    { id: 'book', icon: '📚', name: 'Bookworm', desc: 'Finish 3 books', test: s => (s.byType.book || 0) >= 3 },
    { id: 'course', icon: '🎓', name: 'Graduate', desc: 'Finish 3 courses', test: s => (s.byType.course || 0) >= 3 },
    { id: 'project', icon: '🛠️', name: 'Builder', desc: 'Finish 3 projects', test: s => (s.byType.project || 0) >= 3 },
    { id: 'focus', icon: '🍅', name: 'Deep focus', desc: 'Complete 10 focus sessions', test: s => s.sessions >= 10 },
    { id: 'lvl5', icon: '🚀', name: 'Level 5', desc: 'Reach level 5', test: s => s.level.level >= 5 },
]

/* ============================================================
   Todos from anywhere in the app (used by the Roadmap page)
   ============================================================ */
export function addTodoToday({ text, type = 'task', link = '' }) {
    const now = new Date()
    const key = iso(weekStart(now))
    const day = dayIndex(now)
    setStore('todos', cur => {
        const week = (cur[key] || emptyWeek()).map(list => [...list])
        week[day].push({ id: uid(), text, type, ...(link ? { link } : {}), done: false, doneOn: null })
        return { ...cur, [key]: week }
    }, {})
}

/* ============================================================
   Motivation
   ============================================================ */
export const QUOTES = [
    'Small steps, taken daily, beat big plans left for tomorrow.',
    'You do not need to feel ready. You need to open the file.',
    'Progress is quiet. Keep showing up and let the streak speak.',
    'Understanding arrives after repetition, not before it.',
    'Today you only have to do the next small thing.',
    'Every expert once sat where you are, confused and curious.',
    'Consistency turns an ordinary hour into a skill.',
    'Do not compare your chapter one to their chapter twenty.',
    'Build the thing. The tutorial will make sense afterwards.',
    'A bug is just the computer teaching you something specific.',
    'Rest is part of the plan. Come back and keep the chain alive.',
    'Finish the page, then decide if it needs to be perfect.',
    'The best time to start was last week. The second best is now.',
    'Hard today means easy next month.',
    'Curiosity is the only motivation that never runs out.',
    'You are one focused hour away from a better day.',
    'Write the code you will be proud to read in a year.',
    'Done is better than perfect, and shipped beats both.',
    'Slow is smooth, and smooth becomes fast.',
    'Your future self is cheering for the version of you that starts.',
    'Ask the question. Someone else is quietly wondering the same thing.',
    'A journey of a thousand miles begins with a single step.',
    'Focus on the next checkbox, not the whole mountain.',
    'You are allowed to be a beginner for as long as it takes.',
]

export const quoteOfDay = (date = new Date()) => {
    const n = Math.floor(startOfDay(date) / 86400000)
    return QUOTES[((n % QUOTES.length) + QUOTES.length) % QUOTES.length]
}

/* ============================================================
   Toasts (in-memory, not persisted)
   ============================================================ */
let toasts = []
const toastSubs = new Set()
const emitToasts = () => toastSubs.forEach(fn => fn())
const subToasts = cb => {
    toastSubs.add(cb)
    return () => toastSubs.delete(cb)
}

export function dismissToast(id) {
    toasts = toasts.filter(t => t.id !== id)
    emitToasts()
}

export function notify({ title, body = '', icon = '🔔', sticky = false, actions = [] }) {
    const id = uid()
    toasts = [...toasts, { id, title, body, icon, sticky, actions }]
    emitToasts()
    if (!sticky) setTimeout(() => dismissToast(id), 5000)
    return id
}

export const useToasts = () => useSyncExternalStore(subToasts, () => toasts)

/* ============================================================
   Sound, system notifications, confetti
   ============================================================ */
export function systemNotify(title, body) {
    try {
        if ('Notification' in window && Notification.permission === 'granted') new Notification(title, { body })
    } catch {return null}
}

export function confetti(x, y) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const colors = ['#7c6cff', '#3ddc97', '#ffb454', '#ff6b8b', '#4cc9f0']
    for (let i = 0; i < 18; i++) {
        const p = document.createElement('i')
        const angle = Math.random() * Math.PI * 2
        const dist = 40 + Math.random() * 70
        p.className = 'confetti'
        p.style.cssText = `left:${x}px;top:${y}px;background:${colors[i % colors.length]};--dx:${Math.cos(angle) * dist}px;--dy:${Math.sin(angle) * dist - 30}px;--r:${Math.random() * 720}deg`
        document.body.appendChild(p)
        setTimeout(() => p.remove(), 900)
    }
}

/* ============================================================
   Global CSS: design tokens + shared components
   ============================================================ */
export const GLOBAL_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@600;700&family=DM+Sans:wght@400;500;600&display=swap');
:root{
    --bg:#f3f4fa;--sf:#ffffff;--sf2:#f6f7fc;--ln:#dcdff0;--tx:#161a2e;--mu:#5f6684;
    --ac:#5b4bdb;--ac2:#7c6cff;--ok:#10a366;--wip:#c27803;--bad:#d6455d;
    --shadow:0 1px 2px rgba(22,26,46,.06),0 8px 24px rgba(22,26,46,.06);
    --head:"Bricolage Grotesque","DM Sans",system-ui,sans-serif;--body:"DM Sans",system-ui,sans-serif;
    color-scheme:light;
}
@media(prefers-color-scheme:dark){:root:not([data-theme="light"]){
    --bg:#0e1019;--sf:#161927;--sf2:#1c2030;--ln:#2b3047;--tx:#e8eaf5;--mu:#9399b5;
    --ac:#8c7dff;--ac2:#a99dff;--ok:#3ddc97;--wip:#ffb454;--bad:#ff6b82;
    --shadow:0 1px 2px rgba(0,0,0,.3),0 8px 24px rgba(0,0,0,.25);color-scheme:dark}}
:root[data-theme="dark"]{
    --bg:#0e1019;--sf:#161927;--sf2:#1c2030;--ln:#2b3047;--tx:#e8eaf5;--mu:#9399b5;
    --ac:#8c7dff;--ac2:#a99dff;--ok:#3ddc97;--wip:#ffb454;--bad:#ff6b82;
    --shadow:0 1px 2px rgba(0,0,0,.3),0 8px 24px rgba(0,0,0,.25);color-scheme:dark}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{display:block;margin:0;min-width:320px;background:var(--bg);color:var(--tx);font:15px/1.5 var(--body);-webkit-font-smoothing:antialiased}
#root{max-width:none;margin:0;padding:0;text-align:left;width:auto}
h1,h2,h3,h4{font-family:var(--head);margin:0;letter-spacing:-.01em}
button{font:inherit;color:inherit}
:where(input:not([type=checkbox]):not([type=radio]):not([type=range]),select,textarea){font:inherit;color:inherit;background:var(--sf2);border:1px solid var(--ln);border-radius:8px;padding:7px 10px;width:100%;min-width:0}
:where(input[type=checkbox]){accent-color:var(--ok);width:17px;height:17px;margin:0;cursor:pointer}
textarea{resize:vertical}
:focus-visible{outline:2px solid var(--ac);outline-offset:2px}
::selection{background:color-mix(in srgb,var(--ac) 30%,transparent)}
.btn{font-weight:500;border:1px solid var(--ln);background:var(--sf);color:var(--tx);border-radius:8px;padding:7px 13px;cursor:pointer;transition:border-color .15s,background .15s,transform .1s;white-space:nowrap}
.btn:hover{border-color:var(--ac)}.btn:active{transform:translateY(1px)}
.btn.primary{background:linear-gradient(135deg,var(--ac),var(--ac2));border-color:var(--ac);color:#fff}.btn.primary:hover{filter:brightness(1.08)}
.btn.danger{color:var(--bad)}.btn.danger:hover{border-color:var(--bad)}
.btn.sm{padding:4px 10px;font-size:13px}.btn.ghost{background:none;border-color:transparent}.btn.ghost:hover{background:var(--sf2);border-color:var(--ln)}
.btn.on{border-color:var(--ac);box-shadow:inset 0 0 0 1px var(--ac)}
.icon-btn{border:0;background:none;color:var(--mu);cursor:pointer;border-radius:6px;padding:2px 7px;font-size:16px;line-height:1.4}
.icon-btn:hover{background:var(--sf2);color:var(--tx)}
.card{background:var(--sf);border:1px solid var(--ln);border-radius:14px;box-shadow:var(--shadow);transition:box-shadow .2s,border-color .2s}
.seg{display:inline-flex;gap:6px;flex-wrap:wrap}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.row .grow{flex:1}
.muted{color:var(--mu)}.small{font-size:13px}
.modal-back{position:fixed;inset:0;background:rgba(8,10,20,.55);z-index:60;display:grid;place-items:center;padding:20px;animation:fade .15s}
.modal{background:var(--sf);border:1px solid var(--ln);border-radius:16px;width:min(520px,100%);max-height:calc(100vh - 40px);overflow:auto;padding:20px;box-shadow:0 20px 60px rgba(0,0,0,.35);animation:rise .2s}
.modal h2{font-size:20px;margin-bottom:14px}
.field{display:grid;gap:4px;margin-bottom:12px}.field>span{font-size:13px;color:var(--mu)}
.toasts{position:fixed;right:16px;bottom:16px;z-index:100;display:grid;gap:10px;width:min(360px,calc(100vw - 32px))}
.toast{display:flex;gap:12px;align-items:flex-start;background:var(--sf);border:1px solid var(--ln);border-left:4px solid var(--ac);border-radius:12px;padding:12px 14px;box-shadow:0 12px 36px rgba(0,0,0,.28);animation:slide .3s cubic-bezier(.2,.9,.3,1.2)}
.toast.sticky{border-left-color:var(--wip)}
.toast .ico{font-size:24px;line-height:1;animation:ring 1.2s ease-in-out 2}
.toast b{display:block}.toast p{margin:2px 0 8px;color:var(--mu);font-size:14px}
.confetti{position:fixed;width:7px;height:7px;border-radius:2px;pointer-events:none;z-index:200;animation:burst .85s ease-out forwards}
.fadein{animation:fade .5s}
.bar{height:8px;border-radius:8px;background:var(--ln);overflow:hidden;margin-top:6px}
.bar i{display:block;height:100%;border-radius:8px;background:linear-gradient(90deg,var(--ac),var(--ac2));transition:width .5s}
.bar i.full{background:linear-gradient(90deg,var(--ok),color-mix(in srgb,var(--ok) 60%,#fff))}
.dot-pop{animation:pop .35s cubic-bezier(.2,.9,.3,1.4)}
.ic-img{object-fit:contain;border-radius:4px;display:inline-block;vertical-align:middle;flex:none}
.ic-em{line-height:1;display:inline-block;vertical-align:middle}
.ic-picker{display:grid;gap:8px}
.ic-grid{display:flex;flex-wrap:wrap;gap:4px;max-height:190px;overflow:auto}
.ic-btn{width:34px;height:34px;border:1px solid var(--ln);background:var(--sf2);border-radius:8px;cursor:pointer;font-size:18px;padding:0}
.ic-btn:hover{border-color:var(--ac)}.ic-btn.on{border-color:var(--ac);box-shadow:0 0 0 1px var(--ac)}
@keyframes fade{from{opacity:0}to{opacity:1}}
@keyframes rise{from{opacity:0;transform:translateY(10px) scale(.98)}to{opacity:1;transform:none}}
@keyframes slide{from{opacity:0;transform:translateX(40px)}to{opacity:1;transform:none}}
@keyframes ring{0%,100%{transform:rotate(0)}15%{transform:rotate(14deg)}30%{transform:rotate(-12deg)}45%{transform:rotate(8deg)}60%{transform:rotate(-6deg)}}
@keyframes burst{to{transform:translate(var(--dx),var(--dy)) rotate(var(--r));opacity:0}}
@keyframes flicker{0%,100%{transform:scale(1) rotate(-2deg)}25%{transform:scale(1.07,.96) rotate(2deg)}50%{transform:scale(.96,1.06) rotate(-1deg)}75%{transform:scale(1.05,.98) rotate(3deg)}}
@keyframes pop{from{transform:scale(.4);opacity:0}to{transform:none;opacity:1}}
@keyframes glow{0%,100%{opacity:.55}50%{opacity:1}}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important;scroll-behavior:auto!important}}
`
