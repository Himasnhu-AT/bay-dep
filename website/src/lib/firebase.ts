/**
 * The one place the site knows about Firebase, and the only third party it ever
 * talks to. See CLAUDE.md, "The one rule", for why this exists at all.
 *
 * Nothing here runs on page load. The config is plain data, and the SDK is
 * reached only through `loadFirebase()`, which pulls it in with a dynamic
 * `import()` the first time a visitor presses "Sign in with Google". Until then
 * the browser has not fetched a byte of it, let alone contacted Google.
 *
 * Joining the waitlist does not load the SDK at all: it is one REST request,
 * `joinWaitlistRequest` below, sent when the visitor presses the button. Do not import from
 * `firebase/*` anywhere else, statically or otherwise: a static import would put
 * the SDK in the page bundle and start it before anyone asked.
 *
 * These values are public by design. Access is enforced by the Firestore rules,
 * not by keeping the API key secret. The project and collection shapes are in
 * the access contract the backend and the desktop app are built against.
 */

export const firebaseConfig = {
  apiKey: "AIzaSyCv5j0n_KWnizBrE0uD7f2I4HKKez5V4fk",
  authDomain: "bay-editor-app.firebaseapp.com",
  projectId: "bay-editor-app",
  appId: "1:92159805240:web:ec5d5354eabe07d596a3cd",
  messagingSenderId: "92159805240",
  storageBucket: "bay-editor-app.firebasestorage.app",
} as const;

/** The owner. The rules decide who is an admin; this only decides what the page offers. */
export const ADMIN_EMAIL = "hyattherate2005@gmail.com";

/**
 * Set once a visitor has signed in on this browser, cleared when they sign out.
 * Its only job is to let a returning visitor's page restore their session
 * without a click. Without it, no page loads the SDK until someone presses a
 * button. It holds no token and no address.
 */
export const SESSION_MARK = "bay.signedIn";

/**
 * Joining the waitlist, as one Firestore REST commit, signed out. The SDK would
 * open a write channel (several requests, and ~100 KB of code) to make the same
 * single write; this sends exactly the document the rules accept, with the
 * server's clock for createdAt. There is deliberately no "must not exist"
 * precondition: with one, a repeat answers 409 before the rules run, which
 * tells anyone whether an address is on the list. Without it a repeat is an
 * update, which the rules refuse with the same 403 as any refusal.
 * firebase/test/rules.test.mjs pins this exact request against the rules.
 */
export function joinWaitlistRequest(email: string, note?: string): Promise<Response> {
  const root = `projects/${firebaseConfig.projectId}/databases/(default)/documents`;
  const str = (v: string) => ({ stringValue: v });
  return fetch(
    `https://firestore.googleapis.com/v1/${root}:commit?key=${firebaseConfig.apiKey}`,
    {
      method: "POST",
      credentials: "omit",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        writes: [
          {
            update: {
              name: `${root}/waitlist/${email}`,
              fields: {
                email: str(email),
                status: str("pending"),
                ...(note ? { note: str(note) } : {}),
              },
            },
            updateTransforms: [{ fieldPath: "createdAt", setToServerValue: "REQUEST_TIME" }],
          },
        ],
      }),
    },
  );
}

async function load() {
  const [app, auth, firestore] = await Promise.all([
    import("firebase/app"),
    import("firebase/auth"),
    import("firebase/firestore"),
  ]);
  const instance = app.getApps()[0] ?? app.initializeApp(firebaseConfig);
  return {
    auth: auth.getAuth(instance),
    db: firestore.getFirestore(instance),
    authApi: auth,
    fs: firestore,
  };
}

export type Firebase = Awaited<ReturnType<typeof load>>;

let loading: Promise<Firebase> | null = null;

/** Loads and starts the SDK once. Call it from an event handler, not from render. */
export function loadFirebase(): Promise<Firebase> {
  if (!loading) {
    loading = load().catch((err) => {
      // A failed chunk load (offline, blocked) must be retryable.
      loading = null;
      throw err;
    });
  }
  return loading;
}

export function hasSessionMark(): boolean {
  try {
    return localStorage.getItem(SESSION_MARK) === "1";
  } catch {
    return false;
  }
}

export function setSessionMark(on: boolean) {
  try {
    if (on) localStorage.setItem(SESSION_MARK, "1");
    else localStorage.removeItem(SESSION_MARK);
  } catch {
    // Storage blocked: the visitor will simply be asked to sign in again.
  }
}
