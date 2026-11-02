# Study Hub Worker (free)

One small Cloudflare Worker that does two things the browser cannot do alone:

1. **Notifications while Study Hub is closed** (desktop browser and phone): event reminders, streak reminders, friend nudges, account approvals.
2. **Google Calendar that never shows a popup**: you connect once, the Worker keeps the Google refresh token and gives the app a fresh access token whenever it asks.

Everything fits in Cloudflare's free plan (Workers, D1 database, cron every minute).

## Setup (about 15 minutes, once)

Run everything from the `worker` folder.

```bash
cd worker
pnpm install                      # or npm install
npx wrangler login                # opens the browser, log in to Cloudflare
npx wrangler d1 create studyhub   # prints a database_id
```

1. Paste the `database_id` into `wrangler.toml`.
2. Fill the other values in `wrangler.toml` (`[vars]`): Firebase project id, your admin UID, Google client id, your site address in `ALLOWED_ORIGINS`.
3. Create the tables:

```bash
npx wrangler d1 execute studyhub --remote --file=schema.sql
```

4. Make the notification keys:

```bash
node scripts/gen-vapid.mjs
```

   - Put the **public** key in `wrangler.toml` (`VAPID_PUBLIC`) and in the app's `.env` as `VITE_VAPID_PUBLIC_KEY`.
   - Save the **private** key as a secret (paste the one-line JSON when asked):

```bash
npx wrangler secret put VAPID_PRIVATE_JWK
```

5. Google Calendar (skip if you only want push):
   - Google Cloud Console > APIs & Services > Credentials > your OAuth client. It must be of type **Web application**. Under *Authorized JavaScript origins* add your site address and `http://localhost:5173`.
   - Copy the **client secret** and store it as a secret (it must never be in the app or in git):

```bash
npx wrangler secret put GOOGLE_CLIENT_SECRET
```

   - OAuth consent screen: set the publishing status to **In production**. In "Testing" mode Google deletes refresh tokens after 7 days and you would be asked to connect again every week. An unverified personal app only shows a one-time warning for you.

6. Deploy:

```bash
npx wrangler deploy
```

   It prints your Worker address, for example `https://studyhub-worker.YOURNAME.workers.dev`.

7. In the app's `.env` (and in Cloudflare Pages > Settings > Environment variables, then redeploy):

```text
VITE_PUSH_URL=https://studyhub-worker.YOURNAME.workers.dev
VITE_VAPID_PUBLIC_KEY=<the public key>
```

8. Publish the new `firestore.rules` (Firebase console > Firestore > Rules > Publish).

## Using it

- Settings > Notifications > **Notify me when closed** (once per device). On iPhone: add Study Hub to the Home Screen first (iOS 16.4+), open it from there, then press the button.
- Settings > Google Calendar > **Connect** once. After that it syncs by itself every time you open the app.

## Check it works

```bash
npm test          # proves the encryption and token checks are correct
npx wrangler tail # live logs while you test
```

## How it is protected

- Every request carries your Firebase sign-in token; the Worker verifies Google's signature, the project id and the expiry.
- A nudge is only sent after Firestore confirms (with the sender's own token) that both people are in the group.
- Only the owner (`ADMIN_UID`) can trigger "account approved" messages.
- Spam guards: one nudge per friend per 20 s, one admin alert per person per hour.
- The Google refresh token lives only in your own D1 database. Disconnecting in Settings revokes it at Google and deletes it.

## If something fails

Open your Worker address in a browser (for example `https://studyhub-worker.YOURNAME.workers.dev`). It lists what is set and what is missing. Fix every line that says `missing`, then `npx wrangler deploy` again.

- **"server" error on Notify me when closed**: almost always the database tables were not created in the *remote* database. Run `npx wrangler d1 execute studyhub --remote --file=schema.sql`.
- **"The provided client secret is invalid"**: the secret does not belong to the client id in use. The same OAuth client must be used in three places: `VITE_GOOGLE_CLIENT_ID` (app), `GOOGLE_CLIENT_ID` (wrangler.toml) and the secret you stored. Reset the secret in Google Cloud, copy it again without spaces, and run `npx wrangler secret put GOOGLE_CLIENT_SECRET`.
- **`wrangler tail` times out**: that is your network blocking Cloudflare's log connection, not a Worker problem. Use the Cloudflare dashboard instead (Workers & Pages > studyhub-worker > Logs), try another network or a VPN, or just use the address check above.
