import { useCallback, useEffect, useRef, useState } from 'react'
import * as fb from './firebase'
import { SYNC_KEYS, notify, systemNotify } from './shared'
import { friendly } from './authErrors'
import { play } from './sound'
import { useSyncState } from './sync'

/* ============================================================
   Owner tools. Only the account whose id is VITE_ADMIN_UID (and written in firestore.rules) sees this,
   and the rules refuse these actions for anybody else even if this screen were opened by hand.
   ============================================================ */

const when = ms => (ms ? new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '')

// Mounted once in App. Tells the owner when somebody asks for an account.
export function AdminWatcher({ onOpen }) {
    const { user, access } = useSyncState()
    const seen = useRef(null)
    const owner = fb.isAdmin(user) && access === 'approved'

    useEffect(() => {
        if (!owner) return undefined
        let stop = false
        const check = async () => {
            try {
                const list = (await fb.listRequests()).filter(r => r.status === 'pending')
                if (stop) return
                const ids = new Set(list.map(r => r.uid))
                if (seen.current) {
                    const fresh = list.filter(r => !seen.current.has(r.uid))
                    if (fresh.length) {
                        const names = fresh.map(r => r.email || r.uid).join(', ')
                        notify({ title: 'New account request', body: names, icon: '👤', sticky: true, actions: [{ label: 'Review', onClick: onOpen }] })
                        play('reminder')
                        systemNotify('New account request', names, { tag: 'admin-request', sticky: true })
                    }
                }
                seen.current = ids
            } catch { /* offline or rules not published yet: try again later */ }
        }
        check()
        const id = setInterval(check, 60000)
        return () => { stop = true; clearInterval(id) }
    }, [owner, onOpen])

    return null
}

export function AdminModal({ onClose }) {
    const { user } = useSyncState()
    const [requests, setRequests] = useState([])
    const [approved, setApproved] = useState([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [busy, setBusy] = useState('')
    const [armed, setArmed] = useState('')

    const load = useCallback(async () => {
        setError('')
        try {
            const [r, a] = await Promise.all([fb.listRequests(), fb.listApproved()])
            setRequests(r)
            setApproved(a)
        } catch (e) {
            setError(friendly(e))
        } finally {
            setLoading(false)
        }
    }, [])
    useEffect(() => { load() }, [load])

    const run = async (id, fn, ok) => {
        setBusy(id)
        setError('')
        try {
            await fn()
            play('save')
            notify({ title: ok, icon: '✅' })
            await load()
        } catch (e) {
            setError(friendly(e))
        } finally {
            setBusy('')
            setArmed('')
        }
    }

    const pending = requests.filter(r => r.status !== 'denied')
    const denied = requests.filter(r => r.status === 'denied')

    if (!fb.isAdmin(user)) return null
    return (
        <div className="modal-back" onMouseDown={e => e.target === e.currentTarget && onClose()}>
            <div className="modal" style={{ width: 'min(620px,100%)' }} role="dialog" aria-label="Accounts">
                <h2>👑 Accounts</h2>
                <p className="muted small" style={{ marginTop: -6 }}>Only accounts you approve can use the app. Everyone else sees a waiting page.</p>
                {error && <p style={{ color: 'var(--bad)' }} role="alert">{error}</p>}
                {loading && <p className="muted">Loading…</p>}

                <h3 className="ad-h">Waiting for approval · {pending.length}</h3>
                {!loading && !pending.length && <p className="muted small">No new requests.</p>}
                <ul className="ad-list">
                    {pending.map(r => (
                        <li key={r.uid}>
                            <div className="grow"><b>{r.email || r.name || r.uid}</b><span className="muted small">Asked {when(r.at)}</span></div>
                            <button className="btn sm primary" disabled={busy === r.uid} onClick={() => run(r.uid, () => fb.approveUser(r.uid, r.email), 'Account approved')}>Approve</button>
                            <button className="btn sm danger" disabled={busy === r.uid} onClick={() => run(r.uid, () => fb.denyUser(r.uid, r.email), 'Request declined')}>Decline</button>
                        </li>
                    ))}
                </ul>

                <h3 className="ad-h">Approved accounts · {approved.length}</h3>
                <ul className="ad-list">
                    {approved.map(a => {
                        const me = a.uid === user.uid
                        return (
                            <li key={a.uid}>
                                <div className="grow"><b>{a.email || a.uid}{me ? ' (you)' : ''}</b><span className="muted small">Since {when(a.at)}{a.by === 'legacy' ? ' · existing account' : ''}</span></div>
                                {!me && (
                                    <button className="btn sm danger" disabled={busy === a.uid}
                                        onClick={() => (armed === a.uid
                                            ? run(a.uid, () => fb.removeUser(a.uid, a.email, SYNC_KEYS), 'Account removed')
                                            : setArmed(a.uid))}>
                                        {armed === a.uid ? 'Click again: erase their data' : 'Remove'}
                                    </button>
                                )}
                            </li>
                        )
                    })}
                </ul>

                {denied.length > 0 && (
                    <>
                        <h3 className="ad-h">Declined or removed · {denied.length}</h3>
                        <ul className="ad-list">
                            {denied.map(r => (
                                <li key={r.uid}>
                                    <div className="grow"><b>{r.email || r.uid}</b><span className="muted small">{when(r.at)}</span></div>
                                    <button className="btn sm" disabled={busy === r.uid} onClick={() => run(r.uid, () => fb.approveUser(r.uid, r.email), 'Account approved')}>Approve anyway</button>
                                    <button className="btn sm ghost" disabled={busy === r.uid} onClick={() => run(r.uid, () => fb.forgetRequest(r.uid), 'Entry cleared')}>Clear</button>
                                </li>
                            ))}
                        </ul>
                    </>
                )}

                <p className="muted small" style={{ marginTop: 14 }}>
                    Removing an account erases its cloud data and blocks it. The sign-in record itself stays until you delete it in the Firebase console under Authentication, Users.
                </p>
                <div className="row" style={{ marginTop: 12 }}>
                    <button className="btn" onClick={load}>Refresh</button>
                    <span className="grow" />
                    <button className="btn" onClick={onClose}>Close</button>
                </div>
                <style>{`.ad-h{font-size:16px;margin:16px 0 8px}.ad-list{list-style:none;margin:0;padding:0;display:grid;gap:6px}.ad-list li{display:flex;gap:8px;align-items:center;padding:8px 10px;border-radius:10px;background:var(--sf2);border:1px solid var(--ln)}.ad-list .grow{display:grid;min-width:0;overflow-wrap:anywhere}.ad-list .btn{flex:none;white-space:normal}`}</style>
            </div>
        </div>
    )
}
