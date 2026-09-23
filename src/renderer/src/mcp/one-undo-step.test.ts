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

;(globalThis as { window?: unknown }).window = {
  bay: {
    media: {
      importPaths: async (paths: string[]) => paths.map(importedAsset)
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
  edit_item: [
    // A track change and a patch: `moveItem` then `patchItem`, two store calls.
    { delta: 1, args: (f) => ({ itemId: f.a, trackId: f.v3, from: 10, volume: 0.5, fadeInFrames: 5 }) }
  ],
  split_at: [
    { delta: 1, args: () => ({ frame: 30 }) },
    { delta: 1, args: (f) => ({ frame: 30, itemIds: [f.a, f.c, f.d] }) }
  ],
  delete_items: [
    { delta: 1, args: (f) => ({ itemIds: [f.a, f.c, f.d] }) },
    // Delete plus one `moveItem` per survivor after it: the shape of the original bug.
    { delta: 1, args: (f) => ({ itemIds: [f.a], ripple: true }) },
    { delta: 1, args: (f) => ({ itemIds: [f.a, f.c], ripple: true }) }
  ],
  remove_range: [{ delta: 1, args: () => ({ fromFrame: 10, toFrame: 20 }) }],
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
  remove_marker: [
    {
      delta: 1,
      before: () => {
        assert.ok(state().addMarker(45, 'Beat'), 'the fixture must accept a marker to remove')
      },
      args: () => ({ markerId: state().project.timelines[0]!.markers![0]!.id })
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
  open_project:
    'replaces the document and starts fresh history by design — it is not an edit to undo',
  export_timeline:
    'renders a file from the project and never edits it; its frame exporter needs a DOM canvas'
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
  placeAsset: { delta: 1, run: () => { state().placeAsset(ASSET.id, 300) } },
  moveItem: { delta: 1, run: (f) => state().moveItem(f.a, 200, f.v3) },
  trimItem: { delta: 1, run: (f) => state().trimItem(f.a, 'start', 10) },
  patchItem: { delta: 1, run: (f) => state().patchItem(f.a, { volume: 0.5, fadeInFrames: 4 }) },
  patchLayout: { delta: 1, run: (f) => state().patchLayout(f.a, { left: 10, opacity: 0.5 }) },
  setCrop: { delta: 1, run: (f) => state().setCrop(f.a, 'left', 0.1) },
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
  patchTrack: { delta: 1, run: (f) => state().patchTrack(f.v2, { muted: true, name: 'Under' }) },
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
  notify: { delta: 0, run: () => state().notify('hello') },
  dismissToast: { delta: 0, run: () => state().dismissToast() },
  markSaved: { delta: 0, run: () => state().markSaved() },
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
  // Pins steer the agent; they are not edits to the project.
  addAgentPin: { delta: 0, run: () => state().addAgentPin({ kind: 'range', fromFrame: 0, toFrame: 30 }) },
  removeAgentPin: { delta: 0, run: () => state().removeAgentPin('range:0-30') },
  clearAgentPins: { delta: 0, run: () => state().clearAgentPins() }
}

/** Store functions that manage history themselves, so "exactly one entry" does not apply. */
const STORE_EXEMPT: Record<string, string> = {
  setProject: 'replaces the document and resets history by design',
  enterProject: 'opens a project: setProject plus the screen, so it resets history by design',
  revertAgentChange: 'restores a saved state as one undo step; agent-changes.test.ts covers it',
  undo: 'moves an entry from past to future',
  redo: 'moves an entry from future to past',
  transact: 'is the grouping mechanism itself; editor.test.ts covers it'
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
      'removeMarker'
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
