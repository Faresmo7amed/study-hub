import { useCallback, useEffect, useState } from 'react'
import * as fb from './firebase'
import { notify } from './shared'
import { friendly } from './authErrors'
import { play } from './sound'
import { useSyncState } from './sync'

/* ============================================================
   Give a copy of a roadmap to someone else's account.
   - "Send": makes a code. The other person types it under "Receive a copy" in their own Study Hub.
   - The copy has its own ids, so changing it never changes yours. Links to other roadmaps are removed.
   Props: title (open roadmap), exportMap() -> plain roadmap object, importMap(object, keepProgress) -> new title, onClose
   ============================================================ */
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'
const makeCode = () => Array.from(crypto.getRandomValues(new Uint8Array(10)), b => ALPHABET[b % ALPHABET.length]).join('')
const when = ms => new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

export default function RoadmapShare({ title, exportMap, importMap, onClose }) {
    const { user, access } = useSyncState()
    const ready = Boolean(user) && access === 'approved'
    const [mine, setMine] = useState([])
    const [code, setCode] = useState('')
    const [keep, setKeep] = useState(false)
    const [busy, setBusy] = useState('')
    const [msg, setMsg] = useState('')
    const [error, setError] = useState('')

    const refresh = useCallback(async () => {
        if (!ready) return
        try { setMine(await fb.myRoadmapShares(user.uid)) } catch (e) { setError(friendly(e)) }
    }, [ready, user])
    useEffect(() => { refresh() }, [refresh])

    const send = async () => {
        setBusy('send')
        setError('')
        setMsg('')
        try {
            const data = JSON.stringify(exportMap())
            if (new TextEncoder().encode(data).length > 880000) throw new Error('This roadmap is too big to share as one copy (about 0.9 MB). Remove some content or use Backup and send the file.')
            const c = makeCode()
            const now = Date.now()
            await fb.saveRoadmapShare(c, { owner: user.uid, title: (title || 'Roadmap').slice(0, 80), data, createdAt: now, updatedAt: now })
            play('save')
            setMsg(`Code created: ${c}`)
            await refresh()
        } catch (e) {
            setError(friendly(e))
        } finally {
            setBusy('')
        }
    }

    const copy = async c => {
        try {
            await navigator.clipboard.writeText(c)
            setMsg('Code copied. Send it to the person.')
        } catch {
            setMsg(`Select and copy this code: ${c}`)
        }
    }

    const stop = async c => {
        setBusy(c)
        try {
            await fb.deleteRoadmapShare(c)
            play('delete')
            await refresh()
        } catch (e) {
            setError(friendly(e))
        } finally {
            setBusy('')
        }
    }

    const receive = async e => {
        e.preventDefault()
        const c = code.trim().toLowerCase()
        if (!c) return
        setBusy('recv')
        setError('')
        setMsg('')
        try {
            const doc = await fb.getRoadmapShare(c)
            if (!doc) throw new Error('No roadmap has this code. Check it for typing mistakes, or ask the owner whether they stopped sharing it.')
            const name = importMap(JSON.parse(doc.data), keep)
            play('save')
            notify({ title: 'Roadmap copied to your account', body: name, icon: '📥' })
            onClose()
        } catch (err) {
            setError(friendly(err))
        } finally {
            setBusy('')
        }
    }

    return (
        <div className="modal-back" onMouseDown={e => e.target === e.currentTarget && onClose()}>
            <div className="modal" style={{ width: 'min(560px,100%)' }} role="dialog" aria-label="Share a roadmap">
                <h2>🔗 Share a roadmap</h2>
                {!ready && <p className="muted">Sign in with an approved account to send or receive roadmaps. You can still use Backup to move a roadmap as a file.</p>}
                {error && <p style={{ color: 'var(--bad)' }} role="alert">{error}</p>}
                {msg && <p style={{ color: 'var(--ok)' }} role="status">{msg}</p>}

                <h3 className="rs-h">Send a copy of “{title || 'this roadmap'}”</h3>
                <p className="muted small" style={{ margin: '0 0 8px' }}>They get your topics, subtopics, study content, checklists, resources and projects. Your progress is not sent unless they ask to keep it, and your own copy is never changed.</p>
                <div className="row">
                    <button className="btn primary" disabled={!ready || busy === 'send'} onClick={send}>{busy === 'send' ? 'Creating…' : 'Create a share code'}</button>
                </div>
                {mine.length > 0 && (
                    <ul className="rs-list">
                        {mine.map(m => (
                            <li key={m.code}>
                                <div className="grow"><code className="rs-code">{m.code}</code><span className="muted small">{m.title} · {when(m.updatedAt)}</span></div>
                                <button className="btn sm" onClick={() => copy(m.code)}>Copy</button>
                                <button className="btn sm danger" disabled={busy === m.code} onClick={() => stop(m.code)}>Stop sharing</button>
                            </li>
                        ))}
                    </ul>
                )}

                <h3 className="rs-h">Receive a copy</h3>
                <form className="row" onSubmit={receive}>
                    <input value={code} onChange={e => setCode(e.target.value)} placeholder="Paste the code" aria-label="Share code" maxLength={20} autoCapitalize="none" autoCorrect="off" style={{ flex: '1 1 160px' }} />
                    <button className="btn primary" type="submit" disabled={!ready || !code.trim() || busy === 'recv'}>{busy === 'recv' ? 'Copying…' : 'Add to my roadmaps'}</button>
                </form>
                <label className="row small" style={{ marginTop: 8 }}>
                    <input type="checkbox" checked={keep} onChange={e => setKeep(e.target.checked)} /> Keep the sender’s progress (otherwise everything starts as not done)
                </label>

                <div className="row" style={{ marginTop: 16 }}><span className="grow" /><button className="btn" onClick={onClose}>Close</button></div>
                <style>{'.rs-h{font-size:16px;margin:18px 0 8px}.rs-list{list-style:none;margin:10px 0 0;padding:0;display:grid;gap:6px}.rs-list li{display:flex;gap:8px;align-items:center;padding:8px 10px;border-radius:10px;background:var(--sf2);border:1px solid var(--ln);flex-wrap:wrap}.rs-list .grow{display:grid;min-width:0}.rs-code{font:600 15px ui-monospace,monospace;letter-spacing:.06em}'}</style>
            </div>
        </div>
    )
}
