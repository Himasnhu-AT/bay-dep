import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

/*
 * public/theme.js runs before the bundle exists, so it cannot be imported — it is evaluated
 * here against a stub of the three browser surfaces it touches.
 */
const here = new URL('.', import.meta.url)
const script = readFileSync(new URL('public/theme.js', here), 'utf8')
const html = readFileSync(new URL('index.html', here), 'utf8')

interface Run {
  theme(): string | undefined
  stored(): string | undefined
  osChanges(dark: boolean): void
  handle: { get(): string; set(preference: string): void }
}

function run(stored: string | null, osDark: boolean): Run {
  const storage = new Map<string, string>()
  if (stored !== null) storage.set('bay.theme', stored)
  const attributes = new Map<string, string>()
  let onChange: (() => void) | null = null
  const media = {
    matches: osDark,
    addEventListener: (_: string, listener: () => void) => {
      onChange = listener
    }
  }
  const window: Record<string, unknown> = {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value)
    },
    matchMedia: () => media
  }
  const document = {
    documentElement: { setAttribute: (name: string, value: string) => attributes.set(name, value) }
  }
  runInNewContext(script, { window, document })
  return {
    theme: () => attributes.get('data-theme'),
    // The literal key, not a shared constant: existing installs read this exact string.
    stored: () => storage.get('bay.theme'),
    osChanges: (dark) => {
      media.matches = dark
      onChange?.()
    },
    handle: window.bayTheme as Run['handle']
  }
}

test('with no preference stored, the editor is dark regardless of the OS', () => {
  assert.equal(run(null, false).theme(), 'dark')
  assert.equal(run(null, true).theme(), 'dark')
})

test('an explicit preference wins over the OS in both directions', () => {
  assert.equal(run('light', true).theme(), 'light')
  assert.equal(run('dark', false).theme(), 'dark')
})

test('system resolves through prefers-color-scheme and follows it live', () => {
  const light = run('system', false)
  assert.equal(light.theme(), 'light')
  light.osChanges(true)
  assert.equal(light.theme(), 'dark')

  // The positive control's pair: an explicit preference must not follow the OS.
  const pinned = run('light', false)
  pinned.osChanges(true)
  assert.equal(pinned.theme(), 'light')
})

test('a stored value that is not a preference falls back to dark', () => {
  assert.equal(run('solarized', false).theme(), 'dark')
})

test('set() applies immediately and persists under bay.theme', () => {
  const page = run(null, true)
  page.handle.set('light')
  assert.equal(page.theme(), 'light')
  assert.equal(page.stored(), 'light')
  assert.equal(page.handle.get(), 'light')
})

test('set() refuses an unknown value and names the legal ones', () => {
  const page = run('dark', true)
  assert.throws(() => page.handle.set('blue'), /dark, light, system.*blue/)
  assert.equal(page.theme(), 'dark')
})

test('index.html loads theme.js as a blocking classic script ahead of the bundle', () => {
  const tag = html.match(/<script[^>]*src="\.\/theme\.js"[^>]*>/)?.[0]
  assert.ok(tag, 'index.html no longer loads ./theme.js')
  // type=module, defer and async all let the first paint happen before it runs.
  assert.doesNotMatch(tag, /type="module"|\bdefer\b|\basync\b/)
  const head = html.slice(0, html.indexOf('</head>'))
  assert.ok(head.includes(tag), 'theme.js must be in <head>, before <body> can paint')
  assert.ok(html.indexOf(tag) < html.indexOf('type="module"'))
})
