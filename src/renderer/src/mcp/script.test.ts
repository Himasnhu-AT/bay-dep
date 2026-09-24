/**
 * `read_script` / `apply_script` against the real store.
 *
 * The pure module is tested in `@shared/script.test.ts`. What only the store can show is the
 * promise the tool makes about history: however many clips a script moves, it is **one** undo
 * step, and that step takes the whole script back. The observable is the undo stack, because
 * the project alone cannot tell one entry from five.
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyScript, readScript } from './script'
import { ToolError } from './helpers'
import { useEditor } from '@/store/editor'
import type { Asset, Item, Project } from '@shared/project'

function fixture(): Project {
  const item = (id: string, trackId: string, assetId: string, from: number, duration: number): Item => ({
    id,
    assetId,
    trackId,
    from,
    durationInFrames: duration,
    sourceStartUs: 0,
    layout: { left: 0, top: 0, width: 1920, height: 1080, opacity: 1, rotation: 0 },
    volume: 1,
    fadeInFrames: 0,
    fadeOutFrames: 0,
    speed: 1
  })
  const asset = (id: string, kind: Asset['kind'], text?: string): Asset => ({
    id,
    kind,
    name: text ?? `${id}.mp4`,
    path: kind === 'text' ? null : `/m/${id}.mp4`,
    durationUs: kind === 'text' ? 0 : 60_000_000,
    width: 1920,
    height: 1080,
    fps: 30,
    hasAudio: kind !== 'text',
    hasVideo: kind !== 'text',
    posterPath: null,
    waveformPath: null,
    ...(text ? { text } : {}),
    createdAt: 0
  })
  return {
    id: 'prj',
    name: 'Script store test',
    version: 1,
    assets: [asset('ast_a', 'video'), asset('ast_b', 'video'), asset('ast_t', 'text', 'Hello')],
    timelines: [
      {
        id: 'tl',
        name: 'Main',
        fps: 30,
        width: 1920,
        height: 1080,
        background: '#000000',
        tracks: [
          {
            id: 'trk_v1',
            kind: 'video',
            name: 'V1',
            locked: false,
            muted: false,
            hidden: false,
            items: [
              item('itm_one', 'trk_v1', 'ast_a', 0, 30),
              item('itm_two', 'trk_v1', 'ast_b', 30, 30),
              item('itm_three', 'trk_v1', 'ast_a', 60, 30)
            ]
          },
          {
            id: 'trk_v2',
            kind: 'video',
            name: 'V2',
            locked: false,
            muted: false,
            hidden: false,
            items: [item('itm_title', 'trk_v2', 'ast_t', 0, 45)]
          }
        ],
        transitions: [
          { id: 'trn_x', kind: 'cross-dissolve', fromItemId: 'itm_one', toItemId: 'itm_two', durationInFrames: 10 }
        ]
      }
    ],
    activeTimelineId: 'tl',
    createdAt: 0,
    updatedAt: 0,
    filePath: null
  }
}

const state = (): ReturnType<typeof useEditor.getState> => useEditor.getState()

/** Swap two whole lines, asserting both exist so a format change cannot hollow the test. */
function swap(text: string, a: string, b: string): string {
  const lines = text.split('\n')
  const i = lines.findIndex((l) => l.includes(a))
  const j = lines.findIndex((l) => l.includes(b))
  assert.ok(i >= 0 && j >= 0, `missing ${a} or ${b} in:\n${text}`)
  ;[lines[i], lines[j]] = [lines[j]!, lines[i]!]
  return lines.join('\n')
}

test('a script that changes several clips is one undo step, and undo takes all of it back', () => {
  state().setProject(fixture())
  const before = structuredClone(state().project)
  const pastBefore = state().past.length

  let script = readScript()
  script = swap(script, '[itm_one]', '[itm_thre') // reorder V1: breaks the dissolve too
  script = script.replace('"Hello"', '"Hello, world"')
  assert.notEqual(script, readScript(), 'the edits did not land in the text')

  const result = applyScript({ script })
  assert.match(result, /^Applied \d+ changes as one undo step:/)
  assert.match(result, /Removed cross-dissolve/)
  assert.match(result, /The timeline now reads:\n\n# Script/)

  const tl = state().project.timelines[0]!
  const v1 = tl.tracks[0]!.items.map((i) => [i.id, i.from])
  assert.deepEqual(v1, [['itm_three', 0], ['itm_two', 30], ['itm_one', 60]])
  assert.equal(state().project.assets.find((a) => a.id === 'ast_t')!.text, 'Hello, world')
  assert.deepEqual(tl.transitions, [])

  assert.equal(state().past.length, pastBefore + 1, 'more than one history entry for one script')
  state().undo()
  assert.deepEqual(state().project.timelines, before.timelines)
  assert.deepEqual(state().project.assets, before.assets)
})

test('a refused script changes nothing and pushes no history', () => {
  state().setProject(fixture())
  const before = structuredClone(state().project)
  const pastBefore = state().past.length
  const script = readScript().replace('## V2 · video · [trk_v2]', '## Titles · video · [trk_v2]')
  assert.throws(() => applyScript({ script }), (error: unknown) => {
    assert.ok(error instanceof ToolError)
    assert.match(error.message, /header for V2 was edited/)
    return true
  })
  assert.equal(state().past.length, pastBefore)
  assert.deepEqual(state().project, before)
})

test('an unchanged script says so and records no undo step', () => {
  state().setProject(fixture())
  const pastBefore = state().past.length
  const result = applyScript({ script: readScript() })
  assert.match(result, /^Nothing changed/)
  assert.equal(state().past.length, pastBefore)
})

test('a deleted clip leaves the selection', () => {
  state().setProject(fixture())
  state().select(['itm_two', 'itm_one'])
  const lines = readScript().split('\n')
  const script = lines.filter((l) => !l.includes('[itm_two]')).join('\n')
  assert.notEqual(script, lines.join('\n'))
  applyScript({ script })
  assert.deepEqual(state().selection, ['itm_one'])
})
