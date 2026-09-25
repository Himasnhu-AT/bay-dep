/**
 * Agent turns as commits: a diff when a turn changes the project, and an exact revert.
 * Run with `pnpm test`.
 *
 * Every scenario the audit found is here as its own case, because each one was invisible to the
 * tests that existed: the old fixture cleared the log by hand after switching projects — the one
 * thing the store failed to do — so it could not see a revert put one project into another's
 * window.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Asset, Project } from '@shared/project'
import { asAgent, asClient, emptyProject, MAX_AGENT_CHECKPOINTS, revertImpact, setAgentFileWriter, useEditor } from './editor'

const state = () => useEditor.getState()

function fresh(name = 'Cut'): void {
  // Deliberately not clearing the log: a new project must do that work itself (see below).
  state().enterProject({ ...emptyProject(), name })
  state().clearAgentLog()
}

/** One agent turn whose edits come from tool calls, as they do in the app. */
async function turn(runId: string, work: () => void): Promise<void> {
  state().applyAgentEvent({ type: 'started', runId })
  await asAgent(work)
  state().applyAgentEvent({ type: 'done', runId, reason: 'complete' })
}

type Changes = Extract<ReturnType<typeof state>['agentLog'][number], { kind: 'changes' }>
const changes = (): Changes[] => state().agentLog.filter((e): e is Changes => e.kind === 'changes')
const stateOf = (id: string): string | undefined => changes().find((e) => e.id === id)?.state

/** Everything but the save stamp: a revert is an edit, and edits are stamped. */
const content = (project: Project): Omit<Project, 'updatedAt'> => {
  const { updatedAt: _, ...rest } = project
  return rest
}

const videoTrackName = (): string => {
  const tracks = state().project.timelines[0]!.tracks.filter((t) => t.kind === 'video')
  return `V${tracks.length}`
}

test('a turn that edits leaves one diff entry; a turn that only reads leaves none', async () => {
  fresh()
  await turn('r1', () => {}) // reads nothing, changes nothing
  assert.equal(changes().length, 0)
  let added = ''
  await turn('r2', () => {
    state().addTrack('video')
    added = videoTrackName()
  })
  const [entry] = changes()
  assert.equal(entry?.state, 'applied')
  assert.ok(entry?.lines.some((l) => l.text === `Added track ${added}`), `lines: ${JSON.stringify(entry?.lines)}`)
})

test('a poster arriving during a read-only turn is not a change', async () => {
  fresh()
  const asset: Asset = {
    id: 'a1', kind: 'video', name: 'clip.mp4', path: '/m/clip.mp4', durationUs: 1e6, width: 1920,
    height: 1080, fps: 30, hasAudio: true, hasVideo: true, posterPath: null, waveformPath: null, createdAt: 0
  }
  state().addAssets([asset])
  state().applyAgentEvent({ type: 'started', runId: 'r' })
  state().patchAsset('a1', { posterPath: '/cache/p.jpg' }) // silent, like the real arrival
  assert.notEqual(state().agentTurnBase, state().project, 'specimen: the project object did change')
  state().applyAgentEvent({ type: 'done', runId: 'r', reason: 'complete' })
  assert.equal(changes().length, 0)
})

test('revert restores the state before the turn, and ⌘Z brings the change back', async () => {
  fresh()
  const before = state().project
  await turn('r1', () => {
    state().addTrack('video')
    state().renameProject('Renamed by the agent')
  })
  const after = state().project
  const [entry] = changes()
  state().revertAgentChange(entry!.id)
  assert.deepEqual(content(state().project), content(before))
  assert.equal(stateOf(entry!.id), 'reverted')
  state().undo()
  assert.equal(state().project, after, 'undoing the revert restores the agent’s change')
  assert.equal(stateOf(entry!.id), 'applied', 'and the card says so, with its Revert back')
  state().redo()
  assert.deepEqual(content(state().project), content(before))
  assert.equal(stateOf(entry!.id), 'reverted', 'redo reverts it again')
})

test('reverting an earlier turn marks the later ones reverted too; a later one alone leaves earlier ones', async () => {
  fresh()
  await turn('r1', () => state().addTrack('video'))
  await turn('r2', () => state().addTrack('audio'))
  const [first, second] = changes()
  assert.equal(revertImpact(state(), first!.id).laterTurns, 1)
  state().revertAgentChange(first!.id)
  assert.deepEqual([stateOf(first!.id), stateOf(second!.id)], ['reverted', 'reverted'])

  fresh()
  await turn('r1', () => state().addTrack('video'))
  await turn('r2', () => state().addTrack('audio'))
  const [a, b] = changes()
  state().revertAgentChange(b!.id)
  assert.deepEqual([stateOf(a!.id), stateOf(b!.id)], ['applied', 'reverted'])
})

test('opening another project expires every card: a revert can never put one project into another', async () => {
  fresh('A')
  await turn('r1', () => state().addTrack('video'))
  const [card] = changes()
  const b: Project = { ...emptyProject(), name: 'B' }
  assert.notEqual(b.id, state().project.id, 'specimen: a different project')
  state().setProject(b) // what File → Open does, with no clearAgentLog behind it
  assert.equal(stateOf(card!.id), 'expired')
  state().revertAgentChange(card!.id)
  assert.equal(state().project.id, b.id, 'still B')
  assert.equal(state().project.name, 'B')
  assert.equal(state().dirty, false, 'nothing was changed, so nothing to save over B')

  // Positive control: reloading the same project (same id) keeps the card revertable.
  fresh('A')
  await turn('r1', () => state().addTrack('video'))
  const [kept] = changes()
  state().setProject(structuredClone(state().project), { resetHistory: false })
  assert.equal(stateOf(kept!.id), 'applied')
})

test('the agent opening a project mid-turn: the diff and the revert are about the new project only', async () => {
  fresh('A')
  const b: Project = { ...emptyProject(), name: 'B' }
  state().applyAgentEvent({ type: 'started', runId: 'r' })
  await asAgent(() => {
    state().addTrack('video') // in A, before switching
    state().setProject(b) // open_project
    state().addTrack('audio')
  })
  state().applyAgentEvent({ type: 'done', runId: 'r', reason: 'complete' })
  const card = changes().at(-1)!
  const text = card.lines.map((l) => l.text).join('\n')
  assert.doesNotMatch(text, /Renamed the project/, 'not a diff of A against B')
  assert.match(text, /Added track A2/)
  state().revertAgentChange(card.id)
  assert.equal(state().project.id, b.id)
  assert.deepEqual(content(state().project), content(b))
})

test('a turn that only rewrote a composition gets a card, and its revert writes the old file back', async () => {
  fresh()
  const writes: [string, string][] = []
  setAgentFileWriter(async (path, contents) => {
    writes.push([path, contents])
    return { ok: true }
  })
  try {
    await turn('r1', () => {
      state().recordAgentFileWrite('/p/title.html', '<old/>', '<v1/>')
      state().recordAgentFileWrite('/p/title.html', '<v1/>', '<v2/>') // second write: first before wins
      state().recordAgentFileWrite('/p/new.html', null, '<new/>')
    })
    const card = changes().at(-1)!
    assert.deepEqual(card.lines.map((l) => l.text), ['Rewrote “title.html”', 'Created “new.html”'])
    state().revertAgentChange(card.id)
    await new Promise((resolve) => setImmediate(resolve))
    assert.deepEqual(writes, [['/p/title.html', '<old/>']], 'the file as it was; a file the turn created is left alone')
    assert.equal(state().compositionEpochs['/p/title.html'], 1, 'the preview is told its frames are stale')
    state().undo()
    await new Promise((resolve) => setImmediate(resolve))
    assert.deepEqual(
      writes.slice(1).sort(),
      [['/p/new.html', '<new/>'], ['/p/title.html', '<v2/>']],
      'undoing the revert puts the agent’s versions back, the latest write of each'
    )
  } finally {
    setAgentFileWriter(null)
  }
})

test('outside a turn a file write is not recorded', () => {
  fresh()
  state().recordAgentFileWrite('/p/x.html', '<old/>', '<new/>')
  assert.deepEqual(state().agentTurnFiles, {})
})

test('changes the summary does not itemise still get a card, so they can be reverted', async () => {
  fresh()
  const text: Asset = {
    id: 't1', kind: 'text', name: 'Caption', path: null, text: 'Hi', durationUs: 0, width: null,
    height: null, fps: null, hasAudio: false, hasVideo: false, posterPath: null, waveformPath: null, createdAt: 0
  }
  await turn('r1', () => state().addAssets([text])) // a text asset alone is bookkeeping in the diff
  assert.deepEqual(changes().at(-1)?.lines.map((l) => l.text), ['Changed settings this summary does not list'])
  await turn('r2', () => state().patchTrack(state().project.timelines[0]!.tracks[0]!.id, { muted: true }))
  assert.match(changes().at(-1)!.lines.map((l) => l.text).join('\n'), /^Muted track /m)
})

test('the user’s own edits during a turn are named on the card; the agent’s alone are not', async () => {
  fresh()
  await turn('r1', () => state().addTrack('video'))
  assert.equal(changes().at(-1)?.note, undefined, 'positive control: agent-only turn')
  state().applyAgentEvent({ type: 'started', runId: 'r2' })
  await asAgent(() => state().addTrack('audio'))
  state().renameProject('Typed by the user mid-turn') // not inside a tool call
  state().applyAgentEvent({ type: 'done', runId: 'r2', reason: 'complete' })
  assert.match(changes().at(-1)?.note ?? '', /edits you made while the agent was working/)
})

test('an MCP client’s edits during a turn are its own: named separately, not the agent’s or the user’s', async () => {
  fresh()
  state().applyAgentEvent({ type: 'started', runId: 'r1' })
  await asAgent(() => state().addTrack('audio'))
  await asClient(() => state().renameProject('Renamed from a terminal client'))
  assert.equal(state().agentTurnClientEdited, true, 'the client edit is marked as the client’s')
  assert.equal(state().agentTurnUserEdited, false, 'and not as the user’s')
  state().applyAgentEvent({ type: 'done', runId: 'r1', reason: 'complete' })
  const note = changes().at(-1)?.note ?? ''
  assert.match(note, /an MCP client made through bay's socket/)
  assert.doesNotMatch(note, /edits you made/)
  assert.equal(state().agentTurnClientEdited, false, 'cleared when the turn ends')
})

test('a revert is refused while a turn is running, and works once it ends', async () => {
  fresh()
  await turn('r1', () => state().addTrack('video'))
  const [card] = changes()
  state().applyAgentEvent({ type: 'started', runId: 'r2' })
  const during = state().project
  state().revertAgentChange(card!.id)
  assert.equal(state().project, during, 'refused')
  assert.match(state().toast?.text ?? '', /Wait for the agent to finish/)
  state().applyAgentEvent({ type: 'done', runId: 'r2', reason: 'complete' })
  state().revertAgentChange(card!.id)
  assert.equal(stateOf(card!.id), 'reverted')
})

test('revertImpact says when the project changed after the turn', async () => {
  fresh()
  await turn('r1', () => state().addTrack('video'))
  const [card] = changes()
  assert.equal(revertImpact(state(), card!.id).laterEdits, false)
  state().renameProject('Edited afterwards by the user')
  assert.equal(revertImpact(state(), card!.id).laterEdits, true)
})

test(`only the last ${MAX_AGENT_CHECKPOINTS} turns stay revertable; older cards expire, readable`, async () => {
  fresh()
  for (let i = 0; i <= MAX_AGENT_CHECKPOINTS; i++) await turn(`r${i}`, () => state().renameProject(`Name ${i}`))
  const cards = changes()
  assert.equal(cards.length, MAX_AGENT_CHECKPOINTS + 1)
  assert.equal(cards[0]!.state, 'expired')
  assert.equal(cards[1]!.state, 'applied')
  assert.equal(Object.keys(state().agentCheckpoints).length, MAX_AGENT_CHECKPOINTS)
})

test('with approval off, a session is not gated; turning it on gates the running session', () => {
  fresh()
  state().setAgentApproval(false)
  state().startAgentSession()
  assert.equal(state().agentSessionActive, true)
  assert.equal(state().agentGate, null, 'the agent edits directly')
  state().setAgentApproval(true)
  assert.deepEqual(state().agentGate, { approved: null })
  state().setAgentApproval(false)
  assert.equal(state().agentGate, null)
  state().endAgentSession()
})

test('undoing back to the saved state reads as saved; one step further does not', () => {
  fresh()
  state().renameProject('Saved name')
  state().markSaved()
  const saved = state().project
  state().renameProject('Edited after saving')
  assert.equal(state().dirty, true)
  state().undo()
  assert.equal(state().project, saved, 'specimen: back to the very object that was saved')
  assert.equal(state().dirty, false, 'the file already holds this')
  state().undo()
  assert.equal(state().dirty, true, 'before the save is not what the file holds')
  state().redo()
  assert.equal(state().dirty, false, 'redo back onto the saved state')
  state().redo()
  assert.equal(state().dirty, true)
})

test('a streamed tool call is one card: it appears empty, fills as it streams, then settles', () => {
  fresh()
  const apply = state().applyAgentEvent
  apply({ type: 'started', runId: 's' })
  apply({ type: 'tool', runId: 's', callId: 'c1', tool: 'write_composition', args: {} })
  apply({ type: 'tool-input', runId: 's', callId: 'c1', delta: '{"path":"/p/a.html",' })
  apply({ type: 'tool-input', runId: 's', callId: 'c1', delta: '"html":"<div>' })
  const cards = () => state().agentLog.filter((e) => e.kind === 'tool')
  assert.equal(cards().length, 1)
  assert.equal((cards()[0] as { input?: string }).input, '{"path":"/p/a.html","html":"<div>')
  apply({ type: 'tool', runId: 's', callId: 'c1', tool: 'write_composition', args: { path: '/p/a.html', html: '<div></div>' } })
  assert.equal(cards().length, 1, 'the settled call fills the same card, not a second one')
  assert.deepEqual((cards()[0] as { args: unknown }).args, { path: '/p/a.html', html: '<div></div>' })
  assert.equal((cards()[0] as { input?: string }).input, undefined, 'the raw stream goes once the arguments exist')
  apply({ type: 'done', runId: 's', reason: 'complete' })
})

test('a think becomes one "thought for" line with its duration; a turn ended mid-think still gets one', async () => {
  fresh()
  const apply = state().applyAgentEvent
  const realNow = Date.now
  let clock = 1_000_000
  Date.now = () => clock
  try {
    apply({ type: 'started', runId: 't' })
    apply({ type: 'thinking-start', runId: 't' })
    assert.equal(state().agentThinkingSince, 1_000_000, 'the indicator knows when it began')
    clock += 144_000
    apply({ type: 'thinking-end', runId: 't' })
    const lines = () => state().agentLog.filter((e) => e.kind === 'thinking') as { seconds: number }[]
    assert.deepEqual(lines().map((l) => l.seconds), [144])
    assert.equal(state().agentThinkingSince, null)
    // A blink of thinking is not worth a line.
    apply({ type: 'thinking-start', runId: 't' })
    clock += 400
    apply({ type: 'thinking-end', runId: 't' })
    assert.equal(lines().length, 1)
    // Stopped while thinking: the turn's end closes it.
    apply({ type: 'thinking-start', runId: 't' })
    clock += 5_000
    apply({ type: 'done', runId: 't', reason: 'stopped' })
    assert.deepEqual(lines().map((l) => l.seconds), [144, 5])
    assert.equal(state().agentThinkingSince, null)
  } finally {
    Date.now = realNow
  }
})
