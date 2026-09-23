/**
 * Everything the access pages do with Firebase, over the loader in firebase.ts.
 * The collection shapes are the access contract's; the Firestore rules check
 * every write, so a mismatch here is refused rather than stored.
 *
 *   waitlist/{email}  someone asking for access
 *   access/{email}    a grant, which is what the desktop app checks
 *
 * Doc ids are the email, lowercased and trimmed.
 */

import type { User } from "firebase/auth";
import {
  ADMIN_EMAIL,
  EMAIL_FOR_LINK,
  type Firebase,
  loadFirebase,
  setSessionMark,
} from "@/lib/firebase";
import { product } from "@/lib/product";

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

export const NOTE_LIMIT = 500;

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
      return "Your browser blocked the Google window. Allow pop-ups for this site, or use an email link instead.";
    case "auth/configuration-not-found":
    case "auth/unauthorized-domain":
    case "auth/unauthorized-continue-uri":
      return `Sign-in is not set up for this site yet, so this is our fault, not yours. Please ${write}.`;
    case "auth/operation-not-allowed":
      return `That way of signing in is switched off. Try the other one, or ${write}.`;
    case "auth/invalid-email":
    case "auth/missing-email":
      return "That does not look like an email address. Check it and try again.";
    case "auth/invalid-action-code":
    case "auth/expired-action-code":
      return "This sign-in link has expired or has already been used. Ask for a new one below.";
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
      return `The access list refused that request. If you think it should not have, ${write}.`;
  }
  if (err instanceof Error && /chunk|dynamically imported module|Loading/i.test(err.message)) {
    return "The sign-in code did not load. Check your connection and reload the page.";
  }
  return `Something went wrong${code ? ` (${code})` : ""}. Try again, or ${write}${code ? " and quote that code" : ""}.`;
}

/** Sends a passwordless sign-in link. `next` is where the link lands after it completes. */
export async function sendEmailLink(email: string, next: string) {
  const fb = await loadFirebase();
  const address = normalizeEmail(email);
  const url = new URL("/waitlist/finish", window.location.origin);
  url.searchParams.set("next", next);
  await fb.authApi.sendSignInLinkToEmail(fb.auth, address, {
    url: url.toString(),
    handleCodeInApp: true,
  });
  try {
    localStorage.setItem(EMAIL_FOR_LINK, address);
  } catch {
    // Without storage the finish page asks for the address instead.
  }
  return address;
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
  /** Signed in, has not asked yet. */
  | { kind: "none"; email: string }
  | { kind: "pending"; email: string; since: Date | null }
  | { kind: "approved"; email: string }
  /** Was approved once, and the grant has since been removed. */
  | { kind: "revoked"; email: string }
  /** Signed in with an address that is not verified, which the rules will not accept. */
  | { kind: "unverified"; email: string };

export async function standingOf(user: User): Promise<Standing> {
  const fb = await loadFirebase();
  const email = normalizeEmail(user.email ?? "");
  if (!user.emailVerified) return { kind: "unverified", email };
  const { doc, getDoc } = fb.fs;
  const grant = await getDoc(doc(fb.db, "access", email));
  if (grant.exists()) return { kind: "approved", email };
  const entry = await getDoc(doc(fb.db, "waitlist", email));
  if (!entry.exists()) return { kind: "none", email };
  const data = entry.data() as { status?: string; createdAt?: { toDate(): Date } };
  if (data.status === "approved") return { kind: "revoked", email };
  return { kind: "pending", email, since: data.createdAt?.toDate() ?? null };
}

/** Creates waitlist/{email} with exactly the keys the rules accept. */
export async function requestAccess(user: User, note: string) {
  const fb = await loadFirebase();
  const email = normalizeEmail(user.email ?? "");
  const trimmed = note.trim().slice(0, NOTE_LIMIT);
  const { doc, setDoc, serverTimestamp } = fb.fs;
  await setDoc(doc(fb.db, "waitlist", email), {
    email,
    uid: user.uid,
    createdAt: serverTimestamp(),
    status: "pending",
    ...(trimmed ? { note: trimmed } : {}),
  });
}

// Admin. The rules refuse all of these to anyone but the owner; the page only
// hides the controls from people who could not use them anyway.

export type WaitlistEntry = {
  email: string;
  note: string;
  status: string;
  createdAt: Date | null;
};

export type Grant = {
  email: string;
  via: string;
  referrerEmail: string;
  grantedAt: Date | null;
};

type Stamp = { toDate(): Date } | undefined;

export async function listWaitlist(): Promise<WaitlistEntry[]> {
  const fb = await loadFirebase();
  const { collection, getDocs, orderBy, query } = fb.fs;
  // Ordered on one field only, so no composite index is needed; pending is
  // filtered by the caller.
  const snap = await getDocs(
    query(collection(fb.db, "waitlist"), orderBy("createdAt", "desc")),
  );
  return snap.docs.map((d) => {
    const v = d.data() as { note?: string; status?: string; createdAt?: Stamp };
    return {
      email: d.id,
      note: v.note ?? "",
      status: v.status ?? "",
      createdAt: v.createdAt?.toDate() ?? null,
    };
  });
}

export async function listGrants(): Promise<Grant[]> {
  const fb = await loadFirebase();
  const { collection, getDocs, orderBy, query } = fb.fs;
  const snap = await getDocs(
    query(collection(fb.db, "access"), orderBy("grantedAt", "desc")),
  );
  return snap.docs.map((d) => {
    const v = d.data() as { via?: string; referrerEmail?: string; grantedAt?: Stamp };
    return {
      email: d.id,
      via: v.via ?? "",
      referrerEmail: v.referrerEmail ?? "",
      grantedAt: v.grantedAt?.toDate() ?? null,
    };
  });
}

/** Approval is one batch: the grant and the waitlist status change land together or not at all. */
export async function approve(admin: User, emails: string[]) {
  const fb = await loadFirebase();
  const { doc, writeBatch, serverTimestamp } = fb.fs;
  const batch = writeBatch(fb.db);
  for (const raw of emails) {
    const email = normalizeEmail(raw);
    batch.set(doc(fb.db, "access", email), {
      email,
      via: "admin",
      grantedBy: admin.uid,
      grantedAt: serverTimestamp(),
    });
    batch.update(doc(fb.db, "waitlist", email), { status: "approved" });
  }
  await batch.commit();
}

/** Revoking is deleting the grant. The desktop app notices on its next check. */
export async function revoke(email: string) {
  const fb = await loadFirebase();
  const { doc, deleteDoc } = fb.fs;
  await deleteDoc(doc(fb.db, "access", normalizeEmail(email)));
}

/** A same-site path to go to after sign-in, or the fallback. Never another origin. */
export function safeNext(raw: string | null, fallback = "/waitlist"): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) {
    return fallback;
  }
  try {
    const url = new URL(raw, window.location.origin);
    if (url.origin !== window.location.origin) return fallback;
    return url.pathname + url.search;
  } catch {
    return fallback;
  }
}
