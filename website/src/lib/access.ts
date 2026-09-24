/**
 * Everything the access pages do with Firebase, over firebase.ts.
 * The collection shapes are the access contract's; the Firestore rules check
 * every write, so a mismatch here is refused rather than stored.
 *
 *   waitlist/{email}  someone asking for access; written signed out, read by
 *                     the admin alone
 *   access/{email}    a grant, which is what the desktop app checks
 *
 * Doc ids are the email, lowercased and trimmed. Signing in is Google only.
 */

import type { User } from "firebase/auth";
import {
  ADMIN_EMAIL,
  type Firebase,
  joinWaitlistRequest,
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
      return "Your browser blocked the Google window. Allow pop-ups for this site and try again.";
    case "auth/configuration-not-found":
    case "auth/unauthorized-domain":
    case "auth/unauthorized-continue-uri":
      return `Sign-in is not set up for this site yet, so this is our fault, not yours. Please ${write}.`;
    case "auth/operation-not-allowed":
      return `Signing in with Google is switched off for this site, so this is our fault, not yours. Please ${write}.`;
    case "invalid-email":
      return "That does not look like an email address. Check it and try again.";
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
  if (err instanceof TypeError) {
    // What fetch throws when the request never got an answer.
    return "Could not reach the access list. Check your connection and try again.";
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
  /** No grant for this address. Whether it is on the waitlist is private to the admin. */
  | { kind: "none"; email: string }
  /** A Google account whose address is not verified, which the rules will not accept. */
  | { kind: "unverified"; email: string };

/** Whether the signed-in account has access: its own grant is the one thing it may read. */
export async function standingOf(user: User): Promise<Standing> {
  const fb = await loadFirebase();
  const email = normalizeEmail(user.email ?? "");
  if (!user.emailVerified) return { kind: "unverified", email };
  const { doc, getDoc } = fb.fs;
  const grant = await getDoc(doc(fb.db, "access", email));
  return grant.exists() ? { kind: "approved", email } : { kind: "none", email };
}

/**
 * The same address test the rules apply to a waitlist entry's id, so a visitor
 * is told about a typo here rather than getting a refusal from the server. Keep
 * the two in step: firebase/firestore.rules, `isJoinableEmail`.
 */
export const isJoinableEmail = (email: string) =>
  email.length <= 254 &&
  /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(email);

export class JoinError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

/**
 * Puts an address on the waitlist, signed out, in one request. Resolves with
 * the address as stored.
 *
 * A refusal (403) is treated as joined. The rules refuse a well-formed entry
 * for one reason only, that the address is already on the list, and the caller
 * has already checked the address against the same pattern the rules use. The
 * entry is not readable by the visitor (the list is private), so a repeat join
 * cannot be told from a first one, and saying "you're on the list" is true in
 * both cases.
 */
export async function joinWaitlist(raw: string, note = ""): Promise<string> {
  const email = normalizeEmail(raw);
  if (!isJoinableEmail(email)) throw new JoinError("invalid-email");
  const res = await joinWaitlistRequest(email, note.trim().slice(0, NOTE_LIMIT) || undefined);
  if (res.ok || res.status === 403) return email;
  throw new JoinError(res.status === 429 ? "resource-exhausted" : res.status >= 500 ? "unavailable" : `http-${res.status}`);
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

/** The same test the rules apply to a grant's id: lowercase, no whitespace, one @. */
export const isGrantableEmail = (email: string) =>
  /^[^@\s/]+@[^@\s/]+\.[^@\s/]+$/.test(email);

/**
 * A direct grant from the admin page's form, for an address that never joined
 * the waitlist (or did: its entry is marked approved in the same batch, so it
 * leaves the pending list). It reads first, because over an existing grant the
 * write would be an update, which the rules let the admin make, and it would
 * overwrite a referral's record of who referred whom. So an address that
 * already has access is reported, not re-granted.
 */
export async function grant(admin: User, raw: string): Promise<"granted" | "exists"> {
  const fb = await loadFirebase();
  const email = normalizeEmail(raw);
  const { doc, getDoc, writeBatch, serverTimestamp } = fb.fs;
  const ref = doc(fb.db, "access", email);
  if ((await getDoc(ref)).exists()) return "exists";
  const entry = await getDoc(doc(fb.db, "waitlist", email));
  const batch = writeBatch(fb.db);
  batch.set(ref, {
    email,
    via: "admin",
    grantedBy: admin.uid,
    grantedAt: serverTimestamp(),
  });
  if (entry.exists()) batch.update(entry.ref, { status: "approved" });
  await batch.commit();
  return "granted";
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
