/**
 * Where /api/telemetry and /api/crash put what they accept: Firestore, project
 * bay-editor-app, written through its REST API with a Google service account.
 * Server only. Nothing here is imported by a page.
 *
 * No SDK: the credential is `FIREBASE_SERVICE_ACCOUNT` (the service account's JSON
 * key, raw or base64), an OAuth token is minted from it with a signed JWT
 * (node:crypto), and each accepted request is one `:commit` of exactly three
 * writes (a telemetry batch) or one (a crash), so its documents land together or
 * not at all. The service account's writes are not subject to
 * the Firestore rules, which give browsers no write to these collections.
 *
 * What is written:
 *
 *   telemetry_batches/{id}      one per request, however many events it held:
 *                               the envelope, `events` (an array of
 *                               {name, at, props?}, already allow-listed),
 *                               `count`, receivedAt, day
 *   telemetry_daily/{day}_{n}   per UTC day, in DAILY_SHARDS shards (n chosen at
 *                               random per request), each with `day`, `shard`,
 *                               `events` (total), `counts.<name>` and
 *                               `exportProblems`; /admin sums a day's shards.
 *                               Sharded because one document takes about one
 *                               sustained write a second, and every request
 *                               increments the day's counters.
 *   telemetry_installs/{day}_{installId}
 *                               one per install per day it sent anything, with
 *                               its version, so /admin counts installs by reading
 *                               a doc per install rather than every event
 *   crashes/{id}                one per crash, with `signature` and `day`
 *
 * `day` is the UTC day the site received the request, not the app's clock.
 * The client's IP address is never written anywhere.
 */

import { createSign, randomInt, randomUUID } from "node:crypto";
import { firebaseConfig } from "@/lib/firebase-config";
import {
  type CrashReport,
  crashSignature,
  dayOf,
  EXPORT_EVENTS,
  type PropValue,
  type TelemetryBatch,
} from "@/lib/telemetry";

type ServiceAccount = { client_email: string; private_key: string; token_uri?: string };

export class NotConfigured extends Error {}
/** Storage could not take the write now (5xx, 401, 403, 429): 502, which the app retries. */
export class StorageRefused extends Error {}
/** Google could not be reached at all (DNS, TLS, reset): 502, retried, with its own message. */
export class StorageUnreachable extends StorageRefused {}
/**
 * Firestore refused the write itself (a 4xx other than 401, 403, 429): the same
 * bytes would be refused again, so the answer is 422, which the app drops
 * rather than retrying forever.
 */
export class StorageRejected extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** A fetch that turns "never got an answer" (fetch's TypeError) into StorageUnreachable. */
async function reach(url: string, init: RequestInit, what: string): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (err) {
    throw new StorageUnreachable(`could not reach ${what}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Reads the credential, or throws NotConfigured naming what is wrong with it. */
export function serviceAccount(raw = process.env.FIREBASE_SERVICE_ACCOUNT): ServiceAccount {
  if (!raw || !raw.trim()) throw new NotConfigured("FIREBASE_SERVICE_ACCOUNT is not set");
  let parsed: unknown;
  const text = raw.trim();
  try {
    parsed = JSON.parse(text.startsWith("{") ? text : Buffer.from(text, "base64").toString("utf8"));
  } catch {
    throw new NotConfigured("FIREBASE_SERVICE_ACCOUNT is neither JSON nor base64 of JSON");
  }
  const sa = parsed as Partial<ServiceAccount>;
  if (typeof sa?.client_email !== "string" || typeof sa?.private_key !== "string") {
    throw new NotConfigured("FIREBASE_SERVICE_ACCOUNT has no client_email or private_key");
  }
  return { client_email: sa.client_email, private_key: sa.private_key, token_uri: sa.token_uri };
}

let cached: { token: string; until: number; key: string } | null = null;

const b64url = (data: string | Buffer) => Buffer.from(data).toString("base64url");

async function accessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.key === sa.client_email && cached.until > now + 60) return cached.token;
  const aud = sa.token_uri ?? "https://oauth2.googleapis.com/token";
  const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/datastore",
      aud,
      iat: now,
      exp: now + 3600,
    }),
  )}`;
  let signature: string;
  try {
    signature = createSign("RSA-SHA256").update(unsigned).sign(sa.private_key, "base64url");
  } catch {
    throw new NotConfigured("FIREBASE_SERVICE_ACCOUNT's private_key could not sign");
  }
  const res = await reach(
    aud,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: `${unsigned}.${signature}`,
      }),
    },
    "Google's token endpoint",
  );
  const body = (await res.json().catch(() => null)) as { access_token?: string; expires_in?: number } | null;
  if (!res.ok || !body?.access_token) {
    throw new StorageRefused(`Google refused the service account's token request (${res.status})`);
  }
  cached = { token: body.access_token, until: now + (body.expires_in ?? 3600), key: sa.client_email };
  return body.access_token;
}

// Firestore REST values.
type Value =
  | { stringValue: string }
  | { integerValue: string }
  | { doubleValue: number }
  | { booleanValue: boolean }
  | { timestampValue: string }
  | { mapValue: { fields: Record<string, Value> } }
  | { arrayValue: { values: Value[] } };

const s = (v: string): Value => ({ stringValue: v });
const n = (v: number): Value =>
  Number.isSafeInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
const prop = (v: PropValue): Value =>
  typeof v === "string" ? s(v) : typeof v === "number" ? n(v) : { booleanValue: v };

/** A map key in a field path: backticks let `export.failed` be one key, not two. */
const quoted = (key: string) => `\`${key.replace(/[`\\]/g, (c) => `\\${c}`)}\``;

const ROOT = `projects/${firebaseConfig.projectId}/databases/(default)/documents`;

function envelopeFields(b: TelemetryBatch | CrashReport): Record<string, Value> {
  return {
    v: n(b.v),
    installId: s(b.installId),
    appVersion: s(b.appVersion),
    os: s(b.os),
    osVersion: s(b.osVersion),
    arch: s(b.arch),
  };
}

async function commit(writes: unknown[]) {
  const sa = serviceAccount();
  const token = await accessToken(sa);
  const res = await reach(
    `https://firestore.googleapis.com/v1/${ROOT}:commit`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ writes }),
    },
    "Firestore",
  );
  if (!res.ok) {
    if (res.status === 401) cached = null;
    const detail = await res.text().catch(() => "");
    const message = `Firestore refused the write (${res.status})${detail ? `: ${detail.slice(0, 300)}` : ""}`;
    if (res.status >= 400 && res.status < 500 && ![401, 403, 429].includes(res.status)) {
      throw new StorageRejected(res.status, message);
    }
    throw new StorageRefused(message);
  }
}

/** How many documents a day's counters are spread over; /admin sums them. */
export const DAILY_SHARDS = 10;

/** An export_done that finished but says so badly: `ok: false` or `incomplete: true`. */
const exportHadProblems = (e: TelemetryBatch["events"][number]) =>
  e.name === EXPORT_EVENTS.ok && (e.props?.ok === false || e.props?.incomplete === true);

/**
 * The writes for one telemetry batch: always three, whatever the event count.
 * Exported so the test can read their shape; `shard` is injectable for it.
 */
export function telemetryWrites(
  batch: TelemetryBatch,
  receivedMs: number,
  shard = randomInt(DAILY_SHARDS),
): unknown[] {
  const day = dayOf(receivedMs);
  const receivedAt = { timestampValue: new Date(receivedMs).toISOString() };
  const env = envelopeFields(batch);
  const events: Value[] = batch.events.map((e) => ({
    mapValue: {
      fields: {
        name: s(e.name),
        at: n(e.at),
        ...(e.props
          ? { props: { mapValue: { fields: Object.fromEntries(Object.entries(e.props).map(([k, v]) => [k, prop(v)])) } } }
          : {}),
      },
    },
  }));
  const writes: unknown[] = [
    {
      update: {
        name: `${ROOT}/telemetry_batches/${randomUUID()}`,
        fields: {
          ...env,
          events: { arrayValue: { values: events } },
          count: n(batch.events.length),
          receivedAt,
          day: s(day),
        },
      },
      currentDocument: { exists: false },
    },
  ];

  const perName = new Map<string, number>();
  for (const e of batch.events) perName.set(e.name, (perName.get(e.name) ?? 0) + 1);
  const problems = batch.events.filter(exportHadProblems).length;
  writes.push({
    update: { name: `${ROOT}/telemetry_daily/${day}_${shard}`, fields: { day: s(day), shard: n(shard) } },
    updateMask: { fieldPaths: ["day", "shard"] },
    updateTransforms: [
      { fieldPath: "events", increment: n(batch.events.length) },
      ...[...perName].map(([name, count]) => ({
        fieldPath: `counts.${quoted(name)}`,
        increment: n(count),
      })),
      ...(problems ? [{ fieldPath: "exportProblems", increment: n(problems) }] : []),
    ],
  });

  const installFields = { ...env, day: s(day) };
  writes.push({
    update: { name: `${ROOT}/telemetry_installs/${day}_${batch.installId}`, fields: installFields },
    updateMask: { fieldPaths: Object.keys(installFields) },
    updateTransforms: [
      { fieldPath: "events", increment: n(batch.events.length) },
      { fieldPath: "lastSeen", setToServerValue: "REQUEST_TIME" },
    ],
  });
  return writes;
}

export function crashWrites(report: CrashReport, receivedMs: number): unknown[] {
  const fields: Record<string, Value> = {
    ...envelopeFields(report),
    at: n(report.at),
    process: s(report.process),
    kind: s(report.kind),
    message: s(report.message),
    signature: s(crashSignature(report)),
    receivedAt: { timestampValue: new Date(receivedMs).toISOString() },
    day: s(dayOf(receivedMs)),
  };
  if (report.stack !== undefined) fields.stack = s(report.stack);
  if (report.reason !== undefined) fields.reason = s(report.reason);
  if (report.exitCode !== undefined) fields.exitCode = n(report.exitCode);
  return [
    { update: { name: `${ROOT}/crashes/${randomUUID()}`, fields }, currentDocument: { exists: false } },
  ];
}

export const storeTelemetry = (batch: TelemetryBatch) => commit(telemetryWrites(batch, Date.now()));
export const storeCrash = (report: CrashReport) => commit(crashWrites(report, Date.now()));
