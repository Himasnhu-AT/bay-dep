/**
 * The composition guides an agent copies from, held to what bay will actually run.
 *
 * The guides came from HyperFrames and loaded GSAP from a CDN. A composition window may load
 * only from its own folder (`src/main/html/sandbox.ts`), so an agent that copied the guide got
 * `gsap is not defined` inside a page nobody watches and a clip with no animation — while the
 * guide itself read as correct. So every ```html block here is read by bay's own composition
 * reader, every block that is a whole document is run against a DOM stand-in and seeked, and no
 * example may lean on a library bay does not ship.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Script, runInNewContext } from 'node:vm'
import { fatalFaults, readComposition } from '../../../shared/composition'

const DIR = join(process.cwd(), 'src', 'main', 'mcp', 'docs', 'compositions')

interface Block {
  file: string
  line: number
  lang: string
  code: string
}

function blocks(): Block[] {
  const out: Block[] = []
  for (const file of readdirSync(DIR).filter((name) => name.endsWith('.md')).sort()) {
    const text = readFileSync(join(DIR, file), 'utf8')
    for (const match of text.matchAll(/^```(\w*)\n([\s\S]*?)^```/gm)) {
      out.push({
        file,
        line: text.slice(0, match.index).split('\n').length,
        lang: match[1] ?? '',
        code: match[2] ?? ''
      })
    }
  }
  return out
}

const ALL = blocks()
const HTML = ALL.filter((b) => b.lang === 'html')
// A whole document has a body; a `<template>` file is a sub-composition, which bay does not open alone.
const DOCUMENTS = HTML.filter((b) => /<body\b/i.test(b.code) && !/<template\b/i.test(b.code))
const where = (b: Block): string => `${b.file}:${b.line}`

test('the guides were found, so an empty scan cannot pass for a clean one', () => {
  assert.ok(readdirSync(DIR).filter((n) => n.endsWith('.md')).length >= 10, 'expected the ten guides')
  assert.ok(HTML.length >= 20, `only ${HTML.length} html blocks found`)
  assert.ok(DOCUMENTS.length >= 2, `only ${DOCUMENTS.length} whole documents found`)
})

test('no guide example loads anything over the network', () => {
  const remote = HTML.flatMap((b) =>
    readComposition(b.code)
      .faults.filter((f) => f.code === 'remote-resource' || f.code === 'remote-script')
      .map((f) => `${where(b)}: ${f.message.slice(0, 90)}`)
  )
  assert.deepEqual(remote, [])
})

test('no guide example calls a library bay does not ship', () => {
  // `gsap` with no script tag is the same still frame as `gsap` from a blocked CDN.
  const leaning = ALL.filter((b) => /\bgsap\s*\./.test(b.code)).map(where)
  assert.deepEqual(leaning, [])
})

test('every whole-document example is a composition bay can place', () => {
  const refused = DOCUMENTS.flatMap((b) =>
    fatalFaults(readComposition(b.code).faults).map((f) => `${where(b)}: ${f.message.slice(0, 90)}`)
  )
  assert.deepEqual(refused, [])
})

const INLINE_SCRIPT = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi

test('every script in the guides parses, fragments included', () => {
  // A fragment runs inside someone's time(t), so it is compiled, not run: a typo in a recipe is
  // copied as faithfully as a correct line.
  const sources = [
    ...ALL.filter((b) => b.lang === 'js' || b.lang === 'javascript').map((b) => ({ b, code: b.code })),
    ...HTML.flatMap((b) => [...b.code.matchAll(INLINE_SCRIPT)].map((m) => ({ b, code: m[1] ?? '' })))
  ]
  assert.ok(sources.length >= 10, `only ${sources.length} scripts found`)
  const broken = sources.flatMap(({ b, code }) => {
    try {
      new Script(code)
      return []
    } catch (error) {
      return [`${where(b)}: ${(error as Error).message}`]
    }
  })
  assert.deepEqual(broken, [])
})

/** A DOM stand-in just wide enough for the examples: every lookup answers, every style write is kept. */
/**
 * A 2D context that records every drawing call, so a canvas example (bay://guide/motion-design)
 * is run rather than exempted, and two moments can be told apart by what was drawn.
 */
function recordingContext(ops: string[]): unknown {
  return new Proxy({} as Record<string | symbol, unknown>, {
    get(target, key) {
      if (key in target) return target[key]
      if (key === 'measureText') return (s: string) => ({ width: String(s).length * 10, actualBoundingBoxAscent: 10 })
      if (key === 'createPattern' || key === 'createLinearGradient' || key === 'createRadialGradient')
        return () => ({ addColorStop() {} })
      return (...args: unknown[]) => { ops.push(`${String(key)}(${args.map((a) => (typeof a === 'number' ? a.toFixed(2) : typeof a === 'string' ? a : typeof a)).join(',')})`) }
    },
    set(target, key, value) { target[key] = value; ops.push(`${String(key)}=${String(value)}`); return true }
  })
}

function standIn(): { document: unknown; styles: () => string } {
  const made = new Map<string, Record<string, unknown>>()
  const ops: string[] = []
  const element = (key: string): Record<string, unknown> => {
    let el = made.get(key)
    if (!el) {
      el = {
        style: {},
        textContent: '',
        width: 1920,
        height: 1080,
        setAttribute() {},
        getAttribute: () => null,
        getContext: () => recordingContext(ops),
        classList: { add() {}, remove() {}, toggle() {} },
        querySelector: (sel: string) => element(`${key} ${sel}`),
        querySelectorAll: (sel: string) => [element(`${key} ${sel}`)]
      }
      made.set(key, el)
    }
    return el
  }
  let fresh = 0
  const document = {
    getElementById: (id: string) => element(`#${id}`),
    querySelector: (sel: string) => element(sel),
    querySelectorAll: (sel: string) => [element(sel)],
    createElement: (tag: string) => element(`<${tag}>#${fresh++}`)
  }
  // What a moment looks like: every element's style, and everything drawn since the last read.
  const styles = (): string => {
    const drawn = ops.splice(0).join(';')
    return JSON.stringify([[...made].map(([key, el]) => [key, el['style']]).sort(), drawn])
  }
  return { document, styles }
}

function seekable(b: Block): { id: string; timeline: { time: (t: number) => unknown; duration: () => number }; styles: () => string } {
  const { info, faults } = readComposition(b.code)
  assert.ok(info, `${where(b)}: ${faults.map((f) => f.message).join(' ')}`)
  const { document, styles } = standIn()
  // bay's composition preload creates the registry before page scripts run.
  const window = { __timelines: {} as Record<string, unknown> }
  const scripts = [...b.code.matchAll(INLINE_SCRIPT)].map((m) => m[1] ?? '')
  const context = { window, document, Math, Number, String, JSON }
  for (const script of scripts) {
    try {
      runInNewContext(script, context)
    } catch (error) {
      assert.fail(`${where(b)}: the example's script throws — ${(error as Error).message}`)
    }
  }
  const timeline = window.__timelines[info.compositionId] as
    | { time?: unknown; duration?: unknown }
    | undefined
  assert.ok(timeline, `${where(b)}: nothing registered at window.__timelines["${info.compositionId}"]`)
  assert.equal(typeof timeline.time, 'function', `${where(b)}: the timeline has no time(seconds)`)
  assert.equal(typeof timeline.duration, 'function', `${where(b)}: the timeline has no duration()`)
  return {
    id: info.compositionId,
    timeline: timeline as { time: (t: number) => unknown; duration: () => number },
    styles
  }
}

test('every whole-document example registers a timeline that seeks without throwing', () => {
  for (const b of DOCUMENTS) {
    const { timeline } = seekable(b)
    const d = timeline.duration()
    assert.ok(Number.isFinite(d) && d > 0, `${where(b)}: duration() is ${d}`)
    for (const t of [0, d / 3, d / 2, d]) timeline.time(t)
  }
})

test('the minimal example moves: two moments are two pictures', () => {
  const minimal = DOCUMENTS.find((b) => b.file === 'minimal-composition.md')
  assert.ok(minimal, 'minimal-composition.md has a whole-document example')
  const { timeline, styles } = seekable(minimal)
  timeline.time(0)
  const before = styles()
  timeline.time(timeline.duration() / 2)
  const after = styles()
  assert.notEqual(before, after, 'seeking changed no style, so the example animates nothing')
  // And seeking back reproduces the first picture: time(t) is a function of t, not of history.
  timeline.time(0)
  assert.equal(styles(), before, 'seeking back to 0 did not restore the first picture')
})

test('the motion-design kit draws a different picture at two moments, and the same one on return', () => {
  const kit = DOCUMENTS.find((b) => b.file === 'motion-design.md')
  assert.ok(kit, 'motion-design.md has a whole-document example')
  const { timeline, styles } = seekable(kit)
  styles() // drop what the script drew while it loaded
  timeline.time(0.2)
  const early = styles()
  timeline.time(1.8)
  const later = styles()
  assert.ok(early.includes('fillRect') || early.includes('drawImage'), 'the kit drew nothing at 0.2 s')
  assert.notEqual(early, later, 'the kit drew the same thing at 0.2 s and 1.8 s: nothing animates')
  timeline.time(0.2)
  assert.equal(styles(), early, 'seeking back to 0.2 s drew something else: time(t) depends on history')
})
