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
  ['waitlist: the id need not be a joinable email',
    'allow create: if isJoinableEmail(email)\n', 'allow create: if true\n'],
  ['waitlist: no length cap on the id',
    'return id.size() <= 254\n        && ', 'return '],
  ['waitlist: the email pattern admits uppercase and any domain',
    "id.matches('^[a-z0-9._%+-]+@[a-z0-9-]+(\\\\.[a-z0-9-]+)*\\\\.[a-z]{2,}$')",
    "id.matches('^[^@\\\\s/]+@[^@\\\\s/]+\\\\.[^@\\\\s/]+$')"],
  ['waitlist: extra keys allowed',
    "        && request.resource.data.keys().hasOnly(['email', 'createdAt', 'status', 'note'])\n", ''],
  ['waitlist: the email field need not match the id',
    "        && request.resource.data.email == email\n        && request.resource.data.status == 'pending'",
    "        && request.resource.data.status == 'pending'"],
  ['waitlist: status need not be pending',
    "request.resource.data.status == 'pending'", 'true'],
  ['waitlist: createdAt may be any time',
    "        && request.resource.data.createdAt == request.time\n        && (!('note'",
    "        && (!('note'"],
  ['waitlist: a note may be 501 chars',
    'request.resource.data.note.size() <= 500', 'request.resource.data.note.size() <= 501'],
  ['waitlist: a note need not be a string',
    '(request.resource.data.note is string\n                && ', '('],
  ['waitlist: anyone may read an entry',
    '      allow get, list, update, delete: if isAdmin();\n',
    '      allow get: if true;\n      allow list, update, delete: if isAdmin();\n'],
  ['waitlist: a signed-in user may list the waitlist',
    '      allow get, list, update, delete: if isAdmin();\n',
    '      allow list: if signedIn();\n      allow get, update, delete: if isAdmin();\n'],
  ['waitlist: anyone may overwrite an entry (a repeat join replaces it)',
    '      allow get, list, update, delete: if isAdmin();\n',
    '      allow update: if true;\n      allow get, list, delete: if isAdmin();\n'],
  ['admin: email_verified not required',
    "return verified() && request.auth.token.email == 'hyattherate2005@gmail.com';",
    "return signedIn() && request.auth.token.email == 'hyattherate2005@gmail.com';"],
  ['referral: referrer need not be approved',
    'exists(accessPath(myEmail()))  // approved BEFORE', 'true  // approved BEFORE'],
  ['referral: approval may come from the same batch (existsAfter)',
    'exists(accessPath(myEmail()))  // approved BEFORE', 'existsAfter(accessPath(myEmail()))  // approved BEFORE'],
  ['referral: counter may rise by any amount',
    'after.referralsUsed == before.referralsUsed + 1', 'after.referralsUsed > before.referralsUsed'],
  ['referral: counter need not move (after.lastReferral alone)',
    '&& after.referralsUsed == before.referralsUsed + 1\n', '\n'],
  ['referral: cap raised to 6',
    'after.referralsUsed <= 5', 'after.referralsUsed <= 6'],
  ['referral: one +1 not tied to one grant',
    'after.lastReferral == email', 'true'],
  ['referral: id need not be a lowercase email',
    "          && isEmailId(email)\n          && request.resource.data.keys().hasOnly(['email', 'via', 'grantedBy', 'grantedAt', 'referrerEmail'])",
    "          && request.resource.data.keys().hasOnly(['email', 'via', 'grantedBy', 'grantedAt', 'referrerEmail'])"],
  ['referral: referrerEmail unchecked',
    'request.resource.data.referrerEmail == myEmail()', 'true'],
  ['access get: any verified user reads any grant',
    '|| (verified() && email == myEmail())\n        || (signedIn() && resource != null',
    '|| verified()\n        || (signedIn() && resource != null'],
  ['access: any signed-in user may update/delete a grant',
    "      allow list, update, delete: if isAdmin();\n    }\n\n    // ---- users",
    "      allow list: if isAdmin();\n      allow update, delete: if signedIn();\n    }\n\n    // ---- users"],
  ['access: the admin can neither list nor revoke (the /admin page)',
    "      allow list, update, delete: if isAdmin();\n    }\n\n    // ---- users",
    "      allow update: if isAdmin();\n    }\n\n    // ---- users"],
  ['users create: referralsUsed need not be 0',
    'request.resource.data.referralsUsed == 0', 'true'],
  ['users update: no new grant required',
    '&& existsAfter(accessPath(request.resource.data.lastReferral)));', ');'],
  ['users update: may cite a grant that already existed',
    '&& !exists(accessPath(request.resource.data.lastReferral))\n', '\n'],
  ['users update: any key may change',
    ".affectedKeys().hasOnly(['referralsUsed', 'lastReferral'])", '.affectedKeys().size() >= 0'],
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
    const suites = new Set(['waitlist', 'admin grant form', 'access', 'users', 'desktop REST shapes', 'default deny'])
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
