import { useEffect } from 'react'
import { STUDY_DEFAULT, onStoreChange, useStore } from './shared'
import { useSyncState } from './sync'
import { startLive, stopLive, syncGroups } from './live'
import { ensurePush, syncReminders } from './pushClient'
import { buildReminders } from './brief'

/* What it does: starts the live layer (see live.js) when you are signed in and approved, keeps it matched to
   your groups, and keeps the closed-app reminders up to date.
   When to use it: mounted once in App, inside <AuthGate>, so it works on every page. */
export default function LiveWatcher() {
    const { user, access } = useSyncState()
    const [s] = useStore('studygroup', STUDY_DEFAULT)
    const uid = user && access === 'approved' ? user.uid : ''
    const ids = s.groups.map(g => g.id).join(',')

    useEffect(() => {
        if (!uid) return undefined
        startLive(uid)
        return () => stopLive()
    }, [uid])

    // The list of groups can also change because another device changed it (cloud sync), so watch the value, not the clicks
    useEffect(() => { if (uid) syncGroups() }, [uid, ids])

    // Closed-app notifications: renew the subscription, then keep the Worker's reminder list fresh
    useEffect(() => {
        if (!uid) return undefined
        ensurePush().then(() => syncReminders(buildReminders()))
        let timer = null
        const later = () => {
            clearTimeout(timer)
            timer = setTimeout(() => syncReminders(buildReminders()), 8000)
        }
        const off = onStoreChange(key => { if (['events', 'todos', 'studygroup', 'settings', 'activity', 'focus'].includes(key)) later() })
        const every = setInterval(later, 30 * 60000)
        return () => { clearTimeout(timer); clearInterval(every); off() }
    }, [uid])

    return null
}
