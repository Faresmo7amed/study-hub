# Firebase setup for Study Hub (free Spark plan)

You do this once. Nobody else needs your keys, and you never send them to anyone.

## 1. Create the project
1. Open https://console.firebase.google.com and click **Add project**.
2. Name it (for example `study-hub`). Turn **Google Analytics off** (not needed). Create.
3. Stay on the free **Spark** plan. Do not upgrade to Blaze.

## 2. Turn on sign-in
1. **Build → Authentication → Get started**.
2. **Sign-in method**: enable **Email/Password**, then enable **Google** (pick a support email).

## 3. Create the database
1. **Build → Firestore Database → Create database**.
2. Pick a location near you and your friends. It cannot be changed later.
3. Choose **Start in production mode**.
4. Open the **Rules** tab, replace everything with the contents of `firestore.rules`, click **Publish**.

## 4. Register the web app and copy the config
1. **Project settings (gear icon) → General → Your apps → Web (`</>`)**.
2. Give it a nickname. Skip Firebase Hosting. Click **Register app**.
3. Copy `apiKey`, `authDomain`, `projectId`, `appId` from the config shown.

## 5. Add it to the project
```bash
pnpm add firebase
cp .env.example .env.local      # then paste the four values into .env.local
pnpm dev                        # restart: Vite reads .env files only on start
```
Copy `firestore.rules` and `.env.example` to the root of the project (next to `package.json`). Add `.env.local` to `.gitignore`.

## 6. Test locally
1. Click **Sign in** in the top bar, create an account.
2. In the console, open **Firestore Database → Data**. After a couple of seconds you should see `users → (your id) → data → …`.

## 7. Deploy on Cloudflare Pages
1. Pages project → **Settings → Variables and Secrets** (environment variables). Add the same four `VITE_FIREBASE_*` variables for **Production** and **Preview**.
2. **Redeploy**. Vite bakes the values in at build time, so a redeploy is required.
3. Firebase console → **Authentication → Settings → Authorized domains → Add domain**: add `your-project.pages.dev` (and any custom domain). Google sign-in needs this.

## 8. Friends
- Send them the link. They create their own account and see only their own data.
- To close the door after they joined: **Authentication → Settings → User actions**, turn off **Enable create (sign-up)**. You can still add people by hand under **Authentication → Users → Add user**.
- The Firebase config values in the browser are not secrets. The security rules protect the data.
- As the project owner you can read everyone's data in the console. Tell your friends.
- Watch usage under **Firestore Database → Usage**.

## If you already published the rules earlier
The multiple-roadmaps update added one new synced key, `roadmaps`. Open **Firestore Database → Rules**, replace the text with the current `firestore.rules`, and click **Publish** again. Until you do, saving roadmaps to the cloud is refused with "permission denied".

The study sessions update added one more group collection, `events`. Publish the current `firestore.rules` again, or planning a study session is refused with "permission denied".
