/**
 * POST /api/telemetry: anonymous usage events from the desktop app. The shape is
 * checked by `checkTelemetry` (src/lib/telemetry.ts, the contract) and stored by
 * src/lib/telemetry-store.ts. 204 stored (or nothing left to store once the
 * allow-list dropped every event), 400 names the bad field, 413 over 256 KB,
 * 422 storage rejected the write as malformed (the app drops it), 429 rate
 * limited, 502 storage unreachable or busy (retried), 503 not configured. Any other method is 405,
 * which Next answers for a method this file does not export. No CORS headers:
 * the caller is the app, not a web page.
 */

import { intake, RateLimit } from "@/lib/intake";
import { checkTelemetry } from "@/lib/telemetry";
import { storeTelemetry } from "@/lib/telemetry-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TEN_MINUTES = 10 * 60 * 1000;

/**
 * The app flushes about once a minute, so ten batches per install in ten minutes
 * is normal and 120 is a stuck client. An address may be a whole office behind
 * one NAT, hence five times that. The ceiling is per instance, across every
 * caller: 600 requests a minute is at most 1,800 Firestore writes a minute here
 * (three per request), and past it the answer is 429, never a write.
 */
const limits = {
  perInstall: new RateLimit(120, TEN_MINUTES),
  perIp: new RateLimit(600, TEN_MINUTES),
  global: new RateLimit(600, 60 * 1000),
};

export function POST(request: Request) {
  return intake(request, {
    check: checkTelemetry,
    store: storeTelemetry,
    limits,
    isEmpty: (batch) => batch.events.length === 0,
  });
}
