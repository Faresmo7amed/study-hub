// Run once:  node scripts/gen-vapid.mjs
// Prints the two VAPID keys. The public key goes in the app (.env) and in wrangler.toml.
// The private key is a secret: paste it into `npx wrangler secret put VAPID_PRIVATE_JWK` and never commit it.
import { webcrypto as crypto } from 'node:crypto'

const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
const pub = Buffer.from(await crypto.subtle.exportKey('raw', pair.publicKey)).toString('base64url')
const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey)

console.log('\nPUBLIC key (safe to share):\n' + pub)
console.log('\nPRIVATE key (secret, one line):\n' + JSON.stringify(jwk) + '\n')
