/**
 * SafeRoute Lite - Demo Mode Verification
 *
 * SafeRoute Lite supports two distinct session types:
 * 1. Demo Mode (Guest Account):
 *    - Activated ONLY when the user clicks "Enter as Guest (Demo Mode)".
 *    - Specifically identified by uid: "guest-palanan-user", email: "guest@commuter.com", or "Guest Resident".
 *    - Used for presentations and demonstrations without creating false/test records in Firebase.
 *    - In this mode, danger reporting to Firebase is disabled with a Demo Mode notice.
 *
 * 2. Registered Accounts:
 *    - Authentic residents who logged in or registered using their email, phone number, or Google account.
 *    - DEMO MODE IS NEVER ACTIVE for registered accounts.
 *    - Fully allowed to submit real danger reports (within Barangay Palanan), create spots, and interact with Firebase.
 */

export function isDemoMode(user?: any, profile?: any): boolean {
  if (!user && !profile) {
    return false;
  }

  const uid = String(user?.uid || profile?.uid || '').trim().toLowerCase();
  const email = String(user?.email || profile?.email || '').trim().toLowerCase();
  const name = String(user?.displayName || profile?.name || '').trim().toLowerCase();

  // Explicit check for Guest / Demo account
  if (
    user?.isGuest === true ||
    profile?.isGuest === true ||
    uid === 'guest-palanan-user' ||
    uid === 'guest' ||
    uid === 'demo-user' ||
    email === 'guest@commuter.com' ||
    name === 'guest resident' ||
    name === 'guest user'
  ) {
    return true;
  }

  // Any user with a registered account is NOT in Demo Mode
  return false;
}

// Deprecated global constant - defaults to false so registered accounts are never blocked globally
export const DEMO_MODE = false;
