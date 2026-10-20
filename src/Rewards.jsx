import { useEffect, useRef, useState } from 'react'
import { MONTH_TIERS, activeDaysIn, confetti, dayIndex, emptyWeek, getStore, iso, monthKey, notify, onStoreChange, setStore, tierState, uid, weekStart } from './shared'
import { play } from './sound'

/* ============================================================
   App-wide background jobs and the reward cards
   Mounted once (inside StudyPublisher), so it works on every page:
   - shows the game-style reward cards sent with reward() from shared.js
   - unlocks a monthly title when a new tier is reached
   - creates today's recurring todos
   - reminds you to review notes that are due
   ============================================================ */

function checkTitle(studyMin) {
    const ym = monthKey(new Date())
    const count = activeDaysIn(ym, getStore('activity', {}), getStore('focus', {}), (getStore('studygroup', {}) || {}).days || {}, studyMin)
    const st = tierState(count, ym)
    const t = getStore('titles', {})
    const seen = { ...(t.seen || {}) }
    // First run ever: remember where you already are, so old progress does not fire a pile of rewards
    if (!t.init) {
        setStore('titles', { init: true, seen: { [ym]: st.tier } }, {})
        return
    }
    if (st.tier > (seen[ym] || 0)) {
        seen[ym] = st.tier
        setStore('titles', { ...t, seen }, {})
        const tr = MONTH_TIERS[st.tier - 1]
        window.dispatchEvent(new CustomEvent('studyhub:reward', {
            detail: { id: uid(), icon: tr.icon, title: `Title unlocked: ${tr.name}`, body: `${st.count} active days this month.${st.next ? ` ${st.left} more for ${st.next.name}.` : ' You reached the top title!'}`, kind: 'title', color: tr.color },
        }))
        play('streak')
    }
}

function runRecurring() {
    const now = new Date()
    const today = iso(now)
    const day = dayIndex(now)
    const list = getStore('recurring', [])
    const key = iso(weekStart(now))
    const todayList = ((getStore('todos', {})[key] || emptyWeek())[day]) || []
    const due = (Array.isArray(list) ? list : []).filter(r => r.last !== today && (r.days || []).includes(day))
    if (!due.length) return
    setStore('todos', cur => {
        const week = (cur[key] || emptyWeek()).map(l => [...l])
        due.forEach(r => {
            if (todayList.some(t => t.rid === r.id)) return // another device already made it
            week[day].push({ id: uid(), text: r.text, type: r.type || 'task', ...(r.link ? { link: r.link } : {}), rid: r.id, done: false, doneOn: null })
        })
        return { ...cur, [key]: week }
    }, {})
    setStore('recurring', cur => cur.map(r => (due.some(d => d.id === r.id) ? { ...r, last: today } : r)), [])
}

function runReviews() {
    const notes = getStore('notes', null)
    if (!Array.isArray(notes)) return
    const now = Date.now()
    const due = notes.filter(n => n.review && n.review.due <= now && !n.review.notified && !n.trashed)
    if (!due.length) return
    due.forEach(n => notify({ title: 'Time to review', body: n.title || 'Untitled note', icon: '🔁' }))
    setStore('notes', cur => cur.map(n => (due.some(d => d.id === n.id) ? { ...n, review: { ...n.review, notified: true } } : n)), [])
}

export function RewardHost({ studyMin = 30 }) {
    const [queue, setQueue] = useState([])
    const timer = useRef(null)

    useEffect(() => {
        const onReward = e => setQueue(q => [...q, e.detail].slice(-4))
        window.addEventListener('studyhub:reward', onReward)
        return () => window.removeEventListener('studyhub:reward', onReward)
    }, [])

    useEffect(() => {
        let t = setTimeout(() => checkTitle(studyMin), 1500)
        const off = onStoreChange(key => {
            if (key === 'activity' || key === 'focus' || key === 'studygroup') {
                clearTimeout(t)
                t = setTimeout(() => checkTitle(studyMin), 700)
            }
        })
        const jobs = () => { runRecurring(); runReviews() }
        const first = setTimeout(jobs, 2500)
        const every = setInterval(jobs, 60000)
        return () => { clearTimeout(t); clearTimeout(first); clearInterval(every); off() }
    }, [studyMin])

    const head = queue[0]
    useEffect(() => {
        if (!head) return
        if (head.kind === 'title') confetti(window.innerWidth / 2, window.innerHeight / 3)
        timer.current = setTimeout(() => setQueue(q => q.slice(1)), head.kind === 'task' ? 2200 : head.kind === 'title' ? 5200 : 3800)
        return () => clearTimeout(timer.current)
    }, [head && head.id]) // eslint-disable-line react-hooks/exhaustive-deps

    if (!head) return null
    return (
        <div className={'rw rw-' + head.kind} role="status" aria-live="polite" style={head.color ? { '--rc': head.color } : undefined} onClick={() => setQueue(q => q.slice(1))}>
            <style>{CSS}</style>
            <span className="rw-ic" aria-hidden="true">{head.icon}</span>
            <div className="rw-tx">
                <b>{head.title}</b>
                {head.body && <small>{head.body}</small>}
            </div>
        </div>
    )
}

const CSS = `
.rw{position:fixed;z-index:9999;left:50%;display:flex;align-items:center;gap:12px;cursor:pointer;color:var(--tx);background:var(--sf);border:1.5px solid var(--rc,var(--ac));border-radius:14px;box-shadow:0 10px 40px color-mix(in srgb,var(--rc,var(--ac)) 35%,transparent),var(--shadow);max-width:min(92vw,420px)}
.rw-tx{display:grid;gap:2px;min-width:0}.rw-tx small{color:var(--mu)}
.rw-task{bottom:28px;transform:translateX(-50%);padding:8px 14px;animation:rwpop .35s cubic-bezier(.2,1.4,.4,1)}
.rw-task .rw-ic{font-size:20px}
.rw-goal,.rw-title{top:84px;transform:translateX(-50%);padding:14px 20px;animation:rwdrop .5s cubic-bezier(.2,1.3,.4,1)}
.rw-goal .rw-ic,.rw-title .rw-ic{font-size:38px;animation:rwspin .8s ease-out}
.rw-title{padding:18px 26px;background:linear-gradient(135deg,color-mix(in srgb,var(--rc) 22%,var(--sf)),var(--sf))}
.rw-title .rw-ic{font-size:52px;filter:drop-shadow(0 0 12px var(--rc))}.rw-title b{font-size:18px}
@keyframes rwpop{from{opacity:0;transform:translate(-50%,16px) scale(.8)}}
@keyframes rwdrop{from{opacity:0;transform:translate(-50%,-24px) scale(.85)}}
@keyframes rwspin{from{transform:scale(.3) rotate(-30deg)}60%{transform:scale(1.25) rotate(8deg)}}
@media(prefers-reduced-motion:reduce){.rw,.rw .rw-ic{animation:none}}
`

// Create today's recurring todos right now (used after you add a new repeating todo)
export const runRecurringNow = () => runRecurring()
