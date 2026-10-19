import { useEffect, useMemo, useRef, useState } from 'react'
import { MONTHS, STUDY_DEFAULT, addDays, iso, parseISO, todayISO, useStore, weekStart } from './shared'

/* ============================================================
   Activity graph (like GitHub contributions)
   - one square per day, weeks run Saturday to Friday, like the rest of the app
   - HeatGrid draws any { "YYYY-MM-DD": number } map, so a friend's study minutes can use it too
   - Contributions (default export) is the dashboard card: todos + focus sessions + study time
   ============================================================ */

const ROWS = ['', 'Sun', '', 'Tue', '', 'Thu', '']
const SCORE_STEPS = [1, 2, 4, 7] // score needed for levels 1 to 4 on the dashboard graph
const levelOf = (v, t) => (v < t[0] ? 0 : v < t[1] ? 1 : v < t[2] ? 2 : v < t[3] ? 3 : 4)
const longDay = k => parseISO(k).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })

// What it does: draws the grid of squares for a map of counts per day.
// When to use it: anywhere you have "a number per day". thresholds sets where each green level starts.
export function HeatGrid({ counts, weeks = 53, thresholds = SCORE_STEPS, unit = 'contribution', picked = '', onPick }) {
    const scroll = useRef(null)
    const today = todayISO()
    const cols = useMemo(() => {
        const start = addDays(weekStart(), -(weeks - 1) * 7)
        return Array.from({ length: weeks }, (_, w) => Array.from({ length: 7 }, (_, d) => iso(addDays(start, w * 7 + d))))
    }, [weeks, today]) // eslint-disable-line react-hooks/exhaustive-deps

    // On narrow screens start scrolled to the newest week
    useEffect(() => {
        if (scroll.current) scroll.current.scrollLeft = scroll.current.scrollWidth
    }, [weeks])

    const month = w => {
        const m = parseISO(cols[w][0]).getMonth()
        return w === 0 || m !== parseISO(cols[w - 1][0]).getMonth() ? MONTHS[m].slice(0, 3) : ''
    }

    return (
        <div className="hm-scroll" ref={scroll}>
            <style>{CSS}</style>
            <div className="hm">
                <div className="hm-months">{cols.map((_, w) => <span key={w}>{month(w)}</span>)}</div>
                <div className="hm-body">
                    <div className="hm-days">{ROWS.map((r, i) => <span key={i}>{r}</span>)}</div>
                    <div className="hm-grid" role="grid" aria-label="Activity graph">
                        {cols.map((c, w) => c.map(k => {
                            const v = counts[k] || 0
                            const label = `${v} ${unit}${v === 1 ? '' : 's'}`
                            return (
                                <button key={k} type="button" role="gridcell" disabled={k > today} style={{ '--c': w }}
                                    className={`hm-cell hm-i${levelOf(v, thresholds)}` + (k > today ? ' fut' : '') + (k === today ? ' now' : '') + (k === picked ? ' sel' : '')}
                                    title={`${label} · ${longDay(k)}`} aria-label={`${label} on ${longDay(k)}`}
                                    onClick={() => onPick && onPick(k === picked ? '' : k)} />
                            )
                        }))}
                    </div>
                </div>
            </div>
        </div>
    )
}

export const HeatLegend = () => (
    <span className="hm-legend">Less {[0, 1, 2, 3, 4].map(l => <i key={l} className={'hm-cell hm-i' + l} />)} More</span>
)

// Current and best run of days that have a number above zero
function runsOf(counts, today) {
    const ok = k => (counts[k] || 0) > 0
    let cursor = parseISO(today)
    if (!ok(iso(cursor))) cursor = addDays(cursor, -1) // today can still be saved
    let current = 0
    while (ok(iso(cursor))) {
        current += 1
        cursor = addDays(cursor, -1)
    }
    let best = 0
    let run = 0
    Object.keys(counts).filter(ok).sort().forEach(k => {
        run = ok(iso(addDays(parseISO(k), -1))) ? run + 1 : 1
        best = Math.max(best, run)
    })
    return { current, best: Math.max(best, current) }
}

// Parent: Dashboard. Child: HeatGrid. One point per finished todo, per focus session,
// and per 30 minutes (rounded up) of study time. Click a square to see that day in detail.
export default function Contributions() {
    const [activity] = useStore('activity', {})
    const [focus] = useStore('focus', {})
    const [study] = useStore('studygroup', STUDY_DEFAULT)
    const [settings] = useStore('settings', { dailyGoal: 3 })
    const [picked, setPicked] = useState('')
    const today = todayISO()
    const first = iso(addDays(weekStart(), -52 * 7))

    const counts = useMemo(() => {
        const out = {}
        const add = (k, n) => { if (n > 0) out[k] = (out[k] || 0) + n }
        Object.entries(activity).forEach(([k, n]) => add(k, n))
        Object.entries(focus).forEach(([k, n]) => add(k, n))
        Object.entries(study.days || {}).forEach(([k, m]) => add(k, Math.ceil(m / 30)))
        return out
    }, [activity, focus, study.days])

    const stats = useMemo(() => {
        const inRange = Object.entries(counts).filter(([k]) => k >= first && k <= today)
        return { total: inRange.reduce((n, [, v]) => n + v, 0), days: inRange.length, ...runsOf(counts, today) }
    }, [counts, first, today])

    if (settings.heatmap === false) return null
    const mins = (study.days || {})[picked] || 0

    return (
        <section className="card hmc" aria-label="Study activity">
            <div className="hmc-head">
                <h2>Study activity</h2>
                <span className="muted small">{stats.total} contributions in the last year</span>
            </div>
            <HeatGrid counts={counts} picked={picked} onPick={setPicked} />
            <div className="hmc-foot">
                <span className="hmc-stats">
                    <span><b>{stats.days}</b> days studied</span>
                    <span><b>{stats.current}</b> day streak</span>
                    <span><b>{stats.best}</b> best streak</span>
                </span>
                <HeatLegend />
            </div>
            <p className="muted small hmc-pick" aria-live="polite">
                {picked
                    ? `${longDay(picked)}: ${activity[picked] || 0} todos done · ${focus[picked] || 0} focus sessions · ${mins} min studied`
                    : 'Click a square to see that day. Finished todos, focus sessions and study time all count.'}
            </p>
        </section>
    )
}

const CSS = `
.hm-scroll{overflow-x:auto;padding:2px 0 6px;scrollbar-width:thin}
.hm{--cell:12px;width:max-content}
.hm-months,.hm-grid{display:grid;grid-auto-flow:column;grid-auto-columns:var(--cell);gap:3px}
.hm-months{margin:0 0 4px 30px;font-size:11px;color:var(--mu);height:14px}
.hm-months span{white-space:nowrap;overflow:visible}
.hm-body{display:flex;gap:6px}
.hm-days{display:grid;grid-template-rows:repeat(7,var(--cell));gap:3px;width:24px;font-size:10px;color:var(--mu);line-height:var(--cell)}
.hm-grid{grid-template-rows:repeat(7,var(--cell))}
.hm-cell{display:block;width:var(--cell);height:var(--cell);padding:0;border-radius:3px;border:1px solid transparent;cursor:pointer}
.hm-grid .hm-cell{animation:hmpop .4s both;animation-delay:calc(var(--c) * 9ms);transition:transform .12s}
.hm-i0{background:var(--sf2);border-color:var(--ln)}
.hm-i1{background:color-mix(in srgb,var(--ok) 30%,var(--sf2))}
.hm-i2{background:color-mix(in srgb,var(--ok) 55%,var(--sf2))}
.hm-i3{background:color-mix(in srgb,var(--ok) 80%,var(--sf2))}
.hm-i4{background:var(--ok);box-shadow:0 0 6px color-mix(in srgb,var(--ok) 55%,transparent)}
.hm-cell.fut{visibility:hidden}
.hm-cell.now{outline:2px solid var(--ac);outline-offset:1px}
.hm-cell.sel{outline:2px solid var(--tx);outline-offset:1px}
.hm-grid .hm-cell:hover:not(:disabled){transform:scale(1.35);position:relative;z-index:1}
.hm-legend{display:inline-flex;align-items:center;gap:3px;font-size:12px;color:var(--mu)}
.hm-legend .hm-cell{cursor:default;width:11px;height:11px}
.hmc{padding:20px;display:grid;gap:10px}
.hmc-head{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap}.hmc-head h2{font-size:22px}
.hmc-foot{display:flex;justify-content:space-between;gap:10px 20px;flex-wrap:wrap;align-items:center}
.hmc-stats{display:flex;gap:6px 18px;flex-wrap:wrap;font-size:13px;color:var(--mu)}.hmc-stats b{color:var(--tx);font-size:15px}
.hmc-pick{margin:0;min-height:20px}
@keyframes hmpop{from{opacity:0;transform:scale(.4)}to{opacity:1;transform:none}}
@media(max-width:640px){.hm{--cell:11px}.hmc{padding:14px}}
`
