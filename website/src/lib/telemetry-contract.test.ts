// The server's allow-list (src/lib/telemetry-contract.ts) must be the app's
// (../src/shared/telemetry.ts), byte for byte. A drift in either direction is a
// privacy bug or a silently dropped event, and neither shows up anywhere else.
//
// When the website is built from a checkout without the app beside it (a Vercel
// project whose root is website/ and which does not include files outside it),
// the app's file is not there to compare with. The test then SKIPS, and says so
// in the skip reason and on stderr, because a comparison that could not run must
// not read as one that passed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const APP = fileURLToPath(new URL("../../../src/shared/telemetry.ts", import.meta.url));
const SITE = fileURLToPath(new URL("./telemetry-contract.ts", import.meta.url));

const START = "// -- events and their allow-listed props";
const END = "// -- the contract as a check";

/** The copied section: from START up to (not including) END, or to the end of the file. */
function section(text: string, file: string): string {
  const from = text.indexOf(START);
  assert.ok(from >= 0, `${file} has no "${START}" marker`);
  const to = text.indexOf(END, from);
  return (to >= 0 ? text.slice(from, to) : text.slice(from)).trimEnd();
}

const present = existsSync(APP);
const reason = `CANNOT MEASURE: ${APP} is absent, so the allow-list drift check did not run`;
if (!present) console.warn(`\n*** telemetry-contract.test.ts SKIPPED — ${reason} ***\n`);

test("the site's allow-list is the app's, verbatim", { skip: present ? false : reason }, () => {
  const app = section(readFileSync(APP, "utf8"), APP);
  const site = section(readFileSync(SITE, "utf8"), SITE);
  // The specimen must be the real thing, or two empty slices would compare equal.
  for (const needle of ["export const TELEMETRY_EVENTS = {", "export function sanitizeEvent("]) {
    assert.ok(app.includes(needle), `the app's section lacks ${needle}`);
  }
  const events = (s: string) => s.slice(s.indexOf("export const TELEMETRY_EVENTS = {"), s.indexOf("} as const satisfies") + 1);
  assert.equal(events(site), events(app), "TELEMETRY_EVENTS differs: paste ../src/shared/telemetry.ts's section again");
  assert.equal(site, app, "the copied section differs from ../src/shared/telemetry.ts: paste it again");
});
