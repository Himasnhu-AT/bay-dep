/**
 * The gate for "one user action is one undo step", run against every write tool and every
 * store action.
 *
 * The bug this exists for: a tool looped over several items calling a store action per item,
 * each action is its own `edit()`, and each `edit()` pushes history — so one `delete_items`
 * with ripple became 1 + N undo steps, and `undo` put back the last shift and nothing else. The
 * project was left in a state neither the user nor the agent asked for. `transact` is the fix,
 * and nothing forces a new handler to use it.
 *
 * So this is **behavioural and exhaustive** rather than a source lint:
 *
 * - Every catalog tool with `readOnly: false` must have a case here, driven through the real
 *   dispatcher (`executeToolCall`, schema validation and all) against a fixture spanning three
 *   tracks, and must move the undo stack by exactly its declared amount. A new write tool with
 *   no case fails the coverage test by name.
 * - Every function on the store must be classified: an edit (+1, exercised), not an edit (0,
 *   exercised), or one of the few that manage history themselves. A new store action fails the
 *   coverage test until someone decides which it is.
 *
 * Cases deliberately pick the *multi-item* shape of each call — several ids, a cut across three
 * tracks, a ripple that moves the clips after it — because a single-item call cannot tell a
 * missing `transact` from a present one.
 *
 * Mutation-tested: removing `transact` from `deleteItems` (ripple) and from `editItem` (track
 * move plus patch) in `mcp/write.ts` each fail here; see the commit for the runs.
 *
 * Run with `pnpm test`, or on its own:
 *   node --import ./src/test-hooks.mjs --test src/renderer/src/mcp/one-undo-step.test.ts
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Asset, Item, Project, Track } from '@shared/project'
import { CANVAS_PRESETS } from '@shared/project'
import { TOOLS } from '@shared/mcp'
import { findTemplate } from '@shared/templates'
import type { ImportedAsset } from '@shared/ipc'
import { useEditor, emptyProject, newId, type EditorStore } from '@/store/editor'
import { executeToolCall } from './index'
import { brfRuntime, type BrfWorkerReply, type BrfWorkerRequest, type WorkerLike } from '@/engine/brfCode'
import { createHandler } from '@/engine/brfWorkerCore'

// write_brf runs its module in a worker; here the same handler runs in-process.
brfRuntime.useWorkers((): WorkerLike => {
  const handle = createHandler()
  const worker: WorkerLike = {
    onmessage: null,
    onerror: null,
    postMessage(message) {
      queueMicrotask(() => worker.onmessage?.({ data: handle(message as BrfWorkerRequest) } as MessageEvent<BrfWorkerReply>))
    },
    terminate() {}
  }
  return worker
})
import { planScript, renderScript } from '@shared/script'

// ---------------------------------------------------------------------------
// Fixture: V1 holds two abutting clips (a transition's junction), V2 and A1 each hold one clip
// under them, V3 is empty. Every multi-track operation has something on every track.
// ---------------------------------------------------------------------------

const ASSET: Asset = {
  id: 'ast_footage',
  kind: 'video',
  name: 'footage.mp4',
  path: '/footage/footage.mp4',
  durationUs: 20_000_000,
  width: 1920,
  height: 1080,
  fps: 30,
  hasAudio: true,
  hasVideo: true,
  posterPath: null,
  waveformPath: null,
  createdAt: 1
}

const MOTION = `export default () => <scene duration={2}><text x="50%" y="50%" in="up">Hi</text></scene>`

interface Fixture {
  a: string
  b: string
  c: string
  d: string
  v1: string
  v2: string
  v3: string
}

function item(trackId: string, from: number, durationInFrames: number, sourceStartUs = 0): Item {
  return {
    id: newId('itm'),
    assetId: ASSET.id,
    trackId,
    from,
    durationInFrames,
    sourceStartUs,
    layout: { left: 0, top: 0, width: 1920, height: 1080, opacity: 1, rotation: 0 },
    volume: 1,
    fadeInFrames: 0,
    fadeOutFrames: 0,
    speed: 1
  }
}

function track(kind: 'video' | 'audio', name: string, items: Item[] = []): Track {
  const id = newId('trk')
  return {
    id,
    kind,
    name,
    locked: false,
    muted: false,
    hidden: false,
    items: items.map((i) => ({ ...i, trackId: id }))
  }
}

function load(): Fixture {
  const project: Project = emptyProject()
  const timeline = project.timelines[0]!
  // `b` starts five seconds into its source, so the junction with `a` has head room for a
  // transition; `a` ends two seconds in, leaving tail room.
  const v1 = track('video', 'V1', [item('', 0, 60), item('', 60, 60, 5_000_000)])
  const v2 = track('video', 'V2', [item('', 0, 120)])
  const v3 = track('video', 'V3')
  const a1 = track('audio', 'A1', [item('', 0, 120)])
  timeline.tracks = [v1, v2, v3, a1]
  project.assets = [ASSET]
  // `enterProject`, not `setProject`: the fixture is a project open in the editor. Loaded with
  // `setProject` alone the window is still on the projects screen, and every tool is refused.
  useEditor.getState().enterProject(project)
  return {
    a: v1.items[0]!.id,
    b: v1.items[1]!.id,
    c: v2.items[0]!.id,
    d: a1.items[0]!.id,
    v1: v1.id,
    v2: v2.id,
    v3: v3.id
  }
}

const state = (): EditorStore => useEditor.getState()

/**
 * The current script with two clip lines deleted and another track's clip deleted too — an edit
 * that touches three clips on three tracks, which is exactly the shape one undo step must cover.
 */
function scriptWithout(ids: string[]): string {
  const s = useEditor.getState()
  const text = renderScript(s.project, s.project.timelines[0]!.id)
  const lines = text.split('\n')
  // The rendered id is the shortest unique prefix, and ids made in one tick share a long one —
  // so match the whole bracketed prefix against each id, never a fixed-length cut.
  const shown = (line: string): string | null => /^- \[([^\]]+)\]/.exec(line)?.[1] ?? null
  const kept = lines.filter((line) => {
    const prefix = shown(line)
    return !(prefix && ids.some((id) => id.startsWith(prefix)))
  })
  assert.equal(lines.length - kept.length, ids.length, `every id must match one clip line:\n${text}`)
  return kept.join('\n')
}
const past = (): number => state().past.length

// ---------------------------------------------------------------------------
// A bridge stub, for the tools that go through main: enough of `window.bay` to write, inspect
// and import, and nothing else. Each import mints a fresh asset.
// ---------------------------------------------------------------------------

function importedAsset(path: string): ImportedAsset {
  const template = findTemplate('lower-third')
  return {
    reused: false,
    asset: {
      ...ASSET,
      id: newId('ast'),
      kind: path.endsWith('.html') ? 'composition' : 'video',
      name: path.split('/').pop() ?? path,
      path,
      // Declared, so `add_template` with variables exercises `setCompositionVariable` too.
      ...(path.includes('lower-third') && template
        ? { compositionVariables: [...template.variables] }
        : {})
    } as Asset
  }
}

/**
 * Main's audio measurements for the speech tools. Each of those tools reads two curves per call,
 * so alternate calls answer as two different people: at 50 ms (switch_speakers) the first talks
 * for the first second and the second from 1.1 s; at 10 ms (sync_angles) the second hears the
 * first's speech-like bursts one second later.
 */
let levelCalls = 0
function burstLevel(t: number): number {
  const cell = Math.floor(t / 0.25)
  const hash = Math.sin(cell * 12.9898) * 43758.5453
  return hash - Math.floor(hash) > 0.55 ? -20 - ((cell * 7) % 9) : -60
}
function stubLevels(_path: string, span: { startUs: number; durationUs: number }, windowUs: number): { ok: true; value: number[] } {
  const second = levelCalls++ % 2 === 1
  const n = Math.floor(span.durationUs / windowUs)
  const at = (k: number): number => (span.startUs + k * windowUs) / 1_000_000
  if (windowUs === 50_000) {
    return { ok: true, value: Array.from({ length: n }, (_, k) => ((second ? at(k) >= 1.1 : at(k) < 1) ? -20 : -60)) }
  }
  return { ok: true, value: Array.from({ length: n }, (_, k) => burstLevel(second ? at(k) + 1 : at(k))) }
}

;(globalThis as { window?: unknown }).window = {
  bay: {
    media: {
      levels: async (path: string, span: { startUs: number; durationUs: number }, windowUs: number) => stubLevels(path, span, windowUs),
      // Two pauses in any clip: 0.5–1.5 s and 2.5–3.5 s into what it plays.
      silences: async () => ({ ok: true, value: [{ startSec: 0.5, endSec: 1.5 }, { startSec: 2.5, endSec: 3.5 }] }),
      loudness: async () => ({ ok: true, value: { integratedLufs: -22, truePeakDb: -6 } }),
      importPaths: async (paths: string[]) => paths.map(importedAsset),
      // import_url's download is main's; here it has already landed.
      importUrl: async () => ({ ok: true, path: '/downloads/one/talk [abc].mp4', ytDlp: '/opt/homebrew/bin/yt-dlp' }),
      // put_behind_subject's matte is main's; here it is found, with a person in every frame.
      subjectMatte: async (request: { fromUs: number; toUs: number }) => ({
        ok: true,
        matte: { key: 'c'.repeat(32), fromUs: request.fromUs, toUs: request.toUs, engine: 'apple-vision-person-balanced', frames: 60, width: 512, height: 384 },
        report: { cached: true, frames: 60, coverage: 1, meanArea: 0.3, msPerFrame: 0, visionMsMedian: 0, visionMsP90: 0, bytes: 1, megabytesPerMinute: 1, engineBuild: 'stub', seconds: 0 }
      })
    },
    composition: {
      write: async () => ({ ok: true }),
      inspect: async () => ({
        info: { compositionId: 'card', durationSeconds: 2, variables: [] },
        faults: []
      }),
      writeTemplate: async (id: string) => ({ ok: true, path: `/templates/${id}.html` })
    }
  }
}

// ---------------------------------------------------------------------------
// Every write tool
// ---------------------------------------------------------------------------

interface ToolCase {
  /** Undo entries the call must add: 1 for an edit, 0 for a call that is not one. */
  delta: number
  /** Optional setup, run after `load()` and before the stack is measured. */
  before?: (f: Fixture) => void
  args: (f: Fixture) => Record<string, unknown>
}

const TOOL_CASES: Record<string, ToolCase[]> = {
  import_media: [{ delta: 1, args: () => ({ paths: ['/footage/one.mp4', '/footage/two.mp4'] }) }],
  write_composition: [{ delta: 1, args: () => ({ path: '/work/card.html', html: '<div></div>' }) }],
  add_template: [
    {
      delta: 1,
      args: () => ({ templateId: 'lower-third', atFrame: 200, variables: { name: 'Ada Lovelace' } })
    }
  ],
  place_asset: [{ delta: 1, args: () => ({ assetId: ASSET.id, atFrame: 300 }) }],
  write_brf: [
    // Create and place: `addAssets` then `placeAsset`, two store calls, one step.
    { delta: 1, args: () => ({ code: MOTION, atFrame: 300 }) },
    { delta: 1, args: () => ({ code: MOTION }) },
    {
      delta: 1,
      before: () =>
        state().addAssets([
          { ...ASSET, id: 'ast_motion', kind: 'brf', path: null, brfCode: MOTION, durationUs: 2_000_000, compositionVariables: [] }
        ]),
      args: () => ({ code: MOTION.replace('duration={2}', 'duration={3}'), assetId: 'ast_motion' })
    }
  ],
  edit_item: [
    // A track change and a patch: `moveItem` then `patchItem`, two store calls.
    { delta: 1, args: (f) => ({ itemId: f.a, trackId: f.v3, from: 10, volume: 0.5, fadeInFrames: 5 }) }
  ],
  split_at: [
    { delta: 1, args: () => ({ frame: 30 }) },
    { delta: 1, args: (f) => ({ frame: 30, itemIds: [f.a, f.c, f.d] }) }
  ],
  // Three cuts at once — V1, V2 and A1, each split at 30 by the setup — healed in one call.
  join_items: [
    {
      delta: 1,
      before: () => { state().clearSelection(); state().splitAt(30) },
      args: (f) => ({ itemIds: [f.a] })
    },
    {
      delta: 1,
      before: () => { state().clearSelection(); state().splitAt(30) },
      args: () => ({ itemIds: state().project.timelines[0]!.tracks.flatMap((t) => t.items).filter((i) => i.from < 60).map((i) => i.id) })
    }
  ],
  // A bin made by naming it, and an asset filed in it: two store calls, one step.
  organize_assets: [
    { delta: 1, args: () => ({ assetIds: [ASSET.id], bin: 'Footage' }) },
    { delta: 1, args: () => ({ bin: 'Music' }) }
  ],
  // A track that renames two others as it passes them: one step, names included.
  move_track: [{ delta: 1, args: (f) => ({ trackId: f.v1, position: 3 }) }],
  delete_items: [
    { delta: 1, args: (f) => ({ itemIds: [f.a, f.c, f.d] }) },
    // Delete plus one `moveItem` per survivor after it: the shape of the original bug.
    { delta: 1, args: (f) => ({ itemIds: [f.a], ripple: true }) },
    { delta: 1, args: (f) => ({ itemIds: [f.a, f.c], ripple: true }) }
  ],
  remove_range: [{ delta: 1, args: () => ({ fromFrame: 10, toFrame: 20 }) }],
  // Two pauses removed, each a ripple across every track: one step.
  remove_silences: [{ delta: 1, args: (f) => ({ itemId: f.d }) }],
  set_item_enabled: [{ delta: 1, args: (f) => ({ itemIds: [f.a, f.c, f.d], enabled: false }) }],
  // Three titles restyled, one `patchItem` each: one step.
  apply_text_look: [
    {
      delta: 1,
      before: () => {
        state().addAssets([{ ...ASSET, id: 'ast_title', kind: 'text', name: 'Title', path: null, text: 'Title', hasAudio: false, hasVideo: false, durationUs: 0 }])
        for (const at of [300, 400, 500]) assert.ok(state().placeAsset('ast_title', at))
      },
      args: () => ({ look: 'neon', all: true })
    }
  ],
  // Three effects added and one of them changed and moved, in one batch: one step.
  edit_effects: [
    {
      delta: 1,
      args: (f) => ({
        itemId: f.a,
        operations: [
          { op: 'add', kind: 'glow' },
          { op: 'add', kind: 'flip' },
          { op: 'add', kind: 'pixelate', params: { size: 24 }, index: 0 }
        ]
      })
    }
  ],
  // Detaching both angles' sound, then razoring and disabling both: one step.
  switch_speakers: [
    { delta: 1, args: (f) => ({ angles: [{ videoItemId: f.a }, { videoItemId: f.c }], thresholdDb: -40, minShotSec: 0.2 }) }
  ],
  level_voices: [{ delta: 1, args: (f) => ({ itemIds: [f.d, f.c] }) }],
  sync_angles: [
    {
      delta: 1,
      // Long enough (20 s) to sync by sound; V2 and A1 hold nothing else.
      before: (f) => {
        state().patchItem(f.c, { durationInFrames: 600 })
        state().patchItem(f.d, { durationInFrames: 600 })
      },
      args: (f) => ({ itemIds: [f.d, f.c] })
    }
  ],
  put_behind_subject: [
    // The title (c, on V2) over the clip (a, on V1): the matte is recorded silently, the cut-out made
    // on V3 and linked to the clip — several store changes, one step.
    { delta: 1, args: (f) => ({ itemId: f.c, videoItemId: f.a }) }
  ],
  detach_audio: [
    // Two clips at once, with a transition between them: new items on an audio track (a new one,
    // since A1 is occupied), both pictures marked, and the transition copied — one step.
    {
      delta: 1,
      before: (f) => {
        const added = state().addTransition({ fromItemId: f.a, toItemId: f.b, kind: 'cross-dissolve', durationInFrames: 10 })
        assert.ok('id' in added, 'the fixture must accept a transition')
      },
      args: (f) => ({ itemIds: [f.a, f.b] })
    },
    { delta: 1, before: (f) => { state().detachAudio([f.a, f.c]) }, args: (f) => ({ itemIds: [f.a, f.c], action: 'unlink' }) },
    { delta: 1, before: (f) => { state().detachAudio([f.a, f.c]) }, args: (f) => ({ itemIds: [f.a, f.c], action: 'reattach' }) }
  ],
  audio_effects: [
    // A preset is six effects written at once; on a track as on a clip, one step.
    { delta: 1, args: (f) => ({ itemId: f.a, action: 'preset', preset: 'podcast-voice' }) },
    { delta: 1, args: (f) => ({ trackId: f.v2, action: 'add', kind: 'compressor', params: { ratio: 4 } }) }
  ],
  add_track: [{ delta: 1, args: () => ({ kind: 'audio' }) }],
  add_transition: [
    { delta: 1, args: (f) => ({ fromItemId: f.a, toItemId: f.b, kind: 'cross-dissolve' }) }
  ],
  remove_transition: [
    {
      delta: 1,
      before: (f) => {
        const added = state().addTransition({
          fromItemId: f.a,
          toItemId: f.b,
          kind: 'dip-to-black',
          durationInFrames: 10
        })
        assert.ok('id' in added, 'the fixture must accept a transition to remove')
      },
      args: () => ({ transitionId: state().project.timelines[0]!.transitions![0]!.id })
    }
  ],
  trim_item: [
    { delta: 1, args: (f) => ({ itemId: f.a, mode: 'slip', deltaFrames: 10 }) },
    // A roll moves two clips at once — the shape the gate exists for.
    { delta: 1, args: (f) => ({ itemId: f.a, mode: 'roll', deltaFrames: 10 }) }
  ],
  add_captions: [
    {
      delta: 1,
      args: () => ({
        cues: [
          { fromFrame: 0, toFrame: 30, text: 'First line' },
          { fromFrame: 30, toFrame: 60, text: 'Second line' },
          { fromFrame: 60, toFrame: 90, text: 'First line' }
        ]
      })
    }
  ],
  add_marker: [{ delta: 1, args: () => ({ frame: 45, label: 'Beat' }) }],
  import_url: [{ delta: 1, args: () => ({ url: 'https://video.example/watch?v=abc' }) }],
  // Two picks, each a start and an end marker: four markers, one step.
  mark_highlights: [
    {
      delta: 1,
      args: () => ({
        highlights: [
          { title: 'Opening', fromFrame: 0, toFrame: 40 },
          { title: 'Answer', fromFrame: 60, toFrame: 110 }
        ]
      })
    }
  ],
  set_canvas: [{ delta: 1, args: () => ({ preset: 'vertical-1080' }) }],
  remove_marker: [
    {
      delta: 1,
      before: () => {
        assert.ok(state().addMarker(45, 'Beat'), 'the fixture must accept a marker to remove')
      },
      args: () => ({ markerId: state().project.timelines[0]!.markers![0]!.id })
    }
  ],
  add_comment: [{ delta: 1, args: () => ({ text: 'Check this cut', frame: 30, endFrame: 60 }) }],
  // Two comments resolved by one call — the shape a missing `transact` would split.
  resolve_feedback: [
    {
      delta: 1,
      before: () => {
        assert.ok(state().addComment(10, 'one'), 'the fixture must accept a comment')
        assert.ok(state().addComment(20, 'two'), 'the fixture must accept a comment')
      },
      args: () => ({ commentIds: state().project.timelines[0]!.comments!.map((c) => c.id), note: 'Fixed' })
    }
  ],
  edit_asset: [{ delta: 1, args: () => ({ assetId: ASSET.id, name: 'renamed.mp4' }) }],
  apply_script: [{ delta: 1, args: (f) => ({ script: scriptWithout([f.a, f.c, f.d]) }) }],
  // Moving the playhead is not an edit, and must not become one.
  set_playhead: [{ delta: 0, args: () => ({ frame: 45 }) }],
  undo: [
    {
      delta: -1,
      before: (f) => state().patchItem(f.a, { volume: 0.25 }),
      args: () => ({})
    }
  ]
}

/** Write tools with no case, each with the reason it cannot reach the undo stack. */
const TOOL_EXEMPT: Record<string, string> = {
  add_subtitles: 'transcribes and writes a file through the bridge; add-subtitles.test.ts asserts it is one undo step',
  open_project:
    'replaces the document and starts fresh history by design — it is not an edit to undo',
  export_timeline:
    'renders a file from the project and never edits it; its frame exporter needs a DOM canvas',
  render_brf:
    'renders a file from a throwaway timeline and never edits the project; its frame exporter needs a DOM canvas',
  generate_image: 'starts a job in main and never edits the project; generation.test.ts asserts past is untouched',
  generate_video: 'starts a job in main and never edits the project; generation.test.ts asserts past is untouched',
  generate_speech: 'starts a job in main and never edits the project; generation-speech.test.ts asserts past is untouched',
  index_footage: 'starts an indexing job in main and never edits the project; footage.test.ts asserts past is untouched',
  write_style: 'saves a style file through main and never edits the project; styles.test.ts asserts past is untouched',
  track_generation:
    'reads a job from main before it imports; generation.test.ts asserts import and place are one undo step',
  apply_dub: 'starts jobs in main and never edits the project; dub.test.ts asserts past is untouched',
  track_dub: 'reads jobs from main before it imports; dub.test.ts asserts placement and ducking are one undo step',
  score_sfx: 'renders a file through the bridge before it imports; sfx.test.ts asserts create-and-place is one undo step that takes both back'
}

test('every write tool in the catalog has an undo-step case or a stated exemption', () => {
  const writes = TOOLS.filter((t) => !t.readOnly).map((t) => t.name)
  const unclassified = writes.filter((name) => !TOOL_CASES[name] && !TOOL_EXEMPT[name])
  assert.deepEqual(
    unclassified,
    [],
    `No undo-step case for ${unclassified.join(', ')}. Add one to TOOL_CASES using the call's ` +
      `multi-item shape, and wrap the handler's store calls in one store().transact(...).`
  )
  const stale = [...Object.keys(TOOL_CASES), ...Object.keys(TOOL_EXEMPT)].filter(
    (name) => !writes.includes(name)
  )
  assert.deepEqual(stale, [], `cases for tools that are not writes in the catalog: ${stale.join(', ')}`)
})

for (const [tool, cases] of Object.entries(TOOL_CASES)) {
  cases.forEach((spec, index) => {
    test(`${tool} #${index + 1} moves the undo stack by exactly ${spec.delta}`, async () => {
      const fixture = load()
      spec.before?.(fixture)
      const before = past()
      const projectBefore = JSON.stringify(state().project)

      const result = await executeToolCall({ id: `c${index}`, tool, args: spec.args(fixture) })
      assert.ok(result.ok, `${tool} must succeed for its undo step to mean anything: ${
        result.ok ? '' : result.error
      }`)
      // Positive control for the delta: a call that changed nothing would pass a 0 by default.
      if (spec.delta !== 0) {
        assert.notEqual(JSON.stringify(state().project), projectBefore, `${tool} changed nothing`)
      }
      assert.equal(
        past() - before,
        spec.delta,
        `${tool} pushed ${past() - before} undo entries for one call; expected ${spec.delta}. ` +
          `A handler making several store calls must group them in one store().transact(...).`
      )

      // And the one entry reverses all of it, not the last part.
      if (spec.delta === 1) {
        state().undo()
        assert.equal(JSON.stringify(state().project.timelines), JSON.stringify(
          (JSON.parse(projectBefore) as Project).timelines
        ), `one undo after ${tool} must restore every track it touched`)
      }
    })
  })
}

// ---------------------------------------------------------------------------
// Every store action
// ---------------------------------------------------------------------------

type StoreCase = { delta: number; run: (f: Fixture) => void }

const STORE_CASES: Record<string, StoreCase> = {
  // Edits that touch many items or tracks at once.
  splitAt: { delta: 1, run: () => { state().clearSelection(); state().splitAt(30) } },
  deleteSelected: { delta: 1, run: (f) => { state().select([f.a, f.c, f.d]); state().deleteSelected() } },
  duplicateSelected: { delta: 1, run: (f) => { state().select([f.b, f.c, f.d]); state().duplicateSelected() } },
  rippleDelete: { delta: 1, run: () => { state().rippleDelete(10, 20) } },
  removeAsset: { delta: 1, run: () => state().removeAsset(ASSET.id) },
  // Relinking one asset repoints every clip that places it: many items, one step.
  relinkAssets: {
    delta: 1,
    run: () => state().relinkAssets([{ assetId: ASSET.id, replacement: importedAsset('/moved/clip.mp4').asset }])
  },
  addAssets: {
    delta: 1,
    run: () => state().addAssets([importedAsset('/x/1.mp4').asset, importedAsset('/x/2.mp4').asset])
  },
  setFps: { delta: 1, run: () => { state().setFps(25) } },
  setCanvasPreset: {
    delta: 1,
    run: () => {
      const current = state().project.timelines[0]!
      const other = CANVAS_PRESETS.find((p) => p.width !== current.width || p.height !== current.height)
      assert.ok(other, 'needs a preset different from the current canvas')
      state().setCanvasPreset(other.id)
    }
  },
  removeTrack: { delta: 1, run: (f) => state().removeTrack(f.v2) },
  setBackground: {
    delta: 1,
    run: () => {
      // Derived, not a literal: whatever the fixture's background is, set a different one.
      const current = state().project.timelines[0]!.background.toLowerCase()
      state().setBackground(current === '#102030' ? '#304050' : '#102030')
    }
  },
  // Not an edit: it lands when an export finishes, and an undo step there would clear the redo.
  rememberDelivery: {
    delta: 0,
    run: () => {
      // Derived: a target different from whatever the fixture already remembers.
      const timeline = state().project.timelines[0]!
      const lufs = timeline.delivery?.loudness?.integratedLufs === -14 ? -16 : -14
      state().rememberDelivery(state().project.id, timeline.id, { integratedLufs: lufs, truePeakDb: -1 })
      assert.equal(state().project.timelines[0]!.delivery?.loudness?.integratedLufs, lufs, 'it did write')
    }
  },

  // Single-target edits: one entry each, which a stray second `edit()` would break.
  renameProject: { delta: 1, run: () => state().renameProject('Renamed') },
  editAsset: { delta: 1, run: () => state().editAsset(ASSET.id, { name: 'renamed.mp4' }) },
  trimEdit: {
    delta: 1,
    run: (f) => {
      const result = state().trimEdit({ itemId: f.a, mode: 'roll', deltaFrames: 10 })
      assert.ok(!('error' in result) && !('refused' in result), `the fixture must allow a roll: ${JSON.stringify(result)}`)
    }
  },
  addCaptions: {
    delta: 1,
    run: () => {
      const placed = state().addCaptions([
        { fromFrame: 0, toFrame: 30, text: 'One' },
        { fromFrame: 30, toFrame: 60, text: 'Two' }
      ])
      assert.ok(!('error' in placed), JSON.stringify(placed))
    }
  },
  addMarker: { delta: 1, run: () => { state().addMarker(30, 'Here') } },
  applyScript: {
    delta: 1,
    run: (f) => {
      const tl = state().project.timelines[0]!.id
      const planned = planScript(state().project, tl, scriptWithout([f.a, f.c, f.d]))
      assert.ok('diff' in planned, 'error' in planned ? planned.error : '')
      state().applyScript(tl, planned.diff.operations)
    }
  },
  moveMarker: {
    delta: 1,
    run: () => {
      const id = state().addMarker(30)
      assert.ok(id)
      const before = past()
      state().moveMarker(id, 50)
      assert.equal(past() - before, 1)
    }
  },
  patchMarker: {
    delta: 1,
    run: () => {
      const id = state().addMarker(30)
      assert.ok(id)
      const before = past()
      // Label and colour in one call are one step, not two.
      state().patchMarker(id, { label: 'Fix audio', color: '#E5484D' })
      assert.equal(past() - before, 1)
    }
  },
  removeMarker: {
    delta: 1,
    run: () => {
      // Two, so removing one still leaves the project different from the fixture — with one,
      // "remove" restores it exactly and the changed-something control would misfire.
      state().addMarker(10)
      const id = state().addMarker(30)
      assert.ok(id)
      const before = past()
      state().removeMarker(id)
      assert.equal(past() - before, 1)
    }
  },
  addComment: { delta: 1, run: () => { state().addComment(30, 'Louder here', { endFrame: 60 }) } },
  editComment: {
    delta: 1,
    run: () => {
      const id = state().addComment(30, 'Louder')
      assert.ok(id)
      const before = past()
      // Words, place and span in one call are one step.
      state().editComment(id, { text: 'Louder here', frame: 40, endFrame: 70 })
      assert.equal(past() - before, 1)
    }
  },
  resolveComment: {
    delta: 1,
    run: () => {
      const id = state().addComment(30, 'Louder')
      assert.ok(id)
      const before = past()
      state().resolveComment(id, 'Raised 3 dB')
      assert.equal(past() - before, 1)
    }
  },
  removeComment: {
    delta: 1,
    run: () => {
      // Two, for removeMarker's reason.
      state().addComment(10, 'a')
      const id = state().addComment(30, 'b')
      assert.ok(id)
      const before = past()
      state().removeComment(id)
      assert.equal(past() - before, 1)
    }
  },
  placeAsset: { delta: 1, run: () => { state().placeAsset(ASSET.id, 300) } },
  moveItem: { delta: 1, run: (f) => state().moveItem(f.a, 200, f.v3) },
  trimItem: { delta: 1, run: (f) => state().trimItem(f.a, 'start', 10) },
  patchItem: { delta: 1, run: (f) => state().patchItem(f.a, { volume: 0.5, fadeInFrames: 4 }) },
  // A clip, its linked sound and the rippled clips after it: one step.
  setClipSpeed: { delta: 1, run: (f) => { state().setClipSpeed(f.a, 0.5, { ripple: true }) } },
  detachAudio: { delta: 1, run: (f) => { state().detachAudio([f.a, f.b, f.c]) } },
  reattachAudio: {
    delta: 1,
    run: (f) => {
      state().detachAudio([f.a, f.c])
      const before = past()
      state().reattachAudio([f.a, f.c])
      assert.equal(past() - before, 1)
    }
  },
  putBehindSubject: {
    delta: 1,
    run: (f) => {
      const result = state().putBehindSubject({ videoItemId: f.a, overlayItemId: f.c })
      assert.ok(result.ok, JSON.stringify(result))
    }
  },
  unlinkItems: {
    delta: 1,
    run: (f) => {
      state().detachAudio([f.a, f.c])
      const before = past()
      state().unlinkItems([f.a, f.c])
      assert.equal(past() - before, 1)
    }
  },
  patchLayout: { delta: 1, run: (f) => state().patchLayout(f.a, { left: 10, opacity: 0.5 }) },
  setCrop: { delta: 1, run: (f) => state().setCrop(f.a, 'left', 0.1) },
  setKeyframe: { delta: 1, run: (f) => state().setKeyframe(f.a, 'scale', 10, 1.1) },
  setCompositionVariable: {
    delta: 1,
    run: () => {
      const imported = importedAsset('/templates/lower-third.html').asset
      state().addAssets([imported])
      const placed = state().placeAsset(imported.id, 400)
      assert.ok(placed)
      const before = past()
      state().setCompositionVariable(placed, 'name', 'Grace Hopper')
      // Measured here rather than by the caller: the setup is two edits of its own.
      assert.equal(past() - before, 1)
    }
  },
  addTrack: { delta: 1, run: () => { state().addTrack('video') } },
  moveTrack: { delta: 1, run: (f) => { state().moveTrack(f.v1, 3) } },
  createBin: { delta: 1, run: () => { state().createBin('Interviews') } },
  renameBin: {
    delta: 1,
    run: () => {
      const made = state().createBin('Interviews')
      assert.ok('bin' in made)
      const before = past()
      state().renameBin(made.bin.id, 'Talking heads')
      // Measured here rather than by the caller: making the bin is an edit too.
      assert.equal(past() - before, 1)
    }
  },
  moveAssetsToBin: {
    delta: 1,
    run: () => {
      const made = state().createBin('Interviews')
      assert.ok('bin' in made)
      const before = past()
      state().moveAssetsToBin([ASSET.id], made.bin.id)
      assert.equal(past() - before, 1)
    }
  },
  removeBin: {
    delta: 1,
    run: () => {
      const made = state().createBin('Interviews')
      assert.ok('bin' in made)
      state().moveAssetsToBin([ASSET.id], made.bin.id)
      // A second bin that stays: removing the only one puts the project back as it began.
      state().createBin('Music')
      const before = past()
      state().removeBin(made.bin.id)
      assert.equal(past() - before, 1)
    }
  },
  joinItems: {
    delta: 1,
    run: (f) => {
      state().clearSelection()
      state().splitAt(30)
      // A second cut that stays: splitting and joining at 30 alone puts the project back exactly
      // as it was, and the caller's "this changed something" would read that as nothing done.
      state().splitAt(90)
      const before = past()
      // Measured here rather than by the caller: the splits that make the cuts are edits too.
      const result = state().joinItems([f.a, f.c, f.d].flatMap((id) => {
        const track = state().project.timelines[0]!.tracks.find((t) => t.items.some((i) => i.id === id))!
        return [id, track.items.find((i) => i.from === 30)!.id]
      }))
      assert.ok('joined' in result && result.joined.length === 3, JSON.stringify(result))
      assert.equal(past() - before, 1)
    }
  },
  // Over the project it belongs to, restoring recovered work is one step ⌘Z takes back.
  restoreRecovered: { delta: 1, run: () => state().restoreRecovered({ ...state().project, name: 'Recovered' }) },
  patchTrack: { delta: 1, run: (f) => state().patchTrack(f.v2, { muted: true, name: 'Under' }) },
  setAudioEffects: { delta: 1, run: (f) => state().setAudioEffects({ itemId: f.a }, [{ id: 'afx_x', kind: 'highpass', params: { frequency: 80, q: 0.7 } }]) },
  addTransition: {
    delta: 1,
    run: (f) => {
      state().addTransition({ fromItemId: f.a, toItemId: f.b, kind: 'wipe', durationInFrames: 10 })
    }
  },
  removeTransition: {
    delta: 1,
    run: (f) => {
      const added = state().addTransition({ fromItemId: f.a, toItemId: f.b, kind: 'wipe', durationInFrames: 10 })
      assert.ok('id' in added)
      const before = past()
      state().removeTransition(added.id)
      assert.equal(past() - before, 1)
    }
  },
  patchTransition: {
    delta: 1,
    run: (f) => {
      const added = state().addTransition({ fromItemId: f.a, toItemId: f.b, kind: 'wipe', durationInFrames: 10 })
      assert.ok('id' in added)
      const before = past()
      state().patchTransition(added.id, { kind: 'iris', durationInFrames: 12 })
      assert.equal(past() - before, 1)
    }
  },

  // Not edits: view, selection, playback, agent session and notification state.
  patchAsset: { delta: 0, run: () => state().patchAsset(ASSET.id, { posterPath: '/p.jpg' }) },
  select: { delta: 0, run: (f) => state().select([f.a, f.c]) },
  clearSelection: { delta: 0, run: () => state().clearSelection() },
  setPlayhead: { delta: 0, run: () => state().setPlayhead(50) },
  nudgePlayhead: { delta: 0, run: () => state().nudgePlayhead(5) },
  setPlaying: { delta: 0, run: () => state().setPlaying(true) },
  togglePlay: { delta: 0, run: () => state().togglePlay() },
  setScrubbing: { delta: 0, run: () => state().setScrubbing(true) },
  setPixelsPerFrame: { delta: 0, run: () => state().setPixelsPerFrame(8) },
  zoomBy: { delta: 0, run: () => state().zoomBy(2) },
  setPanel: { delta: 0, run: () => state().setPanel('text') },
  setPage: { delta: 0, run: () => state().setPage(state().page === 'color' ? 'edit' : 'color') },
  setLayoutMode: { delta: 0, run: () => state().setLayoutMode(state().layoutMode === 'ai' ? 'resolve' : 'ai') },
  toggleLayoutMode: { delta: 0, run: () => state().toggleLayoutMode() },
  setAiPanel: { delta: 0, run: () => state().setAiPanel('timeline', !state().aiPanels.timeline) },
  toggleAiPanel: { delta: 0, run: () => state().toggleAiPanel('inspector') },
  closeAiPanels: { delta: 0, run: () => state().closeAiPanels() },
  setInspectorTab: { delta: 0, run: () => state().setInspectorTab('audio') },
  setLibraryTab: { delta: 0, run: () => state().setLibraryTab('index') },
  setAgentDocked: { delta: 0, run: () => state().setAgentDocked(!state().agentDocked) },
  notify: { delta: 0, run: () => state().notify('hello') },
  dismissToast: { delta: 0, run: () => state().dismissToast() },
  markSaved: { delta: 0, run: () => state().markSaved() },
  // Save As moves the document to a new file; the history is rewritten to match, not grown.
  markSavedAs: { delta: 0, run: () => state().markSavedAs('/tmp/Saved As.bay', 'Saved As') },
  startAgentSession: { delta: 0, run: () => state().startAgentSession() },
  endAgentSession: { delta: 0, run: () => state().endAgentSession() },
  logUserMessage: { delta: 0, run: () => state().logUserMessage('cut it') },
  applyAgentEvent: { delta: 0, run: () => state().applyAgentEvent({ type: 'started' } as never) },
  clearAgentLog: { delta: 0, run: () => state().clearAgentLog() },
  approveProposal: {
    delta: 0,
    run: () =>
      state().approveProposal(
        { id: 'p', question: 'q', options: [{ id: 'o', label: 'l', summary: 's', operations: [] }] } as never,
        'o'
      )
  },
  declineProposal: { delta: 0, run: () => state().declineProposal() },
  revokeApproval: { delta: 0, run: () => state().revokeApproval() },
  consumeApproval: { delta: 0, run: () => state().consumeApproval(0) },
  // View state: hiding a region is not an edit.
  setRegionHidden: { delta: 0, run: () => state().setRegionHidden('inspector', true) },
  toggleRegion: { delta: 0, run: () => state().toggleRegion('timeline') },
  showHome: { delta: 0, run: () => state().showHome() },
  toggleDebugMode: { delta: 0, run: () => state().toggleDebugMode() },
  setAgentApproval: { delta: 0, run: () => state().setAgentApproval(true) },
  setSettingsOpen: { delta: 0, run: () => state().setSettingsOpen(true) },
  setAutoDownloadModels: { delta: 0, run: () => state().setAutoDownloadModels(false) },
  setWhisperModel: { delta: 0, run: () => state().setWhisperModel('ggml-small.en.bin') },
  setWhisperDownload: { delta: 0, run: () => state().setWhisperDownload(null) },
  recordAgentFileWrite: { delta: 0, run: () => state().recordAgentFileWrite('/tmp/c.html', null, '<html></html>') },
  markCompositionChanged: { delta: 0, run: () => state().markCompositionChanged('/tmp/c.html') },
  resizeCanvas: { delta: 1, run: () => state().resizeCanvas(1080, 1920, 'auto') },
  // Pins steer the agent; they are not edits to the project.
  addAgentPin: { delta: 0, run: () => state().addAgentPin({ kind: 'range', fromFrame: 0, toFrame: 30 }) },
  removeAgentPin: { delta: 0, run: () => state().removeAgentPin('range:0-30') },
  clearAgentPins: { delta: 0, run: () => state().clearAgentPins() },

  // The keyboard editing verbs (slices/editing.ts) and the view state beside them.
  setRangeIn: { delta: 0, run: () => state().setRangeIn(10) },
  setRangeOut: { delta: 0, run: () => state().setRangeOut(20) },
  clearRange: { delta: 0, run: () => state().clearRange() },
  setSnapping: { delta: 0, run: () => state().setSnapping(false) },
  toggleSnapping: { delta: 0, run: () => state().toggleSnapping() },
  toggleLinkedSelection: { delta: 0, run: () => state().toggleLinkedSelection() },
  toggleLoop: { delta: 0, run: () => state().toggleLoop() },
  setClipDialog: { delta: 0, run: () => state().setClipDialog({ kind: 'pasteAttributes' }) },
  copySelection: { delta: 0, run: (f) => { state().select([f.a, f.c]); state().copySelection() } },
  cutSelection: { delta: 1, run: (f) => { state().select([f.a, f.c, f.d]); state().cutSelection() } },
  paste: {
    delta: 1,
    run: (f) => {
      state().select([f.a, f.c, f.d])
      state().copySelection()
      state().setPlayhead(120)
      assert.equal(state().paste().length, 3)
    }
  },
  pasteAttributes: {
    delta: 1,
    run: (f) => {
      state().select([f.a])
      state().copySelection()
      state().clipboard!.items[0]!.layout.left = 77
      state().select([f.b, f.c])
      assert.equal(state().pasteAttributes(['transform']), 2)
    }
  },
  toggleDisabled: { delta: 1, run: (f) => state().toggleDisabled([f.a, f.c, f.d]) },
  nudgeSelection: { delta: 1, run: (f) => { state().select([f.c, f.d]); assert.ok(state().nudgeSelection(10)) } },
  // A multi-clip drag across lanes: two clips on V1 to the empty V3, one step.
  moveItemsToTracks: {
    delta: 1,
    run: (f) => {
      const result = state().moveItemsToTracks([
        { itemId: f.a, from: 0, trackId: f.v3 },
        { itemId: f.b, from: 60, trackId: f.v3 }
      ])
      assert.ok('ok' in result, JSON.stringify(result))
    }
  },
  closeGapAt: {
    delta: 1,
    run: (f) => {
      state().trimItem(f.a, 'end', 40)
      const before = past()
      const result = state().closeGapAt(f.v1, 50)
      assert.ok(!('error' in result), JSON.stringify(result))
      assert.equal(past() - before, 1)
    }
  },
  trimToPlayhead: {
    delta: 1,
    run: (f) => {
      state().setPlayhead(30)
      state().select([f.a, f.c, f.d])
      state().trimToPlayhead('start', true)
    }
  },
  removeInOutRange: {
    delta: 1,
    run: () => {
      state().setRangeIn(10)
      state().setRangeOut(20)
      state().removeInOutRange()
    }
  },
  openSpan: { delta: 1, run: () => { state().openSpan(15, 10, 'insert') } },
  // The still and the insert across every track, one step (`@shared/freeze-frame`).
  setItemsEnabled: { delta: 1, run: (f) => { state().setItemsEnabled([f.a, f.c, f.d], false) } },
  // The effect stack (`slices/effects.ts`). Each needs an effect to act on, so each measures its
  // own step after adding one.
  addEffect: { delta: 1, run: (f) => { state().addEffect(f.a, 'glow') } },
  setEffects: { delta: 1, run: (f) => { state().setEffects(f.a, [{ id: 'fx_set', kind: 'flip', params: { horizontal: true, vertical: false } }]) } },
  patchEffect: {
    delta: 1,
    run: (f) => {
      const id = state().addEffect(f.a, 'glow') ?? ''
      const before = past()
      state().patchEffect(f.a, id, { params: { amount: 1.2 } })
      assert.equal(past() - before, 1)
    }
  },
  moveEffect: {
    delta: 1,
    run: (f) => {
      const id = state().addEffect(f.a, 'glow') ?? ''
      state().addEffect(f.a, 'flip')
      const before = past()
      state().moveEffect(f.a, id, 1)
      assert.equal(past() - before, 1)
    }
  },
  removeEffect: {
    delta: 1,
    run: (f) => {
      // A second effect stays, so the project is not back to what it was before the run.
      state().addEffect(f.a, 'flip')
      const id = state().addEffect(f.a, 'glow') ?? ''
      const before = past()
      state().removeEffect(f.a, id)
      assert.equal(past() - before, 1)
    }
  },
  toggleEffect: {
    delta: 1,
    run: (f) => {
      const id = state().addEffect(f.a, 'glow') ?? ''
      const before = past()
      state().toggleEffect(f.a, id)
      assert.equal(past() - before, 1)
    }
  },
  // Two angles razored and disabled: one step.
  applyAngleSwitch: {
    delta: 1,
    run: (f) => {
      state().applyAngleSwitch([f.a, f.c], [
        { angle: 0, fromFrame: 0, toFrame: 30 },
        { angle: 1, fromFrame: 30, toFrame: 60 }
      ])
    }
  },
  // Two ranges, each rippling every track: one step.
  rippleDeleteRanges: {
    delta: 1,
    run: () => {
      state().rippleDeleteRanges([
        { fromFrame: 10, toFrame: 20 },
        { fromFrame: 40, toFrame: 50 }
      ])
    }
  },
  insertFreezeFrame: {
    delta: 1,
    run: (f) => {
      const still: Asset = { ...ASSET, id: 'ast_freeze', kind: 'image', name: 'freeze.png', path: '/g/freeze.png', durationUs: 0, hasAudio: false }
      const result = state().insertFreezeFrame({ itemId: f.a, frame: 30, frames: 45, still })
      assert.ok(!('error' in result), JSON.stringify(result))
    }
  }
}

/** Store functions that manage history themselves, so "exactly one entry" does not apply. */
const STORE_EXEMPT: Record<string, string> = {
  setProject: 'replaces the document and resets history by design',
  enterProject: 'opens a project: setProject plus the screen, so it resets history by design',
  revertAgentChange: 'restores a saved state as one undo step; agent-changes.test.ts covers it',
  placeSubtitles: 'needs a source clip and a composition asset; add-subtitles.test.ts covers it as one step',
  placeDub: 'needs generated line assets and a source clip; dub.test.ts covers it as one step',
  undo: 'moves an entry from past to future',
  jumpToHistory: 'a run of undos or redos: moves entries between past and future; history.test.ts and structure.test.ts cover it',
  redo: 'moves an entry from future to past',
  transact: 'is the grouping mechanism itself; editor.test.ts covers it',
  beginGesture: 'opens a pointer-gesture group (transact across events); editor.test.ts covers it',
  endGesture: 'closes a pointer-gesture group into one entry; editor.test.ts covers it'
}

test('every store action is classified as an edit, a non-edit, or history management', () => {
  const actions = Object.entries(state())
    .filter(([, value]) => typeof value === 'function')
    .map(([name]) => name)
  assert.ok(actions.includes('deleteSelected'), 'the walk must actually find the store actions')
  const unclassified = actions.filter((name) => !STORE_CASES[name] && !STORE_EXEMPT[name])
  assert.deepEqual(
    unclassified,
    [],
    `Store actions with no undo-step case: ${unclassified.join(', ')}. Add each to STORE_CASES ` +
      `with delta 1 (an edit) or 0 (not an edit).`
  )
  const stale = [...Object.keys(STORE_CASES), ...Object.keys(STORE_EXEMPT)].filter(
    (name) => !actions.includes(name)
  )
  assert.deepEqual(stale, [], `cases for store actions that no longer exist: ${stale.join(', ')}`)
})

for (const [action, spec] of Object.entries(STORE_CASES)) {
  test(`store.${action} moves the undo stack by exactly ${spec.delta}`, () => {
    const fixture = load()
    const before = past()
    const projectBefore = JSON.stringify(state().project)
    spec.run(fixture)
    if (spec.delta !== 0) {
      assert.notEqual(JSON.stringify(state().project), projectBefore, `${action} changed nothing`)
    }
    // Cases that measure their own step (because their setup is edits too) have asserted
    // already; for the rest the whole run is the one action.
    const selfMeasured = [
      'setCompositionVariable',
      'removeTransition',
      'patchTransition',
      'moveMarker',
      'removeMarker',
      'patchMarker',
      'editComment',
      'resolveComment',
      'removeComment',
      'reattachAudio',
      'unlinkItems',
      'closeGapAt',
      'joinItems',
      'renameBin',
      'moveAssetsToBin',
      'removeBin',
      'patchEffect',
      'moveEffect',
      'removeEffect',
      'toggleEffect'
    ]
    if (!selfMeasured.includes(action)) {
      assert.equal(
        past() - before,
        spec.delta,
        `store.${action} pushed ${past() - before} undo entries; expected ${spec.delta}.`
      )
    }
  })
}
