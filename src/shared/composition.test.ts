import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import {
  COMPOSITION_EXTENSIONS,
  isCompositionPath,
  compositionDurationUs,
  fatalFaults,
  faultsOnWrite,
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
    variables: [],
    audio: []
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

test('a file outside the composition’s folder is reported; one inside it is not', () => {
  const html = ROOT(
    'data-composition-id="hero" data-duration="5" style="width:10px;height:10px"',
    '<img src="../shared/logo.png"><img src="/Users/x/pic.png"><img src="file:///etc/hosts">' +
      '<img src="assets/ok.png"><img src="./also-ok.png"><script src="//cdn.example/x.js"></script>'
  )
  const outside = readComposition(html).faults.filter((f) => f.code === 'outside-folder')
  assert.deepEqual(
    outside.map((f) => /loads (\S+),/.exec(f.message)?.[1]),
    ['../shared/logo.png', '/Users/x/pic.png', 'file:///etc/hosts'],
    'the relative paths inside the folder, and the protocol-relative URL (a remote fault), are not this fault'
  )
  assert.ok(outside.every((f) => !f.fatal))
})

test('a remote script is a warning on read and fatal on write, naming the line and the fix', () => {
  const html =
    '<!doctype html>\n<html><head>\n' +
    '<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>\n' +
    '</head><body>\n<div data-composition-id="hero" data-duration="5" style="width:10px;height:10px"></div>\n' +
    '</body></html>'

  const { info, faults } = readComposition(html)
  const remote = faults.find((f) => f.code === 'remote-script')

  assert.ok(remote, 'the CDN script should be reported')
  // On read it is not fatal: a project that already holds one must still open.
  assert.equal(remote!.fatal, false)
  assert.equal(info?.compositionId, 'hero')
  assert.equal(fatalFaults(faults).length, 0)
  assert.equal(remote!.line, 3)
  // What the author needs to retry: the line, why it fails, and what to write instead.
  assert.match(remote!.message, /Line 3/)
  assert.match(remote!.message, /never runs/)
  assert.match(remote!.message, /__timelines\["<id>"\] = \{ time\(t\)/)
  assert.match(remote!.message, /relative path/)

  // On write it is fatal, and it is the only thing that changed.
  const onWrite = faultsOnWrite(faults)
  assert.deepEqual(fatalFaults(onWrite).map((f) => f.code), ['remote-script'])
  assert.deepEqual(onWrite.map((f) => f.code), faults.map((f) => f.code))
})

test('a remote font or stylesheet stays a warning on write too, because the page still renders', () => {
  // The positive control for the refusal above: a remote resource that is not a script is not refused.
  const html = ROOT(
    'data-composition-id="hero" data-duration="5" style="width:10px;height:10px"',
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">'
  )
  const faults = readComposition(html).faults
  assert.deepEqual(faults.map((f) => f.code), ['remote-resource'])
  assert.deepEqual(fatalFaults(faultsOnWrite(faults)), [])
})

test('a remote script is recognised whatever the tag carries around its src', () => {
  for (const tag of [
    '<script type="module" src="//cdn.example.com/x.js"></script>',
    "<script defer\n  src='http://cdn.example.com/x.js'></script>",
    '<SCRIPT async SRC="https://cdn.example.com/x.js"></SCRIPT>'
  ]) {
    const html = ROOT('data-composition-id="hero" data-duration="5" style="width:10px;height:10px"', tag)
    assert.deepEqual(readComposition(html).faults.map((f) => f.code), ['remote-script'], tag)
  }
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
  assert.ok(codes.includes('remote-script'))
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

// ---------------------------------------------------------------------------
// Declared sound
// ---------------------------------------------------------------------------

const SOUNDED = (audio: string, script = ''): string =>
  '<!doctype html>\n<html><body>\n' +
  '<div data-composition-id="hero" data-duration="5" style="width:1920px;height:1080px">\n' +
  `${audio}\n</div>\n${script}</body></html>`

test('a declared sound is read with every attribute, and its src resolved beside the file', () => {
  const html = SOUNDED(
    '<audio id="whoosh" src="../sfx/big%20whoosh.wav?v=2" data-start="0.2" data-duration="1.5" ' +
      'data-media-start="0.1" data-volume="0.8"></audio>'
  )
  const { info, faults } = readComposition(html, '/work/titles/hero.html')

  assert.deepEqual(faults, [])
  assert.deepEqual(info?.audio, [
    {
      id: 'whoosh',
      src: '../sfx/big%20whoosh.wav?v=2',
      // `..` climbs out of titles/, %20 is a space and the query names no different file —
      // the three ways a naive join would hand ffmpeg a path that does not exist.
      path: '/work/sfx/big whoosh.wav',
      startSeconds: 0.2,
      durationSeconds: 1.5,
      mediaStartSeconds: 0.1,
      volume: 0.8,
      line: 4
    }
  ])
})

test('without the composition path, sounds are still declared but point at no file', () => {
  const { info } = readComposition(SOUNDED('<audio id="a" src="a.wav" data-start="0"></audio>'))
  assert.equal(info?.audio.length, 1)
  assert.equal(info?.audio[0]?.path, null)
})

test('an <audio> with no id is not mixed and says so, while one with an id is', () => {
  // The HyperFrames mixer selects audio[id][src]; bay must not sound what HyperFrames drops.
  const bare = readComposition(SOUNDED('<audio src="a.wav" data-start="0"></audio>'), '/c/x.html')
  assert.deepEqual(bare.info?.audio, [])
  const fault = bare.faults.find((f) => f.code === 'bad-audio')
  assert.ok(fault, 'an id-less sound must be reported')
  assert.match(fault.message, /no id/)
  assert.match(fault.message, /id="whoosh"/, 'the fault must say what to add')
  assert.equal(fault.line, 4)
  assert.equal(fault.fatal, false)

  const named = readComposition(
    SOUNDED('<audio id="a" src="a.wav" data-start="0"></audio>'),
    '/c/x.html'
  )
  assert.equal(named.info?.audio.length, 1, 'the positive control: the same tag with an id plays')
})

test('a remote sound is one fault, not two, and is not mixed', () => {
  const { info, faults } = readComposition(
    SOUNDED('<audio id="bgm" src="https://cdn.example.com/bgm.mp3" data-start="0"></audio>'),
    '/c/x.html'
  )
  assert.deepEqual(info?.audio, [])
  assert.equal(faults.length, 1, faults.map((f) => f.code).join(', '))
  assert.equal(faults[0]?.code, 'bad-audio')
  assert.match(faults[0]?.message ?? '', /over the network/)
  assert.match(faults[0]?.message ?? '', /relative path/)
  assert.equal(faults[0]?.line, 4)

  // And the generic scan still reports remote things that are not declared sounds.
  const script = readComposition(
    SOUNDED(
      '<audio id="bgm" src="bgm.mp3" data-start="0"></audio>',
      '<script src="https://x.io/g.js"></script>'
    ),
    '/c/x.html'
  )
  assert.deepEqual(script.faults.map((f) => f.code), ['remote-script'])
})

test('a data: sound is refused, and a file: URL is a path', () => {
  const data = readComposition(
    SOUNDED('<audio id="a" src="data:audio/wav;base64,AAAA" data-start="0"></audio>'),
    '/c/x.html'
  )
  assert.deepEqual(data.info?.audio, [])
  assert.match(data.faults[0]?.message ?? '', /data: src/)

  const file = readComposition(
    SOUNDED('<audio id="a" src="file:///Users/me/a%20b.wav" data-start="0"></audio>'),
    '/c/x.html'
  )
  assert.equal(file.info?.audio[0]?.path, '/Users/me/a b.wav')
})

test('a missing data-start plays from 0 and says so; a bad one is not mixed', () => {
  const missing = readComposition(SOUNDED('<audio id="a" src="a.wav"></audio>'), '/c/x.html')
  assert.equal(missing.info?.audio[0]?.startSeconds, 0)
  assert.match(missing.faults[0]?.message ?? '', /no data-start/)

  const bad = readComposition(
    SOUNDED('<audio id="a" src="a.wav" data-start="soon"></audio>'),
    '/c/x.html'
  )
  assert.deepEqual(bad.info?.audio, [])
  assert.match(bad.faults[0]?.message ?? '', /data-start="soon"/)
})

test('a sound that starts after the composition ends is reported and dropped', () => {
  const { info, faults } = readComposition(
    SOUNDED(
      '<audio id="late" src="a.wav" data-start="5"></audio>\n' +
        '<audio id="ok" src="b.wav" data-start="4.9"></audio>'
    ),
    '/c/x.html'
  )
  assert.deepEqual(info?.audio.map((s) => s.id), ['ok'])
  assert.equal(faults.length, 1)
  assert.match(faults[0]?.message ?? '', /never heard/)
  assert.equal(faults[0]?.line, 4)
})

test('volume above the +12 dB ceiling is capped, and a volume tween is called out', () => {
  const { info, faults } = readComposition(
    SOUNDED(
      '<audio id="a" src="a.wav" data-start="0" data-volume="9"></audio>',
      '<script>\ntl.to("#a", { volume: 0, duration: 1 }, 3)\n</script>\n'
    ),
    '/c/x.html'
  )
  assert.equal(info?.audio[0]?.volume, 3.98)
  assert.ok(faults.some((f) => /ceiling/.test(f.message)))
  const tween = faults.find((f) => /tweens volume/.test(f.message))
  assert.ok(tween, 'a volume tween bay ignores must be reported')
  assert.equal(tween.line, 7)
})

test('a volume tween is not reported for a composition that declares no sound', () => {
  // `volume:` in a script means nothing to bay when nothing is mixed; a fault there would be
  // noise about a sound that does not exist.
  const { faults } = readComposition(
    SOUNDED('', '<script>tl.to(".bar", { volume: 1 })</script>'),
    '/c/x.html'
  )
  assert.deepEqual(faults, [])
})
