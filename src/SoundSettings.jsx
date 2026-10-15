import { useStore } from './shared'
import { SOUND_CATS, SOUND_DEFAULTS, SOUND_INFO, play } from './sound'

export function SoundButton({ onClick }) {
    const [s] = useStore('sound', SOUND_DEFAULTS)
    return (
        <button className="icon-btn" onClick={onClick} title="Sound settings" aria-label={s.on ? 'Sound settings, sound is on' : 'Sound settings, sound is muted'}>
            {s.on ? '🔊' : '🔇'}
        </button>
    )
}

export function SoundModal({ onClose }) {
    const [s, , update] = useStore('sound', SOUND_DEFAULTS)
    const cats = { ...SOUND_DEFAULTS.cats, ...(s.cats || {}) }
    const volume = Math.round((s.volume == null ? 0.7 : s.volume) * 100)

    return (
        <div className="modal-back" onMouseDown={e => e.target === e.currentTarget && onClose()}>
            <div className="modal" role="dialog" aria-label="Sound settings">
                <h2>Sounds</h2>
                <label className="row" style={{ marginBottom: 12 }}>
                    <input type="checkbox" checked={s.on} onChange={e => update(d => { d.on = e.target.checked })} />
                    <b>Play sounds</b>
                    <span className="muted small">on this device</span>
                </label>
                <label className="field"><span>Volume {volume}%</span>
                    <input type="range" min="0" max="100" value={volume} disabled={!s.on} style={{ accentColor: 'var(--ac)' }}
                        onChange={e => update(d => { d.volume = Number(e.target.value) / 100 })}
                        onPointerUp={() => play('check')} onKeyUp={() => play('check')} />
                </label>
                {Object.entries(SOUND_CATS).map(([cat, label]) => (
                    <section key={cat} style={{ marginTop: 14 }}>
                        <label className="row">
                            <input type="checkbox" checked={cats[cat]} disabled={!s.on} onChange={e => update(d => { d.cats = { ...cats, [cat]: e.target.checked } })} />
                            <b>{label}</b>
                        </label>
                        <div className="row" style={{ marginTop: 6 }}>
                            {Object.entries(SOUND_INFO).filter(([, info]) => info.cat === cat).map(([name, info]) => (
                                <button key={name} className="btn sm" disabled={!s.on} onClick={() => play(name, { force: true })}>▶ {info.label}</button>
                            ))}
                        </div>
                    </section>
                ))}
                <div className="row" style={{ marginTop: 16 }}><span className="grow" /><button className="btn" onClick={onClose}>Close</button></div>
            </div>
        </div>
    )
}
