// Public privacy policy page.
// Rendered by main.jsx at the real path /privacy, OUTSIDE <App /> and <AuthGate />,
// so anyone (including Google's reviewers) can open it without signing in.
// React 19: the <title> below is hoisted into <head> automatically.

import { useEffect } from 'react'
import { GLOBAL_CSS, getStore } from './shared'

const APP_NAME = 'Study Hub'
const CONTACT_EMAIL = 'your-email@example.com' // TODO: replace with a real address you check
const EFFECTIVE_DATE = 'October 24, 2026' // TODO: update when you change the policy

// Only what the policy page adds on top of GLOBAL_CSS (the app's own colors, fonts and base styles)
const CSS = `
.policy{max-width:760px;margin:0 auto;padding:24px 16px 64px}
.policy .card{padding:28px}
.policy h1{font-size:2rem}
.policy h2{font-size:1.25rem;margin:1.8em 0 .5em}
.policy h3{font-size:1.05rem;margin:1.2em 0 .3em}
.policy ul{padding-left:1.4em}
.policy li{margin:.3em 0}
.policy a{color:var(--ac)}
.policy .back{display:inline-block;margin-bottom:16px}
@media(max-width:640px){.policy .card{padding:18px}}
`

export default function PrivacyPolicy() {
    // Same theme the user picked in the app (App's TopBar does this for the main app, not for this page)
    useEffect(() => {
        const theme = getStore('theme', 'system')
        if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme
    }, [])

    return (
        <main className="policy">
            <style>{GLOBAL_CSS}</style>
            <style>{CSS}</style>
            <title>{`Privacy Policy - ${APP_NAME}`}</title>

            <p><a className="back" href="/">Back to {APP_NAME}</a></p>

            <div className="card">

            <h1>Privacy Policy</h1>
            <p>Effective date: {EFFECTIVE_DATE}</p>

            <p>
                {APP_NAME} is a personal study planner with to-dos, notes, roadmaps, focus sessions and study groups.
                This page explains what information it handles, why, and what choices you have.
            </p>

            <h2>1. Information we handle</h2>

            <h3>On your device</h3>
            <p>
                Everything you create is first saved in your browser's local storage on your own device. If you do not
                sign in, your data stays on your device and is never sent to us.
            </p>

            <h3>Account information</h3>
            <ul>
                <li>Your email address and, if you sign in with Google, your Google display name.</li>
                <li>
                    If you sign up with email and password, the password is handled by Firebase Authentication (a Google
                    service). We never see or store your password.
                </li>
                <li>A unique account ID created by Firebase Authentication.</li>
            </ul>

            <h3>Study data you create (when you are signed in and approved)</h3>
            <p>
                Your to-dos, streak and activity history, focus sessions, events, badges and progress, settings,
                courses database, notes and note labels, roadmaps, study group settings, titles and recurring tasks are
                copied to our cloud database so you can use them on several devices.
            </p>

            <h3>Access requests</h3>
            <p>
                New accounts must be approved by the app owner. To handle this we store your email, display name, the
                time of your request and its status (pending, approved or declined).
            </p>

            <h3>Study groups and sharing (only if you use them)</h3>
            <ul>
                <li>
                    Your member card in a group: display name, study minutes per day and in total, whether you are
                    studying now, a summary of your to-dos, and an optional profile (small photo, short bio, email,
                    link, city and focus).
                </li>
                <li>Roadmaps or goals you share with the group, study sessions you plan for the group, and cheers you send.</li>
                <li>Roadmap copies you publish with a share code.</li>
            </ul>

            <h2>2. How we use it</h2>
            <ul>
                <li>To sign you in and keep your account secure.</li>
                <li>To save your study data and sync it between your devices.</li>
                <li>To decide who may use the app (owner approval).</li>
                <li>To show your study group the information described above.</li>
                <li>If you turn it on, to sync your events and to-dos with your Google Calendar.</li>
            </ul>
            <p>We do not use your data for advertising and we do not sell it.</p>

            <h2>3. Google sign-in and Google Calendar</h2>

            <h3>Sign in with Google</h3>
            <p>
                If you choose "Continue with Google", we receive your name and email address from Google, and only use
                them to create and identify your account as described above.
            </p>

            <h3>Google Calendar (optional)</h3>
            <p>
                Google Calendar sync is off until you press Connect in Settings. If you do, {APP_NAME} asks Google for
                one permission, <code>https://www.googleapis.com/auth/calendar.events</code>, which lets the app view and
                edit events on your Google Calendar. It only works with your primary calendar. This is how it uses that
                access:
            </p>
            <ul>
                <li>
                    <b>Events, in both directions:</b> it reads the events on your primary calendar from 30 days ago to one
                    year ahead (title, description, date, time and reminder) and shows them in {APP_NAME}. New, changed or
                    deleted events on either side are copied to the other, so editing or deleting an event in {APP_NAME}
                    also edits or deletes it in Google Calendar.
                </li>
                <li>
                    <b>To-dos, in one direction:</b> if this option is on, your to-dos from the last 7 days and the next 60
                    days are added to your Google Calendar as all-day items (marked ☐ or ☑). Changes made in Google
                    Calendar never change your to-dos.
                </li>
                <li><b>Reminders:</b> timed events get a pop-up reminder in Google Calendar.</li>
            </ul>
            <p>
                Events imported from Google Calendar become normal {APP_NAME} events. If you are signed in to a {APP_NAME}
                account, they are saved with your other study data (section 1) and are visible only to your own account.
                The temporary Google access token (valid for about one hour) is kept in your browser on this device only.
                It is not copied to our cloud database.
            </p>
            <p>
                You can stop at any time by disconnecting in Settings, which revokes the token and stops syncing, or at
                myaccount.google.com/permissions. Events and to-do items that were already copied stay where they are until
                you delete them.
            </p>
            <p>
                {APP_NAME}'s use and transfer of information received from Google APIs adheres to the{' '}
                <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer">
                    Google API Services User Data Policy
                </a>
                , including the Limited Use requirements. We use Google Calendar data only to provide the sync described
                here. We do not sell it, use it for advertising, or transfer it to others, and we do not read it except
                where needed for security or abuse, where the law requires it, or with your permission.
            </p>

            <h2>4. Who can see your data</h2>
            <ul>
                <li>
                    <b>Your private study data</b> is stored under your own account. Our security rules only allow your
                    own signed-in account to read it.
                </li>
                <li>
                    <b>Study groups:</b> your member card and anything you share to a group can be seen by the other
                    members of that group.
                </li>
                <li>
                    <b>Roadmap copies:</b> anyone with an approved account who knows the share code can read that copy.
                </li>
                <li>
                    <b>The app owner</b> can see your email and name when you request access, and can approve, decline
                    or remove accounts.
                </li>
            </ul>
            <p>We do not share your data with anyone else, except where the law requires it.</p>

            <h2>5. Services we rely on</h2>
            <p>
                {APP_NAME} uses Google Firebase (Authentication and Cloud Firestore) to sign you in and store your data.
                Google processes this data on our behalf under its own terms and privacy policy. Firebase Authentication
                also keeps you signed in using your browser's storage (for example IndexedDB or local storage).
            </p>

            <h2>6. Notifications</h2>
            <p>
                If you allow it, {APP_NAME} can show system notifications for event reminders. You can withdraw this
                permission at any time in your browser settings.
            </p>

            <h2>7. Keeping and deleting your data</h2>
            <ul>
                <li>Your data is kept while your account exists.</li>
                <li>
                    You can delete your account inside the app (Account, then "Delete my account"). This erases your
                    cloud study data, your approval record, your member cards and shared items in study groups, and your
                    login.
                </li>
                <li>
                    Some small items you created for other people may remain after deletion, such as cheers you sent,
                    group sessions you planned, and roadmap copies you published. Email us if you want them removed.
                </li>
                <li>You can also sign out and remove the data stored on a device from the same Account screen.</li>
            </ul>

            <h2>8. Your choices and rights</h2>
            <p>
                You can use the app without an account, download a backup of your data, and delete your account at any
                time. To ask about the data we hold, to correct it, or to have it deleted, email{' '}
                <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
            </p>

            <h2>9. Security</h2>
            <p>
                Data is sent over HTTPS and protected by Firebase security rules that limit who can read and write each
                piece of data. No online service can be guaranteed to be perfectly secure.
            </p>

            <h2>10. Children</h2>
            <p>{APP_NAME} is not intended for children under 13, and we do not knowingly collect their information.</p>

            <h2>11. Changes to this policy</h2>
            <p>If this policy changes, we will update the effective date above.</p>

            <h2>12. Contact</h2>
            <p>
                Questions about this policy: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
            </p>
            </div>
        </main>
    )
}
