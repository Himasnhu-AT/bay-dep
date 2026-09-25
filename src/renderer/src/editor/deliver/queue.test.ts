import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ExportProgress, IncompleteFrames } from '@shared/ipc'
import { addRecord, applyProgress, fileName, folderOf, HISTORY_LIMIT, markIncomplete, recordStatus, type RenderRecord } from './queue'

const progress = (jobId: string, patch: Partial<ExportProgress> = {}): ExportProgress => ({
  jobId,
  progress: null,
  framesDone: 0,
  framesTotal: 100,
  stage: 'preparing',
  ...patch
})

const mine = (jobId: string, patch: Partial<RenderRecord> = {}): RenderRecord => ({
  jobId,
  origin: 'you',
  outputPath: `/Users/me/Movies/${jobId}.mp4`,
  summary: 'YouTube 1080p',
  startedAt: 1,
  progress: progress(jobId),
  incomplete: null,
  ...patch
})

const incomplete: IncompleteFrames = {
  frames: 3,
  ranges: [[10, 12]],
  items: [{ name: 'Title.brf', frames: 3, ranges: [[10, 12]] }],
  gradeIssues: [],
  placeholders: [],
  message: 'Frames 10–12 were written before Title.brf had drawn.'
}

test('a report for a job this window started updates it in place', () => {
  const history = addRecord([], mine('a'))
  const next = applyProgress(history, progress('a', { stage: 'rendering', progress: 0.5, framesDone: 50 }), 5)
  assert.equal(next.length, 1)
  assert.equal(next[0]?.origin, 'you', 'still ours, not re-added as the agent’s')
  assert.equal(next[0]?.progress.stage, 'rendering')
  assert.equal(recordStatus(next[0]!).label, 'Rendering · 50%')
})

test('a report for a job nobody here started is the agent’s, and joins the queue at the top', () => {
  const history = addRecord([], mine('a'))
  const next = applyProgress(history, progress('agent-1', { stage: 'encoding', outputPath: '/tmp/x.mp4' }), 9)
  assert.deepEqual(next.map((entry) => entry.jobId), ['agent-1', 'a'])
  assert.equal(next[0]?.origin, 'agent')
  assert.equal(next[0]?.outputPath, '/tmp/x.mp4')
  assert.equal(next[0]?.startedAt, 9)
})

test('a finished job is not reopened by a late frame report, but a terminal report still lands', () => {
  let history = addRecord([], mine('a'))
  history = applyProgress(history, progress('a', { stage: 'done', progress: 1, outputPath: '/Users/me/Movies/final.mp4' }), 2)
  const late = applyProgress(history, progress('a', { stage: 'rendering', progress: 0.99 }), 3)
  assert.equal(late[0]?.progress.stage, 'done', 'the late frame report is ignored')
  assert.equal(late[0]?.outputPath, '/Users/me/Movies/final.mp4', 'done names where the file went')
  // Positive control: the same shape of report, before the job finished, does land.
  const running = applyProgress(addRecord([], mine('b')), progress('b', { stage: 'rendering', progress: 0.99 }), 3)
  assert.equal(running[0]?.progress.stage, 'rendering')
})

test('a done file with wrong frames reads Incomplete, never Complete', () => {
  const done = mine('a', { progress: progress('a', { stage: 'done', progress: 1 }) })
  assert.equal(recordStatus(done).tone, 'complete', 'positive control: the same job without the record is complete')
  const wrong = markIncomplete([done], 'a', incomplete)[0]!
  const status = recordStatus(wrong)
  assert.equal(status.tone, 'incomplete')
  assert.equal(status.label, 'Incomplete')
  assert.equal(status.detail, incomplete.message, 'the sentence says which frames and why')
  // And main's later `done`, which knows nothing of the frames, must not wash it out.
  const after = applyProgress([wrong], progress('a', { stage: 'done', progress: 1 }), 4)[0]!
  assert.equal(recordStatus(after).tone, 'incomplete')
})

test('a blocking finding on the delivered file is a problem, a warning is a note', () => {
  const blocking = mine('a', {
    progress: progress('a', { stage: 'done', progress: 1, findings: [{ severity: 'blocking', message: 'The file has no audio stream.' }] })
  })
  assert.equal(recordStatus(blocking).tone, 'incomplete')
  assert.match(recordStatus(blocking).detail ?? '', /no audio stream/)
  const warned = mine('b', {
    progress: progress('b', { stage: 'done', progress: 1, findings: [{ severity: 'warn', message: 'Length is 1% short.' }] })
  })
  assert.equal(recordStatus(warned).tone, 'complete')
  assert.match(recordStatus(warned).detail ?? '', /1% short/)
})

test('failed says why; cancelled says nothing more', () => {
  const failed = mine('a', { progress: progress('a', { stage: 'failed', error: 'Disk full.' }) })
  assert.deepEqual(recordStatus(failed), { tone: 'failed', label: 'Failed', detail: 'Disk full.' })
  const cancelled = mine('b', { progress: progress('b', { stage: 'cancelled' }) })
  assert.deepEqual(recordStatus(cancelled), { tone: 'cancelled', label: 'Cancelled', detail: null })
})

test('the queue keeps the newest jobs and drops the oldest past its limit', () => {
  let history: readonly RenderRecord[] = []
  for (let i = 0; i < HISTORY_LIMIT + 5; i += 1) history = addRecord(history, mine(`job-${i}`))
  assert.equal(history.length, HISTORY_LIMIT)
  assert.equal(history[0]?.jobId, `job-${HISTORY_LIMIT + 4}`, 'newest first')
  assert.ok(!history.some((entry) => entry.jobId === 'job-0'), 'the oldest went')
})

test('file and folder names split a path at its last slash', () => {
  assert.equal(fileName('/Users/me/Movies/cut.mp4'), 'cut.mp4')
  assert.equal(folderOf('/Users/me/Movies/cut.mp4'), '/Users/me/Movies')
  assert.equal(folderOf('/cut.mp4'), '/')
  assert.equal(fileName(null), null)
})
