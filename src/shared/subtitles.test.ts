/**
 * Word-by-word subtitles. Run with `pnpm test`.
 *
 * The documents are checked by bay's own composition reader (the same one import uses), and
 * their script is run against a small DOM stand-in to see which word is lit at a given moment —
 * a document that merely looks right in the source proves nothing about the picture.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runInNewContext } from 'node:vm'
import { fatalFaults, readComposition } from './composition'
import { SUBTITLE_STYLES, groupWords, subtitleComposition, type SubtitleWord } from './subtitles'

const words = (spec: string): SubtitleWord[] => {
  // "word@start-end word@start-end"
  return spec.split(' ').map((token) => {
    const [text, times] = token.split('@') as [string, string]
    const [start, end] = times.split('-').map(Number) as [number, number]
    return { text, start, end }
  })
}

const SPEECH = words(
  'You@0.1-0.3 are@0.3-0.45 an@0.45-0.6 overthinker,@0.6-1.2 or@1.3-1.4 maybe@1.4-1.7 not@1.7-1.9 thinking@1.9-2.3 enough.@2.3-2.8 ' +
    'Since@3.6-3.9 when@3.9-4.1 was@4.1-4.3 it@4.3-4.4 bad?@4.4-4.9'
)

test('groups respect the word and character limits, sentence ends and pauses, and never overlap', () => {
  const groups = groupWords(SPEECH, { maxWords: 3, maxChars: 22 })
  for (const group of groups) {
    assert.ok(group.words.length <= 3, group.words.map((w) => w.text).join(' '))
    assert.ok(group.words.map((w) => w.text).join(' ').length <= 22)
  }
  const texts = groups.map((g) => g.words.map((w) => w.text).join(' '))
  assert.ok(texts.some((t) => t.endsWith('enough.')), 'a sentence end closes its group')
  assert.ok(texts.some((t) => t.startsWith('Since')), 'the next sentence starts a group — after a 0.8 s pause too')
  for (let i = 1; i < groups.length; i++) assert.ok(groups[i]!.start >= groups[i - 1]!.end, `group ${i} overlaps the one before`)
  assert.deepEqual(groups.flatMap((g) => g.words.map((w) => w.text)), SPEECH.map((w) => w.text), 'every word, once, in order')
})

test('a group holds until the next when the gap is short, and lingers briefly at a real pause', () => {
  const groups = groupWords(SPEECH, { maxWords: 3, maxChars: 22 })
  const second = groups[1]!
  assert.equal(groups[0]!.end, second.start, 'no empty flash between quick phrases')
  const beforePause = groups.find((g) => g.words.at(-1)?.text === 'enough.')!
  assert.ok(beforePause.end > 2.8 && beforePause.end < 3.6, 'lingers past its last word, gone before the next sentence')
})

test('every design produces a composition bay itself accepts, with the right id and length', () => {
  for (const style of SUBTITLE_STYLES) {
    const html = subtitleComposition(style.id, SPEECH, { width: 1080, height: 1920, durationSeconds: 5 })
    const { info, faults } = readComposition(html)
    assert.equal(info?.compositionId, `subtitles-${style.id}`)
    assert.equal(info?.durationSeconds, 5)
    assert.deepEqual(fatalFaults(faults), [], style.id)
    assert.deepEqual(faults.filter((f) => f.code === 'remote-resource' || f.code === 'outside-folder'), [], `${style.id} loads nothing`)
  }
})

test('text that could break out of the script is carried safely', () => {
  const html = subtitleComposition('spotlight', words('</script><img@0-1'), { width: 100, height: 100, durationSeconds: 1 })
  assert.equal(html.split('</script>').length, 2, 'exactly one closing tag: the real one')
})

test('an unknown style or an unreal canvas is refused, naming the styles', () => {
  assert.throws(() => subtitleComposition('comic-sans', SPEECH, { width: 1080, height: 1920, durationSeconds: 5 }), /Styles: spotlight, punch/)
  assert.throws(() => subtitleComposition('spotlight', SPEECH, { width: 0, height: 1920, durationSeconds: 5 }), /whole-pixel canvas/)
})

/** Runs the document's script against a stand-in DOM and returns a function that seeks it. */
function seekable(html: string): (t: number) => { opacity: number; words: { text: string; state: string }[] } {
  const script = /<script>([\s\S]*)<\/script>/.exec(html)![1]!
  const el = (): Record<string, unknown> => {
    const node: { children: unknown[]; style: Record<string, unknown>; className: string; parentNode?: unknown; offsetWidth: number; offsetHeight: number; appendChild: (c: unknown) => void } & Record<string, unknown> = {
      children: [],
      style: {},
      className: '',
      offsetWidth: 1080,
      offsetHeight: 1920,
      appendChild(child: unknown) {
        this.children.push(child)
      }
    }
    Object.defineProperty(node, 'textContent', {
      set(value: string) {
        if (value === '') node.children = []
        node['_text'] = value
      },
      get() {
        return node['_text']
      }
    })
    return node
  }
  const root = el()
  const band = el()
  const line = el()
  band.parentNode = root
  const window: { __timelines: Record<string, { time: (t: number) => number }> } = { __timelines: {} }
  const document = {
    getElementById: (id: string) => (id === 'band' ? band : id === 'line' ? line : null),
    createElement: () => el()
  }
  runInNewContext(script, { window, document, Math })
  const timeline = Object.values(window.__timelines)[0]!
  return (t) => {
    timeline.time(t)
    const spans = line.children as { _text: string; className: string }[]
    return {
      opacity: Number((band.style as { opacity: unknown }).opacity),
      words: spans.map((s) => ({ text: s._text, state: s.className.replace('w ', '') }))
    }
  }
}

test('seeked, the spoken word is lit, the ones before are said, the ones after are to come', () => {
  const seek = seekable(subtitleComposition('spotlight', SPEECH, { width: 1080, height: 1920, durationSeconds: 5 }))
  const during = seek(0.5) // "an" is being spoken
  assert.deepEqual(during.words, [
    { text: 'You', state: 'said' },
    { text: 'are', state: 'said' },
    { text: 'an', state: 'now' }
  ])
  assert.ok(during.opacity > 0.99, 'fully in by then')
  const silence = seek(3.4) // between the two sentences
  assert.equal(silence.opacity, 0, 'nothing on screen in the pause')
  // Positive control that the seek really moves: a moment later a different group is shown.
  assert.equal(seek(4.0).words[0]?.text, 'Since')
})

test('a pause mid-sentence starts a new group even with room left', () => {
  const groups = groupWords(words('so@0-0.2 the@0.2-0.4 answer@1.4-1.8 is@1.8-2.0'), { maxWords: 4, maxChars: 40 })
  assert.deepEqual(groups.map((g) => g.words.map((w) => w.text).join(' ')), ['so the', 'answer is'])
  // Control: the same words spoken without the pause stay together.
  const flowing = groupWords(words('so@0-0.2 the@0.2-0.4 answer@0.4-0.8 is@0.8-1.0'), { maxWords: 4, maxChars: 40 })
  assert.equal(flowing.length, 1)
})
