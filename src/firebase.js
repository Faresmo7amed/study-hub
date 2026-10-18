/* ============================================================
   Firebase adapter: sign-in and Firestore access, nothing else.
   The SDK is loaded on first use, so the app stays small when sync is not configured.

   Firestore layout (one small document per piece of data):
     users/{uid}/data/{key}  ->  { value: "<json string>", updatedAt: <ms>, serverAt: <server time> }

   The value is stored as a JSON string because Firestore does not allow arrays inside arrays,
   and the weekly todos use them.
   ============================================================ */

const env = import.meta.env || {}
const config = {
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    appId: env.VITE_FIREBASE_APP_ID,
}

export const configured = Boolean(config.apiKey && config.projectId && config.appId)

let sdk = null

async function load() {
    if (sdk) return sdk
    if (!configured) throw new Error('Firebase is not configured. Add the VITE_FIREBASE_* variables.')
    const [{ initializeApp }, A, F] = await Promise.all([import('firebase/app'), import('firebase/auth'), import('firebase/firestore')])
    const app = initializeApp(config)
    sdk = { A, F, auth: A.getAuth(app), db: F.getFirestore(app) }
    return sdk
}

const withTimeout = (promise, ms = 15000) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Object.assign(new Error('The cloud did not answer in time.'), { code: 'app/timeout' })), ms)
    promise.then(
        v => { clearTimeout(timer); resolve(v) },
        e => { clearTimeout(timer); reject(e) },
    )
})

/* ---------- accounts ---------- */
export async function onUser(callback) {
    const { A, auth } = await load()
    return A.onAuthStateChanged(auth, user => callback(user ? { uid: user.uid, email: user.email, name: user.displayName } : null))
}

export async function signIn(email, password) {
    const { A, auth } = await load()
    await A.signInWithEmailAndPassword(auth, email, password)
}

export async function signUp(email, password) {
    const { A, auth } = await load()
    await A.createUserWithEmailAndPassword(auth, email, password)
}

export async function signInGoogle() {
    const { A, auth } = await load()
    await A.signInWithPopup(auth, new A.GoogleAuthProvider())
}

export async function resetPassword(email) {
    const { A, auth } = await load()
    await A.sendPasswordResetEmail(auth, email)
}

export async function logOut() {
    const { A, auth } = await load()
    await A.signOut(auth)
}

/* ---------- data ---------- */
// Documents the server changed after `sinceMs`. One read when nothing changed.
export async function pull(uid, sinceMs) {
    const { F, db } = await load()
    const q = F.query(F.collection(db, 'users', uid, 'data'), F.where('serverAt', '>', F.Timestamp.fromMillis(sinceMs)))
    const snap = await withTimeout(F.getDocs(q))
    return snap.docs.map(d => {
        const x = d.data()
        return { key: d.id, value: x.value, updatedAt: x.updatedAt, serverAt: x.serverAt && x.serverAt.toMillis ? x.serverAt.toMillis() : 0 }
    })
}

export async function push(uid, key, value, updatedAt) {
    if (new TextEncoder().encode(value).length > 950000) {
        throw Object.assign(new Error('This part of your data is larger than one cloud document allows (about 1 MB).'), { code: 'app/too-large' })
    }
    const { F, db } = await load()
    await withTimeout(F.setDoc(F.doc(db, 'users', uid, 'data', key), { value, updatedAt, serverAt: F.serverTimestamp() }))
}

export async function remove(uid, key) {
    const { F, db } = await load()
    await withTimeout(F.deleteDoc(F.doc(db, 'users', uid, 'data', key)))
}

/* ---------- study groups (shared between friends) ---------- */
// groups/{code}                  { name, owner, createdAt }   the invite code is the document id
// groups/{code}/members/{uid}    { name, days, total, studying, updatedAt }
export async function createGroup(code, name, uid) {
    const { F, db } = await load()
    await withTimeout(F.setDoc(F.doc(db, 'groups', code), { name, owner: uid, createdAt: Date.now() }))
}

// The group's data, or null when no group has this code
export async function groupInfo(code) {
    const { F, db } = await load()
    const snap = await withTimeout(F.getDoc(F.doc(db, 'groups', code)))
    return snap.exists() ? snap.data() : null
}

export async function saveMember(code, uid, card) {
    const { F, db } = await load()
    await withTimeout(F.setDoc(F.doc(db, 'groups', code, 'members', uid), card))
}

export async function leaveGroup(code, uid) {
    const { F, db } = await load()
    await withTimeout(F.deleteDoc(F.doc(db, 'groups', code, 'members', uid)))
}

// Live updates: the callback runs now and again whenever a member's card changes. Returns the stop function.
export async function watchMembers(code, onData, onError) {
    const { F, db } = await load()
    return F.onSnapshot(
        F.collection(db, 'groups', code, 'members'),
        snap => onData(snap.docs.map(d => ({ uid: d.id, ...d.data() }))),
        onError,
    )
}

// groups/{code}/shares/{uid_...}   { owner, kind, title, data, updatedAt }   data is a JSON string snapshot
export async function saveShare(code, id, share) {
    const { F, db } = await load()
    await withTimeout(F.setDoc(F.doc(db, 'groups', code, 'shares', id), share))
}

export async function deleteShare(code, id) {
    const { F, db } = await load()
    await withTimeout(F.deleteDoc(F.doc(db, 'groups', code, 'shares', id)))
}

export async function watchShares(code, onData, onError) {
    const { F, db } = await load()
    return F.onSnapshot(
        F.collection(db, 'groups', code, 'shares'),
        snap => onData(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
        onError,
    )
}

// Live data of the group document itself (weekly goal, owner)
export async function watchGroup(code, onData, onError) {
    const { F, db } = await load()
    return F.onSnapshot(F.doc(db, 'groups', code), snap => onData(snap.exists() ? snap.data() : null), onError)
}

// Only the group owner can do this (the rules check it)
export async function setGroupGoal(code, minutes) {
    const { F, db } = await load()
    await withTimeout(F.updateDoc(F.doc(db, 'groups', code), { goal: minutes }))
}

// groups/{code}/cheers/{from_to}   { from, to, kind, n, at }
export async function saveCheer(code, id, cheer) {
    const { F, db } = await load()
    await withTimeout(F.setDoc(F.doc(db, 'groups', code, 'cheers', id), cheer))
}

export async function watchCheers(code, onData, onError) {
    const { F, db } = await load()
    return F.onSnapshot(
        F.collection(db, 'groups', code, 'cheers'),
        snap => onData(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
        onError,
    )
}