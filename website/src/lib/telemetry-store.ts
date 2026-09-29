/**
 * Where /api/telemetry and /api/crash put what they accept: Firestore, project
 * bay-editor-app, written through its REST API with a Google service account.
 * Server only. Nothing here is imported by a page.
 *
 * No SDK: the credential is `FIREBASE_SERVICE_ACCOUNT` (the service account's JSON
 * key, raw or base64), an OAuth token is minted from it with a signed JWT
 * (node:crypto), and each accepted request is one `:commit`, so its documents
 * land together or not at all. The service account's writes are not subject to
 * the Firestore rules, which give browsers no write to these collections.
 *
 * What is written:
 *
 *   telemetry_events/{id}       one per event: the envelope, name, at, props,
 *                               receivedAt, day
 *   telemetry_daily/{day}       per UTC day: `events` (total) and `counts.<name>`
 *   telemetry_installs/{day}_{installId}
 *                               one per install per day it sent anything, with
 *                               its version, so /admin counts installs by reading
 *                               a doc per install rather than every event
 *   crashes/{id}                one per crash, with `signature` and `day`
 *
 * `day` is the UTC day the site received the request, not the app's clock.
 * The client's IP address is never written anywhere.
 */

import { createSign, randomUUID } from "node:crypto";
import { firebaseConfig } from "@/lib/firebase-config";
import {
  type CrashReport,
  crashSignature,
  dayOf,
  type PropValue,
  type TelemetryBatch,
} from "@/lib/telemetry";

type ServiceAccount = { client_email: string; private_key: string; token_uri?: string };

export class NotConfigured extends Error {}
export class StorageRefused extends Error {}

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
  const res = await fetch(aud, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${signature}`,
    }),
  });
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
  | { mapValue: { fields: Record<string, Value> } };

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
  const res = await fetch(`https://firestore.googleapis.com/v1/${ROOT}:commit`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ writes }),
  });
  if (!res.ok) {
    if (res.status === 401) cached = null;
    throw new StorageRefused(`Firestore refused the write (${res.status})`);
  }
}

/** The writes for one telemetry batch; exported so the test can read their shape. */
export function telemetryWrites(batch: TelemetryBatch, receivedMs: number): unknown[] {
  const day = dayOf(receivedMs);
  const receivedAt = { timestampValue: new Date(receivedMs).toISOString() };
  const env = envelopeFields(batch);
  const writes: unknown[] = batch.events.map((e) => ({
    update: {
      name: `${ROOT}/telemetry_events/${randomUUID()}`,
      fields: {
        ...env,
        name: s(e.name),
        at: n(e.at),
        ...(e.props
          ? { props: { mapValue: { fields: Object.fromEntries(Object.entries(e.props).map(([k, v]) => [k, prop(v)])) } } }
          : {}),
        receivedAt,
        day: s(day),
      },
    },
    currentDocument: { exists: false },
  }));

  const perName = new Map<string, number>();
  for (const e of batch.events) perName.set(e.name, (perName.get(e.name) ?? 0) + 1);
  writes.push({
    update: { name: `${ROOT}/telemetry_daily/${day}`, fields: { day: s(day) } },
    updateMask: { fieldPaths: ["day"] },
    updateTransforms: [
      { fieldPath: "events", increment: n(batch.events.length) },
      ...[...perName].map(([name, count]) => ({
        fieldPath: `counts.${quoted(name)}`,
        increment: n(count),
      })),
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
