"use client";

import type { User } from "firebase/auth";
import { useState } from "react";
import { ActionButton, Field } from "@/components/layout";
import { explain, sendEmailLink, signInWithGoogle } from "@/lib/access";

/**
 * The two ways in: a link by email, or a Google account. Nothing is loaded
 * until one of the two buttons is pressed; that press is what fetches the
 * sign-in code and first contacts Google. The copy under the buttons says so,
 * because it is the one request this site makes to anyone else.
 *
 * `next` is the path the email link returns to once it is opened, so a sign-in
 * started on the desktop page finishes there.
 */
export function SignIn({
  next,
  onSignedIn,
  intro,
}: {
  next: string;
  onSignedIn: (user: User) => void;
  intro?: string;
}) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<"link" | "google" | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sendLink = async () => {
    setError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("That does not look like an email address. Check it and try again.");
      return;
    }
    setBusy("link");
    try {
      setSentTo(await sendEmailLink(email, next));
    } catch (err) {
      setError(explain(err));
    } finally {
      setBusy(null);
    }
  };

  const google = async () => {
    setError(null);
    setBusy("google");
    try {
      onSignedIn(await signInWithGoogle());
    } catch (err) {
      setError(explain(err));
    } finally {
      setBusy(null);
    }
  };

  if (sentTo) {
    return (
      <div data-state="link-sent" className="max-w-[60ch]">
        <p className="text-eyebrow font-medium text-brass-deep uppercase">
          Check your email
        </p>
        <p className="mt-4 font-serif text-lead font-light text-ink">
          A sign-in link is on its way to {sentTo}.
        </p>
        <p className="mt-4 text-base text-ink-soft">
          Open it in this browser and you will come straight back here, signed
          in. It can take a minute to arrive, and it sometimes lands in spam.
          Opening it on another device works too; you will be asked for the
          address once more.
        </p>
        <ActionButton
          quiet
          className="mt-6"
          onClick={() => {
            setSentTo(null);
            setError(null);
          }}
        >
          Use a different address
        </ActionButton>
      </div>
    );
  }

  return (
    <div data-state="signed-out" className="max-w-[60ch]">
      {intro ? <p className="mb-8 text-base text-ink-soft">{intro}</p> : null}
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void sendLink();
        }}
      >
        <Field
          id="email"
          label="Your email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={setEmail}
          required
        />
        <div className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-5">
          <ActionButton type="submit" disabled={busy !== null}>
            {busy === "link" ? "Sending" : "Email me a link"}
          </ActionButton>
          <ActionButton quiet onClick={google} disabled={busy !== null}>
            {busy === "google" ? "Waiting for Google" : "Continue with Google"}
          </ActionButton>
        </div>
      </form>
      {error ? (
        <p role="alert" className="mt-6 border-l border-brass-deep pl-4 text-base text-ink">
          {error}
        </p>
      ) : null}
      <p className="mt-8 text-xs leading-relaxed text-muted">
        Either button loads Google&rsquo;s sign-in code, which this site does
        not fetch until you press one. No password is created, and your address
        is kept only to decide who has access.
      </p>
    </div>
  );
}
