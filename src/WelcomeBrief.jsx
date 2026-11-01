import { useEffect, useRef, useState } from 'react'
import { STUDY_DEFAULT, getStore, setStore, systemNotify, todayISO } from './shared'
import { useSyncState } from './sync'
import { fmtMin } from './StudyGroup'
import { presenceOf, useLive } from './live'
import { buildBrief } from './brief'

/* What it does: the "good morning" card. The first time you open Study Hub each day it lists your upcoming
   events, today's todos, streaks, your monthly title, roadmap and table progress, who is studying right now,
   and one smart motivational line. It waits until your cloud data and your groups have loaded.
   Parent: App (inside <AuthGate>). Children: none.
   When to use it: mounted once. It shows itself once per day; the day is remembered on this device (key "briefday"). */
export default function WelcomeBrief() {
    const sync = useSyncState()
    const live = useLive()
    const [brief, setBrief] = useState(null)
    const [waited, setWaited] = useState(false)
    const done = useRef(false)
    const ok = Boolean(sync.user) && sync.access === 'approved'
    const loaded = !['loading', 'syncing', 'signedout', 'choose', 'pending'].includes(sync.phase)

    useEffect(() => {
        if (!ok) return undefined
        const id = setTimeout(() => setWaited(true), 6000)
        return () => clearTimeout(id)
    }, [ok])

    useEffect(() => {
        if (!ok || done.current || !((loaded && live.ready) || waited)) return
        done.current = true
        if (getStore('briefday', '') === todayISO()) return
        setStore('briefday', todayISO(), '')
        const b = buildBrief()
        setBrief(b)
        if (document.visibilityState !== 'visible') {
            const first = b.upcoming[0]
            systemNotify('Study Hub', first ? `Next: ${first.title} · ${first.when}` : b.lines[0], { tag: 'welcome-brief' })
        }
    }, [ok, loaded, live.ready, waited])

    useEffect(() => {
        if (!brief) return undefined
        const onKey = e => { if (e.key === 'Escape') setBrief(null) }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [brief])

    if (!brief) return null
    const t = Date.now()
    const me = sync.user.uid
    const groups = getStore('studygroup', STUDY_DEFAULT).groups || []
    const friends = []
    groups.forEach(g => (live.members[g.id] || []).forEach(m => {
        if (m.uid === me || friends.some(f => f.uid === m.uid)) return
        const p = presenceOf(m, t)
        if (p.state === 'studying' || p.state === 'paused' || p.state === 'online') friends.push({ uid: m.uid, name: m.name, state: p.state, min: Math.floor((p.state === 'paused' ? p.ms : p.ms) / 60000) })
    }))
    friends.sort((a, b) => (a.state === 'studying' ? 0 : 1) - (b.state === 'studying' ? 0 : 1))
    const hour = new Date().getHours()
    const greet = hour < 5 ? 'Still up' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
    const name = getStore('studygroup', STUDY_DEFAULT).name
    const close = () => setBrief(null)
    const go = hash => { window.location.hash = hash; close() }

    return (
        <div className="modal-back" onMouseDown={e => e.target === e.currentTarget && close()}>
            <div className="modal wb" role="dialog" aria-label="Your day at a glance">
                <style>{CSS}</style>
                <h2 style={{ margin: 0 }}>{greet}{name ? `, ${name}` : ''} 👋</h2>
                <p className="muted small" style={{ margin: '2px 0 12px' }}>Here is where things stand.</p>

                <section>
                    <h3>📅 Coming up</h3>
                    {brief.upcoming.length === 0 && <p className="muted small">No upcoming events. A quiet day to study.</p>}
                    <ul>{brief.upcoming.map(e => <li key={e.id}><b>{e.title}</b><span>{e.when}{e.in ? ` · ${e.in}` : ''}</span></li>)}</ul>
                </section>

                <section>
                    <h3>🔥 Progress</h3>
                    <ul>
                        <li><b>Today</b><span>{brief.todos.total ? `${brief.todos.done}/${brief.todos.total} todos done` : 'no todos planned'} · {fmtMin(brief.streak.studied)} studied</span></li>
                        <li><b>Streaks</b><span>📚 {brief.streak.study}d study · 🔥 {brief.streak.app}d todos and focus</span></li>
                        <li><b>This month</b><span>{brief.month.cur ? `${brief.month.cur.icon} ${brief.month.cur.name}` : 'no title yet'} · {brief.month.count} active days{brief.month.next ? ` · ${brief.month.left} to ${brief.month.next.icon} ${brief.month.next.name}` : ''}</span></li>
                        {brief.roadmap && <li><b>Roadmap</b><span>{brief.roadmap.title} · {brief.roadmap.pct}%{brief.roadmap.next ? ` · next: ${brief.roadmap.next}` : ''}</span></li>}
                        {brief.tables.map(x => <li key={x.name}><b>{x.name}</b><span>{x.done}/{x.total} done · {x.pct}%</span></li>)}
                    </ul>
                </section>

                {friends.length > 0 && (
                    <section>
                        <h3>👥 Friends right now</h3>
                        <ul>{friends.map(f => <li key={f.uid}><b>{f.name}</b><span>{f.state === 'studying' ? `📖 studying · ${fmtMin(f.min)} so far` : f.state === 'paused' ? `⏸ paused at ${fmtMin(f.min)}` : '🟢 online'}</span></li>)}</ul>
                    </section>
                )}

                <section className="wb-tips">{brief.lines.map(l => <p key={l}>{l}</p>)}</section>

                <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
                    <button className="btn" onClick={() => go('/studygroup')}>Study Group</button>
                    <button className="btn primary" onClick={close} autoFocus>Let's go</button>
                </div>
            </div>
        </div>
    )
}

const CSS = `
.wb{max-width:520px;width:100%;display:grid;gap:12px;max-height:88vh;overflow:auto}
.wb h3{margin:0 0 4px;font-size:14px}
.wb ul{list-style:none;margin:0;padding:0;display:grid;gap:4px}
.wb li{display:flex;gap:10px;justify-content:space-between;flex-wrap:wrap;padding:6px 10px;border-radius:8px;background:var(--sf2);font-size:13px}
.wb li span{color:var(--mu);text-align:right}
.wb-tips p{margin:0 0 6px;font-size:14px}
`
