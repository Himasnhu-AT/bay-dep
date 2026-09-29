/**
 * The one request path behind /api/telemetry and /api/crash. Server only.
 *
 * Order, and why: the size cap first (nothing is parsed past 256 KB), then the
 * shape (a 400 names the field), then the rate limit (keyed on the installId the
 * body carries, plus the caller's IP), then storage. Storage that is not set up
 * answers 503 and stores nothing; it never answers 204 for a write that did not
 * happen.
 *
 * The IP is used for the rate limit only, held in this process's memory for at
 * most one window, and never written anywhere.
 */

import { BODY_LIMIT, type Checked } from "@/lib/telemetry";
import { NotConfigured, StorageRefused } from "@/lib/telemetry-store";

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
 * Best effort: a fixed window per installId + IP, in this instance's memory.
 * A cold start or a second instance starts from zero, which is acceptable for
 * a limit whose job is to stop one stuck client from flooding the store.
 */
export class RateLimit {
  #hits = new Map<string, { count: number; resetAt: number }>();
  readonly max: number;
  readonly windowMs: number;
  constructor(max: number, windowMs: number) {
    this.max = max;
    this.windowMs = windowMs;
  }

  /** Seconds until the key may send again, or 0 when this request is allowed. */
  take(key: string, now = Date.now()): number {
    if (this.#hits.size > 10_000) {
      for (const [k, v] of this.#hits) if (v.resetAt <= now) this.#hits.delete(k);
    }
    const hit = this.#hits.get(key);
    if (!hit || hit.resetAt <= now) {
      this.#hits.set(key, { count: 1, resetAt: now + this.windowMs });
      return 0;
    }
    if (hit.count >= this.max) return Math.ceil((hit.resetAt - now) / 1000);
    hit.count += 1;
    return 0;
  }
}

function callerIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

export async function intake<T extends { installId: string }>(
  request: Request,
  {
    check,
    store,
    limit,
  }: {
    check: (body: unknown) => Checked<T>;
    store: (value: T) => Promise<void>;
    limit: RateLimit;
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

  const wait = limit.take(`${checked.value.installId}|${callerIp(request)}`);
  if (wait > 0) {
    return Response.json(
      { error: `too many requests from this install; retry in ${wait} seconds` },
      { status: 429, headers: { "Retry-After": String(wait) } },
    );
  }

  try {
    await store(checked.value);
  } catch (err) {
    if (err instanceof NotConfigured) {
      console.error(`telemetry storage: ${err.message}`);
      return json(503, "telemetry storage is not configured");
    }
    if (err instanceof StorageRefused) {
      console.error(`telemetry storage: ${err.message}`);
      return json(502, "telemetry storage refused the write; retry later");
    }
    throw err;
  }
  return new Response(null, { status: 204 });
}
