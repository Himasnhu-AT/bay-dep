/**
 * `write_brf` and `read_brf`, through the store and the code runtime.
 *
 * The runtime's workers run in-process here (`useWorkers`), through the same message handler the
 * real worker wraps — the lockdown itself is `brf-lockdown.test.ts`'s subject, and the worker in
 * the app is `test/app/brf.mjs`'s.
 *
 * What is held still: a module that runs becomes an asset carrying its source, placed in the same
 * call as one undo step; a module that fails to compile, or throws on any frame, changes nothing
 * and says where; replacing the source is one undoable edit every placement sees; and
 * create-and-place is all or nothing.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findTool } from '@shared/mcp'
import { allItems, activeTimeline, type Asset } from '@shared/project'
import { emptyProject, useEditor } from '@/store/editor'
import { validateArgs } from '@shared/validate'
import { brfRuntime, type BrfWorkerReply, type BrfWorkerRequest, type WorkerLike } from '@/engine/brfCode'
import { createHandler } from '@/engine/brfWorkerCore'
import { readBrf, writeBrf } from './brf'
import { ToolError } from './helpers'

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

async function call(tool: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const spec = findTool(tool)
  assert.ok(spec, `${tool} must be in the catalog`)
  const invalid = validateArgs(spec, args)
  if (invalid) throw new ToolError(invalid)
  return tool === 'write_brf' ? writeBrf(args) : readBrf(args)
}

async function refusal(tool: string, args: Record<string, unknown>): Promise<string> {
  try {
    await call(tool, args)
  } catch (error) {
    if (error instanceof ToolError) return error.message
    throw error
  }
  assert.fail(`expected ${tool} to be refused`)
}

function load(): void {
  const s = useEditor.getState()
  s.setProject(emptyProject())
  s.enterProject(useEditor.getState().project)
}

const state = () => useEditor.getState()
const assets = (): Asset[] => state().project.assets
const items = () => allItems(activeTimeline(state().project)!)

const TITLE = `
import { interpolate } from 'bay'
export const vars = { title: 'Hello' }
export default ({ t, vars }) => (
  <scene duration={2}>
    <text x="50%" y="50%" opacity={interpolate(t, [0, 0.5], [0, 1])}>{vars.title}</text>
  </scene>
)`

test('a module that runs becomes an asset carrying its source, placed in the same call as one undo step', async () => {
  load()
  const before = state().past.length
  const result = await call('write_brf', { code: TITLE, name: 'Title', atFrame: 30 })

  assert.equal(assets().length, 1)
  const asset = assets()[0]!
  assert.equal(asset.kind, 'brf')
  assert.equal(asset.brfCode, TITLE)
  assert.equal(asset.durationUs, 2_000_000)
  assert.deepEqual(asset.compositionVariables?.map((v) => [v.id, v.default]), [['title', 'Hello']])
  assert.equal(result.assetId, asset.id)
  assert.equal(result.placed, true)
  assert.equal(items().length, 1)
  assert.equal(items()[0]!.from, 30)
  assert.equal(items()[0]!.durationInFrames, 60, 'two seconds at 30fps')
  assert.equal(state().past.length - before, 1, 'create and place undo together')

  state().undo()
  assert.equal(assets().length, 0)
  assert.equal(items().length, 0)
})

test('a module that does not compile changes nothing and says what is wrong', async () => {
  load()
  const before = state().past.length
  const message = await refusal('write_brf', { code: 'export default () => <scene duration={1}' })
  assert.match(message, /The \.brf does not compile/)
  assert.match(message, /Nothing was changed/)
  assert.equal(assets().length, 0)
  assert.equal(state().past.length, before)
})

test('a module that throws on a later frame is refused before anything is placed, naming the frame and line', async () => {
  load()
  const code = `export default ({ frame }) => {\n  if (frame > 40) return null.oops\n  return <scene duration={2} />\n}`
  const message = await refusal('write_brf', { code, atFrame: 0 })
  assert.match(message, /frame \d+ \(line 2:\d+\)/)
  assert.equal(assets().length, 0)
  assert.equal(items().length, 0)
})

test('replacing the source is one undoable edit, and read_brf returns what was written', async () => {
  load()
  const { assetId } = (await call('write_brf', { code: TITLE, atFrame: 0 })) as { assetId: string }
  const longer = TITLE.replace('duration={2}', 'duration={5}').replace("title: 'Hello'", "title: 'Hello', accent: '#ff0000'")
  const before = state().past.length

  const result = await call('write_brf', { code: longer, assetId })
  assert.equal(result.replaced, true)
  assert.equal(result.placements, 1)
  assert.equal(assets().length, 1, 'replaced, not added')
  assert.equal(assets()[0]!.durationUs, 5_000_000)
  assert.deepEqual(assets()[0]!.compositionVariables?.map((v) => [v.id, v.type]), [['title', 'string'], ['accent', 'color']])
  assert.equal((await call('read_brf', { assetId })).code, longer)
  assert.equal(state().past.length - before, 1)

  state().undo()
  assert.equal(assets()[0]!.brfCode, TITLE)
})

test('create-and-place is all or nothing: a refused placement leaves no asset and no undo step', async () => {
  load()
  const before = state().past.length
  const message = await refusal('write_brf', { code: TITLE, atFrame: 0, trackId: 'no-such-track' })
  assert.match(message, /track/i)
  assert.equal(assets().length, 0, 'the asset the rehearsal added was taken back')
  assert.equal(state().past.length, before)
  await call('write_brf', { code: TITLE, atFrame: 0 })
  assert.equal(assets().length, 1, 'the positive control: the same call with no trackId succeeds')
})

test('only a .brf asset has a source to replace or read, and the refusal says what to do', async () => {
  load()
  state().addAssets([
    { id: 'ast_text000001', kind: 'text', name: 'Caption', path: null, text: 'hi', durationUs: 0, width: null, height: null, fps: null, hasAudio: false, hasVideo: true, posterPath: null, waveformPath: null, createdAt: 0 }
  ])
  assert.match(await refusal('write_brf', { code: TITLE, assetId: 'ast_text000001' }), /text asset, not a \.brf one.*Omit assetId/)
  assert.match(await refusal('read_brf', { assetId: 'ast_text000001' }), /not a \.brf one/)
})
