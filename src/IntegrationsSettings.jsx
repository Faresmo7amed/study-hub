import { useEffect, useState } from 'react'
import { notify, registerWorker, systemNotify, useStore } from './shared'
import { GCAL_DEFAULT, connectGoogle, disconnectGoogle, gcalConfigured, syncGoogle, tokenValid, useGcalBusy } from './gcal'

/* Two sections of the Settings window: system notifications and Google Calendar.
   Every button here has type="button" because the Settings window is a form. */

const when = ms => (ms ? new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'never')

export function NotificationsSection({ time, onTime }) {
    const supported = typeof window !== 'undefined' && 'Notification' in window
    const [perm, setPerm] = useState(() => (supported ? Notification.permission : 'unsupported'))
    const [worker, setWorker] = useState('checking')

    useEffect(() => {
        let alive = true
        if (!('serviceWorker' in navigator)) { setWorker('none'); return undefined }
        navigator.serviceWorker.getRegistration().then(r => { if (alive) setWorker(r ? 'ready' : 'none') }).catch(() => alive && setWorker('none'))
        return () => { alive = false }
    }, [])

    const enable = async () => {
        try {
            await registerWorker()
            const result = await Notification.requestPermission()
            setPerm(result)
            setWorker('ready')
            if (result === 'granted') await systemNotify('Notifications are on', 'Event and todo reminders will appear like this.', { tag: 'welcome' })
        } catch { setPerm(Notification.permission) }
    }
    const test = async () => {
        const ok = await systemNotify('Study Hub test', 'If you can read this, reminders will reach you.', { tag: 'test' })
        if (!ok) notify({ title: 'Could not show a notification', body: 'Check the browser or phone notification settings for this site.', icon: '⚠️' })
    }

    return (
        <>
            <h3 className="st-h">Notifications</h3>
            {!supported && <p className="muted small" style={{ marginTop: 0 }}>This browser cannot show system notifications. On iPhone, add Study Hub to the Home Screen first (iOS 16.4 or newer), then open it from there.</p>}
            {supported && (
                <>
                    <p className="small" style={{ marginTop: 0 }}>
                        Status: <b>{perm === 'granted' ? 'on' : perm === 'denied' ? 'blocked in the browser settings' : 'not enabled yet'}</b>
                        {perm === 'granted' && worker === 'ready' ? ' · works on phones too' : ''}
                    </p>
                    <div className="row" style={{ marginBottom: 8 }}>
                        {perm !== 'granted' && perm !== 'denied' && <button type="button" className="btn primary" onClick={enable}>Enable notifications</button>}
                        {perm === 'granted' && <button type="button" className="btn" onClick={test}>Send a test notification</button>}
                    </div>
                    {perm === 'denied' && <p className="small" style={{ color: 'var(--wip)' }}>Notifications are blocked. Open the site settings of your browser (the lock icon next to the address, or the app info on your phone), allow Notifications, then reload.</p>}
                </>
            )}
            <label className="field"><span>Daily reminder for unfinished todos (empty = off)</span>
                <input type="time" value={time || ''} onChange={e => onTime(e.target.value)} />
            </label>
            <p className="muted small" style={{ marginTop: 0 }}>
                Reminders fire while Study Hub is open, including in the background of a browser tab or an installed app. To also get them when the app is completely closed, connect Google Calendar below: your phone’s Calendar app then rings for every event.
            </p>
        </>
    )
}

export function GoogleCalendarSection() {
    const [g, , update] = useStore('gcal', GCAL_DEFAULT)
    const busy = useGcalBusy()
    const [msg, setMsg] = useState('')
    const [err, setErr] = useState('')
    const live = tokenValid(g)

    const run = async fn => {
        setErr('')
        setMsg('')
        try {
            await fn()
        } catch (e) {
            setErr(e.code === 'expired' ? 'Google sign-in expired. Press Connect again.' : e.message)
        }
    }
    const connect = () => run(async () => {
        await connectGoogle(true)
        const r = await syncGoogle()
        setMsg(`Connected. Sent ${r.sent}, received ${r.received}.`)
    })
    const sync = () => run(async () => {
        const r = await syncGoogle()
        setMsg(`Synced. Sent ${r.sent}, received ${r.received}, removed ${r.removed}${g.todos ? `, todos updated ${r.todos}` : ''}.`)
    })

    return (
        <>
            <h3 className="st-h">Google Calendar</h3>
            {!gcalConfigured && (
                <p className="muted small" style={{ marginTop: 0 }}>Not set up yet. Add <code>VITE_GOOGLE_CLIENT_ID</code> to your <code>.env</code> file and restart the app (steps in SETUP_NOTES.md).</p>
            )}
            {gcalConfigured && (
                <>
                    <p className="small" style={{ marginTop: 0 }}>
                        Status: <b>{g.on ? (live ? 'connected' : 'needs reconnecting') : 'not connected'}</b> · last sync: {when(g.last)}
                    </p>
                    <p className="muted small" style={{ marginTop: 0 }}>
                        Events sync both ways between the main calendar, the sidebar calendar and your Google calendar. Google access lasts about an hour; after that, press Connect again (the app also tries by itself).
                    </p>
                    <div className="row" style={{ marginBottom: 8 }}>
                        {(!g.on || !live) && <button type="button" className="btn primary" onClick={connect} disabled={busy}>{g.on ? 'Reconnect' : 'Connect Google Calendar'}</button>}
                        {g.on && live && <button type="button" className="btn" onClick={sync} disabled={busy}>{busy ? 'Syncing…' : 'Sync now'}</button>}
                        {g.on && <button type="button" className="btn danger" onClick={() => { disconnectGoogle(); setMsg('Disconnected. Your events stay here and in Google.') }}>Disconnect</button>}
                    </div>
                    <label className="row" style={{ marginBottom: 8 }}>
                        <input type="checkbox" checked={g.todos} onChange={e => update(d => { d.todos = e.target.checked })} />
                        Also show my todos in Google Calendar (all-day items, one way)
                    </label>
                    {msg && <p className="small" style={{ color: 'var(--ok)', margin: 0 }} role="status">{msg}</p>}
                    {(err || (g.error && g.error !== 'expired')) && <p className="small" style={{ color: 'var(--bad)', margin: 0 }} role="alert">{err || g.error}</p>}
                </>
            )}
        </>
    )
}
