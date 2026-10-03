/**
 * `check_film` through the executor, with main's sampler stood in by the samples it would return.
 *
 * The oracle's judgement is `src/shared/film-oracle.test.ts` and the page scripts are
 * `src/main/html/scripts.test.ts`. What is held still here is the adapter: which composition is
 * asked for and with which clip's variables, that a missing contract comes back as an answer
 * with the shape to add rather than as a pass, that every refusal names what to call instead,
 * and that the project is not touched.
 */

import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import type { FilmSampleRequest, FilmSampleResult } from '@shared/ipc'
import type { FilmSamples, RawTrackSample } from '@shared/film-oracle'
import type { Asset, Item, Project } from '@shared/project'
import { emptyProject, useEditor } from '@/store/editor'
import { executeToolCall } from './index'

const BEATS = [0, 1, 5, 7.5]

/** A 12 s film at 30 fps: a card per beat, and — when `carried` — a hero that crosses each boundary. */
function samples(carried: boolean): FilmSamples {
  const at = (t: number): RawTrackSample => {
    const beat = BEATS.filter((b) => b <= t + 1e-9).length - 1
    const eases = [(u: number) => 1 - (1 - u) ** 3, (u: number) => u, (u: number) => u * u * (3 - 2 * u)]
    const x = BEATS.slice(1).reduce((sum, b, i) => sum + 300 * eases[i]!(Math.min(1, Math.max(0, (t - (b - 0.1)) / 0.4))), 100)
    return { t, boxes: { [`card${beat}`]: [500, 300, 900, 500, 1], ...(carried ? { hero: [x, 60, 200, 200, 1] } : {}) } }
  }
  return {
    width: 1920,
    height: 1080,
    fps: 30,
    durationSeconds: 12,
    trackRate: 30,
    track: Array.from({ length: 361 }, (_, k) => at(k / 30)),
    energy: { step: 1 / 12, values: Array.from({ length: 144 }, (_, i) => (BEATS.slice(1).some((b) => Math.abs((i + 0.5) / 12 - b - 0.1) < 0.3) ? 6 : 0)) },
    purity: [{ t: 4, via: 10, first: at(4), again: at(4), pictureDelta: 0 }]
  }
}

const META = { beats: BEATS, cuts: [], inFrame: {}, blur: false }
const asked: FilmSampleRequest[] = []
let answer: FilmSampleResult = { ok: true, meta: META, samples: samples(true), elapsedMs: 1234 }
;(globalThis as { window?: unknown }).window = {
  bay: {
    composition: {
      film: async (request: FilmSampleRequest) => {
        asked.push(request)
        return answer
      }
    }
  }
}

const asset = (id: string, extra: Partial<Asset>): Asset => ({
  id,
  kind: 'html',
  name: `${id}.html`,
  path: `/films/${id}.html`,
  durationUs: 12_000_000,
  width: 1920,
  height: 1080,
  fps: null,
  hasAudio: false,
  hasVideo: true,
  posterPath: null,
  waveformPath: null,
  createdAt: 0,
  compositionId: id,
  ...extra
})

const CLIP: Item = {
  id: 'clip_launch',
  assetId: 'launch',
  trackId: 'v1',
  from: 0,
  durationInFrames: 288,
  sourceStartUs: 0,
  layout: { left: 0, top: 0, width: 1920, height: 1080, opacity: 1, rotation: 0 },
  volume: 1,
  fadeInFrames: 0,
  fadeOutFrames: 0,
  speed: 1,
  variables: { headline: 'Ship it' }
}

beforeEach(() => {
  asked.length = 0
  answer = { ok: true, meta: META, samples: samples(true), elapsedMs: 1234 }
  const base = emptyProject()
  const project: Project = {
    ...base,
    assets: [
      asset('launch', {
        compositionVariables: [
          { id: 'headline', type: 'string', label: 'Headline', default: 'Hello' },
          { id: 'inset', type: 'number', label: 'Inset', default: 96, unit: 'px' }
        ]
      }),
      asset('take', { kind: 'video', name: 'take.mov', path: '/footage/take.mov' }),
      asset('broken', { error: 'The root element has no data-duration.' })
    ],
    timelines: base.timelines.map((timeline) => ({
      ...timeline,
      fps: 24,
      tracks: [{ id: 'v1', kind: 'video', name: 'V1', locked: false, muted: false, hidden: false, items: [CLIP] }]
    }))
  }
  useEditor.getState().enterProject(project)
})

const run = (args: Record<string, unknown>) => executeToolCall({ id: 't', tool: 'check_film', args })

test('a carried film comes back measured and passing, with the next step and what it cannot see', async () => {
  const result = await run({ assetId: 'launch' })
  assert.ok(result.ok, result.ok ? '' : result.error)
  const value = result.value as Record<string, unknown> & { legs: { continuity: { score: number } }; blind: string[] }
  assert.equal(value['measured'], true)
  assert.equal(value['verdict'], 'pass')
  assert.equal(value.legs.continuity.score, 1)
  assert.equal(value['elapsedSeconds'], 1.2)
  assert.match(value['next'] as string, /read `blind`, then check the picture with frame_grid/)
  assert.ok(value.blind.length > 0)
})

test('a slideshow comes back failing, and told not to place it', async () => {
  answer = { ok: true, meta: META, samples: samples(false), elapsedMs: 900 }
  const result = await run({ assetId: 'launch' })
  assert.ok(result.ok, result.ok ? '' : result.error)
  const value = result.value as { verdict: string; summary: string; next: string; findings: { leg: string; sentence: string }[] }
  assert.equal(value.verdict, 'fail')
  assert.match(value.summary, /^FAIL: continuity\. Carry score 0\.00 over 3 boundaries/)
  assert.equal(value.findings[0]!.leg, 'continuity')
  assert.match(value.next, /Fix the findings in the composition \(write_composition\) and call check_film again/)
})

test('main is asked for the composition at the timeline’s rate, with pictures unless told not to', async () => {
  await run({ assetId: 'launch' })
  await run({ assetId: 'launch', pictures: false })
  assert.equal(asked.length, 2)
  assert.equal(asked[0]!.path, '/films/launch.html')
  assert.equal(asked[0]!.assetId, 'launch')
  assert.equal(asked[0]!.fps, 24)
  assert.equal(asked[0]!.pictures, true)
  assert.equal(asked[1]!.pictures, false)
  // By asset, the composition renders with its declared defaults.
  assert.deepEqual(asked[0]!.variables, { headline: 'Hello', inset: 96 })
  assert.deepEqual(asked[0]!.cssVariables, { headline: 'Hello', inset: '96px' })
})

test('by itemId the clip’s own variables are the ones the film is measured with', async () => {
  const result = await run({ itemId: 'clip_launch' })
  assert.ok(result.ok, result.ok ? '' : result.error)
  assert.equal(asked[0]!.path, '/films/launch.html')
  assert.deepEqual(asked[0]!.variables, { headline: 'Ship it', inset: 96 })
})

test('a composition with no __film is an answer, not a pass: unmeasured, with every problem and the shape to add', async () => {
  answer = { ok: false, reason: 'contract', problems: ['This composition declares nothing to measure: there is no window.__film.'] }
  const result = await run({ assetId: 'launch' })
  assert.ok(result.ok, result.ok ? '' : result.error)
  const value = result.value as { measured: boolean; verdict?: string; problems: string[]; contract: string; next: string }
  assert.equal(value.measured, false)
  assert.equal(value.verdict, undefined, 'no verdict may be read off an unmeasured film')
  assert.deepEqual(value.problems, ['This composition declares nothing to measure: there is no window.__film.'])
  assert.match(value.contract, /window\.__film = \{[\s\S]*beats: \[0, 1\.6, 3\.0\][\s\S]*track\(t\)/)
  assert.match(value.next, /Nothing was measured\. Add or fix window\.__film .*write_composition.*top-left corner/s)
})

test('a composition that could not be sampled is a failure carrying main’s reason', async () => {
  answer = { ok: false, reason: 'failed', problems: ['Sampling track(t) did not answer within 20 s — a loop that does not end in time(t) or track(t)?'] }
  const result = await run({ assetId: 'launch' })
  assert.equal(result.ok, false)
  assert.match(result.ok ? '' : result.error, /check_film could not sample "launch\.html": Sampling track\(t\) did not answer within 20 s/)
})

test('each refusal says what to pass instead, and never reaches main', async () => {
  const neither = await run({})
  assert.equal(neither.ok, false)
  assert.match(neither.ok ? '' : neither.error, /needs assetId .* or itemId .*browse_assets lists compositions as kind "html"/)

  const video = await run({ assetId: 'take' })
  assert.equal(video.ok, false)
  // The candidates: every composition in the project, by name and id.
  assert.match(video.ok ? '' : video.error, /"take\.mov" is a video asset, not an HTML composition/)
  assert.match(video.ok ? '' : video.error, /Compositions in this project: launch\.html \(launch\), broken\.html \(broken\)/)

  const broken = await run({ assetId: 'broken' })
  assert.equal(broken.ok, false)
  assert.match(broken.ok ? '' : broken.error, /"broken\.html" cannot be rendered: The root element has no data-duration\. Fix it with write_composition first/)

  assert.equal(asked.length, 0)
  // The twin: the composition beside them is measured.
  assert.equal((await run({ assetId: 'launch' })).ok, true)
  assert.equal(asked.length, 1)
})

test('checking a film changes nothing: no undo step, the same project object', async () => {
  const before = useEditor.getState()
  await run({ itemId: 'clip_launch' })
  const after = useEditor.getState()
  assert.equal(after.project, before.project)
  assert.equal(after.past.length, before.past.length)
})

test('with "Ask before editing" on and nothing approved, check_film still runs — and a write beside it does not', async () => {
  useEditor.setState({ agentGate: { approved: null } })
  try {
    const checked = await run({ assetId: 'launch' })
    assert.ok(checked.ok, checked.ok ? '' : checked.error)
    // The gate is really on: an edit through the same executor is refused, naming check_film as a read.
    const edit = await executeToolCall({ id: 'w', tool: 'add_track', args: { kind: 'video' } })
    assert.equal(edit.ok, false)
    assert.match(edit.ok ? '' : edit.error, /nothing has been approved/)
    assert.match(edit.ok ? '' : edit.error, /check_film/)
  } finally {
    useEditor.setState({ agentGate: null })
  }
})
