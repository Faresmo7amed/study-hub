/* ============================================================
   Checks the Firebase sign-in token that the app sends with every request.
   The token is a signed JWT. Google publishes the public keys, so the Worker needs no secret for this.
   ============================================================ */
import { unb64u } from './webpush.js'

const JWKS_URL = 'https://www.googleapis.com/robot/v1/metadata/jwk/securetoken@system.gserviceaccount.com'
const dec = new TextDecoder()
let cache = { at: 0, keys: [] }

async function keys(fetcher) {
    if (Date.now() - cache.at < 3600000 && cache.keys.length) return cache.keys
    const res = await fetcher(JWKS_URL)
    if (!res.ok) throw new Error('Could not load Google keys')
    cache = { at: Date.now(), keys: (await res.json()).keys || [] }
    return cache.keys
}

// What it does: returns { uid, email } when the token is real, fresh and made for this Firebase project. Otherwise null.
// When to use it: at the start of every request that must know who is calling.
export async function verifyFirebaseToken(token, projectId, fetcher = fetch) {
    try {
        const [h, p, s] = String(token || '').split('.')
        if (!h || !p || !s) return null
        const head = JSON.parse(dec.decode(unb64u(h)))
        const claims = JSON.parse(dec.decode(unb64u(p)))
        if (head.alg !== 'RS256') return null
        const jwk = (await keys(fetcher)).find(k => k.kid === head.kid)
        if (!jwk) return null
        const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
        const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, unb64u(s), new TextEncoder().encode(`${h}.${p}`))
        const now = Math.floor(Date.now() / 1000)
        if (!ok || claims.exp < now || claims.iat > now + 300) return null
        if (claims.aud !== projectId || claims.iss !== `https://securetoken.google.com/${projectId}` || !claims.sub) return null
        return { uid: claims.sub, email: claims.email || '' }
    } catch {
        return null
    }
}

export const resetKeyCache = () => { cache = { at: 0, keys: [] } }
