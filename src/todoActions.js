import { TYPES, addDays, computeStats, confetti, dayIndex, emptyWeek, getStore, iso, notify, reward, setStore, todayISO, uid, weekStart } from './shared'
import { play } from './sound'

export function toggleTodo(key, day, id, el) {
    const week = getStore('todos', {})[key]
    const todo = week && week[day].find(t => t.id === id)
    if (!todo) return
    const nowDone = !todo.done
    const today = todayISO()
    const doneBefore = getStore('activity', {})[today] || 0
    const focusToday = getStore('focus', {})[today] || 0
    setStore('todos', cur => ({
        ...cur,
        [key]: cur[key].map((list, i) => (i !== day ? list : list.map(t => (t.id !== id ? t : { ...t, done: nowDone, doneOn: nowDone ? today : null })))),
    }), {})
    setStore('activity', cur => {
        const next = { ...cur }
        if (nowDone) next[today] = (next[today] || 0) + 1
        else if (todo.doneOn) next[todo.doneOn] = Math.max(0, (next[todo.doneOn] || 1) - 1)
        return next
    }, {})
    if (nowDone && el) {
        const r = el.getBoundingClientRect()
        confetti(r.left + r.width / 2, r.top + r.height / 2)
    }

    // One sound per action, the most special one wins: a new streak day, the daily goal, a finished day, a big item, then a plain check
    if (!nowDone) {
        play('uncheck')
        return
    }
    const xp = (TYPES[todo.type] || TYPES.task).xp
    const goal = getStore('settings', { dailyGoal: 3 }).dailyGoal || 3
    const dayList = getStore('todos', {})[key][day]
    const firstOfDay = doneBefore === 0 && focusToday === 0
    const reachedGoal = doneBefore + 1 === goal
    if (firstOfDay) {
        const streak = computeStats(getStore('todos', {}), getStore('activity', {}), getStore('focus', {})).streak
        notify({ title: streak > 1 ? `${streak}-day streak` : 'Streak started', body: streak > 1 ? 'Keep the chain going.' : 'Come back tomorrow to make it two.', icon: '🔥' })
        play('streak')
    } else if (reachedGoal) {
        play('goal')
    } else if (dayList.every(t => t.done)) {
        play('complete')
        reward({ icon: '🏁', title: 'Day cleared', body: 'Every todo of the day is done.', kind: 'goal' })
    } else if (['project', 'course', 'book'].includes(todo.type)) {
        play('complete')
    } else {
        play('check')
    }
    if (reachedGoal) reward({ icon: '🎯', title: 'Daily goal reached', body: `${goal} todos done today.`, kind: 'goal' })
    else if (!dayList.every(t => t.done)) reward({ icon: '✅', title: `+${xp} XP`, body: todo.text.slice(0, 40), kind: 'task' })
}

// Move yesterday's unfinished todos to today (they move, they are not copied). Handles the week boundary.
export function carryYesterday() {
    const now = new Date()
    const y = addDays(now, -1)
    const yKey = iso(weekStart(y))
    const yDay = dayIndex(y)
    const tKey = iso(weekStart(now))
    const tDay = dayIndex(now)
    const open = ((getStore('todos', {})[yKey] || emptyWeek())[yDay] || []).filter(t => !t.done)
    if (!open.length) return 0
    const ids = new Set(open.map(t => t.id))
    setStore('todos', cur => {
        const next = { ...cur }
        next[yKey] = (next[yKey] || emptyWeek()).map((list, i) => (i === yDay ? list.filter(t => !ids.has(t.id)) : list))
        const week = (next[tKey] || emptyWeek()).map(list => [...list])
        open.forEach(t => week[tDay].push({ ...t, id: uid() }))
        next[tKey] = week
        return next
    }, {})
    return open.length
}
export const EVENT_COLORS = ['#7c6cff', '#3ddc97', '#ffb454', '#ff6b8b', '#4cc9f0', '#a3a3b8']

// Delete an event, forget its reminders, and offer Undo for a few seconds
export function removeEvent(ev) {
    const original = getStore('events', []).find(x => x.id === ev.id)
    if (!original) return
    setStore('events', cur => cur.filter(x => x.id !== ev.id), [])
    setStore('fired', cur => Object.fromEntries(Object.entries(cur).filter(([k]) => !k.startsWith(ev.id + '|'))), {})
    play('delete')
    notify({
        title: 'Event deleted',
        body: original.title || 'Untitled event',
        icon: '🗑️',
        actions: [{
            label: 'Undo',
            onClick: () => {
                setStore('events', cur => (cur.some(x => x.id === original.id) ? cur : [...cur, original]), [])
                play('undo')
            },
        }],
    })
}
