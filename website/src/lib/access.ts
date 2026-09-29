/**
 * Everything the site's sign-in pages do with Firebase, over firebase.ts:
 * signing in with Google (for /desktop/sign-in and /admin), and the owner's
 * dashboard reads. Anyone with a verified Google account may use the app; there
 * is no grant to look up any more.
 */

import type { User } from "firebase/auth";
import { ADMIN_EMAIL, type Firebase, loadFirebase, setSessionMark } from "@/lib/firebase";
import type { CrashRow, DailyRow, InstallRow } from "@/lib/dashboard";
import { product } from "@/lib/product";

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

export function isAdmin(user: User | null): boolean {
  return (
    !!user &&
    user.emailVerified &&
    normalizeEmail(user.email ?? "") === ADMIN_EMAIL
  );
}

/**
 * The one sentence a person reads when something fails. Each says what to do
 * next, because "an error occurred" ends the visit and a recovery keeps it.
 */
export function explain(err: unknown): string {
  const code =
    typeof err === "object" && err && "code" in err
      ? String((err as { code: unknown }).code)
      : "";
  const write = `write to ${product.email}`;
  switch (code) {
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
      return "The Google window closed before sign-in finished. Try again when you are ready.";
    case "auth/popup-blocked":
      return "Your browser blocked the Google window. Allow pop-ups for this site and try again.";
    case "auth/configuration-not-found":
    case "auth/unauthorized-domain":
    case "auth/unauthorized-continue-uri":
      return `Sign-in is not set up for this site yet, so this is our fault, not yours. Please ${write}.`;
    case "auth/operation-not-allowed":
      return `Signing in with Google is switched off for this site, so this is our fault, not yours. Please ${write}.`;
    case "auth/network-request-failed":
    case "unavailable":
      return "Could not reach the sign-in service. Check your connection and try again.";
    case "auth/too-many-requests":
    case "auth/quota-exceeded":
    case "resource-exhausted":
      return "Too many attempts from here for now. Wait a few minutes and try again.";
    case "auth/user-disabled":
      return `This account has been switched off. If that is a mistake, ${write}.`;
    case "permission-denied":
      return `Firestore refused that read. This page is for the owner's account; if that is you, ${write}.`;
  }
  if (err instanceof TypeError) {
    // What fetch throws when the request never got an answer.
    return "Could not reach Google. Check your connection and try again.";
  }
  if (err instanceof Error && /chunk|dynamically imported module|Loading/i.test(err.message)) {
    return "The sign-in code did not load. Check your connection and reload the page.";
  }
  return `Something went wrong${code ? ` (${code})` : ""}. Try again, or ${write}${code ? " and quote that code" : ""}.`;
}

export async function signInWithGoogle(): Promise<User> {
  const fb = await loadFirebase();
  const provider = new fb.authApi.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  const cred = await fb.authApi.signInWithPopup(fb.auth, provider);
  setSessionMark(true);
  return cred.user;
}

export async function signOut() {
  const fb = await loadFirebase();
  await fb.authApi.signOut(fb.auth);
  setSessionMark(false);
}

/**
 * Waits for the SDK to finish restoring any saved session, then reports the
 * user. `authStateReady` resolves once, so this does not subscribe.
 */
export async function currentUser(): Promise<{ fb: Firebase; user: User | null }> {
  const fb = await loadFirebase();
  await fb.auth.authStateReady();
  const user = fb.auth.currentUser;
  if (!user) setSessionMark(false);
  return { fb, user };
}

export type Standing =
  | { kind: "approved"; email: string }
  /** A Google account whose address is not verified, which the app will not accept. */
  | { kind: "unverified"; email: string };

/**
 * Whether the app will let this account in: any Google account whose address
 * Google has verified. Nothing is read from Firestore; the app decides the same
 * way from the ID token it is handed.
 */
export async function standingOf(user: User): Promise<Standing> {
  const email = normalizeEmail(user.email ?? "");
  return user.emailVerified ? { kind: "approved", email } : { kind: "unverified", email };
}

// The owner's dashboard. The Firestore rules refuse these reads to anyone but
// the owner; the page only hides them from people who could not use them anyway.

/**
 * Most rows one dashboard load reads from each collection. The page names these
 * limits, and says when a load hit one. `daily` is ten shards a day, so 400
 * covers a 30-day window with room to spare; crashes are read newest first, so
 * a capped read drops the oldest reports, never an arbitrary handful.
 */
export const READ_CAP = { daily: 400, installs: 20000, crashes: 2000 } as const;

type Stamp = { toMillis(): number } | undefined;

async function rows(fb: Firebase, name: string, fromDay: string, cap: number) {
  const { collection, getDocs, limit, orderBy, query, where } = fb.fs;
  // One field, so Firestore's automatic single-field index serves it.
  const snap = await getDocs(
    query(collection(fb.db, name), where("day", ">=", fromDay), orderBy("day", "desc"), limit(cap)),
  );
  return snap.docs.map((d) => d.data());
}

/**
 * Crashes newest first by the moment the site received them. Filtering and
 * ordering on the same one field keeps this on the automatic single-field
 * index; `day >=` with `receivedAt` order would need a composite index.
 */
async function crashRows(fb: Firebase, fromDay: string, cap: number) {
  const { collection, getDocs, limit, orderBy, query, where } = fb.fs;
  const since = new Date(`${fromDay}T00:00:00Z`);
  const snap = await getDocs(
    query(collection(fb.db, "crashes"), where("receivedAt", ">=", since), orderBy("receivedAt", "desc"), limit(cap)),
  );
  return snap.docs.map((d) => d.data());
}

export async function loadDashboard(fromDay: string): Promise<{
  daily: DailyRow[];
  installs: InstallRow[];
  crashes: CrashRow[];
}> {
  const fb = await loadFirebase();
  const [daily, installs, crashes] = await Promise.all([
    rows(fb, "telemetry_daily", fromDay, READ_CAP.daily),
    rows(fb, "telemetry_installs", fromDay, READ_CAP.installs),
    crashRows(fb, fromDay, READ_CAP.crashes),
  ]);
  return {
    daily: daily.map((v) => ({
      day: String(v.day ?? ""),
      events: Number(v.events ?? 0),
      counts: (v.counts ?? {}) as Record<string, number>,
      exportProblems: Number(v.exportProblems ?? 0),
    })),
    installs: installs.map((v) => ({
      day: String(v.day ?? ""),
      installId: String(v.installId ?? ""),
      appVersion: String(v.appVersion ?? ""),
      lastSeen: (v.lastSeen as Stamp)?.toMillis() ?? 0,
    })),
    crashes: crashes.map((v) => ({
      signature: String(v.signature ?? ""),
      appVersion: String(v.appVersion ?? ""),
      process: String(v.process ?? ""),
      kind: String(v.kind ?? ""),
      message: String(v.message ?? ""),
      stack: typeof v.stack === "string" ? v.stack : "",
      installId: String(v.installId ?? ""),
      receivedAt: (v.receivedAt as Stamp)?.toMillis() ?? 0,
    })),
  };
}
