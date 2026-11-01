/* ============================================================
   Web Push for a Cloudflare Worker (no libraries, only WebCrypto).
   - VAPID: proves to the browser's push service that the message comes from your server (RFC 8292)
   - Encryption: the message is encrypted for one browser (RFC 8291, aes128gcm)
   ============================================================ */

const enc = new TextEncoder()

export const b64u = bytes => {
    let s = ''
    new Uint8Array(bytes).forEach(b => { s += String.fromCharCode(b) })
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
export const unb64u = text => {
    const s = text.replace(/-/g, '+').replace(/_/g, '/')
    const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4))
    return Uint8Array.from(bin, c => c.charCodeAt(0))
}
const concat = (...parts) => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
    let at = 0
    parts.forEach(p => { out.set(p, at); at += p.length })
    return out
}

// What it does: signs the VAPID token for one push service (the origin of the subscription endpoint).
// When to use it: once per push request. The private key is a JWK string kept in a Worker secret.
export async function vapidHeader(endpoint, publicKey, privateJwk, subject) {
    const key = await crypto.subtle.importKey('jwk', JSON.parse(privateJwk), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
    const head = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
    const claims = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })))
    const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${head}.${claims}`))
    return `vapid t=${head}.${claims}.${b64u(sig)}, k=${publicKey}`
}

async function hkdf(salt, ikm, info, bytes) {
    const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
    return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8))
}

// What it does: encrypts a text for one browser subscription. Returns the exact body to POST to the endpoint.
// When to use it: right before sending. p256dh and auth are the two keys the browser gave when it subscribed.
export async function encryptPayload(text, p256dh, auth) {
    const uaPublic = unb64u(p256dh)
    const authSecret = unb64u(auth)
    const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
    const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
    const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
    const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, pair.privateKey, 256))
    const ikm = await hkdf(authSecret, shared, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32)
    const salt = crypto.getRandomValues(new Uint8Array(16))
    const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16)
    const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12)
    const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
    const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, concat(enc.encode(text), new Uint8Array([2]))))
    return concat(salt, new Uint8Array([0, 0, 0x10, 0]), new Uint8Array([asPublic.length]), asPublic, cipher)
}

// What it does: sends one push. Returns the HTTP status (201 = accepted, 404 or 410 = the subscription is dead).
// When to use it: for every notification. message is a plain object { title, body, url, tag }.
export async function sendPush(sub, message, env) {
    const body = await encryptPayload(JSON.stringify(message), sub.p256dh, sub.auth)
    const res = await fetch(sub.endpoint, {
        method: 'POST',
        headers: {
            Authorization: await vapidHeader(sub.endpoint, env.VAPID_PUBLIC, env.VAPID_PRIVATE_JWK, env.VAPID_SUBJECT),
            'Content-Encoding': 'aes128gcm',
            'Content-Type': 'application/octet-stream',
            TTL: '86400',
            Urgency: 'high',
        },
        body,
    })
    return res.status
}
