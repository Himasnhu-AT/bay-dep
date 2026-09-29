import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Chrome glass must stay legible over the worst picture behind it. Read from styles.css itself —
 * the tokens and the tint shares — so retuning either one re-runs the check rather than passing
 * against numbers copied here.
 */

const css = readFileSync(fileURLToPath(new URL('./styles.css', import.meta.url)), 'utf8')

/** The first `--name: #rrggbb` inside the block that starts at `selector`. */
function token(block: string, name: string): string {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(block)
  assert.ok(match, `--${name} not found`)
  return match[1]!
}

/** The CSS text from `marker` to the next closing brace at the start of a line. */
function blockAt(marker: string): string {
  const start = css.indexOf(marker)
  assert.ok(start >= 0, `${marker} not found in styles.css`)
  return css.slice(start, css.indexOf('\n}', start))
}

function share(selectorMarker: string): number {
  const block = blockAt(selectorMarker)
  const match = /--glass-tint-share:\s*([\d.]+)%/.exec(block)
  assert.ok(match, `no --glass-tint-share in ${selectorMarker}`)
  return Number(match[1]) / 100
}

const channel = (c: number): number => {
  const s = c / 255
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}
const rgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]
const luminance = ([r, g, b]: [number, number, number]): number => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
const contrast = (a: [number, number, number], b: [number, number, number]): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}
/** `color-mix(in srgb, tint share, transparent)` composited over `backdrop`. */
const over = (tint: [number, number, number], share: number, backdrop: [number, number, number]): [number, number, number] =>
  tint.map((c, i) => c * share + backdrop[i]! * (1 - share)) as [number, number, number]

const dark = blockAt('@theme static {')
const light = blockAt("[data-theme='light']")

const cases = [
  { theme: 'dark', block: dark, worst: [255, 255, 255] as [number, number, number] },
  { theme: 'light', block: light, worst: [0, 0, 0] as [number, number, number] }
]

test('ink-2 on a glass drawer keeps 4.5:1 over a white frame (dark) and a black one (light)', () => {
  const tintShare = share('.bay-glass {')
  for (const { theme, block, worst } of cases) {
    const glass = over(rgb(token(block, 'color-surface-1')), tintShare, worst)
    const ratio = contrast(rgb(token(block, 'color-ink-2')), glass)
    assert.ok(ratio >= 4.5, `${theme}: ink-2 on the drawer glass is ${ratio.toFixed(2)}:1`)
  }
})

test('why popovers carry no glass: on surface-2 the guard needs more than 98.5% tint', () => {
  // The reason styles.css gives, measured: the thinnest tint that keeps ink-2 at 4.5:1 over a
  // white frame on the dark theme's surface-2. Should the tokens change so that a real glass fits,
  // this fails and the decision is worth revisiting.
  const surface = rgb(token(dark, 'color-surface-2'))
  const ink = rgb(token(dark, 'color-ink-2'))
  let needed = 1
  for (let tint = 1; tint >= 0.5; tint -= 0.0005) {
    if (contrast(ink, over(surface, tint, [255, 255, 255])) < 4.5) break
    needed = tint
  }
  assert.ok(needed > 0.985, `a popover would need ${(needed * 100).toFixed(2)}% tint`)
})

test('a thinner tint would fail — the check can see the thing it guards', () => {
  // The research note's first guess, 80%, over a white frame in the dark theme.
  const glass = over(rgb(token(dark, 'color-surface-1')), 0.8, [255, 255, 255])
  assert.ok(contrast(rgb(token(dark, 'color-ink-2')), glass) < 4.5)
})

test('glass is solid while the timeline plays', () => {
  const rule = blockAt('html[data-playing] .bay-glass {')
  assert.match(rule, /backdrop-filter:\s*none/)
  assert.match(rule, /background-color:\s*var\(--glass-tint\)/)
})
