"use client";

import type { User } from "firebase/auth";
import { useState } from "react";
import { ActionButton } from "@/components/layout";
import { explain, signInWithGoogle } from "@/lib/access";

/**
 * Sign in with Google, the only way in. Nothing is loaded until the button is
 * pressed; that press is what fetches the sign-in code and first contacts
 * Google. The line under the button says so, because it is the one request
 * this page makes to anyone else.
 *
 * `quiet` makes the button an underlined word, for a page whose main action is
 * something else.
 */
export function SignIn({
  onSignedIn,
  intro,
  quiet = false,
}: {
  onSignedIn: (user: User) => void;
  intro?: string;
  quiet?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const google = async () => {
    setError(null);
    setBusy(true);
    try {
      onSignedIn(await signInWithGoogle());
    } catch (err) {
      setError(explain(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-state="signed-out" className="max-w-[60ch]">
      {intro ? <p className="mb-8 text-base text-ink-soft">{intro}</p> : null}
      <ActionButton quiet={quiet} onClick={google} disabled={busy}>
        {busy ? "Waiting for Google" : "Sign in with Google"}
      </ActionButton>
      {error ? (
        <p role="alert" className="mt-6 border-l border-accent-ink pl-4 text-base text-ink">
          {error}
        </p>
      ) : null}
      <p className="mt-6 text-sm leading-relaxed text-muted">
        The button loads Google&rsquo;s sign-in code, which this site does not
        fetch until you press it. No password is created, and your address is
        used only to sign you in.
      </p>
    </div>
  );
}
