// Run with:  npm test
// Proves the encryption is real by decrypting it the way a browser does, using Node's own crypto.
import test from 'node:test'
import assert from 'node:assert/strict'
import { webcrypto as wc, createECDH, createHmac, createDecipheriv } from 'node:crypto'
import { encryptPayload, vapidHeader, b64u, unb64u } from '../src/webpush.js'
import { verifyFirebaseToken, resetKeyCache } from '../src/auth.js'

const hkdf = (salt, ikm, info, len) => {
    const prk = createHmac('sha256', salt).update(ikm).digest()
    return createHmac('sha256', prk).update(Buffer.concat([info, Buffer.from([1])])).digest().subarray(0, len)
}

test('a push message can be decrypted by the receiver', async () => {
    const ua = createECDH('prime256v1')
    ua.generateKeys()
    const auth = wc.getRandomValues(new Uint8Array(16))
    const body = Buffer.from(await encryptPayload('{"title":"Hi 👉"}', b64u(ua.getPublicKey()), b64u(auth)))
    const salt = body.subarray(0, 16)
    const idlen = body[20]
    const asPublic = body.subarray(21, 21 + idlen)
    const cipher = body.subarray(21 + idlen)
    const shared = ua.computeSecret(asPublic)
    const ikm = hkdf(auth, shared, Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPublic]), 32)
    const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16)
    const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12)
    const d = createDecipheriv('aes-128-gcm', cek, nonce)
    d.setAuthTag(cipher.subarray(cipher.length - 16))
    const plain = Buffer.concat([d.update(cipher.subarray(0, cipher.length - 16)), d.final()])
    assert.equal(plain[plain.length - 1], 2)
    assert.equal(plain.subarray(0, plain.length - 1).toString(), '{"title":"Hi 👉"}')
})

test('the VAPID signature verifies with the public key', async () => {
    const pair = await wc.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
    const pub = b64u(await wc.subtle.exportKey('raw', pair.publicKey))
    const jwk = JSON.stringify(await wc.subtle.exportKey('jwk', pair.privateKey))
    const header = await vapidHeader('https://fcm.googleapis.com/fcm/send/abc', pub, jwk, 'mailto:a@b.c')
    const [, t] = /t=([^,]+), k=(.+)$/.exec(header)
    const [h, p, s] = t.split('.')
    assert.equal(JSON.parse(Buffer.from(unb64u(p))).aud, 'https://fcm.googleapis.com')
    assert.ok(await wc.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pair.publicKey, unb64u(s), new TextEncoder().encode(`${h}.${p}`)))
})

test('Firebase tokens: good one accepted, tampered, expired and foreign ones refused', async () => {
    resetKeyCache()
    const pair = await wc.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])
    const jwk = { ...(await wc.subtle.exportKey('jwk', pair.publicKey)), kid: 'k1', alg: 'RS256' }
    const fetcher = async () => ({ ok: true, json: async () => ({ keys: [jwk] }) })
    const make = async (claims, kid = 'k1') => {
        const enc = o => b64u(new TextEncoder().encode(JSON.stringify(o)))
        const head = enc({ alg: 'RS256', kid })
        const pay = enc(claims)
        const sig = await wc.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(`${head}.${pay}`))
        return `${head}.${pay}.${b64u(sig)}`
    }
    const now = Math.floor(Date.now() / 1000)
    const good = { aud: 'proj', iss: 'https://securetoken.google.com/proj', sub: 'user1', iat: now - 10, exp: now + 3000, email: 'a@b.c' }
    assert.deepEqual(await verifyFirebaseToken(await make(good), 'proj', fetcher), { uid: 'user1', email: 'a@b.c' })
    assert.equal(await verifyFirebaseToken((await make(good)).slice(0, -3) + 'xyz', 'proj', fetcher), null)
    assert.equal(await verifyFirebaseToken(await make({ ...good, exp: now - 5 }), 'proj', fetcher), null)
    assert.equal(await verifyFirebaseToken(await make({ ...good, aud: 'other' }), 'proj', fetcher), null)
    assert.equal(await verifyFirebaseToken(await make(good, 'nokey'), 'proj', fetcher), null)
    assert.equal(await verifyFirebaseToken('', 'proj', fetcher), null)
})
