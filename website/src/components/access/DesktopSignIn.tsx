"use client";

import type { User } from "firebase/auth";
import { useEffect, useRef, useState } from "react";
import { ActionButton } from "@/components/layout";
import { SignIn } from "@/components/access/SignIn";
import { useAccount } from "@/components/access/useAccount";
import { standingOf } from "@/lib/access";
import { product } from "@/lib/product";

/**
 * The browser half of the desktop sign-in. The app opens this page with a
 * loopback port and a one-time state; the page signs the person in and posts
 * the tokens to that port on 127.0.0.1, and to nothing else. The app does not
 * trust what it receives: it exchanges the refresh token itself and reads the
 * grant itself. See the access contract, "Desktop sign-in handoff".
 */

type Target = { port: number; state: string };

/** Validates the query. The host is never taken from it: it is always 127.0.0.1. */
export function parseTarget(search: string): Target | null {
  const q = new URLSearchParams(search);
  const port = q.get("port") ?? "";
  const state = q.get("state") ?? "";
  if (!/^\d{4,5}$/.test(port)) return null;
  const n = Number(port);
  if (n < 1024 || n > 65535) return null;
  if (!/^[A-Za-z0-9_-]{32,512}$/.test(state)) return null;
  return { port: n, state };
}

type Handoff =
  | { kind: "ready" }
  | { kind: "sending" }
  | { kind: "sent"; access: "yes" | "no" | "unknown" }
  | { kind: "failed"; message: string };

/** What the app's answer means to the person looking at this tab. */
function explainStatus(status: number): string {
  switch (status) {
    case 403:
      return `${product.name} did not recognise this sign-in. It may have been started from a different window. Click Sign in in ${product.name} again.`;
    case 400:
      return `${product.name} could not read what this page sent. Click Sign in in ${product.name} again, and if it keeps happening, write to ${product.email}.`;
    case 410:
      return `This sign-in was already completed. If ${product.name} still asks you to sign in, click Sign in there again.`;
    default:
      return `${product.name} answered with an error (${status}). Click Sign in in ${product.name} again.`;
  }
}

async function handOff(target: Target, user: User): Promise<Response> {
  const idToken = await user.getIdToken();
  const init: RequestInit & { targetAddressSpace?: string } = {
    method: "POST",
    mode: "cors",
    credentials: "omit",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      state: target.state,
      idToken,
      refreshToken: user.refreshToken,
    }),
    // Chrome's local network access: declares that this request goes to the
    // loopback address on purpose. Ignored by browsers that do not know it.
    targetAddressSpace: "loopback",
  };
  return fetch(`http://127.0.0.1:${target.port}/callback`, init);
}

function Handing({ target, user, auto }: { target: Target; user: User; auto: boolean }) {
  const [handoff, setHandoff] = useState<Handoff>({ kind: "ready" });
  const started = useRef(false);

  const send = async () => {
    setHandoff({ kind: "sending" });
    let res: Response;
    try {
      res = await handOff(target, user);
    } catch {
      setHandoff({
        kind: "failed",
        message: `${product.name} is no longer waiting for this sign-in. It stops after five minutes, and it only listens on the Mac where you clicked Sign in. Open ${product.name} on that Mac and click Sign in again.`,
      });
      return;
    }
    if (!res.ok) {
      setHandoff({ kind: "failed", message: explainStatus(res.status) });
      return;
    }
    // The app decides access for itself; this is only so the page can say so.
    let access: "yes" | "no" | "unknown" = "unknown";
    try {
      const s = await standingOf(user);
      access = s.kind === "approved" ? "yes" : "no";
    } catch {}
    setHandoff({ kind: "sent", access });
  };

  useEffect(() => {
    if (!auto || started.current) return;
    started.current = true;
    void send();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto]);

  switch (handoff.kind) {
    case "ready":
      return (
        <div data-state="confirm" className="max-w-[60ch]">
          <p className="text-lead font-medium text-ink">
            Sign in to {product.name} as {user.email}?
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-5">
            <ActionButton onClick={() => void send()}>
              Continue as {user.email}
            </ActionButton>
          </div>
        </div>
      );
    case "sending":
      return (
        <p data-state="sending" className="text-base text-ink-soft">
          Handing the sign-in to {product.name}.
        </p>
      );
    case "failed":
      return (
        <div data-state="handoff-failed" className="max-w-[60ch]">
          <p className="text-eyebrow font-semibold text-accent-ink">
            Not handed over
          </p>
          <p role="alert" className="mt-4 text-base text-ink">
            {handoff.message}
          </p>
          <ActionButton quiet className="mt-6" onClick={() => void send()}>
            Try again
          </ActionButton>
        </div>
      );
    case "sent":
      return (
        <div data-state="handed-off" className="max-w-[60ch]">
          <p className="text-eyebrow font-semibold text-accent-ink">
            Signed in
          </p>
          <p className="mt-4 text-lead font-medium text-ink">
            Signed in. Return to {product.name}; you can close this tab.
          </p>
          {handoff.access === "no" ? (
            <p className="mt-4 text-base text-ink-soft">
              {user.email} does not have access yet. {product.name} will show
              you how to ask for it, or someone who already uses it can add you
              from inside the app.
            </p>
          ) : null}
        </div>
      );
  }
}

export function DesktopSignIn() {
  const [target, setTarget] = useState<Target | null | "unread">("unread");
  const [auto, setAuto] = useState(false);
  const { account, restore, signedIn, signOut } = useAccount();

  useEffect(() => {
    // The query is only readable on the client; the page is prerendered.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTarget(parseTarget(window.location.search));
  }, []);

  if (target === "unread") return null;

  if (!target) {
    return (
      <div data-state="bad-request" className="max-w-[60ch]">
        <p className="text-eyebrow font-semibold text-accent-ink">
          Nothing to sign in to
        </p>
        <p className="mt-4 text-base text-ink-soft">
          {product.name} opens this page itself when you click Sign in, with a
          one-time code in the address. This address has no code, or a damaged
          one, so there is nowhere to send a sign-in. Click Sign in in{" "}
          {product.name} again.
        </p>
      </div>
    );
  }

  switch (account.phase) {
    case "idle":
      return (
        <SignIn
          intro={`Sign in with the Google account that has access to ${product.name}. This tab hands the sign-in to the app on this Mac, and only to it.`}
          onSignedIn={(user) => {
            setAuto(true);
            signedIn(user);
          }}
        />
      );
    case "restoring":
      return (
        <p data-state="restoring" className="text-base text-ink-soft">
          You signed in here before. Checking that session.
        </p>
      );
    case "error":
      return (
        <div data-state="error" className="max-w-[60ch]">
          <p role="alert" className="text-base text-ink">
            {account.message}
          </p>
          <ActionButton className="mt-8" onClick={() => void restore()}>
            Try again
          </ActionButton>
        </div>
      );
    case "signed-in":
      return (
        <div>
          <p className="mb-10 flex flex-wrap items-baseline gap-x-5 gap-y-2 text-sm text-muted">
            <span>Signed in as {account.user.email}</span>
            <ActionButton quiet onClick={() => void signOut()}>
              Use a different account
            </ActionButton>
          </p>
          <Handing
            key={account.user.uid}
            target={target}
            user={account.user}
            auto={auto}
          />
        </div>
      );
  }
}

