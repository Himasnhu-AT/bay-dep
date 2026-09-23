"use client";

import type { User } from "firebase/auth";
import { useCallback, useEffect, useState } from "react";
import { ActionButton } from "@/components/layout";
import { SignIn } from "@/components/access/SignIn";
import { SignedInAs } from "@/components/access/Waitlist";
import { useAccount } from "@/components/access/useAccount";
import {
  approve,
  explain,
  type Grant,
  isAdmin,
  listGrants,
  listWaitlist,
  revoke,
  type WaitlistEntry,
} from "@/lib/access";

const day = (d: Date | null) =>
  d
    ? d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
    : "no date";

/** One list's load state, so a refusal on grants does not blank the waitlist. */
type Loaded<T> =
  | { kind: "loading" }
  | { kind: "ok"; rows: T[] }
  | { kind: "error"; message: string };

function Row({
  aside,
  title,
  children,
}: {
  aside: React.ReactNode;
  title: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <li className="grid grid-cols-1 items-baseline gap-2.5 border-b border-line py-6 sm:grid-cols-[140px_1fr] sm:gap-8">
      <div>{aside}</div>
      <div className="min-w-0">
        <p className="font-serif text-section font-normal break-words text-ink">
          {title}
        </p>
        {children}
      </div>
    </li>
  );
}

function Lists({ admin }: { admin: User }) {
  const [waitlist, setWaitlist] = useState<Loaded<WaitlistEntry>>({ kind: "loading" });
  const [grants, setGrants] = useState<Loaded<Grant>>({ kind: "loading" });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [w, g] = await Promise.allSettled([listWaitlist(), listGrants()]);
    setWaitlist(
      w.status === "fulfilled"
        ? { kind: "ok", rows: w.value.filter((e) => e.status === "pending") }
        : { kind: "error", message: explain(w.reason) },
    );
    setGrants(
      g.status === "fulfilled"
        ? { kind: "ok", rows: g.value }
        : { kind: "error", message: explain(g.reason) },
    );
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);

  const toggle = (email: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });

  const doApprove = async (emails: string[]) => {
    if (!emails.length) return;
    setBusy(true);
    setNotice(null);
    try {
      await approve(admin, emails);
      setNotice(
        emails.length === 1
          ? `Approved ${emails[0]}.`
          : `Approved ${emails.length} addresses.`,
      );
      setPicked(new Set());
      await reload();
    } catch (err) {
      setNotice(`Nothing was approved. ${explain(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const doRevoke = async (email: string) => {
    if (!window.confirm(`Remove access for ${email}? The app stops working for them at its next check.`)) {
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      await revoke(email);
      setNotice(`Removed access for ${email}.`);
      await reload();
    } catch (err) {
      setNotice(`Access was not removed. ${explain(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {notice ? (
        <p role="status" className="mb-10 border-l border-brass-deep pl-4 text-base text-ink">
          {notice}
        </p>
      ) : null}

      <section data-state="admin-lists">
        <div className="flex flex-wrap items-baseline justify-between gap-5">
          <p className="text-eyebrow font-medium text-muted uppercase">
            Waiting, newest first
          </p>
          {waitlist.kind === "ok" && waitlist.rows.length > 0 ? (
            <ActionButton
              disabled={busy || picked.size === 0}
              onClick={() => void doApprove([...picked])}
            >
              {picked.size ? `Approve ${picked.size}` : "Approve selected"}
            </ActionButton>
          ) : null}
        </div>
        {waitlist.kind === "loading" ? (
          <p className="mt-6 text-base text-ink-soft">Loading the waitlist.</p>
        ) : waitlist.kind === "error" ? (
          <p role="alert" className="mt-6 text-base text-ink">{waitlist.message}</p>
        ) : waitlist.rows.length === 0 ? (
          <p className="mt-6 text-base text-ink-soft">Nobody is waiting.</p>
        ) : (
          <ul className="mt-6 border-t border-line">
            {waitlist.rows.map((e) => (
              <Row
                key={e.email}
                aside={
                  <label className="flex items-center gap-3 text-xs text-muted">
                    <input
                      type="checkbox"
                      checked={picked.has(e.email)}
                      onChange={() => toggle(e.email)}
                      className="accent-[var(--color-brass-deep)]"
                    />
                    {day(e.createdAt)}
                  </label>
                }
                title={e.email}
              >
                {e.note ? (
                  <p className="mt-2 max-w-[60ch] text-base whitespace-pre-wrap text-ink-soft">
                    {e.note}
                  </p>
                ) : (
                  <p className="mt-2 text-xs text-muted">No note.</p>
                )}
                <ActionButton
                  quiet
                  className="mt-4"
                  disabled={busy}
                  onClick={() => void doApprove([e.email])}
                >
                  Approve
                </ActionButton>
              </Row>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-20">
        <p className="text-eyebrow font-medium text-muted uppercase">
          Has access
        </p>
        {grants.kind === "loading" ? (
          <p className="mt-6 text-base text-ink-soft">Loading grants.</p>
        ) : grants.kind === "error" ? (
          <p role="alert" className="mt-6 text-base text-ink">{grants.message}</p>
        ) : grants.rows.length === 0 ? (
          <p className="mt-6 text-base text-ink-soft">Nobody has access yet.</p>
        ) : (
          <ul className="mt-6 border-t border-line">
            {grants.rows.map((g) => (
              <Row
                key={g.email}
                aside={
                  <span className="text-xs text-muted">
                    {day(g.grantedAt)}
                  </span>
                }
                title={g.email}
              >
                <p className="mt-2 text-xs text-muted">
                  {g.via === "referral"
                    ? `Referred by ${g.referrerEmail || "another user"}`
                    : "Approved from the waitlist"}
                </p>
                <ActionButton
                  quiet
                  className="mt-4"
                  disabled={busy}
                  onClick={() => void doRevoke(g.email)}
                >
                  Revoke
                </ActionButton>
              </Row>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export function Admin() {
  const { account, restore, signedIn, signOut } = useAccount();

  switch (account.phase) {
    case "idle":
      return (
        <SignIn
          next="/admin"
          intro="The waitlist and the grants. Sign in with the owner's address."
          onSignedIn={signedIn}
        />
      );
    case "restoring":
      return (
        <p data-state="restoring" className="text-base text-ink-soft">
          Checking the saved session.
        </p>
      );
    case "error":
      return (
        <div data-state="error">
          <p role="alert" className="text-base text-ink">{account.message}</p>
          <ActionButton className="mt-8" onClick={() => void restore()}>
            Try again
          </ActionButton>
        </div>
      );
    case "signed-in":
      return (
        <div>
          <SignedInAs user={account.user} onSignOut={() => void signOut()} />
          {isAdmin(account.user) ? (
            <Lists admin={account.user} />
          ) : (
            <div data-state="not-authorised" className="max-w-[60ch]">
              <p className="text-eyebrow font-medium text-brass-deep uppercase">
                Not authorised
              </p>
              <p className="mt-4 text-base text-ink-soft">
                {account.user.email} cannot manage access. This page is for the
                owner; the access list refuses everyone else whatever this page
                shows.
              </p>
            </div>
          )}
        </div>
      );
  }
}
