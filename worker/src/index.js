/* ============================================================
   Study Hub Worker (free Cloudflare plan). Two jobs the browser cannot do alone:
   1. Notifications while the app is closed (Web Push): nudges, upcoming events, daily reminders.
   2. Google Calendar sign-in that never shows a popup: it keeps the Google refresh token and hands the app
      a fresh access token whenever it asks.
   Every request (except the cron) carries the Firebase sign-in token, which is verified here.
   ============================================================ */
import { verifyFirebaseToken } from './auth.js'
import { sendPush } from './webpush.js'

const json = (data, status, cors) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...cors } })
const safeId = v => typeof v === 'string' && /^[A-Za-z0-9_-]{3,60}$/.test(v)
const clip = (v, n) => String(v == null ? '' : v).slice(0, n)

function corsFor(request, env) {
    const origin = request.headers.get('Origin') || ''
    const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)
    return {
        'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : allowed[0] || '',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        Vary: 'Origin',
    }
}

/* ---------- small database helpers ---------- */
// What it does: allows an action only once per `ms` for the same key (spam guard). Returns true when allowed.
async function allow(env, key, ms) {
    const now = Date.now()
    const row = await env.DB.prepare('SELECT at FROM limits WHERE k = ?').bind(key).first()
    if (row && now - row.at < ms) return false
    await env.DB.prepare('INSERT INTO limits (k, at) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET at = excluded.at').bind(key, now).run()
    return true
}

// What it does: pushes one message to every browser this user subscribed. Dead subscriptions are removed.
// When to use it: for any "tell this person" action.
async function notifyUser(env, uid, message) {
    const { results } = await env.DB.prepare('SELECT endpoint, p256dh, auth FROM subs WHERE uid = ?').bind(uid).all()
    let sent = 0
    await Promise.all((results || []).map(async sub => {
        try {
            const status = await sendPush(sub, message, env)
            if (status === 404 || status === 410) await env.DB.prepare('DELETE FROM subs WHERE endpoint = ?').bind(sub.endpoint).run()
            else if (status < 300) sent += 1
        } catch { /* one broken browser must not stop the others */ }
    }))
    return sent
}

/* ---------- Google Calendar tokens ---------- */
async function googleToken(body, env) {
    const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: String(env.GOOGLE_CLIENT_ID || '').trim(), client_secret: String(env.GOOGLE_CLIENT_SECRET || '').trim(), ...body }),
    })
    return { status: res.status, data: await res.json().catch(() => ({})) }
}

/* ---------- the routes ---------- */
async function handle(request, env, cors) {
    const url = new URL(request.url)
    const path = url.pathname.replace(/\/+$/, '') || '/'
    // Open the Worker address in a browser to see what is missing (no secrets are shown)
    if (path === '/') {
        let tables = 'missing: run the schema.sql command with --remote'
        try { await env.DB.prepare('SELECT 1 FROM subs LIMIT 1').first(); await env.DB.prepare('SELECT 1 FROM gtokens LIMIT 1').first(); tables = 'ok' } catch { /* keeps the message */ }
        return json({
            ok: true, name: 'studyhub-worker', database: env.DB ? tables : 'missing: add the d1_databases block with the real database_id',
            vapidPrivateKey: env.VAPID_PRIVATE_JWK ? 'set' : 'missing: npx wrangler secret put VAPID_PRIVATE_JWK',
            vapidPublicKey: env.VAPID_PUBLIC && !/PASTE/.test(env.VAPID_PUBLIC) ? 'set' : 'missing: VAPID_PUBLIC in wrangler.toml',
            googleClientId: env.GOOGLE_CLIENT_ID && !/PASTE/.test(env.GOOGLE_CLIENT_ID) ? 'set' : 'missing: GOOGLE_CLIENT_ID in wrangler.toml',
            googleClientSecret: env.GOOGLE_CLIENT_SECRET ? (() => {
                const v = String(env.GOOGLE_CLIENT_SECRET)
                const t = v.trim()
                return `set: ${t.length} characters, ${t.startsWith('GOCSPX-') ? 'starts with GOCSPX- (correct)' : 'does NOT start with GOCSPX- (wrong value)'}, ends with ...${t.slice(-4)}${v !== t ? ', has stray spaces (trimmed)' : ''}. A real secret is 35 characters.`
            })() : 'missing: npx wrangler secret put GOOGLE_CLIENT_SECRET',
            firebaseProjectId: env.FIREBASE_PROJECT_ID && !/PASTE/.test(env.FIREBASE_PROJECT_ID) ? 'set' : 'missing: FIREBASE_PROJECT_ID in wrangler.toml',
        }, 200, cors)
    }

    const auth = (request.headers.get('Authorization') || '').replace(/^Bearer /, '')
    const me = await verifyFirebaseToken(auth, env.FIREBASE_PROJECT_ID)
    if (!me) return json({ error: 'signin' }, 401, cors)
    const body = request.method === 'GET' || request.method === 'DELETE' ? {} : await request.json().catch(() => ({}))

    // The browser's push address. The same browser always sends the same endpoint, so this is an upsert.
    if (path === '/subscribe' && request.method === 'POST') {
        const s = body.subscription || {}
        const k = s.keys || {}
        if (!/^https:\/\//.test(s.endpoint || '') || !k.p256dh || !k.auth) return json({ error: 'bad subscription' }, 400, cors)
        await env.DB.prepare('INSERT INTO subs (endpoint, uid, p256dh, auth, created) VALUES (?, ?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET uid = excluded.uid, p256dh = excluded.p256dh, auth = excluded.auth')
            .bind(s.endpoint, me.uid, k.p256dh, k.auth, Date.now()).run()
        return json({ ok: true }, 200, cors)
    }

    if (path === '/unsubscribe' && request.method === 'POST') {
        await env.DB.prepare('DELETE FROM subs WHERE endpoint = ? AND uid = ?').bind(clip(body.endpoint, 600), me.uid).run()
        return json({ ok: true }, 200, cors)
    }

    // The app sends the list of things to remind about. This replaces the old list of this user.
    if (path === '/reminders' && request.method === 'PUT') {
        const now = Date.now()
        const items = (Array.isArray(body.items) ? body.items : []).slice(0, 120)
            .filter(x => safeId(x.id) && Number.isFinite(x.at) && x.at > now - 60000 && x.at < now + 40 * 86400000)
        const batch = [env.DB.prepare('DELETE FROM reminders WHERE uid = ?').bind(me.uid)]
        items.forEach(x => batch.push(env.DB.prepare('INSERT INTO reminders (uid, id, at, title, body, url, tag) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .bind(me.uid, x.id, Math.round(x.at), clip(x.title, 80), clip(x.body, 200), clip(x.url || '/#/dashboard', 120), clip(x.tag || x.id, 60))))
        await env.DB.batch(batch)
        return json({ ok: true, count: items.length }, 200, cors)
    }

    // A friend nudge. The Worker checks with Firestore (using the caller's own token) that both are in the group.
    if (path === '/nudge' && request.method === 'POST') {
        if (!safeId(body.group) || !safeId(body.to) || body.to === me.uid) return json({ error: 'bad request' }, 400, cors)
        if (!(await allow(env, `nudge:${me.uid}:${body.to}`, 20000))) return json({ ok: true, skipped: 'too soon' }, 200, cors)
        const doc = uid => fetch(`https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/groups/${body.group}/members/${uid}`, { headers: { Authorization: `Bearer ${auth}` } })
        const [mine, theirs] = await Promise.all([doc(me.uid), doc(body.to)])
        if (!mine.ok || !theirs.ok) return json({ error: 'not in the same group' }, 403, cors)
        const sent = await notifyUser(env, body.to, { title: `${clip(body.name, 24) || 'A friend'} nudged you 👉`, body: 'Time to open the timer and start studying.', url: '/#/studygroup', tag: `nudge-${me.uid}` })
        return json({ ok: true, sent }, 200, cors)
    }

    // A new person asked for access: tell the owner (at most once an hour per person)
    if (path === '/notify-admin' && request.method === 'POST') {
        if (!env.ADMIN_UID || !(await allow(env, `admin:${me.uid}`, 3600000))) return json({ ok: true, skipped: true }, 200, cors)
        await notifyUser(env, env.ADMIN_UID, { title: 'New account request', body: clip(me.email, 80) || 'Someone asked for access.', url: '/#/dashboard', tag: 'admin-request' })
        return json({ ok: true }, 200, cors)
    }

    // The owner approved somebody: tell them (only the owner may call this)
    if (path === '/notify-approved' && request.method === 'POST') {
        if (me.uid !== env.ADMIN_UID || !safeId(body.uid)) return json({ error: 'owner only' }, 403, cors)
        await notifyUser(env, body.uid, { title: 'You are in 🎉', body: 'Your Study Hub account was approved.', url: '/#/dashboard', tag: 'approved' })
        return json({ ok: true }, 200, cors)
    }

    // Google Calendar: exchange the one-time code from the sign-in window for a refresh token that stays here
    if (path === '/google/code' && request.method === 'POST') {
        if (!env.GOOGLE_CLIENT_SECRET) return json({ error: 'not configured' }, 501, cors)
        const r = await googleToken({ code: clip(body.code, 600), grant_type: 'authorization_code', redirect_uri: 'postmessage' }, env)
        if (!r.data.access_token) return json({ error: r.data.error_description || r.data.error || 'Google refused the code', hint: r.data.error === 'invalid_client' || /secret/i.test(r.data.error_description || '') ? 'client_id_or_secret_mismatch' : undefined }, 400, cors)
        if (r.data.refresh_token) {
            await env.DB.prepare('INSERT INTO gtokens (uid, refresh, updated) VALUES (?, ?, ?) ON CONFLICT(uid) DO UPDATE SET refresh = excluded.refresh, updated = excluded.updated')
                .bind(me.uid, r.data.refresh_token, Date.now()).run()
        } else if (!(await env.DB.prepare('SELECT 1 FROM gtokens WHERE uid = ?').bind(me.uid).first())) {
            return json({ error: 'Google did not give a refresh token. Remove Study Hub at myaccount.google.com/permissions and connect again.' }, 400, cors)
        }
        return json({ access_token: r.data.access_token, expires_in: r.data.expires_in || 3600 }, 200, cors)
    }

    // Google Calendar: a fresh access token, no window, no user action
    if (path === '/google/token' && request.method === 'GET') {
        const row = await env.DB.prepare('SELECT refresh FROM gtokens WHERE uid = ?').bind(me.uid).first()
        if (!row) return json({ error: 'not_linked' }, 404, cors)
        const r = await googleToken({ refresh_token: row.refresh, grant_type: 'refresh_token' }, env)
        if (r.data.access_token) return json({ access_token: r.data.access_token, expires_in: r.data.expires_in || 3600 }, 200, cors)
        if (r.data.error === 'invalid_grant') {
            await env.DB.prepare('DELETE FROM gtokens WHERE uid = ?').bind(me.uid).run()
            return json({ error: 'revoked' }, 401, cors)
        }
        return json({ error: 'google_unavailable' }, 502, cors)
    }

    if (path === '/google' && request.method === 'DELETE') {
        const row = await env.DB.prepare('SELECT refresh FROM gtokens WHERE uid = ?').bind(me.uid).first()
        if (row) {
            await fetch('https://oauth2.googleapis.com/revoke', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: row.refresh }) }).catch(() => {})
            await env.DB.prepare('DELETE FROM gtokens WHERE uid = ?').bind(me.uid).run()
        }
        return json({ ok: true }, 200, cors)
    }

    return json({ error: 'not found' }, 404, cors)
}

/* ---------- the cron (runs every minute) ---------- */
// What it does: sends every reminder whose time has come, then forgets it. Old ones that were missed are dropped.
async function sendDue(env) {
    const now = Date.now()
    await env.DB.prepare('DELETE FROM reminders WHERE at < ?').bind(now - 6 * 3600000).run()
    const { results } = await env.DB.prepare('SELECT uid, id, title, body, url, tag FROM reminders WHERE at <= ? ORDER BY at LIMIT 60').bind(now).all()
    for (const r of results || []) {
        await env.DB.prepare('DELETE FROM reminders WHERE uid = ? AND id = ?').bind(r.uid, r.id).run()
        await notifyUser(env, r.uid, { title: r.title, body: r.body, url: r.url, tag: r.tag })
    }
    await env.DB.prepare('DELETE FROM limits WHERE at < ?').bind(now - 86400000).run()
}

export default {
    async fetch(request, env) {
        const cors = corsFor(request, env)
        if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
        try {
            return await handle(request, env, cors)
        } catch (e) {
            return json({ error: 'server', detail: String((e && e.message) || e).slice(0, 200) }, 500, cors)
        }
    },
    async scheduled(event, env, ctx) {
        ctx.waitUntil(sendDue(env))
    },
}
