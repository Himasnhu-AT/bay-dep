/**
 * What the app may send to /api/telemetry and /api/crash, checked field by field.
 *
 * This file is the contract. The desktop app's client is written against it, and
 * each refusal names the field that was wrong, because the only reader of a 400
 * is a developer looking at the app's log, and "bad request" tells them nothing.
 *
 * It imports only src/lib/telemetry-contract.ts (the app's allow-list, copied
 * verbatim, itself import-free), so `pnpm test` can run it under plain Node and
 * /admin can use its names in the browser.
 *
 * Unknown keys are ignored, not refused, so a newer app can add a field without
 * an older site turning it away. Only the fields named here are ever stored.
 *
 * Two layers, and they answer differently. The SHAPE (the app's own
 * `telemetryBatchProblem`) is a 400 naming the field: the same bytes would be
 * refused again. The ALLOW-LIST (`TELEMETRY_EVENTS`) drops rather than refuses:
 * an event whose name is not listed is left out, and so is any prop not listed
 * for its event or of the wrong type, so a newer app with a new event still
 * delivers the rest of its batch. The privacy rule is enforced here, whatever
 * the app sent; a batch with nothing left is accepted and nothing is written.
 */

import { sanitizeEvent } from "@/lib/telemetry-contract";

export const BODY_LIMIT = 256 * 1024;

export const EVENT_NAME = /^[a-z0-9_.]+$/;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const PROCESSES = ["main", "renderer", "gpu", "utility", "child", "composition"] as const;
export const KINDS = ["exception", "rejection", "process-gone", "renderer-error"] as const;

/**
 * The event names /admin reads for "exports finished vs failed". An export_done
 * whose props say `ok: false` or `incomplete: true` is also counted as finished
 * with problems (telemetry-store.ts, `exportProblems`). Any other name is counted
 * under its own name and nothing more.
 */
export const EXPORT_EVENTS = { ok: "export_done", failed: "export_failed" } as const;

export type PropValue = string | number | boolean;

export type Envelope = {
  v: 1;
  installId: string;
  appVersion: string;
  os: "darwin";
  osVersion: string;
  arch: string;
};

export type TelemetryEvent = {
  name: string;
  at: number;
  props?: Record<string, PropValue>;
};

export type TelemetryBatch = Envelope & { events: TelemetryEvent[] };

export type CrashReport = Envelope & {
  at: number;
  process: (typeof PROCESSES)[number];
  kind: (typeof KINDS)[number];
  message: string;
  stack?: string;
  reason?: string;
  exitCode?: number;
};

export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

class Refusal extends Error {}

const fail = (message: string): never => {
  throw new Refusal(message);
};

/** A short, quoted echo of what arrived, so the message says what was wrong with it. */
function shown(value: unknown): string {
  if (value === undefined) return "nothing";
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  if (typeof value === "object") return "an object";
  if (typeof value === "string") {
    return JSON.stringify(value.length > 40 ? `${value.slice(0, 40)}…` : value);
  }
  return String(value);
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function str(obj: Record<string, unknown>, key: string, path: string, max: number, min = 1): string {
  const v = obj[key];
  if (typeof v !== "string") fail(`${path} must be a string (got ${shown(v)})`);
  const s = v as string;
  if (s.length < min) fail(`${path} must not be empty`);
  if (s.length > max) fail(`${path} must be at most ${max} characters (got ${s.length})`);
  return s;
}

function optStr(obj: Record<string, unknown>, key: string, path: string, max: number): string | undefined {
  return obj[key] === undefined ? undefined : str(obj, key, path, max, 0);
}

function time(obj: Record<string, unknown>, key: string, path: string): number {
  const v = obj[key];
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) {
    fail(`${path} must be a positive number of milliseconds since 1970 (got ${shown(v)})`);
  }
  return v as number;
}

function oneOf<T extends string>(obj: Record<string, unknown>, key: string, allowed: readonly T[]): T {
  const v = obj[key];
  if (typeof v !== "string" || !allowed.includes(v as T)) {
    fail(`${key} must be one of ${allowed.map((a) => `"${a}"`).join(", ")} (got ${shown(v)})`);
  }
  return v as T;
}

function envelope(body: unknown): Envelope {
  if (!isRecord(body)) fail(`the body must be a JSON object (got ${shown(body)})`);
  const b = body as Record<string, unknown>;
  if (b.v !== 1) fail(`v must be 1 (got ${shown(b.v)})`);
  const installId = str(b, "installId", "installId", 36);
  if (!UUID.test(installId)) fail(`installId must be a UUID (got ${shown(installId)})`);
  const appVersion = str(b, "appVersion", "appVersion", 64);
  if (b.os !== "darwin") fail(`os must be "darwin" (got ${shown(b.os)})`);
  const osVersion = str(b, "osVersion", "osVersion", 64);
  const arch = str(b, "arch", "arch", 32);
  return { v: 1, installId: installId.toLowerCase(), appVersion, os: "darwin", osVersion, arch };
}

/**
 * The shape of an event's props, as the app's contract checks it. Which keys
 * survive is decided afterwards by the allow-list, so an unknown key is not a
 * refusal here: it is dropped there, and never becomes a Firestore field.
 */
function props(raw: unknown, path: string): void {
  if (!isRecord(raw)) fail(`${path} must be an object (got ${shown(raw)})`);
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > 20) fail(`${path} must have at most 20 keys (got ${entries.length})`);
  for (const [key, value] of entries) {
    const at = `${path}.${key}`;
    if (typeof value === "string") {
      if (value.length > 200) fail(`${at} must be at most 200 characters (got ${value.length})`);
    } else if (typeof value === "number") {
      if (!Number.isFinite(value)) fail(`${at} must be a finite number`);
    } else if (typeof value !== "boolean") {
      fail(`${at} must be a string, number or boolean (got ${shown(value)})`);
    }
  }
}

function run<T>(fn: () => T): Checked<T> {
  try {
    return { ok: true, value: fn() };
  } catch (err) {
    if (err instanceof Refusal) return { ok: false, error: err.message };
    throw err;
  }
}

export function checkTelemetry(body: unknown): Checked<TelemetryBatch> {
  return run(() => {
    const env = envelope(body);
    const raw = (body as Record<string, unknown>).events;
    if (!Array.isArray(raw)) fail(`events must be an array (got ${shown(raw)})`);
    const list = raw as unknown[];
    if (list.length < 1 || list.length > 100) {
      fail(`events must hold 1 to 100 events (got ${list.length})`);
    }
    const events: TelemetryEvent[] = [];
    list.forEach((e, i) => {
      const path = `events[${i}]`;
      if (!isRecord(e)) fail(`${path} must be an object (got ${shown(e)})`);
      const ev = e as Record<string, unknown>;
      const name = str(ev, "name", `${path}.name`, 64);
      if (!EVENT_NAME.test(name)) {
        fail(`${path}.name must match ${EVENT_NAME.source} (got ${shown(name)})`);
      }
      const at = time(ev, "at", `${path}.at`);
      if (ev.props !== undefined) props(ev.props, `${path}.props`);
      // The allow-list: an unlisted name is dropped, and so is an unlisted or mistyped prop.
      const kept = sanitizeEvent(name, ev.props, at);
      if (kept) events.push(kept);
    });
    // May be empty: every event was unlisted. intake answers 204 and writes nothing.
    return { ...env, events };
  });
}

export function checkCrash(body: unknown): Checked<CrashReport> {
  return run(() => {
    const env = envelope(body);
    const b = body as Record<string, unknown>;
    const at = time(b, "at", "at");
    const process = oneOf(b, "process", PROCESSES);
    const kind = oneOf(b, "kind", KINDS);
    const message = str(b, "message", "message", 2000, 0);
    const stack = optStr(b, "stack", "stack", 16000);
    const reason = optStr(b, "reason", "reason", 200);
    let exitCode: number | undefined;
    if (b.exitCode !== undefined) {
      if (typeof b.exitCode !== "number" || !Number.isInteger(b.exitCode)) {
        fail(`exitCode must be an integer (got ${shown(b.exitCode)})`);
      }
      exitCode = b.exitCode as number;
    }
    const report: CrashReport = { ...env, at, process, kind, message: scrub(message) };
    if (stack !== undefined) report.stack = scrub(stack);
    if (reason !== undefined) report.reason = scrub(reason);
    if (exitCode !== undefined) report.exitCode = exitCode;
    return report;
  });
}

/**
 * Takes what identifies a person out of a crash's text before it is stored:
 * message, stack and reason, all through this one function. The site says file
 * paths, email addresses and credentials never leave the Mac, and an error can
 * carry any of them ("ENOENT: open '/Users/ada/My Movies/wedding.mp4'"). The app
 * redacts first (src/main/telemetry/redact.ts); this is the site keeping the
 * promise whatever the app sent.
 *
 * - A path under a home, a volume, a temp folder or `~/` becomes `<path>`, and
 *   it runs past spaces: it ends after the LAST file extension before the end
 *   of the line or a quote or bracket, or at that end when there is none. Over-
 *   scrubbing a few words is the safe direction; stopping at the first space
 *   left "Movies/Acme wedding.mp4" behind. A path inside an app bundle keeps its
 *   part from `<name>.app/` on, which says where in the code the crash was.
 * - Email addresses, plain or `%40`-encoded, become `<email>`.
 * - A URL's query string becomes `?<query>`.
 * - Token shapes become `<token>`: `Bearer …`, `sk-…`, `AIza…`, `ya29.…`,
 *   `AMf-…`, and any run of 32 or more base64url characters holding both a
 *   letter and a digit (a long identifier with no digit is code, not a secret).
 *
 * Linear time. Every regex below is anchored on a literal or bounded, and the
 * path pass is a hand-written scan, because the obvious regex for "a path up to
 * its last extension" backtracks quadratically (the test holds 16k characters
 * of each pathological shape to 50 ms).
 */
export function scrub(text: string): string {
  return scrubPaths(
    text
      .replace(QUERY, "?<query>")
      .replace(BEARER, "Bearer <token>")
      .replace(TOKEN, "<token>")
      .replace(EMAIL, "<email>"),
  ).replace(LONG_RUN, (run) => (/\d/.test(run) && /[A-Za-z]/.test(run) ? "<token>" : run));
}

/** `?key=…` up to whitespace, a quote, a bracket or a fragment. Starts only at `?`. */
const QUERY = /\?[A-Za-z0-9_.~%+-]+=[^\s'"`<>#]*/g;
const BEARER = /\bBearer\s+[^\s'"`]+/g;
const TOKEN = /\b(?:sk-[A-Za-z0-9_-]{16,}|AIza[0-9A-Za-z_-]{20,}|ya29\.[0-9A-Za-z_.-]+|AMf-[0-9A-Za-z_-]+)/g;
/** Bounded on both sides (64 and 253 are the RFC limits), so a long run without `@` costs O(64) per start. */
const EMAIL = /[A-Za-z0-9._%+-]{1,64}(?:@|%40)[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,24}/g;
const LONG_RUN = /[A-Za-z0-9_-]{32,}={0,2}/g;

const PATH_START = /(?:\/private)?\/(?:Users|home|Volumes|var|tmp)\/|(?<![\w~])~\//g;

/** Where a path certainly ends: a line end, a quote or a bracket. */
const isStop = (c: number) =>
  c === 10 || c === 13 || c === 39 || c === 34 || c === 96 || c === 60 || c === 62 || c === 40 || c === 41;
/** What may follow a file extension: whitespace, `:` (a line number), `,;?#`. */
const isAfterExtension = (c: number) =>
  c === 32 || c === 9 || c === 58 || c === 44 || c === 59 || c === 63 || c === 35;
const isAlnum = (c: number) => (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122);

function scrubPaths(text: string): string {
  let out = "";
  let copied = 0;
  PATH_START.lastIndex = 0;
  for (let m = PATH_START.exec(text); m; m = PATH_START.exec(text)) {
    const start = m.index;
    let end = start + m[0].length;
    while (end < text.length && !isStop(text.charCodeAt(end))) end++;
    // The last `.ext` (1 to 10 letters or digits) followed by the end or a boundary.
    let cut = -1;
    for (let i = start + m[0].length; i < end; i++) {
      if (text.charCodeAt(i) !== 46) continue;
      let j = i + 1;
      while (j < end && isAlnum(text.charCodeAt(j))) j++;
      const run = j - i - 1;
      if (run >= 1 && run <= 10 && (j === end || isAfterExtension(text.charCodeAt(j)))) cut = j;
      i = j - 1;
    }
    if (cut < 0) {
      cut = end;
      while (cut > start && /\s/.test(text[cut - 1])) cut--;
    }
    const path = text.slice(start, cut);
    const bundle = path.indexOf(".app/");
    const kept = bundle >= 0 ? path.slice(path.lastIndexOf("/", bundle) + 1) : "";
    out += text.slice(copied, start) + (kept ? `<path>/${kept}` : "<path>");
    copied = cut;
    PATH_START.lastIndex = Math.max(cut, start + 1);
  }
  return out + text.slice(copied);
}

/** The first line of a stack that names a place in the code, without its line and column. */
export function topFrame(stack: string | undefined): string {
  if (!stack) return "";
  const lines = stack.split("\n").map((l) => l.trim()).filter(Boolean);
  const frame = lines.find((l) => l.startsWith("at ")) ?? lines[1] ?? "";
  return frame.replace(/:\d+(?::\d+)?(\)?)$/, "$1");
}

/**
 * Which crashes are the same crash: the message and the top frame, with line
 * and column numbers dropped so one fault reads as one row across versions.
 */
export function crashSignature(report: Pick<CrashReport, "message" | "stack">): string {
  const text = `${report.message}\n${topFrame(report.stack)}`;
  return hash53(text, 0x9e3779b9) + hash53(text, 0x85ebca6b);
}

/**
 * cyrb53: a 53-bit string hash, as 14 hex digits. Two seeds make 28 digits,
 * which is plenty to tell crash messages apart. Not a cryptographic hash, and it
 * does not need to be; it has no import, so this file runs in the browser too.
 */
function hash53(text: string, seed: number): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
}

/** The UTC day a moment falls on, as the `day` bucket stores it. */
export const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
