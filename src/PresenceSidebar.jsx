import { STUDY_DEFAULT, hms, useNow, useStore } from './shared'
import { cheer, presenceOf, useLive } from './live'

/* What it does: the right-hand panel of the Study Group page. For every group you joined it shows who is
   studying (with a live timer), who is online and who is offline, and lets you nudge or cheer a friend.
   Parent: StudyGroup (rendered next to the main column). Children: none.
   When to use it: only on the Study Group page; the data comes from the live layer, so it is always current. */

const ORDER = { studying: 0, paused: 1, online: 2, offline: 3 }
const LABEL = { studying: '📖 studying', paused: '⏸ paused', online: '🟢 online', offline: '⚫ offline' }

const ago = ms => {
    const m = Math.round((Date.now() - ms) / 60000)
    if (!ms) return 'a while ago'
    if (m < 2) return 'just now'
    if (m < 60) return `${m}m ago`
    const h = Math.round(m / 60)
    return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`
}

function Row({ gid, m, p, me, now }) {
    const text = p.state === 'studying' ? `${LABEL.studying} · ${hms(now - m.studying)}` : p.state === 'paused' ? `${LABEL.paused} · ${hms(m.paused)}` : p.state === 'online' ? LABEL.online : `${LABEL.offline} · ${ago(p.last)}`
    const photo = m.profile && m.profile.photo
    return (
        <li className={'pv-row ' + p.state}>
            <span className="pv-av" aria-hidden="true">{photo ? <img src={photo} alt="" /> : (m.name || '?').slice(0, 1).toUpperCase()}<i /></span>
            <div className="grow">
                <b>{m.name || '?'}{me ? ' (you)' : ''}</b>
                <small className="muted">{text}</small>
            </div>
            {!me && p.state !== 'studying' && <button className="btn sm" title={`Remind ${m.name} to study`} onClick={() => cheer(gid, m.uid, 'nudge')}>👉 Nudge</button>}
            {!me && p.state === 'studying' && <button className="icon-btn" title={`Cheer ${m.name}`} aria-label={`Cheer ${m.name}`} onClick={() => cheer(gid, m.uid, 'muscle')}>💪</button>}
        </li>
    )
}

export default function PresenceSidebar({ uid, activeId }) {
    const [s] = useStore('studygroup', STUDY_DEFAULT)
    const live = useLive()
    const now = useNow(1000).getTime()
    if (!s.groups.length) return null

    return (
        <aside className="pv-side" aria-label="Who is online">
            <style>{CSS}</style>
            <h3>Who is online</h3>
            {s.groups.map(g => {
                const list = (live.members[g.id] || []).map(m => ({ m, p: presenceOf(m, now) })).sort((a, b) => ORDER[a.p.state] - ORDER[b.p.state] || (a.m.name || '').localeCompare(b.m.name || ''))
                const on = list.filter(x => x.p.state !== 'offline').length
                const studying = list.filter(x => x.p.state === 'studying').length
                return (
                    <details key={g.id} open={g.id === activeId || s.groups.length === 1} className="pv-group">
                        <summary><b>👥 {g.name}</b><small className="muted">{live.members[g.id] ? `${studying} studying · ${on} online · ${list.length - on} offline` : 'loading…'}</small></summary>
                        <ul>{list.map(x => <Row key={x.m.uid} gid={g.id} m={x.m} p={x.p} me={x.m.uid === uid} now={now} />)}</ul>
                    </details>
                )
            })}
        </aside>
    )
}

const CSS = `
.pv-side{width:290px;flex:none;position:sticky;top:76px;max-height:calc(100vh - 96px);overflow:auto;display:grid;gap:10px;padding:14px;border:1px solid var(--ln);border-radius:14px;background:var(--sf);scrollbar-width:thin}
.pv-side h3{margin:0;font-size:15px}
.pv-group summary{cursor:pointer;display:grid;gap:2px;padding:4px 0}
.pv-group ul{list-style:none;margin:6px 0 0;padding:0;display:grid;gap:6px}
.pv-row{display:flex;gap:10px;align-items:center;padding:6px 8px;border-radius:10px;background:var(--sf2)}
.pv-row small{display:block}
.pv-row.offline{opacity:.72}
.pv-av{position:relative;width:34px;height:34px;border-radius:50%;background:var(--ln);display:grid;place-items:center;font:700 14px var(--head);flex:none}
.pv-av img{width:100%;height:100%;border-radius:50%;object-fit:cover}
.pv-av i{position:absolute;right:-1px;bottom:-1px;width:11px;height:11px;border-radius:50%;border:2px solid var(--sf2);background:#7b8294}
.pv-row.studying .pv-av i{background:var(--ok,#3ddc97)}.pv-row.online .pv-av i{background:#4cc9f0}.pv-row.paused .pv-av i{background:#ffb454}
@media (max-width:1100px){.pv-side{width:auto;position:static;max-height:none}}
`
