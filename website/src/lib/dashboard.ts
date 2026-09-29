/**
 * What /admin shows, worked out from the rows it reads (src/lib/access.ts,
 * `loadDashboard`). Pure, so the test runs it under plain Node.
 */

import { dayOf, EXPORT_EVENTS } from "@/lib/telemetry";

export type DailyRow = { day: string; events: number; counts: Record<string, number> };
export type InstallRow = { day: string; installId: string; appVersion: string; lastSeen: number };
export type CrashRow = {
  signature: string;
  appVersion: string;
  process: string;
  kind: string;
  message: string;
  stack: string;
  installId: string;
  receivedAt: number;
};

export type CrashGroup = {
  signature: string;
  count: number;
  installs: number;
  firstSeen: number;
  lastSeen: number;
  versions: string[];
  process: string;
  kind: string;
  /** The newest report's message and stack. */
  message: string;
  stack: string;
};

export type Summary = {
  /** Every day of the window, oldest first, with its distinct installs and events. */
  days: { day: string; installs: number; events: number }[];
  /** Distinct installs across the whole window. */
  installs: number;
  /** Each install counted once, under the newest version it reported in the window. */
  versions: { version: string; installs: number }[];
  counts: { name: string; count: number }[];
  exports: { ok: number; failed: number };
  crashes: CrashGroup[];
};

/** The window's days, oldest first, ending today (UTC). */
export function windowDays(span: number, now = Date.now()): string[] {
  return Array.from({ length: span }, (_, i) => dayOf(now - (span - 1 - i) * 86_400_000));
}

const byCount = <T extends { count: number }>(a: T, b: T) => b.count - a.count;

export function summarize(
  days: string[],
  daily: DailyRow[],
  installs: InstallRow[],
  crashes: CrashRow[],
): Summary {
  const inWindow = new Set(days);

  const perDay = new Map<string, Set<string>>();
  const newest = new Map<string, InstallRow>();
  for (const row of installs) {
    if (!inWindow.has(row.day)) continue;
    let set = perDay.get(row.day);
    if (!set) perDay.set(row.day, (set = new Set()));
    set.add(row.installId);
    const seen = newest.get(row.installId);
    if (!seen || row.day > seen.day || (row.day === seen.day && row.lastSeen > seen.lastSeen)) {
      newest.set(row.installId, row);
    }
  }

  const versions = new Map<string, number>();
  for (const row of newest.values()) versions.set(row.appVersion, (versions.get(row.appVersion) ?? 0) + 1);

  const counts = new Map<string, number>();
  const eventsPerDay = new Map<string, number>();
  for (const row of daily) {
    if (!inWindow.has(row.day)) continue;
    eventsPerDay.set(row.day, (eventsPerDay.get(row.day) ?? 0) + row.events);
    for (const [name, count] of Object.entries(row.counts)) {
      counts.set(name, (counts.get(name) ?? 0) + Number(count));
    }
  }

  const groups = new Map<string, CrashGroup & { ids: Set<string>; vers: Set<string> }>();
  for (const c of crashes) {
    if (!inWindow.has(dayOf(c.receivedAt))) continue;
    const g = groups.get(c.signature);
    if (!g) {
      groups.set(c.signature, {
        signature: c.signature,
        count: 1,
        installs: 0,
        firstSeen: c.receivedAt,
        lastSeen: c.receivedAt,
        versions: [],
        process: c.process,
        kind: c.kind,
        message: c.message,
        stack: c.stack,
        ids: new Set([c.installId]),
        vers: new Set([c.appVersion]),
      });
      continue;
    }
    g.count += 1;
    g.ids.add(c.installId);
    g.vers.add(c.appVersion);
    g.firstSeen = Math.min(g.firstSeen, c.receivedAt);
    if (c.receivedAt >= g.lastSeen) {
      g.lastSeen = c.receivedAt;
      g.message = c.message;
      g.stack = c.stack;
      g.process = c.process;
      g.kind = c.kind;
    }
  }

  return {
    days: days.map((day) => ({
      day,
      installs: perDay.get(day)?.size ?? 0,
      events: eventsPerDay.get(day) ?? 0,
    })),
    installs: newest.size,
    versions: [...versions]
      .map(([version, n]) => ({ version, installs: n }))
      .sort((a, b) => b.installs - a.installs || b.version.localeCompare(a.version, undefined, { numeric: true })),
    counts: [...counts].map(([name, count]) => ({ name, count })).sort(byCount),
    exports: { ok: counts.get(EXPORT_EVENTS.ok) ?? 0, failed: counts.get(EXPORT_EVENTS.failed) ?? 0 },
    crashes: [...groups.values()]
      .map(({ ids, vers, ...g }) => ({
        ...g,
        installs: ids.size,
        versions: [...vers].sort((a, b) => b.localeCompare(a, undefined, { numeric: true })),
      }))
      .sort((a, b) => b.count - a.count || b.lastSeen - a.lastSeen),
  };
}
