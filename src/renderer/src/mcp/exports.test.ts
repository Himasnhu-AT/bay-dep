/**
 * What `track_export` tells the agent when an export finished with frames that are wrong.
 *
 * The requirement is that an export never puts the wrong picture in a file *silently*. Main says
 * `done` when the encoder closes — it cannot know what the frames held — so a `done` over a file
 * with a graphic missing or a clip ungraded must still reach the agent as not complete, with the
 * frames and the names, at the moment it is about to report success. The clean export beside it
 * is the control: the report must not accuse every export.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ExportProgress } from '@shared/ipc'
import { describeIncomplete } from '@/engine/exporter'
import { exportStatus } from './exports'

const done: ExportProgress = { jobId: 'job-1', progress: 1, framesDone: 120, framesTotal: 120, stage: 'done' }

test('a done export with frames missing a graphic is reported as not complete, naming them', () => {
  const incomplete = describeIncomplete([
    { frame: 0, missing: ['Counter probe'], gradeIssues: [] },
    { frame: 1, missing: ['Counter probe'], gradeIssues: [] }
  ])
  assert.ok(incomplete)
  const status = exportStatus(done, '/out.mp4', incomplete)
  assert.equal(status.stage, 'done', 'the file exists and every frame is in it')
  assert.equal(status.complete, false)
  assert.deepEqual(status.incompleteFrames, {
    frames: 2,
    ranges: [[0, 1]],
    items: [{ name: 'Counter probe', frames: 2, ranges: [[0, 1]] }],
    gradeIssues: []
  })
  assert.equal(typeof status.warning, 'string')
  assert.match(String(status.warning), /frames 0-1/)
  assert.match(String(status.warning), /"Counter probe"/)
})

test('a done export with a clip drawn ungraded is reported as not complete, naming the clip', () => {
  const issue = 'clip itm_a was drawn ungraded: this renderer has no WebGL2'
  const incomplete = describeIncomplete([{ frame: 40, missing: [], gradeIssues: [issue] }])
  assert.ok(incomplete)
  const status = exportStatus(done, '/out.mp4', incomplete)
  assert.equal(status.complete, false)
  assert.deepEqual((status.incompleteFrames as { gradeIssues: unknown }).gradeIssues, [{ issue, frames: 1, ranges: [[40, 40]] }])
  assert.match(String(status.warning), /itm_a was drawn ungraded/)
})

test('the control: a clean done export says complete, with no warning', () => {
  const status = exportStatus(done, '/out.mp4', null)
  assert.equal(status.complete, true)
  assert.equal(status.warning, undefined)
  assert.equal(status.incompleteFrames, undefined)
  assert.equal(status.outputPath, '/out.mp4')
})

test('a running export claims nothing about completeness yet', () => {
  const status = exportStatus({ ...done, stage: 'rendering', progress: 0.5, framesDone: 60 }, '/out.mp4', null)
  assert.equal(status.complete, undefined)
})
