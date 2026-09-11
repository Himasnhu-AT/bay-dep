/**
 * Lets `node --test` resolve this project's import style.
 *
 * Node runs TypeScript natively now, but its resolver is the plain ESM one: a relative import
 * must name a real file, so `./serve` does not resolve to `serve.ts`. The project is on
 * `moduleResolution: bundler`, where extensionless is the correct and universal form — every
 * other import in the tree is written that way, and electron-vite resolves them fine.
 *
 * The alternative was writing `./serve.ts` in the tests and turning on
 * `allowImportingTsExtensions` in tsconfig.node.json. That works — it coexists with
 * `composite` under `--noEmit` — but it is a change to shared build config to suit a handful
 * of files, and it would make the tests the only modules in the tree importing differently
 * from every other. A resolver hook keeps the oddity here, in the thing that is odd.
 *
 * It lives at `src/` rather than under `src/main/` because both halves of the app test
 * through it — the main process and the renderer's engine — and a shared tool filed under one
 * consumer reads as that consumer's private detail. Its path is referenced from package.json
 * and CLAUDE.md; moving it again means updating both.
 *
 * Usage:  pnpm test   (or: node --import ./src/test-hooks.mjs --test <glob>)
 */

import { registerHooks } from 'node:module'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const EXTENSIONLESS_RELATIVE = /^\.{1,2}\//
const HAS_EXTENSION = /\.[mc]?[jt]sx?$|\.json$|\.node$/

/**
 * The path aliases from electron.vite.config.ts and the tsconfigs.
 *
 * These have to be here, and the reason is worth stating because it is not obvious until it
 * bites: without them, only modules that happen to import nothing aliased are testable. The
 * first suite passed for exactly that accidental reason — `serve.ts` deals in bytes and imports
 * no project types — and the first attempt to test anything touching the model died on
 * `Cannot find package '@shared/project'`. That failure reads like a broken test rather than a
 * missing resolver rule, which is how a project ends up with tests only where the imports were
 * lucky. If an alias is added to the vite config, add it here too.
 */
const SRC = path.dirname(new URL(import.meta.url).pathname)
const ALIASES = [
  ['@shared/', path.join(SRC, 'shared')],
  ['@/', path.join(SRC, 'renderer', 'src')]
]

function resolveAlias(specifier) {
  for (const [prefix, base] of ALIASES) {
    if (!specifier.startsWith(prefix)) continue
    const rest = specifier.slice(prefix.length)
    const target = path.join(base, rest)
    return HAS_EXTENSION.test(target) ? target : `${target}.ts`
  }
  return null
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    const aliased = resolveAlias(specifier)
    if (aliased) {
      return { shortCircuit: true, url: pathToFileURL(aliased).href }
    }
    if (EXTENSIONLESS_RELATIVE.test(specifier) && !HAS_EXTENSION.test(specifier)) {
      try {
        return nextResolve(`${specifier}.ts`, context)
      } catch {
        // Not a TypeScript module — fall through and let Node report its own error, which
        // will name the specifier the author actually wrote.
      }
    }
    return nextResolve(specifier, context)
  }
})
