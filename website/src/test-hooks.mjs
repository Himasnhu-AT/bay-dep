/**
 * Lets `node --test` resolve the site's import style: the `@/` alias from
 * tsconfig.json, and extensionless relative imports, which `moduleResolution:
 * bundler` writes and Node's own resolver refuses. The same idea as the app's
 * ../src/test-hooks.mjs, kept separate because the site is its own package.
 *
 * Usage:  pnpm test
 */

import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";

const SRC = path.dirname(new URL(import.meta.url).pathname);
const HAS_EXTENSION = /\.[mc]?[jt]sx?$|\.json$/;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const target = path.join(SRC, specifier.slice(2));
      return {
        shortCircuit: true,
        url: pathToFileURL(HAS_EXTENSION.test(target) ? target : `${target}.ts`).href,
      };
    }
    if (/^\.{1,2}\//.test(specifier) && !HAS_EXTENSION.test(specifier)) {
      try {
        return nextResolve(`${specifier}.ts`, context);
      } catch {
        // Not a TypeScript module: let Node report the specifier as written.
      }
    }
    return nextResolve(specifier, context);
  },
});
