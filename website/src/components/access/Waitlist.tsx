"use client";

import type { User } from "firebase/auth";
import { useEffect, useState } from "react";
import { ActionButton, ActionLink, Field } from "@/components/layout";
import { SignIn } from "@/components/access/SignIn";
import { useAccount } from "@/components/access/useAccount";
import {
  explain,
  NOTE_LIMIT,
  requestAccess,
  type Standing,
  standingOf,
} from "@/lib/access";
import { product } from "@/lib/product";

type View =
  | { kind: "checking" }
  | { kind: "error"; message: string }
  | Standing;

/** The signed-in line, with the way out. */
export function SignedInAs({
  user,
  onSignOut,
}: {
  user: User;
  onSignOut: () => void;
}) {
  return (
    <p className="mb-10 flex flex-wrap items-baseline gap-x-5 gap-y-2 text-xs tracking-[0.04em] text-muted">
      <span>Signed in as {user.email}</span>
      <ActionButton quiet onClick={onSignOut}>
        Sign out
      </ActionButton>
    </p>
  );
}

function Label({ children }: { children: string }) {
  return (
    <p className="text-eyebrow font-medium text-brass-deep uppercase">{children}</p>
  );
}

function Headline({ children }: { children: string }) {
  return (
    <p className="mt-4 font-serif text-lead font-light text-ink">{children}</p>
  );
}

function StandingView({ user }: { user: User }) {
  const [view, setView] = useState<View>({ kind: "checking" });
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let live = true;
    standingOf(user).then(
      (s) => live && setView(s),
      (err) => live && setView({ kind: "error", message: explain(err) }),
    );
    return () => {
      live = false;
    };
  }, [user]);

  const submit = async () => {
    setSending(true);
    try {
      await requestAccess(user, note);
      setView(await standingOf(user));
    } catch (err) {
      setView({ kind: "error", message: explain(err) });
    } finally {
      setSending(false);
    }
  };

  switch (view.kind) {
    case "checking":
      return (
        <p data-state="checking" className="text-base text-ink-soft">
          Looking up your address on the access list.
        </p>
      );
    case "error":
      return (
        <div data-state="error" className="max-w-[60ch]">
          <Label>Something went wrong</Label>
          <p role="alert" className="mt-4 text-base text-ink">
            {view.message}
          </p>
          <ActionButton
            className="mt-8"
            onClick={() => {
              setView({ kind: "checking" });
              standingOf(user).then(setView, (err) =>
                setView({ kind: "error", message: explain(err) }),
              );
            }}
          >
            Try again
          </ActionButton>
        </div>
      );
    case "unverified":
      return (
        <div data-state="unverified" className="max-w-[60ch]">
          <Label>Address not verified</Label>
          <p className="mt-4 text-base text-ink-soft">
            {view.email} has not been verified, so it cannot go on the list.
            Sign out and sign in with an email link instead, which verifies the
            address as you use it.
          </p>
        </div>
      );
    case "none":
      return (
        <form
          data-state="request"
          className="max-w-[60ch]"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Label>Ask for access</Label>
          <Headline>{`${view.email} is not on the list yet.`}</Headline>
          <p className="mt-4 mb-8 text-base text-ink-soft">
            Send the request and it waits for someone to read it. If a person
            who already uses {product.name} sent you here, say who; they can
            also add you from inside the app.
          </p>
          <Field
            id="note"
            label="A note, if you want"
            multiline
            maxLength={NOTE_LIMIT}
            placeholder="Who you know, or what you would edit"
            value={note}
            onChange={setNote}
            hint={`${note.trim().length} of ${NOTE_LIMIT} characters`}
          />
          <ActionButton type="submit" className="mt-8" disabled={sending}>
            {sending ? "Sending" : "Request access"}
          </ActionButton>
        </form>
      );
    case "pending":
      return (
        <div data-state="pending" className="max-w-[60ch]">
          <Label>Requested</Label>
          <Headline>Your request is on the list.</Headline>
          <p className="mt-4 text-base text-ink-soft">
            {view.since
              ? `You asked on ${view.since.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}. `
              : ""}
            Nothing else is needed from you. Come back to this page to see
            whether it has been approved; there is no newsletter and no
            reminder email.
          </p>
        </div>
      );
    case "approved":
      return (
        <div data-state="approved" className="max-w-[60ch]">
          <Label>Approved</Label>
          <Headline>{`You're in. ${view.email} has access.`}</Headline>
          {product.download ? (
            <>
              <p className="mt-4 text-base text-ink-soft">
                Download {product.name}, open it, and sign in with this address.
                You sign in once; after that it works offline.
              </p>
              <ActionLink href={product.download} className="mt-8">
                Download for Mac
              </ActionLink>
            </>
          ) : (
            <p className="mt-4 text-base text-ink-soft">
              Sign in from the app with this address. You sign in once; after
              that it works offline. There is no download on this site yet, so
              if you do not have a build, write to{" "}
              <a
                href={`mailto:${product.email}`}
                className="text-brass-deep underline underline-offset-2 hover:text-ink"
              >
                {product.email}
              </a>
              .
            </p>
          )}
        </div>
      );
    case "revoked":
      return (
        <div data-state="revoked" className="max-w-[60ch]">
          <Label>Access removed</Label>
          <p className="mt-4 text-base text-ink-soft">
            {view.email} was approved once and no longer has access. If you
            think that is a mistake, write to{" "}
            <a
              href={`mailto:${product.email}`}
              className="text-brass-deep underline underline-offset-2 hover:text-ink"
            >
              {product.email}
            </a>
            .
          </p>
        </div>
      );
  }
}

/** The request-access flow: sign in, then see or change where you stand. */
export function Waitlist() {
  const { account, restore, signedIn, signOut } = useAccount();

  switch (account.phase) {
    case "idle":
      return <SignIn next="/waitlist" onSignedIn={signedIn} />;
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
          <SignedInAs user={account.user} onSignOut={() => void signOut()} />
          <StandingView key={account.user.uid} user={account.user} />
        </div>
      );
  }
}
