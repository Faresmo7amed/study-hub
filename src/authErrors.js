// Turns a Firebase error into a sentence a person can act on. Used by the login page and the account window.
export const friendly = err => {
    const code = (err && err.code) || ''
    const map = {
        'auth/invalid-credential': 'Wrong email or password.',
        'auth/wrong-password': 'Wrong email or password.',
        'auth/user-not-found': 'Wrong email or password.',
        'auth/invalid-email': 'That email address does not look right.',
        'auth/email-already-in-use': 'An account with this email already exists. Try signing in.',
        'auth/weak-password': 'Use a password with at least 6 characters.',
        'auth/too-many-requests': 'Too many attempts. Wait a few minutes and try again.',
        'auth/network-request-failed': 'No connection. Check your internet and try again.',
        'auth/popup-closed-by-user': 'The Google window was closed before signing in.',
        'auth/popup-blocked': 'Your browser blocked the Google window. Allow pop-ups or use email and password.',
        'auth/operation-not-allowed': 'This sign-in method is turned off, or new sign-ups are disabled.',
        'auth/unauthorized-domain': 'This web address is not allowed yet. Add it under Authentication, Settings, Authorized domains.',
        'auth/requires-recent-login': 'For safety, sign out, sign in again, and then retry.',
        'permission-denied': 'The cloud refused this. Your account may not be approved yet, or the Firestore rules were not published.',
    }
    return map[code] || (err && err.message) || 'Something went wrong.'
}
