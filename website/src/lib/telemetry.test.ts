// The telemetry contract (src/lib/telemetry.ts), the request path around it
// (src/lib/intake.ts), what is written (src/lib/telemetry-store.ts) and what
// /admin makes of it (src/lib/dashboard.ts). Run: pnpm test.
//
// Every refusal is asserted by the field its message names, and each is paired
// with the good payload passing, so a checker that refused everything fails.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  BODY_LIMIT,
  checkCrash,
  checkTelemetry,
  crashSignature,
  EXPORT_EVENTS,
  scrubPaths,
  type TelemetryBatch,
  topFrame,
} from "@/lib/telemetry";
import { intake, RateLimit } from "@/lib/intake";
import { crashWrites, storeTelemetry, telemetryWrites } from "@/lib/telemetry-store";
import { summarize, windowDays } from "@/lib/dashboard";

const INSTALL = "0b6f3c1e-2a4d-4e8f-9a1b-3c5d7e9f1a2b";

const good = () => ({
  v: 1,
  installId: INSTALL,
  appVersion: "0.9.3",
  os: "darwin",
  osVersion: "15.6.1",
  arch: "arm64",
  events: [
    { name: "app.launch", at: 1_790_000_000_000 },
    { name: "export.completed", at: 1_790_000_001_000, props: { format: "mp4", seconds: 42.5, gpu: true } },
  ],
});

const goodCrash = () => ({
  v: 1,
  installId: INSTALL,
  appVersion: "0.9.3",
  os: "darwin",
  osVersion: "15.6.1",
  arch: "arm64",
  at: 1_790_000_000_000,
  process: "renderer",
  kind: "exception",
  message: "Cannot read properties of undefined (reading 'from')",
  stack:
    "TypeError: Cannot read properties of undefined (reading 'from')\n    at trimItem (file:///Applications/bay.app/Contents/Resources/app.asar/out/renderer/index.js:10:5)",
});

/** Refused, with a message that names `field`. */
function refuses(result: { ok: boolean; error?: string }, field: string, also?: RegExp) {
  assert.equal(result.ok, false, `accepted a payload with a bad ${field}`);
  assert.ok(result.error?.startsWith(field), `message "${result.error}" does not name ${field}`);
  if (also) assert.match(result.error ?? "", also);
}

describe("checkTelemetry", () => {
  test("accepts a good batch and keeps only the contract's fields", () => {
    const r = checkTelemetry({ ...good(), extra: "ignored", events: [{ ...good().events[1], junk: 1 }] });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal("extra" in r.value, false);
    assert.deepEqual(Object.keys(r.value.events[0]).sort(), ["at", "name", "props"]);
    assert.deepEqual(r.value.events[0].props, { format: "mp4", seconds: 42.5, gpu: true });
  });

  test("the body must be an object", () => {
    for (const body of [null, [], "x", 3]) refuses(checkTelemetry(body), "the body");
  });

  test("each envelope field is checked by name", () => {
    refuses(checkTelemetry({ ...good(), v: 2 }), "v", /must be 1/);
    refuses(checkTelemetry({ ...good(), installId: "not-a-uuid" }), "installId", /UUID/);
    refuses(checkTelemetry({ ...good(), installId: undefined }), "installId", /string/);
    refuses(checkTelemetry({ ...good(), appVersion: "" }), "appVersion", /empty/);
    refuses(checkTelemetry({ ...good(), appVersion: "x".repeat(65) }), "appVersion", /64/);
    refuses(checkTelemetry({ ...good(), os: "win32" }), "os", /"darwin"/);
    refuses(checkTelemetry({ ...good(), osVersion: 15 }), "osVersion", /string/);
    refuses(checkTelemetry({ ...good(), arch: "" }), "arch", /empty/);
  });

  test("events: 1 to 100, and each one's name, at and props", () => {
    refuses(checkTelemetry({ ...good(), events: [] }), "events", /1 to 100.*got 0/);
    const e = good().events[0];
    refuses(checkTelemetry({ ...good(), events: Array(101).fill(e) }), "events", /got 101/);
    assert.equal(checkTelemetry({ ...good(), events: Array(100).fill(e) }).ok, true);
    refuses(checkTelemetry({ ...good(), events: "x" }), "events", /array/);

    const at = (ev: unknown) => checkTelemetry({ ...good(), events: [e, ev] });
    refuses(at("x"), "events[1]", /object/);
    refuses(at({ name: "Export.Done", at: 1 }), "events[1].name", /\^\[a-z0-9_\.\]\+\$.*"Export.Done"/);
    refuses(at({ name: "a".repeat(65), at: 1 }), "events[1].name", /64/);
    assert.equal(at({ name: "a".repeat(64), at: 1 }).ok, true);
    refuses(at({ name: "ok", at: "yesterday" }), "events[1].at", /milliseconds/);
    refuses(at({ name: "ok", at: Number.NaN }), "events[1].at");
    refuses(at({ name: "ok", at: 1, props: [] }), "events[1].props", /object/);
    const many = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`k${i}`, i]));
    refuses(at({ name: "ok", at: 1, props: many }), "events[1].props", /20 keys.*got 21/);
    refuses(at({ name: "ok", at: 1, props: { note: "x".repeat(201) } }), "events[1].props.note", /200/);
    assert.equal(at({ name: "ok", at: 1, props: { note: "x".repeat(200) } }).ok, true);
    refuses(at({ name: "ok", at: 1, props: { nested: { a: 1 } } }), "events[1].props.nested", /string, number or boolean/);
    refuses(at({ name: "ok", at: 1, props: { __name__: 1 } }), "events[1].props key");
    refuses(at({ name: "ok", at: 1, props: { "has space": 1 } }), "events[1].props key");
  });
});

describe("checkCrash", () => {
  test("accepts a good report", () => {
    const r = checkCrash(goodCrash());
    assert.equal(r.ok, true);
    assert.equal(checkCrash({ ...goodCrash(), stack: undefined, message: "" }).ok, true);
  });

  test("each field is checked by name", () => {
    refuses(checkCrash({ ...goodCrash(), installId: "x" }), "installId");
    refuses(checkCrash({ ...goodCrash(), at: -1 }), "at", /milliseconds/);
    refuses(checkCrash({ ...goodCrash(), process: "kernel" }), "process", /"main".*"kernel"/);
    refuses(checkCrash({ ...goodCrash(), kind: "panic" }), "kind", /"exception"/);
    refuses(checkCrash({ ...goodCrash(), message: 3 }), "message", /string/);
    refuses(checkCrash({ ...goodCrash(), message: "x".repeat(2001) }), "message", /2000/);
    assert.equal(checkCrash({ ...goodCrash(), message: "x".repeat(2000) }).ok, true);
    refuses(checkCrash({ ...goodCrash(), stack: "x".repeat(16001) }), "stack", /16000/);
    refuses(checkCrash({ ...goodCrash(), reason: 7 }), "reason", /string/);
    refuses(checkCrash({ ...goodCrash(), exitCode: 1.5 }), "exitCode", /integer/);
    assert.equal(checkCrash({ ...goodCrash(), exitCode: -11, reason: "crashed" }).ok, true);
  });

  test("the person's paths are taken out of message and stack before anything is stored", () => {
    const specimen = "ENOENT: open '/Users/ada/Movies/wedding.mp4'";
    assert.ok(specimen.includes("/Users/ada"), "the specimen must carry a home path");
    const r = checkCrash({
      ...goodCrash(),
      message: specimen,
      stack: "Error\n    at x (/Users/ada/Applications/bay.app/Contents/Resources/app.asar/out/main/index.js:3:9)",
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.value.message, "ENOENT: open '<path>'");
    assert.equal(r.value.stack?.includes("ada"), false);
    assert.match(r.value.stack ?? "", /<path>\/bay\.app\/Contents\/Resources\/app\.asar\/out\/main\/index\.js:3:9/);
    assert.equal(scrubPaths("/private/var/folders/xy/T/bay-1/a.wav failed"), "<path> failed");
    assert.equal(scrubPaths("no path here"), "no path here");
  });

  test("one fault is one signature across builds; a different fault is another", () => {
    const a = goodCrash();
    const moved = { ...a, stack: a.stack.replace(":10:5", ":212:17") };
    assert.notEqual(a.stack, moved.stack);
    assert.equal(topFrame(a.stack), topFrame(moved.stack));
    assert.equal(crashSignature(a), crashSignature(moved));
    assert.notEqual(crashSignature(a), crashSignature({ ...a, message: "other" }));
    assert.match(crashSignature(a), /^[0-9a-f]{28}$/);
  });
});

describe("what is written", () => {
  test("one event doc each, a daily rollup whose keys keep their dots, an install doc, and no IP", () => {
    const r = checkTelemetry(good());
    assert.ok(r.ok);
    if (!r.ok) return;
    const writes = telemetryWrites(r.value, Date.UTC(2026, 8, 29, 12)) as {
      update: { name: string; fields: Record<string, unknown> };
      updateTransforms?: { fieldPath: string }[];
    }[];
    assert.equal(writes.length, 4);
    assert.match(writes[0].update.name, /\/telemetry_events\/[0-9a-f-]{36}$/);
    assert.deepEqual(writes[0].update.fields.day, { stringValue: "2026-09-29" });
    assert.match(writes[2].update.name, /\/telemetry_daily\/2026-09-29$/);
    assert.deepEqual(
      writes[2].updateTransforms?.map((t) => t.fieldPath),
      ["events", "counts.`app.launch`", "counts.`export.completed`"],
    );
    assert.match(writes[3].update.name, new RegExp(`/telemetry_installs/2026-09-29_${INSTALL}$`));
    assert.doesNotMatch(JSON.stringify(writes), /\bip\b|forwarded|127\.0\.0\.1/i);
  });

  test("a crash doc carries its signature and day", () => {
    const r = checkCrash(goodCrash());
    assert.ok(r.ok);
    if (!r.ok) return;
    const [w] = crashWrites(r.value, Date.UTC(2026, 8, 29)) as { update: { fields: Record<string, { stringValue?: string }> } }[];
    assert.equal(w.update.fields.signature.stringValue, crashSignature(r.value));
    assert.equal(w.update.fields.day.stringValue, "2026-09-29");
  });
});

describe("intake", () => {
  const post = (body: string, headers: Record<string, string> = {}) =>
    new Request("http://localhost/api/telemetry", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9", ...headers },
      body,
    });
  const accept = async (batch: TelemetryBatch) => {
    assert.equal(batch.installId, batch.installId.toLowerCase());
  };
  const opts = (limit = new RateLimit(100, 60_000), store = accept) => ({ check: checkTelemetry, store, limit });

  test("204 for a good batch; 400 naming the field for a bad one; 400 for non-JSON", async () => {
    assert.equal((await intake(post(JSON.stringify(good())), opts())).status, 204);
    const bad = await intake(post(JSON.stringify({ ...good(), os: "linux" })), opts());
    assert.equal(bad.status, 400);
    assert.match((await bad.json()).error, /^os must be "darwin"/);
    const junk = await intake(post("{nope"), opts());
    assert.equal(junk.status, 400);
    assert.match((await junk.json()).error, /JSON/);
  });

  test("413 past 256 KB, whether or not the length was declared", async () => {
    const big = JSON.stringify({ ...good(), pad: "x".repeat(BODY_LIMIT) });
    assert.equal((await intake(post(big), opts())).status, 413);
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode(big));
        c.close();
      },
    });
    const chunked = new Request("http://localhost/api/telemetry", {
      method: "POST",
      body: stream,
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    assert.equal(chunked.headers.get("content-length"), null);
    assert.equal((await intake(chunked, opts())).status, 413);
  });

  test("429 once an install and IP pass the limit; another install is not held back", async () => {
    const limit = new RateLimit(2, 60_000);
    assert.equal((await intake(post(JSON.stringify(good())), opts(limit))).status, 204);
    assert.equal((await intake(post(JSON.stringify(good())), opts(limit))).status, 204);
    const held = await intake(post(JSON.stringify(good())), opts(limit));
    assert.equal(held.status, 429);
    assert.match((await held.json()).error, /retry in \d+ seconds/);
    assert.ok(Number(held.headers.get("retry-after")) > 0);
    const other = { ...good(), installId: "1b6f3c1e-2a4d-4e8f-9a1b-3c5d7e9f1a2b" };
    assert.equal((await intake(post(JSON.stringify(other)), opts(limit))).status, 204);
  });

  test("503 when storage is not configured, never a 204 for a write that did not happen", async () => {
    const saved = process.env.FIREBASE_SERVICE_ACCOUNT;
    delete process.env.FIREBASE_SERVICE_ACCOUNT;
    try {
      const res = await intake(post(JSON.stringify(good())), opts(undefined, storeTelemetry));
      assert.equal(res.status, 503);
      assert.deepEqual(await res.json(), { error: "telemetry storage is not configured" });
    } finally {
      if (saved !== undefined) process.env.FIREBASE_SERVICE_ACCOUNT = saved;
    }
  });
});

describe("dashboard", () => {
  test("installs per day are distinct; versions count each install once; crashes group by signature", () => {
    const now = Date.UTC(2026, 8, 29, 12);
    const days = windowDays(7, now);
    assert.deepEqual([days[0], days[6]], ["2026-09-23", "2026-09-29"]);
    const s = summarize(
      days,
      [
        { day: "2026-09-28", events: 5, counts: { "app.launch": 3, [EXPORT_EVENTS.ok]: 2 } },
        { day: "2026-09-29", events: 2, counts: { [EXPORT_EVENTS.failed]: 1, [EXPORT_EVENTS.ok]: 1 } },
        { day: "2026-09-01", events: 99, counts: { "app.launch": 99 } },
      ],
      [
        { day: "2026-09-28", installId: "a", appVersion: "0.9.2", lastSeen: 1 },
        { day: "2026-09-29", installId: "a", appVersion: "0.9.3", lastSeen: 2 },
        { day: "2026-09-29", installId: "b", appVersion: "0.9.3", lastSeen: 3 },
        { day: "2026-09-01", installId: "c", appVersion: "0.8.0", lastSeen: 0 },
      ],
      [
        { signature: "s1", appVersion: "0.9.2", process: "main", kind: "exception", message: "old", stack: "", installId: "a", receivedAt: now - 86_400_000 },
        { signature: "s1", appVersion: "0.9.3", process: "main", kind: "exception", message: "new", stack: "st", installId: "b", receivedAt: now },
        { signature: "s2", appVersion: "0.9.3", process: "gpu", kind: "process-gone", message: "gpu", stack: "", installId: "a", receivedAt: now },
        { signature: "s3", appVersion: "0.8.0", process: "main", kind: "exception", message: "outside", stack: "", installId: "c", receivedAt: Date.UTC(2026, 8, 1) },
      ],
    );
    assert.deepEqual(s.days.slice(-2), [
      { day: "2026-09-28", installs: 1, events: 5 },
      { day: "2026-09-29", installs: 2, events: 2 },
    ]);
    assert.equal(s.installs, 2);
    assert.deepEqual(s.versions, [{ version: "0.9.3", installs: 2 }]);
    assert.deepEqual(s.exports, { ok: 3, failed: 1 });
    assert.deepEqual(s.counts[0], { name: "app.launch", count: 3 });
    assert.equal(s.crashes.length, 2);
    const [top] = s.crashes;
    assert.equal(top.signature, "s1");
    assert.equal(top.count, 2);
    assert.equal(top.installs, 2);
    assert.equal(top.message, "new");
    assert.deepEqual(top.versions, ["0.9.3", "0.9.2"]);
    assert.equal(top.firstSeen, now - 86_400_000);
  });
});
