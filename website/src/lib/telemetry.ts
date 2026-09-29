/**
 * What the app may send to /api/telemetry and /api/crash, checked field by field.
 *
 * This file is the contract. The desktop app's client is written against it, and
 * each refusal names the field that was wrong, because the only reader of a 400
 * is a developer looking at the app's log, and "bad request" tells them nothing.
 *
 * It imports nothing at all, so `pnpm test` can run it under plain Node
 * (src/lib/telemetry.test.ts) and /admin can use its names in the browser.
 *
 * Unknown keys are ignored, not refused, so a newer app can add a field without
 * an older site turning it away. Only the fields named here are ever stored.
 */

export const BODY_LIMIT = 256 * 1024;

export const EVENT_NAME = /^[a-z0-9_.]+$/;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Prop keys become Firestore map keys; `__x__` is reserved there. */
export const PROP_KEY = /^[A-Za-z0-9_.-]{1,64}$/;

export const PROCESSES = ["main", "renderer", "gpu", "utility", "child", "composition"] as const;
export const KINDS = ["exception", "rejection", "process-gone", "renderer-error"] as const;

/**
 * The event names /admin reads for "exports ok vs failed". Any other name is
 * counted under its own name and nothing more; these two are the only ones the
 * dashboard gives a meaning to.
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

function props(raw: unknown, path: string): Record<string, PropValue> {
  if (!isRecord(raw)) fail(`${path} must be an object (got ${shown(raw)})`);
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > 20) fail(`${path} must have at most 20 keys (got ${entries.length})`);
  const out: Record<string, PropValue> = {};
  for (const [key, value] of entries) {
    if (!PROP_KEY.test(key) || /^__.*__$/.test(key)) {
      fail(`${path} key ${shown(key)} must be 1 to 64 of A-Z, a-z, 0-9, "_", "." or "-", and not __like_this__`);
    }
    const at = `${path}.${key}`;
    if (typeof value === "string") {
      if (value.length > 200) fail(`${at} must be at most 200 characters (got ${value.length})`);
    } else if (typeof value === "number") {
      if (!Number.isFinite(value)) fail(`${at} must be a finite number`);
    } else if (typeof value !== "boolean") {
      fail(`${at} must be a string, number or boolean (got ${shown(value)})`);
    }
    out[key] = value as PropValue;
  }
  return out;
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
    const events = list.map((e, i): TelemetryEvent => {
      const path = `events[${i}]`;
      if (!isRecord(e)) fail(`${path} must be an object (got ${shown(e)})`);
      const ev = e as Record<string, unknown>;
      const name = str(ev, "name", `${path}.name`, 64);
      if (!EVENT_NAME.test(name)) {
        fail(`${path}.name must match ${EVENT_NAME.source} (got ${shown(name)})`);
      }
      const at = time(ev, "at", `${path}.at`);
      return ev.props === undefined
        ? { name, at }
        : { name, at, props: props(ev.props, `${path}.props`) };
    });
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
    const report: CrashReport = { ...env, at, process, kind, message };
    if (stack !== undefined) report.stack = scrubPaths(stack);
    if (reason !== undefined) report.reason = reason;
    if (exitCode !== undefined) report.exitCode = exitCode;
    report.message = scrubPaths(message);
    return report;
  });
}

/**
 * Takes the person's own paths out of a crash's text before it is stored. The
 * site says file paths never leave the Mac, and a stack or an error message can
 * carry one ("ENOENT: open '/Users/ada/Movies/wedding.mp4'"). The app should
 * not send them; this is the site keeping that promise whatever the app sends.
 *
 * A path inside an app bundle keeps its part from `<name>.app/` on, which is
 * the part that says where in the code the crash was. Any other absolute path
 * under a home, a volume or a temp folder becomes `<path>`.
 */
export function scrubPaths(text: string): string {
  return text.replace(
    /(?:\/private)?\/(?:Users|home|Volumes|var|tmp)\/[^\s'"`()<>,;]*/g,
    (path) => {
      const app = /[^/]+\.app\/.*/.exec(path);
      return app ? `<path>/${app[0]}` : "<path>";
    },
  );
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
