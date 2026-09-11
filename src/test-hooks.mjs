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

const EXTENSIONLESS_RELATIVE = /^\.{1,2}\//
const HAS_EXTENSION = /\.[mc]?[jt]sx?$|\.json$|\.node$/

registerHooks({
  resolve(specifier, context, nextResolve) {
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
