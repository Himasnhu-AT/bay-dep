/**
 * The one request path behind /api/telemetry and /api/crash. Server only.
 *
 * Order, and why: the size cap first (nothing is parsed past 256 KB), then the
 * shape (a 400 names the field), then the limits, then storage:
 *
 * 1. per caller address: a fresh installId costs nothing to make, so a limit
 *    keyed on the body alone is no limit (the audit of bbdc12f walked around it
 *    with a new UUID per request);
 * 2. per install: one stuck client on many addresses;
 * 3. a ceiling across every caller on this instance, which fails closed. It is
 *    what bounds the Firestore bill when the first two are defeated by many
 *    addresses at once.
 *
 * A batch the allow-list emptied (every event unknown) is answered 204 and
 * writes nothing; it still counts against the per-caller limits, not the
 * ceiling. Storage that is not set up answers 503 and stores nothing; it never
 * answers 204 for a write that did not happen. A write Firestore refuses as
 * malformed is 422, which the app drops; one it could not take right now is
 * 502, which the app retries.
 *
 * The IP is used for the limits only, held in this process's memory for at
 * most one window, and never written anywhere.
 */

import { BODY_LIMIT, type Checked } from "@/lib/telemetry";
import { NotConfigured, StorageRefused, StorageRejected, StorageUnreachable } from "@/lib/telemetry-store";

const json = (status: number, error: string) => Response.json({ error }, { status });

/** Reads at most `limit` bytes of the body, or null when there is more. */
async function readCapped(request: Request, limit: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > limit) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Best effort: a fixed window per key, in this instance's memory. A cold start
 * or a second instance starts from zero, which is acceptable for a limit whose
 * job is to stop one caller from flooding the store.
 *
 * The memory is bounded: at most `maxKeys` keys, the oldest evicted first. A
 * key is inserted when its window starts and never moved, so insertion order is
 * also the order windows expire in, and expired keys are dropped from the front
 * on every call (amortised O(1)) rather than only past a threshold.
 */
export class RateLimit {
  #hits = new Map<string, { count: number; resetAt: number }>();
  readonly max: number;
  readonly windowMs: number;
  readonly maxKeys: number;
  constructor(max: number, windowMs: number, maxKeys = 10_000) {
    this.max = max;
    this.windowMs = windowMs;
    this.maxKeys = maxKeys;
  }

  get size(): number {
    return this.#hits.size;
  }

  /** Seconds until the key may send again, or 0 when this request is allowed. */
  take(key: string, now = Date.now()): number {
    for (const [k, v] of this.#hits) {
      if (v.resetAt > now) break;
      this.#hits.delete(k);
    }
    const hit = this.#hits.get(key);
    // An expired hit behind a live one: only when the clock stepped back.
    if (hit && hit.resetAt <= now) this.#hits.delete(key);
    else if (hit) {
      if (hit.count >= this.max) return Math.max(1, Math.ceil((hit.resetAt - now) / 1000));
      hit.count += 1;
      return 0;
    }
    while (this.#hits.size >= this.maxKeys) {
      const oldest = this.#hits.keys().next();
      if (oldest.done) break;
      this.#hits.delete(oldest.value);
    }
    this.#hits.set(key, { count: 1, resetAt: now + this.windowMs });
    return 0;
  }
}

/**
 * The caller's address, as Vercel's edge saw it. Vercel sets
 * `x-vercel-forwarded-for` and `x-real-ip` itself and overwrites any
 * `x-forwarded-for` the client sent, so on Vercel all three are the edge's word
 * rather than the caller's. Off Vercel, the last hop of `x-forwarded-for` is
 * the one the nearest proxy appended; the first is whatever the client wrote.
 *
 * An IPv6 address is reduced to its /64, which one subscriber usually holds
 * whole: otherwise every address in it would be a new caller.
 */
export function clientIp(headers: Headers): string {
  const first = (v: string | null) => v?.split(",")[0]?.trim() || "";
  const ip =
    first(headers.get("x-vercel-forwarded-for")) ||
    first(headers.get("x-real-ip")) ||
    headers.get("x-forwarded-for")?.split(",").map((h) => h.trim()).filter(Boolean).pop() ||
    "";
  if (!ip) return "unknown";
  return ip.includes(":") ? ipv6Prefix(ip) : ip;
}

/** The first four groups of an IPv6 address, `::` expanded, as `a:b:c:d::/64`. */
function ipv6Prefix(ip: string): string {
  const bare = ip.replace(/^\[|\](?::\d+)?$/g, "").split("%")[0];
  const [head, tail] = bare.split("::", 2);
  const left = head ? head.split(":") : [];
  const right = tail === undefined ? [] : tail ? tail.split(":") : [];
  const groups =
    tail === undefined
      ? left
      : [...left, ...Array<string>(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right];
  return `${groups
    .slice(0, 4)
    .map((g) => (g || "0").toLowerCase().replace(/^0+(?=.)/, ""))
    .join(":")}::/64`;
}

export type Limits = {
  /** Keyed on the caller's address. */
  perIp: RateLimit;
  /** Keyed on the installId the body carries. */
  perInstall: RateLimit;
  /** One key: every accepted request on this instance. */
  global: RateLimit;
};

const tooMany = (wait: number, who: string) =>
  Response.json(
    { error: `too many requests from ${who}; retry in ${wait} seconds` },
    { status: 429, headers: { "Retry-After": String(wait) } },
  );

export async function intake<T extends { installId: string }>(
  request: Request,
  {
    check,
    store,
    limits,
    isEmpty,
  }: {
    check: (body: unknown) => Checked<T>;
    store: (value: T) => Promise<void>;
    limits: Limits;
    /** True when the checked value holds nothing to store (a batch the allow-list emptied). */
    isEmpty?: (value: T) => boolean;
  },
): Promise<Response> {
  const text = await readCapped(request, BODY_LIMIT);
  if (text === null) return json(413, `the body must be at most ${BODY_LIMIT} bytes`);

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json(400, "the body must be JSON");
  }
  const checked = check(body);
  if (!checked.ok) return json(400, checked.error);

  const byIp = limits.perIp.take(clientIp(request.headers));
  if (byIp > 0) return tooMany(byIp, "this address");
  const byInstall = limits.perInstall.take(checked.value.installId);
  if (byInstall > 0) return tooMany(byInstall, "this install");

  if (isEmpty?.(checked.value)) return new Response(null, { status: 204 });

  const busy = limits.global.take("*");
  if (busy > 0) {
    return Response.json(
      { error: `this site is taking too many reports right now; retry in ${busy} seconds` },
      { status: 429, headers: { "Retry-After": String(busy) } },
    );
  }

  try {
    await store(checked.value);
  } catch (err) {
    if (err instanceof NotConfigured) {
      console.error(`telemetry storage: ${err.message}`);
      return json(503, "telemetry storage is not configured");
    }
    if (err instanceof StorageRejected) {
      console.error(`telemetry storage: ${err.message}`);
      return json(422, `telemetry storage rejected this report (${err.status}); it will not be accepted on retry`);
    }
    if (err instanceof StorageUnreachable) {
      console.error(`telemetry storage: ${err.message}`);
      return json(502, "telemetry storage could not be reached; retry later");
    }
    if (err instanceof StorageRefused) {
      console.error(`telemetry storage: ${err.message}`);
      return json(502, "telemetry storage refused the write; retry later");
    }
    throw err;
  }
  return new Response(null, { status: 204 });
}
