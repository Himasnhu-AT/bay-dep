import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import {
  COMPOSITION_EXTENSIONS,
  isCompositionPath,
  compositionDurationUs,
  fatalFaults,
  readComposition,
  seekSecondsFor,
  MAX_COMPOSITION_SECONDS,
  resolveVariables,
  variablesKey,
  cssVariables
} from './composition'

const ROOT = (attrs: string, inner = ''): string =>
  `<!doctype html><html><body><div ${attrs}>${inner}</div></body></html>`

const GOOD = ROOT(
  'data-composition-id="hero" data-duration="5" style="width:1920px;height:1080px"'
)

test('reads what bay needs off a well-formed composition', () => {
  const { info, faults } = readComposition(GOOD)

  assert.deepEqual(faults, [])
  assert.deepEqual(info, {
    compositionId: 'hero',
    durationSeconds: 5,
    width: 1920,
    height: 1080,
    // Pinned whole rather than field by field: an inspector reads this to decide what controls
    // to draw, so a field quietly disappearing has to fail here.
    variables: []
  })
})

test('seconds on the page become microseconds in the model, at this boundary only', () => {
  const { info } = readComposition(GOOD)
  // Derived from the parsed value rather than written as 5_000_000, so the assertion still
  // means something if the fixture's duration changes.
  assert.equal(compositionDurationUs(info!), info!.durationSeconds * 1_000_000)
})

test('a missing root says what to add, because there is nothing to infer from', () => {
  const { info, faults } = readComposition('<!doctype html><html><body><p>hi</p></body></html>')

  assert.equal(info, null)
  assert.equal(faults.length, 1)
  assert.equal(faults[0]?.code, 'no-root')
  assert.ok(faults[0]?.fatal)
  // An error is a recovery instruction: it has to carry the attribute to add.
  assert.match(faults[0]!.message, /data-composition-id/)
})

test('a root inside <template> is caught, because it renders blank rather than failing', () => {
  const html =
    '<!doctype html><html><body><template>' +
    '<div data-composition-id="hero" data-duration="5" style="width:1920px;height:1080px"></div>' +
    '</template></body></html>'

  const { faults } = readComposition(html)
  const fault = faults.find((f) => f.code === 'wrapped-in-template')

  assert.ok(fault, `expected a wrapped-in-template fault, got ${JSON.stringify(faults)}`)
  assert.ok(fault!.fatal)
})

test('a template that has already closed before the root is not a wrapper', () => {
  // The positive control for the check above: a composition may legitimately contain a
  // <template> for something else, and a naive "does the file contain <template>" would
  // reject this correct file.
  const html =
    '<!doctype html><html><body><template><span>a slot</span></template>' +
    '<div data-composition-id="hero" data-duration="5" style="width:1920px;height:1080px"></div>' +
    '</body></html>'

  const { info, faults } = readComposition(html)

  assert.equal(faults.filter((f) => f.code === 'wrapped-in-template').length, 0)
  assert.equal(info?.compositionId, 'hero')
})

test('a duration in milliseconds is caught as the mistake it always is', () => {
  const { info, faults } = readComposition(
    ROOT('data-composition-id="hero" data-duration="5000" style="width:100px;height:100px"')
  )

  assert.equal(info, null)
  const fault = faults.find((f) => f.code === 'bad-duration')
  assert.ok(fault)
  assert.match(fault!.message, /seconds/)
})

test('a duration just under the ceiling is still accepted', () => {
  // The positive control: a refusal test passes trivially against something that refuses
  // everything, so the largest legal value must still be read.
  const seconds = MAX_COMPOSITION_SECONDS - 1
  const { info } = readComposition(
    ROOT(`data-composition-id="long" data-duration="${seconds}" style="width:10px;height:10px"`)
  )

  assert.equal(info?.durationSeconds, seconds)
})

test('an unsized root is refused, because it renders empty rather than erroring', () => {
  const { info, faults } = readComposition(ROOT('data-composition-id="hero" data-duration="5"'))

  assert.equal(info, null)
  assert.ok(faults.some((f) => f.code === 'no-size' && f.fatal))
})

test('size is read from width/height attributes as well as from style', () => {
  const { info } = readComposition(
    ROOT('data-composition-id="hero" data-duration="5" width="1280" height="720"')
  )

  assert.equal(info?.width, 1280)
  assert.equal(info?.height, 720)
})

test('a remote resource is reported, and is not fatal', () => {
  const html = ROOT(
    'data-composition-id="hero" data-duration="5" style="width:10px;height:10px"',
    '<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>'
  )

  const { info, faults } = readComposition(html)
  const remote = faults.find((f) => f.code === 'remote-resource')

  assert.ok(remote, 'the CDN script should be reported')
  assert.equal(remote!.fatal, false)
  // Not fatal, so the composition is still usable — it just will not look right.
  assert.equal(info?.compositionId, 'hero')
  assert.equal(fatalFaults(faults).length, 0)
  assert.ok(remote!.line !== null, 'a remote resource is attributable to a line')
})

test('a relative script is not mistaken for a remote one', () => {
  const html = ROOT(
    'data-composition-id="hero" data-duration="5" style="width:10px;height:10px"',
    '<script src="gsap.min.js"></script><link href="./fonts/x.woff2" rel="preload">'
  )

  assert.equal(readComposition(html).faults.length, 0)
})

test('every fault names a line when one is attributable', () => {
  const html =
    '<!doctype html>\n<html>\n<body>\n' +
    '<div data-composition-id="hero" data-duration="oops" style="width:10px;height:10px"></div>\n' +
    '</body></html>'

  const fault = readComposition(html).faults.find((f) => f.code === 'bad-duration')
  assert.equal(fault?.line, 4)
})

test('seeking clamps into the composition and speaks the seconds a timeline takes', () => {
  const { info } = readComposition(GOOD)
  const d = info!.durationSeconds

  assert.equal(seekSecondsFor(info!, 0), 0)
  assert.equal(seekSecondsFor(info!, 1_000_000), 1)
  assert.equal(seekSecondsFor(info!, -5), 0, 'a negative source time is the start, not a throw')
  assert.equal(seekSecondsFor(info!, d * 2 * 1_000_000), d, 'past the end holds the last frame')
})

test('three problems are reported as three, not as the first one', () => {
  // Ordering matters here: the remote resource is the fault that hides best — a blocked CDN
  // renders as a still frame with nothing in any log — so it must not be dropped because a
  // louder fault was found first.
  const html = ROOT(
    'data-composition-id="hero" data-duration="bad"',
    '<script src="https://cdn.example.com/x.js"></script>'
  )

  const codes = readComposition(html).faults.map((f) => f.code)

  assert.ok(codes.includes('bad-duration'))
  assert.ok(codes.includes('no-size'))
  assert.ok(codes.includes('remote-resource'))
})

/**
 * The reader is pointed at the composition the render spike actually drove, when it is
 * present. A parser proven only against its own fixtures agrees with itself; this is the one
 * file that is known to seek, paint and hash correctly in a real browser.
 */
test('reads the real HyperFrames composition the spike rendered', (t) => {
  const path =
    '/private/tmp/claude-501/-Users-himanshu-codes-synthai-vii/' +
    '040091dd-ab41-47c2-a7dd-937a61a97337/scratchpad/spike/demo.html'
  if (!existsSync(path)) {
    t.skip('the spike fixture is not on this machine — the proof cannot run here')
    return
  }

  const { info, faults } = readComposition(readFileSync(path, 'utf8'))

  assert.equal(info?.compositionId, 'hw-title')
  assert.equal(info?.durationSeconds, 6)
  assert.equal(info?.width, 1920)
  assert.equal(info?.height, 1080)
  assert.deepEqual(fatalFaults(faults), [], 'the real composition must not be refused')
})


test('every offered extension is one the importer routes as a composition', () => {
  // The two must agree or the picker offers a file the importer hands to ffprobe, which
  // rejects it — producing a "could not be read" asset for a file the user was invited to
  // choose. Derived from the list rather than written out, so adding one cannot miss this.
  for (const extension of COMPOSITION_EXTENSIONS) {
    assert.ok(isCompositionPath(`/tmp/thing.${extension}`), extension)
    assert.ok(isCompositionPath(`/tmp/thing.${extension.toUpperCase()}`), `${extension} upper`)
  }
})

test('media files are not routed as compositions', () => {
  // The positive control for the check above: a predicate that returned true for everything
  // would pass it and send every import down the composition path.
  for (const path of ['/a/clip.mp4', '/a/song.wav', '/a/still.png', '/a/x.gif', '/a/n.mov']) {
    assert.equal(isCompositionPath(path), false, path)
  }
})

test('an extension-shaped substring elsewhere in the path is not an extension', () => {
  // `/html/clip.mp4` is a video in a directory called html, and a naive `includes` says
  // otherwise.
  assert.equal(isCompositionPath('/projects/html/clip.mp4'), false)
  assert.equal(isCompositionPath('/projects/my.html.backup/clip.mp4'), false)
  assert.equal(isCompositionPath('/no-extension-at-all'), false)
})

// --- the controls a composition declares for itself ---------------------------------------

const WITH_VARS = (declaration: string): string =>
  `<!doctype html><html data-composition-variables='${declaration}'><body>` +
  `<div data-composition-id="lower" data-duration="5" style="width:1920px;height:1080px">` +
  `</div></body></html>`

test('declared variables are read, in the order the author wrote them', () => {
  const { info, faults } = readComposition(
    WITH_VARS(
      '[{"id":"name","type":"string","label":"Name","default":"Jane"},' +
        '{"id":"accent","type":"color","label":"Accent","default":"#ffb020"}]'
    )
  )

  assert.deepEqual(faults, [])
  // Order is the author's grouping; sorting them would scatter it.
  assert.deepEqual(info!.variables.map((v) => v.id), ['name', 'accent'])
  assert.equal(info!.variables[0]!.type, 'string')
  assert.equal(info!.variables[1]!.default, '#ffb020')
})

test('a composition with no declaration simply has no controls', () => {
  const { info, faults } = readComposition(
    '<!doctype html><html><body><div data-composition-id="x" data-duration="2" ' +
      'style="width:10px;height:10px"></div></body></html>'
  )

  assert.deepEqual(info!.variables, [])
  assert.deepEqual(faults, [])
})

test('a malformed declaration is reported but never fatal', () => {
  // The composition still renders at its defaults. Refusing to place a clip over a trailing
  // comma in an attribute would be wildly out of proportion.
  const { info, faults } = readComposition(WITH_VARS('[{"id":"a",]'))

  assert.ok(info, 'the composition is still usable')
  assert.deepEqual(info!.variables, [])
  const fault = faults.find((f) => f.code === 'bad-variables')
  assert.ok(fault)
  assert.equal(fault!.fatal, false)
})

test('an enum with no options is refused, because it is a control with no choices', () => {
  const { info, faults } = readComposition(
    WITH_VARS('[{"id":"mode","type":"enum","label":"Mode","default":"a"}]')
  )

  assert.deepEqual(info!.variables, [])
  assert.match(faults.find((f) => f.code === 'bad-variables')!.message, /no options/)
})

test('a duplicate id keeps the first and says so', () => {
  const { info, faults } = readComposition(
    WITH_VARS(
      '[{"id":"n","type":"string","label":"First","default":"a"},' +
        '{"id":"n","type":"string","label":"Second","default":"b"}]'
    )
  )

  assert.equal(info!.variables.length, 1)
  assert.equal(info!.variables[0]!.label, 'First')
  assert.match(faults.find((f) => f.code === 'bad-variables')!.message, /repeats the id/)
})

test('entities in the attribute are decoded, since it lives inside HTML', () => {
  const { info } = readComposition(
    '<!doctype html><html data-composition-variables="[{&quot;id&quot;:&quot;n&quot;,' +
      '&quot;type&quot;:&quot;string&quot;,&quot;label&quot;:&quot;N&quot;,' +
      '&quot;default&quot;:&quot;hi&quot;}]"><body>' +
      '<div data-composition-id="x" data-duration="2" style="width:10px;height:10px"></div>' +
      '</body></html>'
  )

  assert.equal(info!.variables[0]?.id, 'n')
  assert.equal(info!.variables[0]?.default, 'hi')
})

test('resolving starts from the declared defaults', () => {
  const { info } = readComposition(
    WITH_VARS('[{"id":"name","type":"string","label":"Name","default":"Jane"}]')
  )

  assert.deepEqual(resolveVariables(info!, undefined), { name: 'Jane' })
})

test('an override wins, and is coerced to the declared type', () => {
  const { info } = readComposition(
    WITH_VARS('[{"id":"size","type":"number","label":"Size","default":40}]')
  )

  // "64" out of a text input is a typo in form, not a different intention.
  assert.deepEqual(resolveVariables(info!, { size: '64' }), { size: 64 })
})

test('an override for something no longer declared is dropped', () => {
  // A leftover from an earlier version of the file. Forwarding it would set a CSS custom
  // property nothing reads — invisible, and with no control drawn to clear it.
  const { info } = readComposition(
    WITH_VARS('[{"id":"name","type":"string","label":"Name","default":"Jane"}]')
  )

  assert.deepEqual(resolveVariables(info!, { name: 'Ada', gone: 'x' }), { name: 'Ada' })
})

test('an override of the wrong type falls back to the default rather than rendering nonsense', () => {
  const { info } = readComposition(
    WITH_VARS('[{"id":"size","type":"number","label":"Size","default":40}]')
  )

  assert.deepEqual(resolveVariables(info!, { size: 'huge' }), { size: 40 })
})

test('the values key is stable across insertion order, and distinguishes different values', () => {
  // Without values in the cache key, two lower thirds naming different people would show
  // whichever rendered first — and nothing would look broken.
  assert.equal(variablesKey({ a: '1', b: '2' }), variablesKey({ b: '2', a: '1' }))
  assert.notEqual(variablesKey({ name: 'Jane' }), variablesKey({ name: 'Ada' }))
  assert.equal(variablesKey({}), '')
})

test('a number with a unit becomes CSS-usable, while its text stays bare', () => {
  // `--inset: 96` makes `left: var(--inset)` invalid CSS, so the declaration is dropped and the
  // element sits at the frame edge with nothing reported anywhere. `--inset: 96px` is what the
  // author meant. But a caption bound to the same variable must read "96", not "96px".
  const { info } = readComposition(
    WITH_VARS('[{"id":"inset","type":"number","label":"Inset","default":96,"unit":"px"}]')
  )
  const values = resolveVariables(info!, undefined)

  assert.deepEqual(values, { inset: 96 })
  assert.deepEqual(cssVariables(info!, values), { inset: '96px' })
})

test('a number with no unit is left alone, so calc() authors are not broken', () => {
  const { info } = readComposition(
    WITH_VARS('[{"id":"scale","type":"number","label":"Scale","default":2}]')
  )

  assert.deepEqual(cssVariables(info!, resolveVariables(info!, undefined)), { scale: '2' })
})

test('strings and colours pass through unchanged', () => {
  const { info } = readComposition(
    WITH_VARS(
      '[{"id":"name","type":"string","label":"Name","default":"Ada"},' +
        '{"id":"accent","type":"color","label":"Accent","default":"#66d9ef"}]'
    )
  )

  assert.deepEqual(cssVariables(info!, resolveVariables(info!, undefined)), {
    name: 'Ada',
    accent: '#66d9ef'
  })
})
