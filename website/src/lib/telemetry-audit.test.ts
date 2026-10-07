// The fixes from the audit of bbdc12f (the report endpoints), one describe per
// finding. Each refusal is paired with the nearest call that must still pass,
// and each error is asserted by what it says, not only by its status.
// Run: pnpm test.

import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { checkCrash, checkTelemetry, scrub, type TelemetryBatch } from "@/lib/telemetry";
import { clientIp, intake, RateLimit } from "@/lib/intake";
import { DAILY_SHARDS, storeTelemetry, telemetryWrites } from "@/lib/telemetry-store";
import { summarize, windowDays } from "@/lib/dashboard";
import { latest } from "@/lib/latest";

const INSTALL = "0b6f3c1e-2a4d-4e8f-9a1b-3c5d7e9f1a2b";
const uuid = (i: number) => `${i.toString(16).padStart(8, "0")}-2a4d-4e8f-9a1b-3c5d7e9f1a2b`;

const batch = (events: unknown[], installId = INSTALL) => ({
  v: 1,
  installId,
  appVersion: "0.9.3",
  os: "darwin",
  osVersion: "15.6.1",
  arch: "arm64",
  events,
});
const good = (installId = INSTALL) =>
  batch([{ name: "app_open", at: 1_790_000_000_000, props: { launchMs: 812 } }], installId);

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/telemetry", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

const roomy = () => new RateLimit(1_000, 60_000);
const limits = (over: Partial<Record<"perInstall" | "perIp" | "global", RateLimit>> = {}) => ({
  perInstall: roomy(),
  perIp: roomy(),
  global: roomy(),
  ...over,
});
const stored: TelemetryBatch[] = [];
const keep = async (b: TelemetryBatch) => {
  stored.push(b);
};
const opts = (over: Parameters<typeof limits>[0] = {}, store = keep) => ({
  check: checkTelemetry,
  store,
  limits: limits(over),
  isEmpty: (b: TelemetryBatch) => b.events.length === 0,
});

beforeEach(() => {
  stored.length = 0;
});

// ---------------------------------------------------------------------------
describe("H1: rate limits that a fresh installId cannot walk around", () => {
  test("a new installId on every request is still held back by the per-IP limit", async () => {
    const o = opts({ perIp: new RateLimit(3, 60_000) });
    const ip = { "x-vercel-forwarded-for": "203.0.113.9" };
    for (let i = 0; i < 3; i++) assert.equal((await intake(post(good(uuid(i)), ip), o)).status, 204);
    const held = await intake(post(good(uuid(99)), ip), o);
    assert.equal(held.status, 429);
    assert.match((await held.json()).error, /too many requests from this address; retry in \d+ seconds/);
    assert.ok(Number(held.headers.get("retry-after")) > 0);
    // The nearest legal call: another address is not held back by this one.
    assert.equal((await intake(post(good(uuid(100)), { "x-vercel-forwarded-for": "198.51.100.4" }), o)).status, 204);
  });

  test("the per-install limit still holds one install on many addresses", async () => {
    const o = opts({ perInstall: new RateLimit(2, 60_000) });
    for (const ip of ["198.51.100.1", "198.51.100.2"]) {
      assert.equal((await intake(post(good(), { "x-vercel-forwarded-for": ip }), o)).status, 204);
    }
    const held = await intake(post(good(), { "x-vercel-forwarded-for": "198.51.100.3" }), o);
    assert.equal(held.status, 429);
    assert.match((await held.json()).error, /too many requests from this install/);
    assert.equal((await intake(post(good(uuid(7)), { "x-vercel-forwarded-for": "198.51.100.3" }), o)).status, 204);
  });

  test("the IP is Vercel's, not whatever the caller put first in x-forwarded-for", () => {
    const h = (o: Record<string, string>) => new Headers(o);
    assert.equal(clientIp(h({ "x-vercel-forwarded-for": "203.0.113.9", "x-forwarded-for": "1.2.3.4, 203.0.113.9", "x-real-ip": "5.6.7.8" })), "203.0.113.9");
    assert.equal(clientIp(h({ "x-real-ip": "203.0.113.9", "x-forwarded-for": "1.2.3.4, 203.0.113.8" })), "203.0.113.9");
    // Without either, the last hop (the one the nearest proxy appended), never the first.
    assert.equal(clientIp(h({ "x-forwarded-for": "1.2.3.4, 203.0.113.9" })), "203.0.113.9");
    assert.equal(clientIp(h({})), "unknown");
    // An IPv6 caller owns a /64; rotating inside it must not be a new caller.
    assert.equal(clientIp(h({ "x-vercel-forwarded-for": "2001:db8:1:2::1" })), clientIp(h({ "x-vercel-forwarded-for": "2001:db8:1:2:ffff::9" })));
    assert.notEqual(clientIp(h({ "x-vercel-forwarded-for": "2001:db8:1:2::1" })), clientIp(h({ "x-vercel-forwarded-for": "2001:db8:1:3::1" })));
  });

  test("a spoofed first hop in x-forwarded-for does not escape the per-IP limit", async () => {
    const o = opts({ perIp: new RateLimit(2, 60_000) });
    const spoof = (i: number) => ({ "x-forwarded-for": `10.0.0.${i}, 203.0.113.9` });
    assert.equal((await intake(post(good(uuid(1)), spoof(1)), o)).status, 204);
    assert.equal((await intake(post(good(uuid(2)), spoof(2)), o)).status, 204);
    assert.equal((await intake(post(good(uuid(3)), spoof(3)), o)).status, 429);
  });

  test("the limiter's memory is capped, evicting the oldest keys first", () => {
    const limit = new RateLimit(1, 60_000, 100);
    const now = 1_000_000;
    for (let i = 0; i < 1_000; i++) assert.equal(limit.take(`k${i}`, now), 0);
    assert.ok(limit.size <= 100, `holds ${limit.size} keys, cap 100`);
    // The newest key is still remembered (and held); the oldest was evicted, so it is free again.
    assert.ok(limit.take("k999", now) > 0, "the newest key was forgotten");
    assert.equal(limit.take("k0", now), 0);
  });

  test("expired windows are dropped as time passes, not only past a threshold", () => {
    const limit = new RateLimit(5, 1_000, 10_000);
    for (let i = 0; i < 50; i++) limit.take(`k${i}`, 0);
    assert.equal(limit.size, 50);
    limit.take("later", 5_000);
    assert.equal(limit.size, 1);
  });

  test("a ceiling across all callers fails closed with 429 and Retry-After", async () => {
    const o = opts({ global: new RateLimit(3, 60_000) });
    for (let i = 0; i < 3; i++) {
      assert.equal((await intake(post(good(uuid(i)), { "x-vercel-forwarded-for": `198.51.100.${i}` }), o)).status, 204);
    }
    const held = await intake(post(good(uuid(9)), { "x-vercel-forwarded-for": "198.51.100.9" }), o);
    assert.equal(held.status, 429);
    assert.match((await held.json()).error, /this site is taking too many reports right now; retry in \d+ seconds/);
    assert.ok(Number(held.headers.get("retry-after")) > 0);
    assert.equal(stored.length, 3, "the held request reached storage");
  });

  test("one request is three writes: one batch doc, one daily shard, one install doc", () => {
    const events = Array.from({ length: 100 }, (_, i) => ({ name: i % 2 ? "page_view" : "tool_call", at: 1_790_000_000_000 + i }));
    const r = checkTelemetry(batch(events));
    assert.ok(r.ok);
    if (!r.ok) return;
    const writes = telemetryWrites(r.value, Date.UTC(2026, 8, 29, 12), 7) as {
      update: { name: string; fields: Record<string, { arrayValue?: { values: unknown[] }; stringValue?: string }> };
      updateTransforms?: { fieldPath: string }[];
    }[];
    assert.equal(writes.length, 3);
    const [doc, daily, install] = writes;
    assert.match(doc.update.name, /\/telemetry_batches\/[0-9a-f-]{36}$/);
    assert.equal(doc.update.fields.events.arrayValue?.values.length, 100);
    assert.equal(doc.update.fields.day.stringValue, "2026-09-29");
    assert.equal(doc.update.fields.installId.stringValue, INSTALL);
    assert.ok("receivedAt" in doc.update.fields);
    assert.match(daily.update.name, /\/telemetry_daily\/2026-09-29_7$/);
    assert.deepEqual(daily.updateTransforms?.map((t) => t.fieldPath).sort(), ["counts.`page_view`", "counts.`tool_call`", "events"]);
    assert.match(install.update.name, new RegExp(`/telemetry_installs/2026-09-29_${INSTALL}$`));
    assert.doesNotMatch(JSON.stringify(writes), /telemetry_events/);
  });

  test("the daily shard is chosen at random among DAILY_SHARDS", () => {
    const r = checkTelemetry(good());
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(DAILY_SHARDS, 10);
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) {
      const name = (telemetryWrites(r.value, Date.UTC(2026, 8, 29))[1] as { update: { name: string } }).update.name;
      const m = /\/telemetry_daily\/2026-09-29_(\d+)$/.exec(name);
      assert.ok(m, name);
      const n = Number(m[1]);
      assert.ok(n >= 0 && n < DAILY_SHARDS, name);
      seen.add(m[1]);
    }
    assert.ok(seen.size >= 5, `400 writes landed on only ${seen.size} shards`);
  });

  test("the dashboard sums a day's shards, and still reads an unsharded day", () => {
    const now = Date.UTC(2026, 8, 29, 12);
    const s = summarize(
      windowDays(2, now),
      [
        { day: "2026-09-29", events: 3, counts: { app_open: 2, export_done: 1 }, exportProblems: 1 },
        { day: "2026-09-29", events: 4, counts: { app_open: 1, export_done: 3 }, exportProblems: 0 },
        { day: "2026-09-28", events: 5, counts: { app_open: 5 }, exportProblems: 0 },
      ],
      [],
      [],
    );
    assert.deepEqual(s.days.map((d) => d.events), [5, 7]);
    assert.deepEqual(s.counts.find((c) => c.name === "app_open"), { name: "app_open", count: 8 });
    assert.deepEqual(s.exports, { finished: 4, problems: 1, failed: 0 });
  });
});

// ---------------------------------------------------------------------------
describe("H2: the server enforces the app's allow-list", () => {
  test("an unknown event is dropped and a free-text prop never survives", () => {
    const r = checkTelemetry(
      batch([
        { name: "anything.at.all", at: 1_790_000_000_000, props: { email: "bob@example.com" } },
        { name: "export_done", at: 1_790_000_000_001, props: { ok: false, incomplete: true, durationSec: "12", secret: "bob@example.com" } },
        { name: "tool_call", at: 1_790_000_000_002, props: { tool: "Hello World /Users/bob", ok: true } },
      ]),
    );
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.deepEqual(r.value.events, [
      { name: "export_done", at: 1_790_000_000_001, props: { ok: false, incomplete: true } },
      { name: "tool_call", at: 1_790_000_000_002, props: { ok: true } },
    ]);
    assert.doesNotMatch(JSON.stringify(r.value), /bob|anything|secret/);
  });

  test("a batch with nothing allow-listed is 204 with nothing written; one good event is written", async () => {
    const junk = Array.from({ length: 100 }, (_, i) => ({ name: `made.up.${i}`, at: 1_790_000_000_000 }));
    const none = await intake(post(batch(junk)), opts());
    assert.equal(none.status, 204);
    assert.equal(stored.length, 0, "an empty batch reached storage");
    const one = await intake(post(batch([...junk.slice(0, 99), { name: "app_quit", at: 1_790_000_000_000 }])), opts());
    assert.equal(one.status, 204);
    assert.equal(stored.length, 1);
    assert.deepEqual(stored[0].events.map((e) => e.name), ["app_quit"]);
  });

  test("an event name that breaks the shape is still a 400 naming it", () => {
    const r = checkTelemetry(batch([{ name: "Export Done", at: 1 }]));
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.match(r.error, /^events\[0\]\.name must match/);
  });
});

// ---------------------------------------------------------------------------
describe("M1: one scrub for message, stack and reason", () => {
  test("a path with spaces goes whole, up to its extension", () => {
    const specimen = "ENOENT: open '/Users/ada/My Movies/Acme wedding.mp4'";
    assert.equal(scrub(specimen), "ENOENT: open '<path>'");
    assert.equal(scrub("failed on /Users/ada/My Movies/Acme wedding.mp4 at load"), "failed on <path> at load");
    assert.equal(scrub("/private/var/folders/xy/T/bay-1/a.wav failed"), "<path> failed");
    assert.equal(scrub("no path here, and 1.5 of it"), "no path here, and 1.5 of it");
  });

  test("an app bundle keeps its code location", () => {
    assert.equal(
      scrub("at x (/Users/ada/Applications/bay.app/Contents/Resources/app.asar/out/main/index.js:3:9)"),
      "at x (<path>/bay.app/Contents/Resources/app.asar/out/main/index.js:3:9)",
    );
  });

  test("home-relative paths, emails, query strings and tokens", () => {
    assert.equal(scrub("open ~/Client Work/Acme cut.mov"), "open <path>");
    assert.equal(scrub("signed in as ada.lovelace+bay@example.co.uk today"), "signed in as <email> today");
    assert.equal(scrub("GET /callback?who=ada%40example.com"), "GET /callback?<query>");
    assert.equal(scrub("fetch https://api.example.com/v1/x?key=abc&sig=def failed"), "fetch https://api.example.com/v1/x?<query> failed");
    assert.equal(scrub("Authorization: Bearer abc.def-123"), "Authorization: Bearer <token>");
    for (const t of [
      "sk-proj-AbCdEf0123456789xyzXYZ",
      "AIzaSyA1234567890abcdefghijklmnopqrstu",
      "ya29.a0AfH6SMBx-yz_123",
      "AMf-vBxyz0123456789abcdef",
      "Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZg",
    ]) {
      assert.equal(scrub(`token ${t} refused`), "token <token> refused", t);
    }
    // The nearest legal text: a long identifier with no digit is code, not a secret.
    assert.equal(scrub("Cannot_read_properties_of_undefined_reading"), "Cannot_read_properties_of_undefined_reading");
  });

  test("a crash's message, stack and reason are all scrubbed before storage", () => {
    const r = checkCrash({
      v: 1,
      installId: INSTALL,
      appVersion: "0.9.3",
      os: "darwin",
      osVersion: "15.6.1",
      arch: "arm64",
      at: 1_790_000_000_000,
      process: "child",
      kind: "process-gone",
      message: "open ~/My Movies/a b.mp4",
      stack: "Error: x\n    at y (/Users/ada/My Stuff/z.js:1:2)",
      reason: "crashed for ada@example.com",
    });
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(r.value.message, "open <path>");
    assert.equal(r.value.stack, "Error: x\n    at y (<path>:1:2)");
    assert.equal(r.value.reason, "crashed for <email>");
  });

  test("16k characters of pathological input scrub in under 50 ms each", () => {
    const n = 16_000;
    const inputs: Record<string, string> = {
      letters: "a".repeat(n),
      "local parts": "a.".repeat(n / 2),
      "at signs": "a@".repeat(n / 2),
      "%40": "a%40".repeat(n / 4),
      "31-char runs": `${"a1".repeat(15)}a `.repeat(Math.floor(n / 32)),
      "home prefixes": "/Users/".repeat(Math.floor(n / 7)),
      "spaced dirs": "/Users/a b ".repeat(Math.floor(n / 11)),
      "tilde dirs": "~/a b/".repeat(Math.floor(n / 6)),
      "dots without extension": `/Users/${"a.".repeat(n / 2)}`,
      schemes: "http://a".repeat(n / 8),
      "sk-": "sk-".repeat(Math.floor(n / 3)),
      bearer: "Bearer ".repeat(Math.floor(n / 7)),
    };
    for (const [label, text] of Object.entries(inputs)) {
      assert.ok(text.length >= 15_900, `${label} is only ${text.length} characters`);
      const t0 = performance.now();
      scrub(text);
      const ms = performance.now() - t0;
      assert.ok(ms < 50, `${label}: ${ms.toFixed(1)} ms`);
    }
  });
});

// ---------------------------------------------------------------------------
describe("storage answers: what the app retries and what it drops", () => {
  const realFetch = globalThis.fetch;
  const saved = process.env.FIREBASE_SERVICE_ACCOUNT;
  let commitAnswer: () => Response;

  beforeEach(() => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({
      client_email: `test-${Math.random()}@example.iam.gserviceaccount.com`,
      private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    });
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("oauth2")) return Response.json({ access_token: "t", expires_in: 3600 });
      return commitAnswer();
    }) as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    if (saved === undefined) delete process.env.FIREBASE_SERVICE_ACCOUNT;
    else process.env.FIREBASE_SERVICE_ACCOUNT = saved;
  });

  const send = () => intake(post(good()), opts({}, storeTelemetry));

  test("a Firestore 4xx about the write itself is 422, which the app drops rather than retrying forever", async () => {
    for (const status of [400, 404, 409, 413]) {
      commitAnswer = () => new Response("{}", { status });
      const res = await send();
      assert.equal(res.status, 422, `Firestore ${status}`);
      assert.match((await res.json()).error, new RegExp(`telemetry storage rejected this report \\(${status}\\); it will not be accepted on retry`));
    }
  });

  test("5xx, 401, 403 and 429 stay 502, which the app retries", async () => {
    for (const status of [500, 503, 401, 403, 429]) {
      commitAnswer = () => new Response("{}", { status });
      const res = await send();
      assert.equal(res.status, 502, `Firestore ${status}`);
      assert.match((await res.json()).error, /telemetry storage refused the write; retry later/);
    }
    commitAnswer = () => new Response("{}", { status: 200 });
    assert.equal((await send()).status, 204, "the positive control: a 200 commit is a 204");
  });

  test("a network failure reaching Google is 502 with a clear error, not a 500", async () => {
    commitAnswer = () => {
      throw new TypeError("fetch failed");
    };
    const res = await send();
    assert.equal(res.status, 502);
    assert.match((await res.json()).error, /telemetry storage could not be reached; retry later/);
  });
});

// ---------------------------------------------------------------------------
describe("the dashboard's staleness guard", () => {
  test("a load that started before a newer one reports itself stale; the newest does not", () => {
    const guard = latest();
    const first = guard.begin();
    const second = guard.begin();
    assert.equal(first(), false, "the older load would still write its figures");
    assert.equal(second(), true);
    const third = guard.begin();
    assert.equal(second(), false);
    assert.equal(third(), true);
  });
});
