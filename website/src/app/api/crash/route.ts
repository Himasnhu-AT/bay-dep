/**
 * POST /api/crash: one crash report from the desktop app. The shape is checked
 * by `checkCrash` (src/lib/telemetry.ts, the contract), which also takes the
 * person's paths, emails, query strings and tokens out of the message, stack
 * and reason (`scrub`), and stored by
 * src/lib/telemetry-store.ts. Status codes as /api/telemetry. No CORS headers.
 */

import { intake, RateLimit } from "@/lib/intake";
import { checkCrash } from "@/lib/telemetry";
import { storeCrash } from "@/lib/telemetry-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TEN_MINUTES = 10 * 60 * 1000;

/**
 * 30 reports per install in ten minutes: a crash loop should not fill the store
 * (the app itself sends one identical crash at most every ten minutes). 120 per
 * address, and 120 a minute across every caller on this instance.
 */
const limits = {
  perInstall: new RateLimit(30, TEN_MINUTES),
  perIp: new RateLimit(120, TEN_MINUTES),
  global: new RateLimit(120, 60 * 1000),
};

export function POST(request: Request) {
  return intake(request, { check: checkCrash, store: storeCrash, limits });
}
