/**
 * A font family someone typed, as the CSS stack a text item stores.
 *
 * The compositor writes the stack into `ctx.font`, and canvas *ignores* an assignment it cannot
 * parse — it keeps the previous font without a word. So a typed `Archivo 2` (a name starting with
 * a digit after a space is not a valid unquoted family) would draw in whatever face came before,
 * and the substitution check would measure that face and call it fine. Quoting every named family
 * makes any name parse; the generic keywords (`serif`, `system-ui`…) stay bare, because quoted
 * they become a family literally called "serif".
 *
 * Returns `null` for input that cannot be a stack: empty, or carrying `;{}` which would end the
 * shorthand.
 */

const GENERIC = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
  'emoji',
  'math',
  'fangsong',
  '-apple-system'
])

export function normalizeFontStack(input: string): string | null {
  if (/[;{}]/.test(input)) return null
  const families = input
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => {
      const bare = part.replace(/^(["'])(.*)\1$/, '$2').trim()
      if (bare === '') return null
      if (GENERIC.has(bare.toLowerCase()) && bare === part) return bare.toLowerCase()
      return `"${bare.replace(/["\\]/g, '')}"`
    })
  if (families.length === 0 || families.some((family) => family === null)) return null
  return families.join(', ')
}
