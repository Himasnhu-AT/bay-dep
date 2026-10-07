/**
 * The composition guides an agent copies from, held to what bay will actually run.
 *
 * The guides came from HyperFrames and loaded GSAP from a CDN. A composition window may load
 * only from its own folder (`src/main/html/sandbox.ts`), so an agent that copied the guide got
 * `gsap is not defined` inside a page nobody watches and a clip with no animation — while the
 * guide itself read as correct. So every ```html block here is read by bay's own composition
 * reader, every block that is a whole document is run against a DOM stand-in and seeked, and no
 * example may lean on a library bay does not ship.
 *
 * The one library bay does ship is its own: `<script src="bay-motion.js">`. The stand-in runs the
 * real generated script for that tag, in document order, so an example written on `BM` is run on
 * the moves an agent's copy of it would get — and a `BM.` call that does not exist throws here.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Script, createContext, runInContext, type Context } from 'node:vm'
import { fatalFaults, readComposition } from '../../../shared/composition'
import * as MOTION from '../../../shared/motion/index'
import { MOTION_FILE } from '../../../shared/motion-file'
import {
  ANCHOR_AREA_SHARE,
  BEAT_CV_MIN,
  BEAT_RATIO_MIN,
  BURST_COUNT,
  BURST_WINDOW_SECONDS,
  CARRY_AFTER_SECONDS,
  CARRY_FAIL_BELOW,
  CARRY_MOVE_DIAGONALS,
  CARRY_SCALE_RATIO,
  CARRY_WARN_BELOW,
  END_EXEMPT_SECONDS,
  FAST_PX_PER_FRAME_AT_1080P,
  FILM_CONTRACT,
  REST_SECONDS_MIN,
  STILL_SHARE_MIN
} from '../../../shared/film-oracle'
import { BAY_SKILLS } from '../../../shared/skills'
import { MOTION_SCRIPT } from '../../html/motion-script.generated'

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

const SCRIPT_TAG = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi

/**
 * What a composition window would run for this document, in document order: each inline script,
 * and for `<script src="bay-motion.js">` the library main writes beside the file. Any other
 * `src` names a file the example does not come with, so it is refused rather than skipped — a
 * skipped script is an example "run" without the thing it calls.
 */
function pageScripts(b: Block): string[] {
  return [...b.code.matchAll(SCRIPT_TAG)].map((tag) => {
    const src = /\bsrc\s*=\s*["']?([^"'\s>]+)/i.exec(tag[1] ?? '')?.[1]
    if (src === undefined) return tag[2] ?? ''
    assert.ok(
      src === MOTION_FILE || src === `./${MOTION_FILE}`,
      `${where(b)}: loads ${src}. The only script bay puts beside a composition is ${MOTION_FILE}; an example must run with nothing else.`
    )
    return MOTION_SCRIPT
  })
}

interface Seekable {
  id: string
  timeline: { time: (t: number) => unknown; duration: () => number }
  styles: () => string
  /** The page's globals, for reading what its scripts defined (`BM`, `window.__film`). */
  context: Context
}

function seekable(b: Block): Seekable {
  const { info, faults } = readComposition(b.code)
  assert.ok(info, `${where(b)}: ${faults.map((f) => f.message).join(' ')}`)
  const { document, styles } = standIn()
  // bay's composition preload creates the registry before page scripts run.
  const window = { __timelines: {} as Record<string, unknown> }
  // One context for the whole page, so the library's `var BM` is a global the next script sees.
  const context = createContext({ window, document })
  for (const script of pageScripts(b)) {
    try {
      runInContext(script, context)
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
    styles,
    context
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

// ---------------------------------------------------------------------------
// The motion-design guide: its kit runs on the real library, and its numbers are the code's
// ---------------------------------------------------------------------------

const GUIDE = readFileSync(join(DIR, 'motion-design.md'), 'utf8')
const KIT = DOCUMENTS.find((b) => b.file === 'motion-design.md')
/** The guide without its kit: the prose and tables an agent reads as reference. */
const GUIDE_PROSE = GUIDE.replace(/^```html\n[\s\S]*?^```/m, '')

/** `block` with one piece of its code swapped — and proof the swap landed, or the control tests nothing. */
function mutated(block: Block, from: string, to: string): Block {
  assert.ok(block.code.includes(from), `specimen: the kit must contain ${JSON.stringify(from)} for this control to mean anything`)
  const code = block.code.replace(from, to)
  assert.notEqual(code, block.code)
  return { ...block, code }
}

test('the kit loads bay-motion.js, and the BM it runs on is the library itself', () => {
  assert.ok(KIT, 'motion-design.md has a whole-document example')
  assert.match(KIT.code, /<script src="bay-motion\.js"><\/script>/)
  const { context } = seekable(KIT)
  const names = runInContext('Object.keys(BM).sort().join(" ")', context) as string
  assert.equal(names, Object.keys(MOTION).sort().join(' '))
  // A value, not only names: the page's curve table is the measured one.
  assert.equal(runInContext('BM.EASE_T80.expoOut', context), MOTION.EASE_T80.expoOut)
})

test('the kit draws every frame of its ten seconds without throwing, and its hold is one draw', () => {
  assert.ok(KIT)
  const { timeline, styles } = seekable(KIT)
  const frames = Math.round(timeline.duration() * 30)
  styles()
  const subFrames: number[] = []
  for (let frame = 0; frame <= frames; frame += 1) {
    timeline.time(frame / 30)
    // The blur averages sub-frames onto the view with drawImage; a frame drawn once has none.
    subFrames.push(styles().split('drawImage(').length - 1)
  }
  assert.ok(Math.max(...subFrames) >= 8, `the fastest frame drew ${Math.max(...subFrames)} sub-frames: the blur is not sized from travel`)
  // The last three seconds are the hold: nothing travels, so nothing is blurred.
  assert.deepEqual([...new Set(subFrames.slice(-90))], [0])
})

test('a BM call that does not exist fails the kit — at load, and at the time that reaches it', () => {
  assert.ok(KIT)
  // Reached while the script loads (time(0) draws the panel).
  assert.throws(() => seekable(mutated(KIT, 'BM.rectMorph(', 'BM.rectMorf(')), /the example's script throws — BM\.rectMorf is not a function/)
  // Reached only once the last beat is on screen: loading passes, and so does an early seek.
  const late = seekable(mutated(KIT, 'BM.lineReveal(', 'BM.lineRevel('))
  late.timeline.time(1)
  assert.throws(() => late.timeline.time(8), /BM\.lineRevel is not a function/)
  // And without the tag there is no BM at all: the stand-in supplies the library only when asked.
  assert.throws(() => seekable(mutated(KIT, '<script src="bay-motion.js"></script>', '')), /BM is not defined/)
})

test('the guide\'s curve table is EASE_T80, every curve and every number', () => {
  const rows = [...GUIDE_PROSE.matchAll(/^\s*\| `(\w+)` \| (\d\.\d\d) \|/gm)].map((m) => [m[1]!, m[2]!] as const)
  assert.deepEqual(
    Object.fromEntries(rows),
    Object.fromEntries(Object.entries(MOTION.EASE_T80).map(([name, t80]) => [name, t80.toFixed(2)]))
  )
  assert.equal(rows.length, Object.keys(MOTION.EASE_T80).length, 'a curve is listed twice')
})

test('the guide names every export of the move library, so the catalogue cannot fall behind it', () => {
  const missing = Object.keys(MOTION).filter((name) => !new RegExp(`\\b${name}\\b`).test(GUIDE_PROSE))
  assert.deepEqual(missing, [])
})

test('every BM.name in the guides and the skills is a real export', () => {
  const sources: [string, string][] = [
    ...readdirSync(DIR).filter((name) => name.endsWith('.md')).map((name): [string, string] => [name, readFileSync(join(DIR, name), 'utf8')]),
    ['brf.md', readFileSync(join(DIR, '..', 'brf.md'), 'utf8')],
    ...BAY_SKILLS.map((skill): [string, string] => [`skill ${skill.slug}`, skill.body])
  ]
  const named = (text: string): string[] => [...text.matchAll(/\bBM\.([A-Za-z_]\w*)/g)].map((m) => m[1]!)
  let seen = 0
  for (const [where_, text] of sources) {
    seen += named(text).length
    assert.deepEqual(named(text).filter((name) => !(name in MOTION)), [], `${where_} names a move the library does not have`)
  }
  assert.ok(seen >= 60, `only ${seen} BM names found — is the pattern still matching?`)
  // The proof it can fail: the same reader on a spoiled name.
  assert.deepEqual(named('BM.wordLand(t, 0) and BM.wordLanding(t, 0)').filter((name) => !(name in MOTION)), ['wordLanding'])
})

test('the thresholds the guide quotes are the oracle\'s own', () => {
  // The guide has to state numbers — an agent plans against them — and a number in prose does
  // not move when the constant does. Each phrase is built from the constant it quotes.
  const percent = (share: number): number => Math.round(share * 100)
  const phrases = [
    `carry score under ${CARRY_FAIL_BELOW}`,
    `warns under ${CARRY_WARN_BELOW}`,
    `moves ${percent(CARRY_MOVE_DIAGONALS)} % of the frame diagonal`,
    `scales ${percent(CARRY_SCALE_RATIO - 1)} %`,
    `covering ${percent(ANCHOR_AREA_SHARE)} % of the frame`,
    `${BURST_COUNT} bare boundaries within ${BURST_WINDOW_SECONDS} s`,
    `in the last ${END_EXEMPT_SECONDS} s`,
    `over ${FAST_PX_PER_FRAME_AT_1080P} px/frame at 1080p`,
    `coefficient of variation under ${BEAT_CV_MIN}`,
    `under ${BEAT_RATIO_MIN}× the shortest`,
    `under ${percent(STILL_SHARE_MIN)} % of the film dead still`,
    `no rest of ${REST_SECONDS_MIN} s`,
    `slower than ${CARRY_AFTER_SECONDS} s`
  ]
  assert.deepEqual(phrases.filter((phrase) => !GUIDE_PROSE.includes(phrase)), [])
  // Every field of the contract the oracle prints is in the guide's own copy of it.
  const fields = [...FILM_CONTRACT.matchAll(/^ {2}(\w+)[:(]/gm)].map((m) => m[1]!)
  assert.deepEqual(fields, ['beats', 'cuts', 'inFrame', 'blur', 'track', 'events'])
  const contract = /```js\nwindow\.__film = \{[\s\S]*?^```/m.exec(GUIDE_PROSE)?.[0] ?? ''
  assert.deepEqual(fields.filter((field) => !new RegExp(`^ {2}${field}[:(]`, 'm').test(contract)), [])
})
