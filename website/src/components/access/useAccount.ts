"use client";

import type { User } from "firebase/auth";
import { useCallback, useEffect, useState } from "react";
import { currentUser, explain, signOut as doSignOut } from "@/lib/access";
import { hasSessionMark, setSessionMark } from "@/lib/firebase";

export type Account =
  /** Nobody has signed in on this browser, and nothing has been loaded. */
  | { phase: "idle" }
  /** Someone signed in here before; the SDK is restoring that session. */
  | { phase: "restoring" }
  | { phase: "signed-in"; user: User }
  | { phase: "error"; message: string };

/**
 * The account on this page. It loads the SDK on mount only when this browser
 * has signed in before (the session mark); otherwise it stays idle until the
 * visitor presses a sign-in button, and no request leaves the page.
 */
export function useAccount() {
  const [account, setAccount] = useState<Account>({ phase: "idle" });

  const restore = useCallback(async () => {
    setAccount({ phase: "restoring" });
    try {
      const { user } = await currentUser();
      setAccount(user ? { phase: "signed-in", user } : { phase: "idle" });
    } catch (err) {
      setAccount({ phase: "error", message: explain(err) });
    }
  }, []);

  useEffect(() => {
    // Reading storage has to wait for the client, so this runs after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (hasSessionMark()) void restore();
  }, [restore]);

  const signedIn = useCallback((user: User) => {
    setSessionMark(true);
    setAccount({ phase: "signed-in", user });
  }, []);

  const signOut = useCallback(async () => {
    try {
      await doSignOut();
    } finally {
      setSessionMark(false);
      setAccount({ phase: "idle" });
    }
  }, []);

  return { account, restore, signedIn, signOut };
}
