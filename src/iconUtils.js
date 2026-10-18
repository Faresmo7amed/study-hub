export const ICONS = ['📄', '🌐', '🎨', '⚛️', '🟨', '🟦', '🟧', '🟩', '🟥', '🐍', '☕', '🗄️', '🔒', '🧪', '🧠', '🚀', '🛠️', '📱', '☁️', '🐳', '🔧', '📊', '🎯', '📚', '🎓', '🎬', '▶️', '🏔️', '🧩', '⚡', '🔥', '💻', '🧰', '🔌', '📦', '✅', '🏆', '⭐', '📝', '🎧', '📈', '🗂️', '📌', '🧭', '💡', '🖥️', '⌨️', '🤖', '📡', '🛡️', '🔍', '📅', '⏱️', '🧮', '🌱']

// An icon is either a short emoji text or a small image stored as a data URL
export const isImg = v => typeof v === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(v)
export const cleanIcon = v => {
    const s = typeof v === 'string' ? v : ''
    return isImg(s) ? (s.length <= 20000 ? s : '') : s.slice(0, 16)
}
// For places that can only show text (like <option>), where an image cannot appear
export const textIcon = v => (isImg(v) ? '' : v || '')

// Turns a picked image into a 64x64 image (usually 2 to 4 KB)
export const fileToIcon = file => new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
        const box = 64
        const scale = Math.min(box / img.width, box / img.height)
        const w = Math.max(1, Math.round(img.width * scale))
        const h = Math.max(1, Math.round(img.height * scale))
        const canvas = document.createElement('canvas')
        canvas.width = box
        canvas.height = box
        canvas.getContext('2d').drawImage(img, (box - w) / 2, (box - h) / 2, w, h)
        URL.revokeObjectURL(url)
        const out = canvas.toDataURL('image/webp', 0.85)
        if (out.length > 20000) reject(new Error('That image is too detailed. Try a simpler one.'))
        else resolve(out)
    }
    img.onerror = () => {
        URL.revokeObjectURL(url)
        reject(new Error('That file is not an image.'))
    }
    img.src = url
})