/**
 * Autosave's decisions: which sidecar is offered, what each state says, when a write is due and
 * when it must not happen. The file half is `src/main/project/recovery.test.ts`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  AUTOSAVE_KEYS,
  autosaveSkip,
  autosaveSkipSentence,
  createAutosaver,
  parseAutosavePrefs,
  recoveryOffer,
  type AutosaveConditions,
  type AutosaveSkip
} from './autosave'

// -- which sidecar is offered ------------------------------------------------

const opened = { id: 'prj_a', filePath: '/work/film.bay', name: 'Film', updatedAt: 1000 }
const sidecar = (updatedAt: number, id = 'prj_a') => ({ kind: 'project' as const, sidecarPath: '/work/film.bay.autosave', id, name: 'Film', updatedAt })

test('newer is offered, older and equal are not — by the documents’ own stamps', () => {
  assert.equal(recoveryOffer(opened, sidecar(1001))?.state, 'newer')
  assert.equal(recoveryOffer(opened, sidecar(1000)), null)
  assert.equal(recoveryOffer(opened, sidecar(999)), null)
  assert.equal(recoveryOffer(opened, { kind: 'none' }), null)
})

test('a project never saved has no saved time to compare with, and says so', () => {
  const offer = recoveryOffer({ ...opened, filePath: null }, sidecar(1001))
  assert.equal(offer?.state === 'newer' ? offer.savedAt : 'absent', null)
})

// -- preferences -------------------------------------------------------------

test('the preference keys are pinned: a later build reads what this one wrote', () => {
  assert.deepEqual(AUTOSAVE_KEYS, { enabled: 'bay.autosave', idleSeconds: 'bay.autosave.idleSeconds' })
})

test('autosave is on unless turned off, and a corrupt delay falls back rather than writing every 0 s', () => {
  assert.deepEqual(parseAutosavePrefs(null, null), { enabled: true, idleSeconds: 3 })
  assert.deepEqual(parseAutosavePrefs('0', '10'), { enabled: false, idleSeconds: 10 })
  assert.equal(parseAutosavePrefs(null, 'soon').idleSeconds, 3)
  assert.equal(parseAutosavePrefs(null, '0').idleSeconds, 1)
  assert.equal(parseAutosavePrefs(null, '99999').idleSeconds, 120)
})

// -- when a write must not happen --------------------------------------------

const writable: AutosaveConditions = { enabled: true, probeDriving: false, editing: true, recoveryPending: false, dirty: true }

test('a dirty project open in the editor is written; each condition alone stops it, with its own reason', () => {
  assert.equal(autosaveSkip(writable), null)
  assert.equal(autosaveSkip({ ...writable, enabled: false }), 'off')
  assert.equal(autosaveSkip({ ...writable, probeDriving: true }), 'probe')
  assert.equal(autosaveSkip({ ...writable, editing: false }), 'no-project')
  assert.equal(autosaveSkip({ ...writable, recoveryPending: true }), 'recovery-pending')
  assert.equal(autosaveSkip({ ...writable, dirty: false }), 'clean')
})

test('the skips a person should know about each have a sentence, and each a different one', () => {
  const said = (['off', 'probe', 'recovery-pending'] as AutosaveSkip[]).map(autosaveSkipSentence)
  assert.ok(said.every((line) => typeof line === 'string' && line.length > 0))
  assert.equal(new Set(said).size, 3)
  assert.equal(autosaveSkipSentence('clean'), null)
})

// -- the scheduler -----------------------------------------------------------

/** A clock and timers the test moves by hand. */
function harness(options: { idleMs?: number; burstMs?: number; skip?: () => AutosaveSkip | null; write?: () => Promise<void> } = {}) {
  let now = 0
  let timers: { at: number; run: () => void; id: number }[] = []
  let ids = 0
  const writes: number[] = []
  const skipped: AutosaveSkip[] = []
  const failures: unknown[] = []
  const saver = createAutosaver({
    idleMs: () => options.idleMs ?? 3000,
    burstMs: options.burstMs ?? 30_000,
    now: () => now,
    setTimer: (run, ms) => {
      const id = (ids += 1)
      timers.push({ at: now + ms, run, id })
      return id
    },
    clearTimer: (handle) => {
      timers = timers.filter((timer) => timer.id !== handle)
    },
    skip: options.skip ?? (() => null),
    write:
      options.write ??
      (async () => {
        writes.push(now)
      }),
    onSkipped: (skip) => skipped.push(skip),
    onFailed: (error) => failures.push(error)
  })
  /** Move the clock, firing what falls due, and let the writes those start finish. */
  async function advance(ms: number): Promise<void> {
    const end = now + ms
    for (;;) {
      const due = timers.filter((timer) => timer.at <= end).sort((a, b) => a.at - b.at)[0]
      if (!due) break
      now = due.at
      timers = timers.filter((timer) => timer !== due)
      due.run()
      await new Promise((resolve) => setImmediate(resolve))
    }
    now = end
  }
  return { saver, advance, writes, skipped, failures, armed: () => timers.length }
}

test('a project is written once it has been idle, not before', async () => {
  const h = harness()
  h.saver.edited()
  await h.advance(2999)
  assert.deepEqual(h.writes, [])
  await h.advance(1)
  assert.deepEqual(h.writes, [3000])
  // Nothing more is owed: an idle project is not rewritten every three seconds.
  await h.advance(60_000)
  assert.deepEqual(h.writes, [3000])
})

test('every edit restarts the wait, so a drag of many edits is one write after it ends', async () => {
  const h = harness()
  for (let i = 0; i < 5; i += 1) {
    h.saver.edited()
    await h.advance(1000)
  }
  assert.deepEqual(h.writes, [])
  await h.advance(2000)
  assert.deepEqual(h.writes, [7000])
})

test('a run of edits that never pauses is still written, every burst length', async () => {
  const h = harness({ idleMs: 3000, burstMs: 30_000 })
  for (let t = 0; t < 70_000; t += 1000) {
    h.saver.edited()
    await h.advance(1000)
  }
  assert.deepEqual(h.writes, [30_000, 60_000])
})

test('a probe that attaches after the edit, before the timer, still stops the write', async () => {
  let driving = false
  const h = harness({ skip: () => (driving ? 'probe' : null) })
  h.saver.edited()
  await h.advance(1000)
  driving = true
  await h.advance(10_000)
  assert.deepEqual(h.writes, [])
  assert.deepEqual(h.skipped, ['probe'])
  // And a paused autosave does not spin: nothing is armed until the next edit.
  assert.equal(h.armed(), 0)
  // The pair: with the probe gone, the next edit is written as usual.
  driving = false
  h.saver.edited()
  await h.advance(3000)
  assert.deepEqual(h.writes, [14_000])
})

test('a save settles what was owed: no sidecar is written for work already in the file', async () => {
  const h = harness()
  h.saver.edited()
  await h.advance(1000)
  h.saver.settled()
  await h.advance(60_000)
  assert.deepEqual(h.writes, [])
  assert.equal(h.saver.pending(), false)
})

test('writes never overlap, and an edit made during one gets its own afterwards', async () => {
  let running = 0
  let most = 0
  let finish: (() => void) | null = null
  const started: number[] = []
  const h = harness({
    write: () =>
      new Promise<void>((resolve) => {
        running += 1
        most = Math.max(most, running)
        started.push(started.length)
        finish = () => {
          running -= 1
          resolve()
        }
      })
  })
  h.saver.edited()
  await h.advance(3000)
  assert.equal(started.length, 1)
  h.saver.edited()
  await h.advance(3000)
  assert.equal(started.length, 1, 'the second write waits for the first')
  finish!()
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(started.length, 2)
  assert.equal(most, 1)
  finish!()
})

test('a failed write is reported and does not stop the next one', async () => {
  let fail = true
  const done: string[] = []
  const h = harness({
    write: async () => {
      if (fail) throw new Error('disk full')
      done.push('ok')
    }
  })
  h.saver.edited()
  await h.advance(3000)
  assert.equal((h.failures[0] as Error).message, 'disk full')
  fail = false
  h.saver.edited()
  await h.advance(3000)
  assert.deepEqual(done, ['ok'])
})

test('flush writes what is owed now, and nothing when nothing is', async () => {
  const h = harness()
  await h.saver.flush()
  assert.deepEqual(h.writes, [])
  h.saver.edited()
  await h.saver.flush()
  assert.deepEqual(h.writes, [0])
  assert.equal(h.armed(), 0)
})
