"use client";

import { useCallback, useEffect, useState } from "react";
import { ActionButton, BarList, Stat } from "@/components/layout";
import { SignIn } from "@/components/access/SignIn";
import { SignedInAs } from "@/components/access/SignedInAs";
import { useAccount } from "@/components/access/useAccount";
import { explain, isAdmin, loadDashboard, READ_CAP } from "@/lib/access";
import { type CrashGroup, type Summary, summarize, windowDays } from "@/lib/dashboard";
import { EXPORT_EVENTS } from "@/lib/telemetry";

const when = (ms: number) =>
  ms
    ? new Date(ms).toLocaleString(undefined, {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "no date";

const shortDay = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

type Loaded =
  | { kind: "loading" }
  | { kind: "ok"; summary: Summary; capped: string[] }
  | { kind: "error"; message: string };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-16 border-t border-line pt-10">
      <h2 className="text-section font-semibold text-ink">{title}</h2>
      <div className="mt-6">{children}</div>
    </section>
  );
}

function Crash({ group }: { group: CrashGroup }) {
  return (
    <li className="border-b border-line py-6">
      <details>
        <summary className="cursor-pointer list-none">
          <div className="grid grid-cols-1 items-baseline gap-2 sm:grid-cols-[120px_1fr] sm:gap-8">
            <p className="text-sm text-ink tabular-nums">
              {group.count.toLocaleString("en")}{" "}
              <span className="text-muted">
                {group.count === 1 ? "report" : "reports"}
              </span>
            </p>
            <div className="min-w-0">
              <p className="text-base font-medium break-words text-ink">
                {group.message || "No message"}
              </p>
              <p className="mt-1.5 text-xs text-muted">
                {group.process}, {group.kind}. {group.installs}{" "}
                {group.installs === 1 ? "install" : "installs"}. First{" "}
                {when(group.firstSeen)}, last {when(group.lastSeen)}. Versions{" "}
                {group.versions.join(", ")}.
              </p>
            </div>
          </div>
        </summary>
        <div className="mt-4 sm:ml-[152px]">
          {group.stack ? (
            <pre className="max-h-96 overflow-auto rounded-[12px] border border-line bg-paper-raised p-4 font-app-mono text-xs leading-relaxed whitespace-pre-wrap text-ink-soft">
              {group.stack}
            </pre>
          ) : (
            <p className="text-sm text-muted">The newest report carried no stack.</p>
          )}
          <p className="mt-2 font-app-mono text-xs text-muted">{group.signature}</p>
        </div>
      </details>
    </li>
  );
}

function Dashboard() {
  const [span, setSpan] = useState<7 | 30>(7);
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });

  const load = useCallback(async (days: number) => {
    setLoaded({ kind: "loading" });
    const range = windowDays(days);
    try {
      const { daily, installs, crashes } = await loadDashboard(range[0]);
      const capped = [
        installs.length >= READ_CAP.installs ? `${READ_CAP.installs.toLocaleString("en")} install-days` : "",
        crashes.length >= READ_CAP.crashes ? `${READ_CAP.crashes.toLocaleString("en")} crash reports` : "",
      ].filter(Boolean);
      setLoaded({ kind: "ok", summary: summarize(range, daily, installs, crashes), capped });
    } catch (err) {
      setLoaded({ kind: "error", message: explain(err) });
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(span);
  }, [load, span]);

  const other = span === 7 ? 30 : 7;

  return (
    <div data-state="dashboard">
      <div className="flex flex-wrap items-baseline justify-between gap-5">
        <p className="text-lead font-medium text-ink">The last {span} days</p>
        <div className="flex gap-6">
          <ActionButton quiet onClick={() => setSpan(other)} disabled={loaded.kind === "loading"}>
            Show the last {other} days
          </ActionButton>
          <ActionButton quiet onClick={() => void load(span)} disabled={loaded.kind === "loading"}>
            Reload
          </ActionButton>
        </div>
      </div>
      <p className="mt-2 text-sm text-muted">
        Days are UTC, by when this site received the report.
      </p>

      {loaded.kind === "loading" ? (
        <p className="mt-10 text-base text-ink-soft">Reading telemetry.</p>
      ) : loaded.kind === "error" ? (
        <div className="mt-10">
          <p role="alert" className="border-l border-accent-ink pl-4 text-base text-ink">
            {loaded.message}
          </p>
        </div>
      ) : (
        <Figures summary={loaded.summary} capped={loaded.capped} span={span} />
      )}
    </div>
  );
}

function Figures({ summary, capped, span }: { summary: Summary; capped: string[]; span: number }) {
  const today = summary.days[summary.days.length - 1];
  const exports = summary.exports.ok + summary.exports.failed;
  return (
    <>
      {capped.length ? (
        <p role="status" className="mt-8 border-l border-accent-ink pl-4 text-base text-ink">
          This read stopped at {capped.join(" and ")}, so the figures below are
          short. Look at a shorter window.
        </p>
      ) : null}

      <div className="mt-10 grid grid-cols-2 gap-x-10 gap-y-8 sm:grid-cols-4">
        <Stat value={summary.installs.toLocaleString("en")} label={`installs active in ${span} days`} />
        <Stat value={(today?.installs ?? 0).toLocaleString("en")} label="installs active today" />
        <Stat value={summary.exports.ok.toLocaleString("en")} label={`exports finished (${EXPORT_EVENTS.ok})`} />
        <Stat
          value={summary.exports.failed.toLocaleString("en")}
          label={
            exports
              ? `exports failed, ${Math.round((summary.exports.failed / exports) * 100)}% of ${exports.toLocaleString("en")}`
              : `exports failed (${EXPORT_EVENTS.failed})`
          }
        />
      </div>

      <Section title="Active installs per day">
        <BarList
          rows={[...summary.days].reverse().map((d) => ({
            key: d.day,
            label: shortDay(d.day),
            value: d.installs,
            note: `${d.events.toLocaleString("en")} events`,
          }))}
        />
      </Section>

      <Section title="App versions">
        <BarList
          empty="No install has reported in this window."
          rows={summary.versions.map((v) => ({ key: v.version, label: v.version, value: v.installs }))}
        />
        <p className="mt-4 text-xs text-muted">
          Each install counted once, under the newest version it reported.
        </p>
      </Section>

      <Section title="Events by name">
        <BarList
          empty="No events in this window."
          rows={summary.counts.map((c) => ({
            key: c.name,
            label: <span className="font-app-mono text-xs">{c.name}</span>,
            value: c.count,
          }))}
        />
      </Section>

      <Section title="Crashes, grouped by signature">
        {summary.crashes.length ? (
          <ul className="border-t border-line">
            {summary.crashes.map((g) => (
              <Crash key={g.signature} group={g} />
            ))}
          </ul>
        ) : (
          <p className="text-base text-ink-soft">No crash reports in this window.</p>
        )}
      </Section>
    </>
  );
}

export function Admin() {
  const { account, restore, signedIn, signOut } = useAccount();

  switch (account.phase) {
    case "idle":
      return (
        <SignIn
          intro="Usage and crash reports from the app. Sign in with the owner's Google account."
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
            <Dashboard />
          ) : (
            <div data-state="not-authorised" className="max-w-[60ch]">
              <p className="text-eyebrow font-semibold text-accent-ink">
                Not authorised
              </p>
              <p className="mt-4 text-base text-ink-soft">
                {account.user.email} cannot read the reports. This page is for
                the owner; Firestore refuses everyone else whatever this page
                shows.
              </p>
            </div>
          )}
        </div>
      );
  }
}
