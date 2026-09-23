"use client";

import { useEffect, useState } from "react";
import { ActionButton, ActionLink, Field } from "@/components/layout";
import { explain, normalizeEmail, safeNext } from "@/lib/access";
import { EMAIL_FOR_LINK, loadFirebase, setSessionMark } from "@/lib/firebase";

/** Marks a desktop sign-in that finished by email, so the desktop page hands off without a second click. */
export const HANDOFF_AUTO = "bay.handoffAuto";

type State =
  | { kind: "working" }
  /** The link was opened somewhere its address is not remembered: another device, or cleared storage. */
  | { kind: "ask-email"; error?: string }
  | { kind: "not-a-link" }
  | { kind: "error"; message: string }
  | { kind: "done"; next: string };

/**
 * The page an email link lands on. Opening the link is the visitor's action,
 * so this is the one page that loads the sign-in code as soon as it mounts.
 */
export function FinishLink() {
  const [state, setState] = useState<State>({ kind: "working" });
  const [email, setEmail] = useState("");

  const complete = async (address: string) => {
    setState({ kind: "working" });
    try {
      const fb = await loadFirebase();
      await fb.authApi.signInWithEmailLink(
        fb.auth,
        normalizeEmail(address),
        window.location.href,
      );
      setSessionMark(true);
      try {
        localStorage.removeItem(EMAIL_FOR_LINK);
      } catch {}
      const next = safeNext(
        new URLSearchParams(window.location.search).get("next"),
      );
      if (next.startsWith("/desktop/sign-in")) {
        try {
          sessionStorage.setItem(HANDOFF_AUTO, "1");
        } catch {}
      }
      setState({ kind: "done", next });
      // Replace, so Back does not return to a link that has been spent.
      window.location.replace(next);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "auth/invalid-email" || code === "auth/missing-email") {
        setState({
          kind: "ask-email",
          error:
            "That is not the address this link was sent to. Type the one you entered when you asked for it.",
        });
      } else {
        setState({ kind: "error", message: explain(err) });
      }
    }
  };

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const fb = await loadFirebase();
        if (!live) return;
        if (!fb.authApi.isSignInWithEmailLink(fb.auth, window.location.href)) {
          setState({ kind: "not-a-link" });
          return;
        }
        let stored: string | null = null;
        try {
          stored = localStorage.getItem(EMAIL_FOR_LINK);
        } catch {}
        if (stored) void complete(stored);
        else setState({ kind: "ask-email" });
      } catch (err) {
        if (live) setState({ kind: "error", message: explain(err) });
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  switch (state.kind) {
    case "working":
      return (
        <p data-state="working" className="text-base text-ink-soft">
          Signing you in.
        </p>
      );
    case "done":
      return (
        <p data-state="done" className="text-base text-ink-soft">
          Signed in. Taking you back to{" "}
          <a href={state.next} className="text-brass-deep underline underline-offset-2">
            where you started
          </a>
          .
        </p>
      );
    case "ask-email":
      return (
        <form
          noValidate
          data-state="ask-email"
          className="max-w-[60ch]"
          onSubmit={(e) => {
            e.preventDefault();
            if (email.trim()) void complete(email);
          }}
        >
          <p className="mb-8 text-base text-ink-soft">
            This link was opened on a different device or browser from the one
            that asked for it, so it needs the address once more. Type the
            email the link was sent to.
          </p>
          <Field
            id="email"
            label="Your email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={setEmail}
            required
          />
          <ActionButton type="submit" className="mt-8">
            Finish signing in
          </ActionButton>
          {state.error ? (
            <p role="alert" className="mt-6 border-l border-brass-deep pl-4 text-base text-ink">
              {state.error}
            </p>
          ) : null}
        </form>
      );
    case "not-a-link":
      return (
        <div data-state="not-a-link" className="max-w-[60ch]">
          <p className="text-base text-ink-soft">
            This page finishes a sign-in from an email link, and the address
            you opened is not one, or it has lost part of itself on the way.
            Open the link from the email again, or ask for a new one.
          </p>
          <ActionLink href="/waitlist" className="mt-8">
            Request access
          </ActionLink>
        </div>
      );
    case "error":
      return (
        <div data-state="error" className="max-w-[60ch]">
          <p role="alert" className="border-l border-brass-deep pl-4 text-base text-ink">
            {state.message}
          </p>
          <ActionLink href="/waitlist" className="mt-8">
            Ask for a new link
          </ActionLink>
        </div>
      );
  }
}
