/**
 * `?raw` imports, for TypeScript's benefit.
 *
 * Vite inlines the file's text at build time — verified: the bundle contains the markdown, not
 * a path to it — but `tsc` resolves modules on its own and has no idea the suffix means
 * anything. Without this, `pnpm typecheck` fails on a build that works, which is the inverse of
 * the usual gap and just as confusing.
 *
 * **Declared per extension, never as `*?raw`.** Two extensions are inlined here and they are
 * inlined for different reasons — markdown because a guide must exist on a user's machine
 * rather than at a path that resolved on a developer's, html because a template *is* its
 * bytes. A blanket declaration would type every future `?raw` import as a string, including
 * the one somebody adds by mistake.
 */
declare module '*.md?raw' {
  const content: string
  export default content
}

declare module '*.html?raw' {
  const content: string
  export default content
}
