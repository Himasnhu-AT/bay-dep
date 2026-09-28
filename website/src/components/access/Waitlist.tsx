"use client";

import type { User } from "firebase/auth";
import { useEffect, useState } from "react";
import { ActionButton, ActionLink, Field } from "@/components/layout";
import { SignIn } from "@/components/access/SignIn";
import { useAccount } from "@/components/access/useAccount";
import { explain, joinWaitlist, type Standing, standingOf } from "@/lib/access";
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
    <p className="mb-10 flex flex-wrap items-baseline gap-x-5 gap-y-2 text-sm text-muted">
      <span>Signed in as {user.email}</span>
      <ActionButton quiet onClick={onSignOut}>
        Sign out
      </ActionButton>
    </p>
  );
}

function Label({ children }: { children: string }) {
  return (
    <p className="text-eyebrow font-semibold text-accent-ink">{children}</p>
  );
}

function Headline({ children }: { children: string }) {
  return (
    <p className="mt-4 text-lead font-medium break-words text-ink">{children}</p>
  );
}

const mailto = (
  <a
    href={`mailto:${product.email}`}
    className="font-medium text-accent-ink underline decoration-accent-ink/40 underline-offset-4 hover:text-ink"
  >
    {product.email}
  </a>
);

type Join =
  | { kind: "form"; error?: string }
  | { kind: "sending" }
  | { kind: "joined"; email: string };

/**
 * The waitlist itself: an address and a button, no account. Nothing leaves the
 * page until the button is pressed, and then exactly one request does.
 */
function JoinForm() {
  const [email, setEmail] = useState("");
  const [join, setJoin] = useState<Join>({ kind: "form" });

  const submit = async () => {
    setJoin({ kind: "sending" });
    try {
      setJoin({ kind: "joined", email: await joinWaitlist(email) });
    } catch (err) {
      setJoin({ kind: "form", error: explain(err) });
    }
  };

  if (join.kind === "joined") {
    return (
      <div data-state="joined" className="max-w-[60ch]" role="status">
        <Label>You&rsquo;re on the list</Label>
        <Headline>{`${join.email} is on the waitlist.`}</Headline>
        <p className="mt-4 text-base text-ink-soft">
          Access is granted by the owner, or by someone who already uses{" "}
          {product.name} and refers you from inside the app. Nothing will be
          emailed to you. Once you have access, open {product.name} and sign in
          with Google as this address.
        </p>
        <ActionButton
          quiet
          className="mt-6"
          onClick={() => {
            setEmail("");
            setJoin({ kind: "form" });
          }}
        >
          Add a different address
        </ActionButton>
      </div>
    );
  }

  return (
    <form
      noValidate
      data-state="join"
      className="max-w-[60ch]"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
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
        hint="The address of the Google account you will sign in to the app with."
        required
      />
      <ActionButton type="submit" className="mt-8" disabled={join.kind === "sending"}>
        {join.kind === "sending" ? "Joining" : "Join the waitlist"}
      </ActionButton>
      {join.kind === "form" && join.error ? (
        <p role="alert" className="mt-6 border-l border-accent-ink pl-4 text-base text-ink">
          {join.error}
        </p>
      ) : null}
      <p className="mt-6 text-sm leading-relaxed text-muted">
        Pressing the button sends your address, and nothing else, to the access
        list, which is kept in Google&rsquo;s Firestore and read by one person.
        Nothing on this page contacts anyone before that.
      </p>
    </form>
  );
}

/** What a signed-in account can learn: whether it has access. */
function StandingView({ user }: { user: User }) {
  const [view, setView] = useState<View>({ kind: "checking" });

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
          <p role="alert" className="text-base text-ink">
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
            Google has not verified {view.email} for this account, so the access
            list will not accept it. Sign out and use a Google account whose
            address is verified.
          </p>
        </div>
      );
    case "none":
      return (
        <div data-state="no-access" className="max-w-[60ch]">
          <Label>No access yet</Label>
          <Headline>{`${view.email} does not have access yet.`}</Headline>
          <p className="mt-4 text-base text-ink-soft">
            If you joined the waitlist with this address, it is on the list, and
            there is nothing more to do. The owner grants access, or someone who
            already uses {product.name} can refer you from inside the app. If
            you have not joined, use the form above.
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
                Download {product.name} (for Macs with Apple silicon), open it,
                and sign in with Google as this address. You sign in once; after that it works offline.
              </p>
              <ActionLink href={product.download} className="mt-8">
                Download for Mac
              </ActionLink>
            </>
          ) : (
            <p className="mt-4 text-base text-ink-soft">
              Sign in from the app with Google as this address. You sign in
              once; after that it works offline. There is no download on this
              site yet, so if you do not have a build, write to {mailto}.
            </p>
          )}
        </div>
      );
  }
}

/**
 * Checking access: Google sign-in, secondary to joining. It loads nothing until
 * pressed, except on a browser that signed in here before (the session mark).
 */
function AccessCheck() {
  const { account, restore, signedIn, signOut } = useAccount();

  switch (account.phase) {
    case "idle":
      return (
        <SignIn
          quiet
          intro="Sign in to see whether your address has been granted access."
          onSignedIn={signedIn}
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
          <SignedInAs user={account.user} onSignOut={() => void signOut()} />
          <StandingView key={account.user.uid} user={account.user} />
        </div>
      );
  }
}

/** The waitlist page: join first; checking access is the secondary path. */
export function Waitlist() {
  return (
    <div>
      <JoinForm />
      <section className="mt-20 border-t border-line pt-12">
        <h2 className="text-section font-semibold text-ink">
          Already have access?
        </h2>
        <div className="mt-4">
          <AccessCheck />
        </div>
      </section>
    </div>
  );
}
