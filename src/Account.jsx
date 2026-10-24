import { useEffect, useState } from 'react'
import { SYNC_KEYS, STUDY_DEFAULT, clearLocalData, downloadBackup, getStore, notify } from './shared'
import * as fb from './firebase'
import { friendly } from './authErrors'
import { resolveChoice, signOutAndWipe, startSync, syncNow, useSyncState } from './sync'

const LABELS = { todos: 'Todos', activity: 'Streak history', focus: 'Focus sessions', events: 'Events', game: 'Badges', settings: 'Settings', database: 'Courses database', notes: 'Notes', labels: 'Note labels', roadmap: 'Roadmap (old)', roadmaps: 'Roadmaps', studygroup: 'Study Group' }
const PHASE = {
    loading: ['…', 'Connecting'],
    signedout: ['☁️', 'Sign in'],
    syncing: ['☁️', 'Saving…'],
    dirty: ['☁️', 'Saving…'],
    synced: ['☁️', 'Synced'],
    offline: ['📴', 'Offline'],
    error: ['⚠️', 'Sync error'],
    choose: ['❗', 'Action needed'],
    pending: ['⏳', 'Waiting for approval'],
}

/* ---------- small button in the top bar ---------- */
export function AccountButton({ onClick }) {
    const s = useSyncState()
    if (s.phase === 'off') return null
    const [icon, label] = PHASE[s.phase] || PHASE.loading
    return (
        <button className={'btn sm app-cloud ' + s.phase} onClick={onClick} aria-label={`Cloud sync: ${label}`} title={s.message || `Cloud sync: ${label}`}>
            <span aria-hidden="true">{icon}</span><span className="app-lbl"> {label}</span>
        </button>
    )
}

/* ---------- delete my own account ---------- */
function DeleteAccount({ user }) {
    const [open, setOpen] = useState(false)
    const [password, setPassword] = useState('')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const owner = fb.isAdmin(user)

    const go = async e => {
        e.preventDefault()
        setBusy(true)
        setError('')
        try {
            const groups = ((getStore('studygroup', STUDY_DEFAULT) || {}).groups || []).map(g => g.id)
            await fb.deleteMyAccount({ keys: SYNC_KEYS, groups, password })
            clearLocalData()
            window.location.reload()
        } catch (err) {
            setError(friendly(err))
            setBusy(false)
        }
    }

    if (owner) return <p className="muted small">This is the owner account, so it cannot be deleted from here.</p>
    if (!open) return <button className="btn danger" onClick={() => setOpen(true)}>Delete my account…</button>
    return (
        <form onSubmit={go} className="card" style={{ padding: 14, boxShadow: 'none', display: 'grid', gap: 8 }}>
            <b>Delete this account for good?</b>
            <p className="muted small" style={{ margin: 0 }}>This erases your cloud data, removes you from your study groups and deletes your login. The data on this device is erased too. Download a backup first if you want to keep anything.</p>
            <label className="field" style={{ marginBottom: 0 }}><span>Your password (leave empty if you sign in with Google)</span>
                <input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} />
            </label>
            {error && <p style={{ color: 'var(--bad)', margin: 0 }} role="alert">{error}</p>}
            <div className="row">
                <button className="btn danger" type="submit" disabled={busy}>{busy ? 'Deleting…' : 'Yes, delete everything'}</button>
                <button className="btn" type="button" onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
            </div>
        </form>
    )
}

/* ---------- sign in / account ---------- */
export function AccountModal({ onClose, onAdmin }) {
    const s = useSyncState()
    const [mode, setMode] = useState('signin')
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const [info, setInfo] = useState('')
    const [armed, setArmed] = useState(false)

    const submit = async e => {
        e.preventDefault()
        setBusy(true)
        setError('')
        setInfo('')
        try {
            if (mode === 'signin') await fb.signIn(email.trim(), password)
            else if (mode === 'signup') await fb.signUp(email.trim(), password)
            else {
                await fb.resetPassword(email.trim())
                setInfo('If that email has an account, a reset link is on its way.')
                return
            }
            onClose()
        } catch (err) {
            setError(friendly(err))
        } finally {
            setBusy(false)
        }
    }

    const google = async () => {
        setBusy(true)
        setError('')
        try {
            await fb.signInGoogle()
            onClose()
        } catch (err) {
            setError(friendly(err))
        } finally {
            setBusy(false)
        }
    }

    const signedIn = Boolean(s.user)
    const [, label] = PHASE[s.phase] || PHASE.loading

    return (
        <div className="modal-back" onMouseDown={e => e.target === e.currentTarget && onClose()}>
            <div className="modal" role="dialog" aria-label="Cloud sync account">
                <h2>{signedIn ? 'Your account' : mode === 'signup' ? 'Create an account' : mode === 'reset' ? 'Reset your password' : 'Sign in to sync'}</h2>

                {signedIn ? (
                    <>
                        <p><b>{s.user.email || s.user.name}</b></p>
                        <p className="muted small">
                            {label}{s.lastSync ? ` · last synced ${new Date(s.lastSync).toLocaleTimeString()}` : ''}
                            {s.message ? ` · ${s.message}` : ''}
                        </p>
                        <p className="muted small">
                            Your data is saved on this device first and copied to the cloud a moment later. It keeps working offline and syncs when you are back online.
                        </p>
                        <div className="row" style={{ margin: '12px 0' }}>
                            <button className="btn primary" onClick={() => syncNow().then(() => notify({ title: 'Sync finished', icon: '☁️' }))}>Sync now</button>
                            <button className="btn" onClick={() => fb.logOut().then(onClose)}>Sign out</button>
                        </div>
                        {fb.isAdmin(s.user) && (
                            <div className="row" style={{ margin: '0 0 12px' }}>
                                <button className="btn" onClick={() => { onClose(); onAdmin && onAdmin() }}>👑 Approve or remove accounts</button>
                            </div>
                        )}
                        <div className="field"><span>Shared or public computer?</span>
                            <button className="btn danger" style={{ whiteSpace: 'normal', textAlign: 'left' }} onClick={() => { if (armed) signOutAndWipe(); else setArmed(true) }}>
                                {armed ? 'Click again to sign out and erase local data' : 'Sign out and remove my data from this device'}
                            </button>
                        </div>
                        <div className="field"><span>Delete account</span><DeleteAccount user={s.user} /></div>
                    </>
                ) : (
                    <form onSubmit={submit}>
                        <p className="muted small" style={{ marginTop: -6 }}>
                            Sign in to keep your data safe in the cloud and use it on your phone and computer. New accounts must be approved by the owner first. Without an account everything stays on this device.
                        </p>
                        <label className="field"><span>Email</span>
                            <input type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} />
                        </label>
                        {mode !== 'reset' && (
                            <label className="field"><span>Password</span>
                                <input type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} required minLength={6} value={password} onChange={e => setPassword(e.target.value)} />
                            </label>
                        )}
                        {error && <p style={{ color: 'var(--bad)' }} role="alert">{error}</p>}
                        {info && <p style={{ color: 'var(--ok)' }} role="status">{info}</p>}
                        <div className="row">
                            <button className="btn primary" type="submit" disabled={busy}>
                                {mode === 'signup' ? 'Create account' : mode === 'reset' ? 'Send reset link' : 'Sign in'}
                            </button>
                            {mode !== 'reset' && <button className="btn" type="button" onClick={google} disabled={busy}>Continue with Google</button>}
                        </div>
                        <div className="row small" style={{ marginTop: 12 }}>
                            {mode !== 'signin' && <button type="button" className="btn sm ghost" onClick={() => { setMode('signin'); setError(''); setInfo('') }}>I have an account</button>}
                            {mode !== 'signup' && <button type="button" className="btn sm ghost" onClick={() => { setMode('signup'); setError(''); setInfo('') }}>Create an account</button>}
                            {mode !== 'reset' && <button type="button" className="btn sm ghost" onClick={() => { setMode('reset'); setError(''); setInfo('') }}>Forgot password</button>}
                        </div>
                    </form>
                )}

                <div className="row" style={{ marginTop: 14 }}><span className="grow" /><button className="btn" onClick={onClose}>Close</button></div>
            </div>
        </div>
    )
}

/* ---------- the "which copy wins?" question ---------- */
function ChooseModal() {
    const s = useSyncState()
    const c = s.choose
    if (!c) return null
    const names = keys => (keys.length ? keys.map(k => LABELS[k] || k).join(', ') : 'nothing')
    return (
        <div className="modal-back">
            <div className="modal" role="alertdialog" aria-label="Choose which data to keep">
                <h2>Which data should win?</h2>
                <p>
                    {c.foreign
                        ? 'This device still holds data from a different account.'
                        : 'This device already has data, and this account already has data in the cloud.'}
                </p>
                <ul style={{ paddingLeft: 18 }}>
                    <li><b>In the cloud:</b> {names(c.remoteKeys)}</li>
                    <li><b>On this device:</b> {names(c.localKeys)}</li>
                </ul>
                <p className="muted small">Pick one. The other copy is replaced, so download a backup of this device first if you are unsure.</p>
                <div className="row" style={{ margin: '10px 0' }}>
                    <button className="btn" onClick={downloadBackup}>Download a backup of this device</button>
                </div>
                <div className="row">
                    <button className="btn primary" onClick={() => resolveChoice('cloud')}>Use the cloud data</button>
                    <button className="btn danger" onClick={() => resolveChoice('device')}>Upload this device's data</button>
                </div>
                <div className="row" style={{ marginTop: 12 }}>
                    <button className="btn sm ghost" onClick={() => fb.logOut()}>Cancel and sign out</button>
                </div>
            </div>
        </div>
    )
}

/* ---------- mounted once: starts the sync engine and shows its questions ---------- */
export function CloudSync() {
    const s = useSyncState()
    useEffect(() => { startSync() }, [])
    return (
        <>
            {s.phase === 'choose' && <ChooseModal />}
        </>
    )
}
