/**
 * POST /api/crash: one crash report from the desktop app. The shape is checked
 * by `checkCrash` (src/lib/telemetry.ts, the contract), which also takes the
 * person's own paths out of the message and stack, and stored by
 * src/lib/telemetry-store.ts. Status codes as /api/telemetry. No CORS headers.
 */

import { intake, RateLimit } from "@/lib/intake";
import { checkCrash } from "@/lib/telemetry";
import { storeCrash } from "@/lib/telemetry-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 30 reports per install and IP in ten minutes: a crash loop should not fill the store. */
const limit = new RateLimit(30, 10 * 60 * 1000);

export function POST(request: Request) {
  return intake(request, { check: checkCrash, store: storeCrash, limit });
}
