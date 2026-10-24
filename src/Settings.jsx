import { useState } from 'react'
import { clamp, isHttp, normalizeUrl, notify, useStore } from './shared'
import { play } from './sound'
import { GoogleCalendarSection, NotificationsSection } from './IntegrationsSettings'

// [key, label, icon, placeholder]
export const LINK_KINDS = [
    ['portfolio', 'Portfolio', '🌐', 'yoursite.dev'],
    ['github', 'GitHub', '🐙', 'github.com/you'],
    ['linkedin', 'LinkedIn', '💼', 'linkedin.com/in/you'],
    ['x', 'X / Twitter', '🐦', 'x.com/you'],
    ['youtube', 'YouTube', '▶️', 'youtube.com/@you'],
    ['instagram', 'Instagram', '📷', 'instagram.com/you'],
    ['other', 'Other', '🔗', 'any link'],
]

// [key, label]. A card is hidden when settings.hide[key] is true.
export const RAIL_CARDS = [
    ['study', 'Study timer (left)'],
    ['scratch', 'Scratchpad (left)'],
    ['calendar', 'Mini calendar (right)'],
    ['roadmaps', 'Roadmap progress (right)'],
    ['links', 'My links (right)'],
    ['quote', 'Daily quote (right)'],
]

export const SETTINGS_EVENT = 'studyhub-settings'
export const openSettings = () => window.dispatchEvent(new Event(SETTINGS_EVENT))

// What it does: shows your saved links as small chips.
// When to use it: in a sidebar card. With no links yet it shows a button that opens Settings.
export function SocialLinks() {
    const [settings] = useStore('settings', { dailyGoal: 3 })
    const links = settings.links || {}
    const items = LINK_KINDS.filter(([k]) => isHttp(links[k] || ''))
    if (!items.length) return <button className="btn sm" onClick={openSettings}>Add your links</button>
    return (
        <div className="sl-list">
            {items.map(([k, label, icon]) => (
                <a key={k} className="sl-chip" href={links[k]} target="_blank" rel="noopener noreferrer" title={links[k]}>
                    <span aria-hidden="true">{icon}</span> {label}
                </a>
            ))}
        </div>
    )
}

// Parent: App. Edits your links, daily goal and what shows in the sidebars and on the dashboard.
// Everything is saved in the synced "settings" key, so it follows you to your other devices.
export function SettingsModal({ onClose }) {
    const [settings, , update] = useStore('settings', { dailyGoal: 3 })
    const [links, setLinks] = useState(() => ({ ...(settings.links || {}) }))
    const [goal, setGoal] = useState(settings.dailyGoal || 3)
    const [heat, setHeat] = useState(settings.heatmap !== false)
    const [hide, setHide] = useState(() => ({ ...(settings.hide || {}) }))
    const [remindAt, setRemindAt] = useState(settings.dailyRemind || '')

    const save = e => {
        e.preventDefault()
        const clean = Object.fromEntries(Object.entries(links).map(([k, v]) => [k, normalizeUrl(v)]).filter(([, v]) => v))
        update(d => {
            d.links = clean
            d.dailyGoal = clamp(Number(goal) || 3, 1, 20)
            d.heatmap = heat
            d.hide = hide
            d.dailyRemind = /^\d{2}:\d{2}$/.test(remindAt) ? remindAt : ''
        })
        play('save')
        notify({ title: 'Settings saved', icon: '⚙️' })
        onClose()
    }

    return (
        <div className="modal-back" onMouseDown={e => e.target === e.currentTarget && onClose()}>
            <form className="modal" onSubmit={save} role="dialog" aria-label="Settings">
                <h2>⚙️ Settings</h2>

                <h3 className="st-h">Your links</h3>
                <p className="muted small" style={{ marginTop: 0 }}>They appear in the right sidebar. Leave a field empty to hide it.</p>
                {LINK_KINDS.map(([key, label, icon, hint]) => (
                    <label key={key} className="field"><span>{icon} {label}</span>
                        <input value={links[key] || ''} placeholder={hint} maxLength={200} onChange={e => setLinks(cur => ({ ...cur, [key]: e.target.value }))} />
                    </label>
                ))}

                <h3 className="st-h">Dashboard</h3>
                <label className="field"><span>Daily todo goal</span>
                    <input type="number" min="1" max="20" value={goal} onChange={e => setGoal(e.target.value)} />
                </label>
                <label className="row" style={{ marginBottom: 12 }}>
                    <input type="checkbox" checked={heat} onChange={e => setHeat(e.target.checked)} /> Show the study activity graph
                </label>

                <NotificationsSection time={remindAt} onTime={setRemindAt} />
                <GoogleCalendarSection />

                <h3 className="st-h">Sidebar cards</h3>
                <p className="muted small" style={{ marginTop: 0 }}>Untick a card to hide it.</p>
                <div className="st-cards">
                    {RAIL_CARDS.map(([key, label]) => (
                        <label key={key} className="row">
                            <input type="checkbox" checked={!hide[key]} onChange={e => setHide(cur => ({ ...cur, [key]: !e.target.checked }))} /> {label}
                        </label>
                    ))}
                </div>

                <div className="row" style={{ marginTop: 16 }}>
                    <span className="grow" />
                    <button type="button" className="btn" onClick={onClose}>Cancel</button>
                    <button type="submit" className="btn primary">Save settings</button>
                </div>
                <style>{`.st-h{font-size:16px;margin:18px 0 8px}.st-h:first-of-type{margin-top:4px}.st-cards{display:grid;gap:8px;grid-template-columns:repeat(auto-fit,minmax(200px,1fr))}`}</style>
            </form>
        </div>
    )
}
