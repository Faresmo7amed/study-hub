import { useEffect, useState } from 'react'
import * as fb from './firebase'
import { recheckAccess, useSyncState } from './sync'
import { useStore } from './shared'
import { friendly } from './authErrors'

/* ============================================================
   The front door of the app.
   - Firebase not set up      -> no gate, the app works on this device only (like before)
   - signed out               -> login / sign-up page
   - signed in, not approved  -> "waiting for approval" page (the owner approves in the Admin panel)
   - signed in and approved   -> the app
   Set ALLOW_LOCAL to false to remove the "continue without an account" link.
   ============================================================ */
const ALLOW_LOCAL = true

const Brand = () => (
    <div className="ag-brand">
        <span className="app-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="26" height="26"><path d="M5 19c0-6 4-5 7-8s1-6 7-6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /><circle cx="5" cy="19" r="2" fill="currentColor" /><circle cx="19" cy="5" r="2" fill="currentColor" /></svg>
        </span>
        <span>Study Hub</span>
    </div>
)

function Shell({ children }) {
    return (
        <div className="ag">
            <style>{CSS}</style>
            <main className="ag-card card">
                <Brand />
                {children}
            </main>
        </div>
    )
}

function LoginPage({ onLocal }) {
    const [mode, setMode] = useState('signin')
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const [info, setInfo] = useState('')

    const switchTo = m => { setMode(m); setError(''); setInfo('') }

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
            }
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
        } catch (err) {
            setError(friendly(err))
        } finally {
            setBusy(false)
        }
    }

    return (
        <Shell>
            <h1 className="ag-h">{mode === 'signup' ? 'Create an account' : mode === 'reset' ? 'Reset your password' : 'Welcome back'}</h1>
            <p className="muted ag-sub">
                {mode === 'signup'
                    ? 'New accounts need approval from the owner of this app before they can use it.'
                    : mode === 'reset' ? 'We will email you a link to choose a new password.' : 'Sign in to open your study hub on any device.'}
            </p>
            <form onSubmit={submit} className="ag-form">
                <label className="field"><span>Email</span>
                    <input type="email" autoComplete="email" required autoFocus value={email} onChange={e => setEmail(e.target.value)} />
                </label>
                {mode !== 'reset' && (
                    <label className="field"><span>Password</span>
                        <input type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} required minLength={6} value={password} onChange={e => setPassword(e.target.value)} />
                    </label>
                )}
                {error && <p className="ag-msg bad" role="alert">{error}</p>}
                {info && <p className="ag-msg ok" role="status">{info}</p>}
                <button className="btn primary ag-wide" type="submit" disabled={busy}>
                    {busy ? 'Please wait…' : mode === 'signup' ? 'Request an account' : mode === 'reset' ? 'Send reset link' : 'Sign in'}
                </button>
                {mode !== 'reset' && <button className="btn ag-wide" type="button" onClick={google} disabled={busy}>Continue with Google</button>}
            </form>
            <div className="ag-links">
                {mode !== 'signin' && <button type="button" className="btn sm ghost" onClick={() => switchTo('signin')}>I have an account</button>}
                {mode !== 'signup' && <button type="button" className="btn sm ghost" onClick={() => switchTo('signup')}>Create an account</button>}
                {mode === 'signin' && <button type="button" className="btn sm ghost" onClick={() => switchTo('reset')}>Forgot password</button>}
            </div>
            {ALLOW_LOCAL && (
                <p className="ag-local">
                    <button type="button" className="btn sm ghost" onClick={onLocal}>Continue without an account</button>
                    <span className="muted small">Your data stays on this device only.</span>
                </p>
            )}
        </Shell>
    )
}

function WaitingPage({ denied }) {
    const s = useSyncState()
    const [busy, setBusy] = useState(false)

    // Check again by itself every 20 seconds, so the page opens as soon as the owner approves
    useEffect(() => {
        if (denied) return undefined
        const id = setInterval(() => { recheckAccess() }, 20000)
        return () => clearInterval(id)
    }, [denied])

    const again = async () => {
        setBusy(true)
        await recheckAccess()
        setBusy(false)
    }

    return (
        <Shell>
            <h1 className="ag-h">{denied ? 'Request declined' : 'Waiting for approval'}</h1>
            <p className="muted ag-sub">
                {denied
                    ? 'The owner did not approve this account. If you think this is a mistake, contact them directly.'
                    : 'Your request was sent. You will be able to use Study Hub as soon as the owner approves it. This page checks by itself.'}
            </p>
            <p className="ag-who"><b>{(s.user && (s.user.email || s.user.name)) || 'Your account'}</b></p>
            <div className="ag-links">
                {!denied && <button className="btn primary" onClick={again} disabled={busy}>{busy ? 'Checking…' : 'Check again'}</button>}
                <button className="btn" onClick={() => fb.logOut()}>Sign out</button>
            </div>
        </Shell>
    )
}

function Splash({ text = 'Opening Study Hub…' }) {
    const [slow, setSlow] = useState(false)
    useEffect(() => {
        const id = setTimeout(() => setSlow(true), 8000)
        return () => clearTimeout(id)
    }, [])
    return (
        <Shell>
            <p className="muted ag-sub" role="status">{text}</p>
            {slow && <p className="muted small">This is taking a while. Check your connection, or reload the page.</p>}
        </Shell>
    )
}

// Wrap the whole app with this. children is shown only when the visitor may see the app.
export default function AuthGate({ children }) {
    const s = useSyncState()
    const [meta, , updateMeta] = useStore('meta', {})

    if (s.phase === 'off') return children
    if (s.phase === 'loading') return <Splash />
    if (!s.user) {
        if (ALLOW_LOCAL && meta.localOnly) return children
        return <LoginPage onLocal={() => updateMeta(d => { d.localOnly = true })} />
    }
    if (s.access === 'denied') return <WaitingPage denied />
    if (s.access === 'pending') return <WaitingPage />
    if (s.access === 'approved') return children
    // Still checking. Someone who was approved on this device before can keep working offline.
    if (meta.approvedUid === s.user.uid) return children
    return <Splash text="Checking your account…" />
}

const CSS = `
.ag{min-height:100vh;min-height:100dvh;display:grid;place-items:center;padding:20px;background:radial-gradient(circle at 15% 10%,color-mix(in srgb,var(--ac) 18%,transparent),transparent 45%),radial-gradient(circle at 90% 90%,color-mix(in srgb,var(--ok) 12%,transparent),transparent 45%),var(--bg)}
.ag-card{width:min(420px,100%);padding:28px 26px;display:grid;gap:6px;animation:rise .35s both}
.ag-brand{display:flex;align-items:center;gap:12px;font:700 22px var(--head);margin-bottom:10px}
.ag-h{font-size:26px}
.ag-sub{margin:0 0 8px}
.ag-form{display:grid;gap:10px;margin-top:6px}
.ag-form .field{margin-bottom:0}
.ag-wide{width:100%;padding:10px 14px}
.ag-msg{margin:0;font-size:14px}.ag-msg.bad{color:var(--bad)}.ag-msg.ok{color:var(--ok)}
.ag-links{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}
.ag-local{display:grid;gap:2px;margin:14px 0 0;padding-top:12px;border-top:1px solid var(--ln);justify-items:start}
.ag-who{margin:4px 0 0;padding:10px 12px;border-radius:10px;background:var(--sf2);border:1px solid var(--ln);overflow-wrap:anywhere}
@media(max-width:480px){.ag{padding:12px}.ag-card{padding:22px 18px}}
`
