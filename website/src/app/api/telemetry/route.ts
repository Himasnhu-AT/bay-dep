/**
 * POST /api/telemetry: anonymous usage events from the desktop app. The shape is
 * checked by `checkTelemetry` (src/lib/telemetry.ts, the contract) and stored by
 * src/lib/telemetry-store.ts. 204 stored, 400 names the bad field, 413 over
 * 256 KB, 429 rate limited, 503 storage not configured. Any other method is 405,
 * which Next answers for a method this file does not export. No CORS headers:
 * the caller is the app, not a web page.
 */

import { intake, RateLimit } from "@/lib/intake";
import { checkTelemetry } from "@/lib/telemetry";
import { storeTelemetry } from "@/lib/telemetry-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 120 batches of up to 100 events per install and IP in ten minutes. */
const limit = new RateLimit(120, 10 * 60 * 1000);

export function POST(request: Request) {
  return intake(request, { check: checkTelemetry, store: storeTelemetry, limit });
}
