// Mutation proof for firestore.rules: weaken one line at a time, run the suite
// against the weakened copy, and require it to fail. The rules file on disk is
// never touched; each mutant is a separate temp file passed as $RULES_FILE.
//
// Guards against the harness lying (CLAUDE.md): every replacement must occur
// exactly once in the source and the mutant must differ from it; the baseline
// must pass before and after; exit codes are read, not summaries.
//
// Run: pnpm mutate (inside the emulator via `firebase emulators:exec`).

import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const RULES = fileURLToPath(new URL('../firestore.rules', import.meta.url))
const SUITE = fileURLToPath(new URL('./rules.test.mjs', import.meta.url))
const source = readFileSync(RULES, 'utf8')
const dir = mkdtempSync(join(tmpdir(), 'bay-rules-mutants-'))

const MUTANTS = [
  ['owner: email_verified not required',
    "    function isOwner() {\n      return verified() && request.auth.token.email == 'hyattherate2005@gmail.com';",
    "    function isOwner() {\n      return request.auth != null && request.auth.token.email == 'hyattherate2005@gmail.com';"],
  ['owner: any verified account is the owner',
    "return verified() && request.auth.token.email == 'hyattherate2005@gmail.com';",
    'return verified();'],
  ['telemetry_events: anyone signed in reads',
    'match /telemetry_events/{id} {\n      allow read: if isOwner();',
    'match /telemetry_events/{id} {\n      allow read: if request.auth != null;'],
  ['telemetry_daily: anyone reads',
    'match /telemetry_daily/{day} {\n      allow read: if isOwner();',
    'match /telemetry_daily/{day} {\n      allow read: if true;'],
  ['telemetry_installs: anyone reads',
    'match /telemetry_installs/{id} {\n      allow read: if isOwner();',
    'match /telemetry_installs/{id} {\n      allow read: if true;'],
  ['crashes: anyone reads',
    'match /crashes/{id} {\n      allow read: if isOwner();',
    'match /crashes/{id} {\n      allow read: if true;'],
  ['crashes: the owner may write (a forged report)',
    'match /crashes/{id} {\n      allow read: if isOwner();',
    'match /crashes/{id} {\n      allow read, write: if isOwner();'],
  ['telemetry_events: a signed-in client may write',
    'match /telemetry_events/{id} {\n      allow read: if isOwner();',
    'match /telemetry_events/{id} {\n      allow read: if isOwner();\n      allow create: if request.auth != null;'],
  ['access get: any verified user reads any grant',
    '|| (verified() && email == request.auth.token.email.lower());',
    '|| verified();'],
  ['access get: email_verified not required for your own grant',
    '|| (verified() && email == request.auth.token.email.lower());',
    '|| (request.auth != null && email == request.auth.token.email.lower());'],
  ['access: the owner may still create grants',
    '      allow get: if isOwner()\n',
    '      allow create, delete, list: if isOwner();\n      allow get: if isOwner()\n'],
  ['reports: the owner reads nothing (the /admin page)',
    'match /telemetry_daily/{day} {\n      allow read: if isOwner();',
    'match /telemetry_daily/{day} {\n      allow read: if false;'],
]

function run(rulesFile) {
  const r = spawnSync(process.execPath, ['--test', '--test-timeout=30000', SUITE], {
    env: { ...process.env, RULES_FILE: rulesFile },
    encoding: 'utf8',
  })
  const failed = [...r.stdout.matchAll(/^\s*✖ (.+?) \(\d/gm)].map((m) => m[1])
  return { code: r.status, failed: [...new Set(failed)] }
}

function occurrences(hay, needle) {
  return hay.split(needle).length - 1
}

const base = run(RULES)
if (base.code !== 0) {
  console.error('BASELINE FAILS against the unmodified rules; nothing below would mean anything.')
  process.exit(2)
}
console.log('baseline: pass')

let survived = 0
for (const [label, from, to] of MUTANTS) {
  const n = occurrences(source, from)
  if (n !== 1) {
    console.error(`HARNESS: "${label}" matches ${n} times, not once; fix the mutation string.`)
    process.exit(2)
  }
  // A function, not the string: a string replacement reads `$'`, `$&` and the
  // like as patterns, and the email regex ends in `$'`. Passed as a string it
  // spliced the rest of the file into the mutant, which then failed to load and
  // was scored as caught.
  const mutant = source.replace(from, () => to)
  if (!mutant.includes(to)) throw new Error(`HARNESS: "${label}" did not insert its replacement verbatim`)
  if (mutant === source) throw new Error(`HARNESS: "${label}" did not change the source`)
  const file = join(dir, `${MUTANTS.findIndex((m) => m[0] === label)}.rules`)
  writeFileSync(file, mutant)
  const { code, failed } = run(file)
  if (code === 0) {
    survived++
    console.log(`SURVIVED  ${label}`)
  } else {
    const suites = new Set(['reports', 'access (builds released before open access)', 'older desktop REST shapes', 'default deny'])
    const tests = failed.filter((t) => !suites.has(t))
    console.log(`caught    ${label}\n            by: ${tests.join(' | ') || '(load error: exit ' + code + ')'}`)
  }
}

const after = run(RULES)
if (after.code !== 0) {
  console.error('BASELINE FAILS after the run; the harness disturbed something.')
  process.exit(2)
}
console.log(`baseline after: pass\n${MUTANTS.length - survived}/${MUTANTS.length} caught`)
process.exit(survived === 0 ? 0 : 1)
