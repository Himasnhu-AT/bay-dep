/** `#abc` and `#aabbcc`, with or without the hash, as `#AABBCC`. Anything else is null — not committed. */
export function normaliseHex(input: string): string | null {
  const hex = input.trim().replace(/^#/, '')
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`.toUpperCase()
  }
  if (/^[0-9a-fA-F]{6}$/.test(hex)) return `#${hex}`.toUpperCase()
  return null
}
