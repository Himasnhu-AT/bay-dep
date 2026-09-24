/**
 * Keyboard shortcuts as data: one spelling, parsed once, matched, shown and handed to the menu.
 *
 * A shortcut is written the way a person reads it: `'Mod+B'`, `'Shift+Delete'`, `'S'`, `'?'`,
 * `'Mod+Shift+Z'`. `Mod` is ⌘ on macOS and Ctrl elsewhere. Modifiers come first, in any order;
 * the last token is the key — a single character, or one of `NAMED_KEYS`. `'+'` as the key is
 * spelled `'+'` alone or `'Mod++'`.
 *
 * Pure (no DOM, no Electron), because three places need the same answer: the renderer matches
 * key events against it, `Kbd` and menus draw it, and main turns it into an Electron
 * accelerator. Three spellings of one binding is how a tooltip comes to advertise a key that
 * does something else.
 */

export interface Shortcut {
  mod: boolean
  shift: boolean
  alt: boolean
  /** A single character (letters upper-cased) or a name from `NAMED_KEYS`. */
  key: string
}

/** Keys spelled by name. Their `KeyboardEvent.key` is the same string, except `Space`. */
export const NAMED_KEYS = [
  'Space',
  'Enter',
  'Escape',
  'Tab',
  'Backspace',
  'Delete',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'F1',
  'F2',
  'F3',
  'F4',
  'F5',
  'F6',
  'F7',
  'F8',
  'F9',
  'F10',
  'F11',
  'F12'
] as const

const NAMED = new Set<string>(NAMED_KEYS)

/** Parses a spelling, or returns null for anything that is not one (prose, `'⌘S'`). */
export function parseShortcut(spec: string): Shortcut | null {
  if (spec.length === 0) return null
  // A trailing '+' is the plus key: 'Mod++' → ['Mod', '+'], '+' → ['+'].
  let tokens: string[]
  if (spec === '+') tokens = ['+']
  else if (spec.endsWith('++')) tokens = [...spec.slice(0, -2).split('+'), '+']
  else tokens = spec.split('+')
  const key = tokens.pop()
  if (key === undefined || key === '') return null

  const out: Shortcut = { mod: false, shift: false, alt: false, key: '' }
  for (const token of tokens) {
    if (token === 'Mod' && !out.mod) out.mod = true
    else if (token === 'Shift' && !out.shift) out.shift = true
    else if (token === 'Alt' && !out.alt) out.alt = true
    else return null
  }
  if (NAMED.has(key)) out.key = key
  else if ([...key].length === 1) out.key = key.toUpperCase()
  else return null
  return out
}

/** Letters, digits and named keys: Shift is part of the binding. */
function shiftIsSignificant(key: string): boolean {
  return NAMED.has(key) || /^[A-Z0-9]$/.test(key)
}

/** One spelling per binding, for comparing two of them. */
export function canonicalShortcut(shortcut: Shortcut): string {
  const parts: string[] = []
  if (shortcut.mod) parts.push('Mod')
  if (shortcut.alt) parts.push('Alt')
  // For punctuation the character already says whether Shift was down ('?' is Shift+/), so a
  // written 'Shift' there is noise and must not make two identical bindings look different.
  if (shortcut.shift && shiftIsSignificant(shortcut.key)) parts.push('Shift')
  parts.push(shortcut.key)
  return parts.join('+')
}

/** The fields of a `KeyboardEvent` that matching reads, so tests need no DOM. */
export interface KeyLike {
  key: string
  code?: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
}

/**
 * Whether a key event is this shortcut.
 *
 * Modifiers match exactly — `S` does not fire on ⇧S, so ⇧S stays free for something else —
 * except Shift on punctuation, where the character is the only reliable signal across layouts.
 * `Mod` is ⌘ *or* Ctrl, as the renderer's handler always accepted both.
 */
export function matchesShortcut(shortcut: Shortcut, event: KeyLike): boolean {
  const mod = event.metaKey || event.ctrlKey
  if (mod !== shortcut.mod) return false
  if (event.altKey !== shortcut.alt) return false
  if (shiftIsSignificant(shortcut.key) && event.shiftKey !== shortcut.shift) return false

  const key = shortcut.key
  if (key === 'Space') return event.key === ' ' || event.key === 'Spacebar'
  if (NAMED.has(key)) return event.key === key
  if (/^[A-Z]$/.test(key)) {
    if (event.key.toUpperCase() === key) return true
    // ⌥ turns a letter into another character on macOS (⌥D is '∂'); the physical key is the
    // only way to see the binding then.
    return event.altKey && event.code === `Key${key}`
  }
  if (/^[0-9]$/.test(key)) return event.key === key || event.code === `Digit${key}`
  return event.key === key
}

export function isMacPlatform(): boolean {
  const nav = (globalThis as { navigator?: { platform?: string; userAgent?: string } }).navigator
  if (!nav) return false
  return /Mac|iPhone|iPad/.test(nav.platform ?? nav.userAgent ?? '')
}

const MAC_KEY_GLYPHS: Record<string, string> = {
  Backspace: '⌫',
  Delete: '⌦',
  Enter: '↩',
  Escape: 'Esc',
  Tab: '⇥',
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  PageUp: 'PgUp',
  PageDown: 'PgDn'
}

const OTHER_KEY_NAMES: Record<string, string> = {
  Escape: 'Esc',
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  PageUp: 'PgUp',
  PageDown: 'PgDn'
}

/**
 * The binding as a person reads it: `⇧⌘Z` on a Mac, `Ctrl+Shift+Z` elsewhere.
 *
 * Anything that does not parse comes back unchanged, so a caller holding prose or an
 * already-drawn glyph (`'⌘S'`) can pass it through the same function.
 */
export function formatShortcut(spec: string, mac: boolean = isMacPlatform()): string {
  const shortcut = parseShortcut(spec)
  if (!shortcut) return spec
  const key = shortcut.key
  if (mac) {
    // Apple's order: ⌃ ⌥ ⇧ ⌘, then the key.
    let out = ''
    if (shortcut.alt) out += '⌥'
    if (shortcut.shift && shiftIsSignificant(key)) out += '⇧'
    if (shortcut.mod) out += '⌘'
    return out + (MAC_KEY_GLYPHS[key] ?? key)
  }
  const parts: string[] = []
  if (shortcut.mod) parts.push('Ctrl')
  if (shortcut.alt) parts.push('Alt')
  if (shortcut.shift && shiftIsSignificant(key)) parts.push('Shift')
  parts.push(OTHER_KEY_NAMES[key] ?? key)
  return parts.join('+')
}

const ACCELERATOR_KEYS: Record<string, string> = {
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  Escape: 'Esc',
  Enter: 'Return',
  '+': 'Plus',
  ' ': 'Space'
}

/**
 * The Electron accelerator for a binding (`'Mod+Shift+S'` → `'CmdOrCtrl+Shift+S'`), or
 * undefined when Electron cannot spell it — a shifted punctuation character such as `'?'`,
 * whose Shift is implied by the character and not writable as an accelerator.
 */
export function toAccelerator(spec: string): string | undefined {
  const shortcut = parseShortcut(spec)
  if (!shortcut) return undefined
  const key = shortcut.key
  if (!shiftIsSignificant(key) && !/^[`\-=[\]\\;',./+]$/.test(key)) return undefined
  const parts: string[] = []
  if (shortcut.mod) parts.push('CmdOrCtrl')
  if (shortcut.alt) parts.push('Alt')
  if (shortcut.shift && shiftIsSignificant(key)) parts.push('Shift')
  parts.push(ACCELERATOR_KEYS[key] ?? key)
  return parts.join('+')
}
