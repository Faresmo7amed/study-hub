import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
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
import StudyGroup, { StudyPublisher } from './StudyGroup'
import { LeftRail, RAIL_CSS, RightRail } from './Rails'
import { SETTINGS_EVENT, SettingsModal } from './Settings'
import { useSyncState } from './sync'

const PAGES = [
    { id: 'dashboard', label: 'Dashboard', icon: '◧' },
    { id: 'notes', label: 'Notes', icon: '🗒️' },
    { id: 'roadmap', label: 'Roadmap', icon: '🗺️' },
    { id: 'studygroup', label: 'Study Group', icon: '👥' },
]

const fromHash = () => {
    const id = window.location.hash.replace(/^#\/?/, '')
    return PAGES.some(p => p.id === id) ? id : 'dashboard'
}

/* ---------- Top bar ---------- */
function TopBar({ page, go, onBackup, onAccount, onSound, onSettings, onPanels }) {
    const stats = useStats()
    const [meta] = useStore('meta', {})
    const now = useNow(60000)
    const stale = !meta.lastBackup || now.getTime() - meta.lastBackup > 7 * 86400000
    const [theme, setTheme] = useStore('theme', 'system')
    const [ui, setUi] = useStore('ui', { left: true, right: true })
    const [more, setMore] = useState(false)
    const [sound] = useStore('sound', { on: true })
    const cloud = useSyncState()
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
        } catch {return null}
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
                        <button className="btn sm app-desk" onClick={askPermission} title="Get system notifications for event reminders" aria-label="Enable alerts">
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
                    <button className="btn sm app-desk" onClick={onBackup} aria-label="Backup and restore" title={stale ? 'You have not backed up in over a week' : 'Backup and restore'}>
                        <span aria-hidden="true">💾</span><span className="app-lbl"> Backup</span>{stale && <span className="app-dot" role="img" aria-label="Backup recommended" />}
                    </button>
                    <span className="app-desk"><SoundButton onClick={onSound} /></span>
                    <button className="icon-btn app-desk" onClick={onSettings} aria-label="Settings" title="Settings">⚙️</button>
                    <button className="icon-btn app-railbtn" onClick={() => setUi({ ...ui, left: !ui.left })} aria-pressed={ui.left} aria-label="Toggle left sidebar" title="Toggle left sidebar">◧</button>
                    <button className="icon-btn app-railbtn" onClick={() => setUi({ ...ui, right: !ui.right })} aria-pressed={ui.right} aria-label="Toggle right sidebar" title="Toggle right sidebar">◨</button>
                    <button className="icon-btn app-desk" onClick={toggleTheme} aria-label="Switch theme" title="Switch theme">◐</button>
                    <button className="icon-btn app-more" onClick={() => setMore(!more)} aria-label="More" aria-expanded={more} aria-haspopup="menu">
                        ☰{stale && <span className="app-dot" aria-hidden="true" />}
                    </button>
                </div>
            </div>
            {more && createPortal(
                <>
                    <div className="app-moreback" onClick={() => setMore(false)} />
                    <div className="app-menu" role="menu">
                        {[
                            ...(cloud.phase === 'off' ? [] : [[cloud.user ? '☁️' : '🔑', cloud.user ? 'Account and sync' : 'Sign in to sync', onAccount]]),
                            ['📋', 'Today and overview', onPanels],
                            ['💾', stale ? 'Backup (overdue)' : 'Backup and restore', onBackup],
                            [sound.on ? '🔊' : '🔇', sound.on ? 'Sound is on' : 'Sound is muted', onSound],
                            ['⚙️', 'Settings and links', onSettings],
                            ['🌓', 'Switch theme', toggleTheme],
                            ...(perm === 'default' ? [['🔔', 'Enable alerts', askPermission]] : []),
                        ].map(([icon, label, fn]) => (
                            <button key={label} role="menuitem" onClick={() => { setMore(false); fn() }}><span aria-hidden="true">{icon}</span> {label}</button>
                        ))}
                    </div>
                </>,
                document.body,
            )}
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
        play('save')
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
        play('save')
        notify({ title: 'Backup restored', body: 'Your data is back.', icon: '✅' })
        onClose()
    }

    const d = pending ? pending.obj.data : {}
    const todos = Object.values(d.todos || {}).reduce((n, week) => n + week.reduce((m, day) => m + day.length, 0), 0)
    const rows = pending ? [
        ['Todos', todos], ['Events', (d.events || []).length], ['Database tables', d.database ? (d.database.blocks ? d.database.blocks.reduce((n, b) => n + b.order.length, 0) : d.database.order.length) : 0],
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

/* ---------- Today and overview, for screens too small for the sidebars ---------- */
function PanelsModal({ onClose }) {
    return (
        <div className="modal-back sheet-back" onMouseDown={e => e.target === e.currentTarget && onClose()}>
            <div className="modal sheet-modal" role="dialog" aria-label="Today and overview">
                <div className="row"><h2 className="grow" style={{ margin: 0 }}>Today and overview</h2><button className="btn sm" onClick={onClose}>Close</button></div>
                <LeftRail sheet />
                <RightRail sheet />
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
    const [settingsOpen, setSettingsOpen] = useState(false)
    const [panels, setPanels] = useState(false)
    const [ui] = useStore('ui', { left: true, right: true })
    // Ask the browser not to evict our data when disk space runs low
    useEffect(() => {
        if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {})
    }, [])

    useEffect(() => {
        const onHash = () => setPage(fromHash())
        window.addEventListener('hashchange', onHash)
        return () => window.removeEventListener('hashchange', onHash)
    }, [])

    // The "Add your links" button in the sidebar asks for the settings page with this event
    useEffect(() => {
        const open = () => setSettingsOpen(true)
        window.addEventListener(SETTINGS_EVENT, open)
        return () => window.removeEventListener(SETTINGS_EVENT, open)
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
            <style>{RAIL_CSS}</style>
            <TopBar page={page} go={go} onBackup={() => setBackup(true)} onAccount={() => setAccount(true)} onSound={() => setSoundOpen(true)} onSettings={() => setSettingsOpen(true)} onPanels={() => setPanels(true)} />
            <div className="app-shell">
                {ui.left && page !== 'notes' && <LeftRail />}
                <main>
                    {page === 'notes' && <Notes />}
                    {page === 'roadmap' && <Roadmap />}
                    {page === 'studygroup' && <StudyGroup />}
                    {page === 'dashboard' && <Dashboard />}
                </main>
                {ui.right && <RightRail />}
            </div>
            {backup && <BackupModal onClose={() => setBackup(false)} />}
            {account && <AccountModal onClose={() => setAccount(false)} />}
            {soundOpen && <SoundModal onClose={() => setSoundOpen(false)} />}
            {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
            {panels && <PanelsModal onClose={() => setPanels(false)} />}
            <CloudSync />
            <StudyPublisher />
            <Toasts />
            <Reminders />
            <GameWatcher />
        </div>
    )
}

const CSS = `
.app-top{position:sticky;top:0;z-index:40;background:color-mix(in srgb,var(--bg) 86%,transparent);backdrop-filter:blur(12px);border-bottom:1px solid var(--ln)}
.app-top-in{max-width:1600px;margin:auto;padding:10px 20px;display:flex;align-items:center;gap:20px;flex-wrap:wrap}
.app-brand{display:flex;align-items:center;gap:10px;font:700 19px var(--head);color:var(--tx);text-decoration:none}
.app-mark{display:grid;place-items:center;width:34px;height:34px;border-radius:10px;background:linear-gradient(135deg,var(--ac),var(--ac2));color:#fff;box-shadow:0 4px 14px color-mix(in srgb,var(--ac) 40%,transparent)}
.app-nav{display:flex;gap:4px;background:var(--sf2);border:1px solid var(--ln);border-radius:10px;padding:3px}
.app-nav button{border:0;background:none;padding:6px 14px;border-radius:7px;cursor:pointer;color:var(--mu);font-weight:500;transition:color .15s,background .15s}
.app-nav button:hover{color:var(--tx)}
.app-nav button.on{background:var(--sf);color:var(--tx);box-shadow:0 1px 3px rgba(0,0,0,.12)}
.app-right{margin-left:auto;display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:flex-end;min-width:0}
.app-chip{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--ln);background:var(--sf);border-radius:999px;padding:3px 12px;font-weight:600;font-size:14px;white-space:nowrap}
.app-chip.lvl i{display:block;width:44px;height:6px;border-radius:6px;background:var(--ln);overflow:hidden}
.app-chip.lvl b{display:block;height:100%;background:linear-gradient(90deg,var(--ok),color-mix(in srgb,var(--ok) 60%,#fff));transition:width .5s}
.app-dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--wip);margin-left:6px}
.flame-on{display:inline-block;animation:flicker 1.1s ease-in-out infinite}
.app-cloud.signedout{background:linear-gradient(135deg,var(--ac),var(--ac2));color:#fff;border-color:transparent}
.app-cloud.synced{color:var(--ok)}.app-cloud.offline,.app-cloud.error{color:var(--wip)}.app-cloud.choose{color:var(--bad);border-color:var(--bad)}
.app-railbtn,.app-more{display:none}
.app-more{position:relative;font-size:20px;padding:2px 9px}
.app-moreback{position:fixed;inset:0;z-index:65}
.app-menu{position:fixed;z-index:70;top:54px;right:10px;width:min(280px,calc(100vw - 20px));background:var(--sf);border:1px solid var(--ln);border-radius:14px;box-shadow:0 16px 48px rgba(0,0,0,.35);padding:6px;display:grid;animation:rise .15s}
.app-menu button{display:flex;gap:12px;align-items:center;border:0;background:none;text-align:left;padding:12px;border-radius:9px;cursor:pointer;font-size:15px;color:var(--tx)}
.app-menu button:hover{background:var(--sf2)}
.app-menu button span{width:24px;text-align:center;font-size:18px}
.app-shell{display:flex;align-items:flex-start;max-width:2120px;margin:0 auto}
.app-shell>main{flex:1;min-width:0}
.rail{display:none;flex:none;width:260px;gap:14px;align-content:start;position:sticky;top:70px;max-height:calc(100vh - 78px);overflow:auto;padding:20px 0 20px 16px;scrollbar-width:thin}
.rail.r{padding:20px 16px 20px 0}
@media(min-width:1100px){.rail.l{display:grid}.app-railbtn{display:inline-block}}
@media(min-width:1400px){.rail.r{display:grid}}
.sheet-back{align-items:end;padding:0}
.sheet-modal{width:min(560px,100%);max-height:92vh;border-radius:18px 18px 0 0;display:grid;gap:14px;align-content:start}
@media(max-width:900px){
.app-desk{display:none!important}
.app-more{display:inline-block}
.app-nav{order:3;flex:1 1 100%}
.app-nav button{flex:1}
.app-top-in{gap:10px 12px}
}
@media(max-width:640px){
.app-top{backdrop-filter:none;background:var(--bg)}
.app-top-in{gap:8px;padding:8px 12px;flex-wrap:nowrap}
.app-brand{font-size:17px;flex:none}
.app-mark{width:30px;height:30px}
.app-right{flex:1;gap:6px;flex-wrap:nowrap}
.app-lbl{display:none}
.app-cloud.signedout .app-lbl{display:inline}
.app-chip{padding:3px 8px}
.app-nav{position:fixed;left:0;right:0;bottom:0;z-index:45;border-radius:0;border-width:1px 0 0;background:var(--sf);padding:4px 6px calc(4px + env(safe-area-inset-bottom));gap:2px;order:0;box-shadow:0 -6px 20px rgba(0,0,0,.12)}
.app-nav button{flex:1;display:grid;justify-items:center;gap:1px;padding:6px 2px;font-size:11px;white-space:nowrap}
.app-nav button>span{font-size:18px;line-height:1.2}
.app-nav button.on{background:color-mix(in srgb,var(--ac) 14%,transparent);color:var(--ac);box-shadow:none}
.app-shell>main{padding-bottom:68px}
.toasts{bottom:76px}
.app-menu{top:50px}
}
@media(max-width:640px){.modal-back{align-items:end;padding:0}.modal{width:100%;max-height:92vh;border-radius:18px 18px 0 0;padding:18px 16px calc(18px + env(safe-area-inset-bottom))}.modal input,.modal select,.modal textarea{font-size:16px}.modal .row .btn{flex:1 1 auto}}
@media(max-width:420px){.app-brand{font-size:0}.app-chip.lvl i{display:none}}
`
