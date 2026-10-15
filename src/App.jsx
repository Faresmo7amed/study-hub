import { useEffect, useRef, useState } from 'react'
import {
    BADGES, GLOBAL_CSS, checkBackup, dismissToast, downloadBackup, getStore, importAll, notify, setStore,
    systemNotify, useNow, useStats, useStore, useToasts,
} from './shared'
import Dashboard from './Dashboard'
import Notes from './Notes'
import Roadmap from './Roadmap'
import { AccountButton, AccountModal, CloudSync } from './Account'
import { SoundButton, SoundModal } from './SoundSettings'
import { play } from './sound'

const PAGES = [
    { id: 'dashboard', label: 'Dashboard', icon: '◧' },
    { id: 'notes', label: 'Notes', icon: '🗒️' },
    { id: 'roadmap', label: 'Roadmap', icon: '🗺️' },
]

const fromHash = () => {
    const id = window.location.hash.replace(/^#\/?/, '')
    return PAGES.some(p => p.id === id) ? id : 'dashboard'
}

/* ---------- Top bar ---------- */
function TopBar({ page, go, onBackup, onAccount, onSound }) {
    const stats = useStats()
    const [meta] = useStore('meta', {})
    const stale = !meta.lastBackup || Date.now() - meta.lastBackup > 7 * 86400000
    const [theme, setTheme] = useStore('theme', 'system')
    const [perm, setPerm] = useState(() => ('Notification' in window ? Notification.permission : 'denied'))

    useEffect(() => {
        const root = document.documentElement
        if (theme === 'system') delete root.dataset.theme
        else root.dataset.theme = theme
    }, [theme])

    const toggleTheme = () => {
        const dark = theme === 'system' ? window.matchMedia('(prefers-color-scheme: dark)').matches : theme === 'dark'
        setTheme(dark ? 'light' : 'dark')
    }

    const askPermission = async () => {
        try {
            const result = await Notification.requestPermission()
            setPerm(result)
            if (result === 'granted') notify({ title: 'Alerts enabled', body: 'Event reminders will also appear as system notifications.', icon: '✅' })
        } catch {}
    }

    return (
        <header className="app-top">
            <div className="app-top-in">
                <a className="app-brand" href="#/dashboard" onClick={() => go('dashboard')}>
                    <span className="app-mark" aria-hidden="true">
                        <svg viewBox="0 0 24 24" width="22" height="22"><path d="M5 19c0-6 4-5 7-8s1-6 7-6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /><circle cx="5" cy="19" r="2" fill="currentColor" /><circle cx="19" cy="5" r="2" fill="currentColor" /></svg>
                    </span>
                    Study Hub
                </a>
                <nav className="app-nav" aria-label="Pages">
                    {PAGES.map(p => (
                        <button key={p.id} className={page === p.id ? 'on' : ''} onClick={() => go(p.id)} aria-current={page === p.id ? 'page' : undefined}>
                            <span aria-hidden="true">{p.icon}</span> {p.label}
                        </button>
                    ))}
                </nav>
                <div className="app-right">
                    {perm === 'default' && (
                        <button className="btn sm" onClick={askPermission} title="Get system notifications for event reminders" aria-label="Enable alerts">
                            <span aria-hidden="true">🔔</span><span className="app-lbl"> Enable alerts</span>
                        </button>
                    )}
                    <span className="app-chip" title={`${stats.streak}-day streak. Best: ${stats.best}`}>
                        <span className={stats.streak > 0 ? 'flame-on' : ''}>🔥</span> {stats.streak}
                    </span>
                    <span className="app-chip lvl" title={`${stats.level.into}/${stats.level.span} XP to the next level`}>
                        Lv {stats.level.level}
                        <i><b style={{ width: stats.level.pct + '%' }} /></i>
                    </span>
                    <AccountButton onClick={onAccount} />
                    <button className="btn sm" onClick={onBackup} aria-label="Backup and restore" title={stale ? 'You have not backed up in over a week' : 'Backup and restore'}>
                        <span aria-hidden="true">💾</span><span className="app-lbl"> Backup</span>{stale && <span className="app-dot" role="img" aria-label="Backup recommended" />}
                    </button>
                    <SoundButton onClick={onSound} />
                    <button className="icon-btn" onClick={toggleTheme} aria-label="Switch theme" title="Switch theme">◐</button>
                </div>
            </div>
        </header>
    )
}

/* ---------- Toasts ---------- */
function Toasts() {
    const toasts = useToasts()
    return (
        <div className="toasts" aria-live="polite">
            {toasts.map(t => (
                <div key={t.id} className={'toast' + (t.sticky ? ' sticky' : '')}>
                    <span className="ico">{t.icon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <b>{t.title}</b>
                        {t.body && <p>{t.body}</p>}
                        <div className="row">
                            {t.actions.map(a => (
                                <button key={a.label} className="btn sm" onClick={() => { a.onClick && a.onClick(); dismissToast(t.id) }}>{a.label}</button>
                            ))}
                            {t.sticky && <button className="btn sm ghost" onClick={() => dismissToast(t.id)}>Dismiss</button>}
                        </div>
                    </div>
                    {!t.sticky && <button className="icon-btn" onClick={() => dismissToast(t.id)} aria-label="Dismiss">×</button>}
                </div>
            ))}
        </div>
    )
}

/* ---------- Event reminders (run on every page) ---------- */
function Reminders() {
    const now = useNow(1000)
    const snoozed = useRef([])

    useEffect(() => {
        const t = now.getTime()
        const events = getStore('events', [])
        const fired = getStore('fired', {})
        const patch = {}

        const fire = (ev, kind) => {
            const late = t - new Date(`${ev.date}T${ev.time}`).getTime()
            const title = ev.title || 'Event'
            const body = kind === 'pre'
                ? `Starts at ${ev.time} (in ${Math.max(1, Math.round(-late / 60000))} min)`
                : late > 120000 ? `Started at ${ev.time}` : `Starting now (${ev.time})`
            notify({
                title,
                body: ev.notes ? `${body}. ${ev.notes}` : body,
                icon: kind === 'pre' ? '⏳' : '🔔',
                sticky: true,
                actions: [{
                    label: 'Snooze 5 min',
                    onClick: () => snoozed.current.push({ ev, at: Date.now() + 5 * 60000 }),
                }],
            })
            play(kind === 'pre' ? 'reminder' : 'alarm')
            systemNotify(title, body)
        }

        events.forEach(ev => {
            if (!ev.time) return
            const at = new Date(`${ev.date}T${ev.time}`).getTime()
            const lead = Number(ev.remind) || 0
            const preKey = `${ev.id}|${ev.date}|${ev.time}|pre`
            const atKey = `${ev.id}|${ev.date}|${ev.time}|at`
            const inWindow = t >= at && t < at + 3600000
            if (lead > 0 && !fired[preKey] && !fired[atKey] && t >= at - lead * 60000 && t < at) {
                patch[preKey] = true
                fire(ev, 'pre')
            }
            if (!fired[atKey] && inWindow) {
                patch[atKey] = true
                patch[preKey] = true
                fire(ev, 'at')
            }
        })

        const due = snoozed.current.filter(s => s.at <= t)
        if (due.length) {
            snoozed.current = snoozed.current.filter(s => s.at > t)
            due.forEach(s => notify({ title: s.ev.title || 'Event', body: 'Snoozed reminder', icon: '⏰', sticky: true }))
            play('reminder')
        }

        if (Object.keys(patch).length) setStore('fired', cur => ({ ...cur, ...patch }), {})
    }, [now])

    return null
}

/* ---------- Level ups and badges ---------- */
function GameWatcher() {
    const stats = useStats()
    const ready = useRef(false)

    useEffect(() => {
        const game = getStore('game', { badges: {}, level: 1 })
        const earned = BADGES.filter(b => b.test(stats) && !game.badges[b.id])
        const levelUp = stats.level.level > game.level

        if (ready.current) {
            if (levelUp) {
                notify({ title: `Level ${stats.level.level}: ${stats.level.title}`, body: 'You levelled up. Keep the chain going.', icon: '🚀' })
                play('levelup')
            } else if (earned.length) {
                play('badge')
            }
            earned.forEach(b => notify({ title: `Badge unlocked: ${b.name}`, body: b.desc, icon: b.icon }))
        }
        ready.current = true

        if (earned.length || levelUp) {
            setStore('game', cur => ({
                level: Math.max(cur.level, stats.level.level),
                badges: { ...cur.badges, ...Object.fromEntries(earned.map(b => [b.id, Date.now()])) },
            }), { badges: {}, level: 1 })
        }
    }, [stats])

    return null
}

/* ---------- Backup and restore ---------- */
function BackupModal({ onClose }) {
    const [pending, setPending] = useState(null)
    const [error, setError] = useState('')

    const download = () => {
        downloadBackup()
        notify({ title: 'Backup downloaded', body: 'Keep the file somewhere safe, like a cloud drive.', icon: '💾' })
    }

    const onFile = async e => {
        const file = e.target.files[0]
        e.target.value = ''
        if (!file) return
        try {
            let obj
            try { obj = JSON.parse(await file.text()) } catch { throw new Error('That file is not valid JSON.') }
            checkBackup(obj)
            setPending({ obj, name: file.name })
            setError('')
        } catch (err) {
            setPending(null)
            setError(err.message)
        }
    }

    const restore = () => {
        importAll(pending.obj)
        notify({ title: 'Backup restored', body: 'Your data is back.', icon: '✅' })
        onClose()
    }

    const d = pending ? pending.obj.data : {}
    const todos = Object.values(d.todos || {}).reduce((n, week) => n + week.reduce((m, day) => m + day.length, 0), 0)
    const rows = pending ? [
        ['Todos', todos], ['Events', (d.events || []).length], ['Database tables', d.database ? d.database.order.length : 0],
        ['Notes', (d.notes || []).length], ['Roadmap topics', d.roadmap ? d.roadmap.topics.length : 0],
    ] : []

    return (
        <div className="modal-back" onMouseDown={e => e.target === e.currentTarget && onClose()}>
            <div className="modal" role="dialog" aria-label="Backup and restore">
                <h2>Backup and restore</h2>
                <p className="muted small" style={{ marginTop: -6 }}>
                    Your data is stored in this browser only. A backup file holds the dashboard, courses database, events, streak, notes and roadmap.
                </p>
                <div className="field"><span>1. Save a copy</span>
                    <button className="btn primary" onClick={download}>Download backup file</button>
                </div>
                <div className="field"><span>2. Restore from a copy</span>
                    <input type="file" accept="application/json,.json" onChange={onFile} aria-label="Choose a backup file" />
                </div>
                {error && <p style={{ color: 'var(--bad)' }}>{error}</p>}
                {pending && (
                    <div className="card" style={{ padding: 14, boxShadow: 'none' }}>
                        <b>{pending.name}</b>
                        <p className="muted small">Saved {new Date(pending.obj.exportedAt).toLocaleString()}</p>
                        <ul style={{ margin: '6px 0 12px', paddingLeft: 18 }}>{rows.map(([k, v]) => <li key={k}>{k}: {v}</li>)}</ul>
                        <p className="small">Restoring replaces the matching data in this browser.</p>
                        <button className="btn danger" onClick={restore}>Replace my data with this backup</button>
                    </div>
                )}
                <div className="row" style={{ marginTop: 12 }}><span className="grow" /><button className="btn" onClick={onClose}>Close</button></div>
            </div>
        </div>
    )
}

/* ---------- App ---------- */
export default function App() {
    const [page, setPage] = useState(fromHash)
    const [backup, setBackup] = useState(false)
    const [account, setAccount] = useState(false)
    const [soundOpen, setSoundOpen] = useState(false)

    // Ask the browser not to evict our data when disk space runs low
    useEffect(() => {
        if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {})
    }, [])

    useEffect(() => {
        const onHash = () => setPage(fromHash())
        window.addEventListener('hashchange', onHash)
        return () => window.removeEventListener('hashchange', onHash)
    }, [])

    const go = id => {
        window.location.hash = '/' + id
        setPage(id)
        window.scrollTo({ top: 0 })
    }

    return (
        <div className="app">
            <style>{GLOBAL_CSS}</style>
            <style>{CSS}</style>
            <TopBar page={page} go={go} onBackup={() => setBackup(true)} onAccount={() => setAccount(true)} onSound={() => setSoundOpen(true)} />
            <main>
                {page === 'notes' && <Notes />}
                {page === 'roadmap' && <Roadmap />}
                {page === 'dashboard' && <Dashboard />}
            </main>
            {backup && <BackupModal onClose={() => setBackup(false)} />}
            {account && <AccountModal onClose={() => setAccount(false)} />}
            {soundOpen && <SoundModal onClose={() => setSoundOpen(false)} />}
            <CloudSync />
            <Toasts />
            <Reminders />
            <GameWatcher />
        </div>
    )
}

const CSS = `
.app-top{position:sticky;top:0;z-index:40;background:color-mix(in srgb,var(--bg) 86%,transparent);backdrop-filter:blur(12px);border-bottom:1px solid var(--ln)}
.app-top-in{max-width:1400px;margin:auto;padding:10px 20px;display:flex;align-items:center;gap:20px;flex-wrap:wrap}
.app-brand{display:flex;align-items:center;gap:10px;font:700 19px var(--head);color:var(--tx);text-decoration:none}
.app-mark{display:grid;place-items:center;width:34px;height:34px;border-radius:10px;background:var(--ac);color:#fff}
.app-nav{display:flex;gap:4px;background:var(--sf2);border:1px solid var(--ln);border-radius:10px;padding:3px}
.app-nav button{border:0;background:none;padding:6px 14px;border-radius:7px;cursor:pointer;color:var(--mu);font-weight:500}
.app-nav button:hover{color:var(--tx)}
.app-nav button.on{background:var(--sf);color:var(--tx);box-shadow:0 1px 3px rgba(0,0,0,.12)}
.app-right{margin-left:auto;display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:flex-end;min-width:0}
.app-chip{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--ln);background:var(--sf);border-radius:999px;padding:3px 12px;font-weight:600;font-size:14px}
.app-chip.lvl i{display:block;width:44px;height:6px;border-radius:6px;background:var(--ln);overflow:hidden}
.app-chip.lvl b{display:block;height:100%;background:var(--ok);transition:width .5s}
.app-dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--wip);margin-left:6px}
.flame-on{display:inline-block;animation:flicker 1.1s ease-in-out infinite}
@media(max-width:640px){
.app-top-in{gap:10px;padding:10px 12px}
.app-nav{order:3;width:100%}.app-nav button{flex:1;padding:6px 6px;white-space:nowrap}
.app-right{gap:6px}
.app-lbl{display:none}
.app-chip{padding:3px 9px}
}
@media(max-width:380px){.app-chip.lvl i{display:none}.app-brand{font-size:17px}.app-nav{padding:2px}.app-nav button{font-size:13px;padding:6px 2px}}
`
