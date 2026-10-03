// Writes `src/main/html/motion-script.generated.ts`: the text of `bay-motion.js`, built from
// `src/shared/motion/`. What it is and why it is checked in is in `src/shared/motion-bundle.ts`;
// `src/main/html/motion-script.test.ts` fails when it is stale. Usage: `pnpm gen:motion`
// (which loads `src/test-hooks.mjs`, because the bundler imports without extensions like the
// rest of the tree).

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { motionScript, motionScriptModule } from '../src/shared/motion-bundle.ts'

const read = (id) => {
  const path = join('src/shared', `${id}.ts`)
  return existsSync(path) ? readFileSync(path, 'utf8') : null
}

const path = 'src/main/html/motion-script.generated.ts'
const next = motionScriptModule(motionScript(read))
const current = existsSync(path) ? readFileSync(path, 'utf8') : null
if (current === next) {
  console.log(`${path}: up to date`)
} else {
  writeFileSync(path, next)
  console.log(`${path}: written`)
}
