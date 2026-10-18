import { computeStats, confetti, getStore, notify, setStore, todayISO } from './shared'
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
    } else if (['project', 'course', 'book'].includes(todo.type)) {
        play('complete')
    } else {
        play('check')
    }
    if (reachedGoal) notify({ title: 'Daily goal reached', body: `${goal} todos done today.`, icon: '🎯' })
}