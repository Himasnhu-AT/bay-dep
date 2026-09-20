/**
 * `?raw` imports, for TypeScript's benefit.
 *
 * Vite inlines the file's text at build time — verified: the bundle contains the markdown, not
 * a path to it — but `tsc` resolves modules on its own and has no idea the suffix means
 * anything. Without this, `pnpm typecheck` fails on a build that works, which is the inverse of
 * the usual gap and just as confusing.
 *
 * Scoped to `.md` rather than declared for every `?raw` suffix, so importing some other file
 * type this way is still a type error rather than silently typed as a string.
 */
declare module '*.md?raw' {
  const content: string
  export default content
}
