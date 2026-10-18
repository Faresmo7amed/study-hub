import { useState } from 'react'
import { ICONS, cleanIcon, fileToIcon, isImg } from './iconUtils'

export function Icon({ value, size = 18 }) {
    if (isImg(value)) return <img className="ic-img" src={value} alt="" style={{ width: size, height: size }} />
    return <span className="ic-em" style={{ fontSize: size }} aria-hidden="true">{value}</span>
}

// What it does: lets the user pick an emoji, type their own, or upload an image. It calls onChange with the new icon.
// When to use it: inside a drawer or popover. allowNone adds a button that clears the icon.
export function IconPicker({ value, onChange, allowNone = false }) {
    const [error, setError] = useState('')
    const [text, setText] = useState('')

    const upload = async e => {
        const file = e.target.files[0]
        e.target.value = ''
        if (!file) return
        try {
            onChange(await fileToIcon(file))
            setError('')
        } catch (err) {
            setError(err.message)
        }
    }
    const typed = e => {
        e.preventDefault()
        const v = cleanIcon(text.trim())
        if (v) onChange(v)
        setText('')
    }

    return (
        <div className="ic-picker">
            <div className="ic-grid">
                {allowNone && <button type="button" className={'ic-btn' + (!value ? ' on' : '')} onClick={() => onChange('')} title="No icon" aria-label="No icon">∅</button>}
                {ICONS.map(e => <button type="button" key={e} className={'ic-btn' + (value === e ? ' on' : '')} onClick={() => onChange(e)} aria-label={`Icon ${e}`}>{e}</button>)}
            </div>
            <div className="row">
                <label className="btn sm">Upload image<input type="file" accept="image/*" hidden onChange={upload} /></label>
                {isImg(value) && <Icon value={value} size={28} />}
            </div>
            <form className="row" onSubmit={typed}>
                <input value={text} maxLength={16} onChange={e => setText(e.target.value)} placeholder="Or type any emoji" aria-label="Type an emoji" />
                <button className="btn sm" type="submit">Use</button>
            </form>
            {error && <p style={{ color: 'var(--bad)', margin: 0 }} role="alert">{error}</p>}
        </div>
    )
}