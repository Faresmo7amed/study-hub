import { STUDY_DEFAULT, activeDaysIn, addDays, computeStats, dayIndex, fmt12, getStore, iso, pad, quoteOfDay, tierState, todayISO, until, weekStart } from './shared'
import { STREAK_MIN, fmtMin, streakOf } from './StudyGroup'
import { loadRoadmaps, nextUp, roadmapList } from './Roadmap'
import { loadBlocks } from './Database'

/* ============================================================
   Pure helpers that read your data and turn it into short sentences.
   No screens here: WelcomeBrief shows the result, LiveWatcher sends reminders for the closed app.
   ============================================================ */

const at = e => new Date(`${e.date}T${e.time || '00:00'}`).getTime()

// What it does: "Today 6:30 PM", "Tomorrow", "Wed, Nov 5".
const whenLabel = (e, now) => {
    const day = e.date === iso(now) ? 'Today' : e.date === iso(addDays(now, 1)) ? 'Tomorrow' : new Date(`${e.date}T00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
    return `${day}${e.time ? ' ' + fmt12(e.time) : ' · all day'}`
}

// What it does: progress of every table that has a checkbox or a status column ("12 of 30 done").
// When to use it: for the "Database" line of the brief. Tables with fewer than 3 rows are skipped.
function tableProgress() {
    const out = []
    loadBlocks().forEach(b => (b.order || []).forEach(id => {
        const t = b.tables[id]
        if (!t || t.rows.length < 3) return
        const box = t.props.find(p => p.type === 'checkbox')
        const status = t.props.find(p => p.type === 'status')
        const prop = box || status
        if (!prop) return
        const done = t.rows.filter(r => (box ? r.cells[prop.id] === true : r.cells[prop.id] === 'done')).length
        out.push({ name: `${t.icon || ''} ${t.name}`.trim(), done, total: t.rows.length, pct: Math.round((100 * done) / t.rows.length) })
    }))
    return out
}

// What it does: gathers everything the welcome message talks about.
// When to use it: once when the app opens. Friends are added by WelcomeBrief from the live data.
export function buildBrief(now = new Date()) {
    const today = iso(now)
    const study = getStore('studygroup', STUDY_DEFAULT)
    const activity = getStore('activity', {})
    const focus = getStore('focus', {})
    const stats = computeStats(getStore('todos', {}), activity, focus)
    const ym = today.slice(0, 7)
    const month = tierState(activeDaysIn(ym, activity, focus, study.days || {}, STREAK_MIN), ym)
    const studied = (study.days || {})[today] || 0
    const sg = streakOf(study.days || {}, today)

    const week = getStore('todos', {})[iso(weekStart(now))] || []
    const list = week[dayIndex(now)] || []
    const todos = { total: list.length, done: list.filter(t => t.done).length }
    todos.open = todos.total - todos.done

    const upcoming = getStore('events', [])
        .filter(e => !e.done && e.date && (e.time ? at(e) >= now.getTime() : e.date >= today))
        .sort((a, b) => at(a) - at(b))
        .slice(0, 5)
        .map(e => ({ id: e.id, title: e.title || 'Event', when: whenLabel(e, now), in: e.time ? until(at(e) - now.getTime()) : '' }))

    const store = loadRoadmaps()
    const maps = roadmapList(store)
    const nxt = nextUp(store)
    const roadmap = maps.length ? { title: (nxt && nxt.roadmap) || maps[0].title, pct: nxt ? nxt.pct : maps[0].pct, next: nxt ? nxt.title : '' } : null
    const tables = tableProgress().sort((a, b) => b.pct - a.pct).slice(0, 3)

    // One smart sentence, the most useful one first
    const lines = []
    if (studied < STREAK_MIN && sg.streak >= 2) lines.push(`🔥 Your ${sg.streak}-day study streak needs ${STREAK_MIN - studied} more minutes today.`)
    else if (studied >= STREAK_MIN) lines.push(`✅ Today's streak is already secured with ${fmtMin(studied)} of study.`)
    if (month.next && month.left > 0 && month.left <= 3) lines.push(`${month.next.icon} Only ${month.left} active day${month.left > 1 ? 's' : ''} left to become ${month.next.name} this month.`)
    if (roadmap && roadmap.pct >= 60 && roadmap.pct < 100) lines.push(`🗺️ "${roadmap.title}" is ${roadmap.pct}% done${roadmap.next ? `. Next up: ${roadmap.next}.` : '.'}`)
    const close = tables.find(t => t.pct >= 60 && t.pct < 100)
    if (close) lines.push(`🗄️ ${close.name} is ${close.pct}% done (${close.total - close.done} left).`)
    if (!stats.active.has(today) && stats.streak === 0 && stats.best >= 3) lines.push(`🌱 Fresh start. Your best streak was ${stats.best} days, one good day starts the next one.`)
    if (todos.open > 0) lines.push(`📝 ${todos.open} todo${todos.open > 1 ? 's' : ''} still open today.`)
    lines.push(quoteOfDay(now))

    return { today, upcoming, todos, streak: { app: stats.streak, study: sg.streak, best: sg.best, studied }, month, roadmap, tables, lines: lines.slice(0, 3) }
}

// What it does: lists the push messages the Worker should send while the app is closed (next ~3 days).
// When to use it: after anything that changes events, todos or study time. The Worker replaces its old list with this one.
export function buildReminders(now = new Date()) {
    const t = now.getTime()
    const items = []
    const add = (id, when, title, body, tag) => {
        if (when > t + 30000 && items.length < 110) items.push({ id: id.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 60), at: when, title, body, url: '/#/dashboard', tag })
    }
    const horizon = t + 30 * 86400000
    getStore('events', []).forEach(e => {
        if (e.done || !e.date) return
        const title = e.title || 'Event'
        if (e.time) {
            const start = at(e)
            if (start > horizon) return
            const lead = Number(e.remind) || 0
            if (lead > 0) add(`${e.id}_pre_${e.date}`, start - lead * 60000, title, `Starts at ${fmt12(e.time)} (in ${lead} min)`, `${e.id}|${e.date}|${e.time}|pre`)
            add(`${e.id}_at_${e.date}`, start, title, `Starting now (${fmt12(e.time)})`, `${e.id}|${e.date}|${e.time}|at`)
        } else if (e.date <= iso(addDays(now, 3))) {
            add(`${e.id}_day_${e.date}`, new Date(`${e.date}T08:30`).getTime(), `Today: ${title}`, 'All-day event', `${e.id}|${e.date}|day`)
        }
    })

    const study = getStore('studygroup', STUDY_DEFAULT)
    const sg = streakOf(study.days || {}, todayISO())
    const app = computeStats(getStore('todos', {}), getStore('activity', {}), getStore('focus', {})).streak
    const streak = Math.max(sg.streak, app)
    const dailyAt = (getStore('settings', {}).dailyRemind || '').split(':').map(Number)
    for (let d = 0; d < 3; d++) {
        const day = addDays(now, d)
        const date = iso(day)
        if (streak > 0) {
            const left = d === 0 ? STREAK_MIN - ((study.days || {})[date] || 0) : STREAK_MIN
            if (left > 0) add(`streak_${date}`, new Date(`${date}T20:30`).getTime(), `🔥 Keep your ${streak}-day streak`, `Study ${left} minutes today and it stays alive.`, `streak|${date}`)
        }
        if (dailyAt.length === 2 && !dailyAt.some(Number.isNaN)) {
            add(`todos_${date}`, new Date(`${date}T${pad(dailyAt[0])}:${pad(dailyAt[1])}`).getTime(), 'Todo reminder', 'Open Study Hub and check your todos for today.', `daily|${date}`)
        }
    }
    return items
}
