/**
 * The export form's subscription: a frame of progress must leave what the form reads equal under
 * the comparison `useShallow` makes, or every surface built from `useExportForm` (the Deliver
 * settings column, the dialog) redraws on every exported frame. Paired with the changes that must
 * still reach the form.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shallow } from 'zustand/shallow'
import type { ExportProgress } from '@shared/ipc'
import { exportFormFields, useExportSession } from './export-session'
import { addRecord, applyProgress } from './deliver/queue'

function frame(framesDone: number, stage: ExportProgress['stage'] = 'rendering'): ExportProgress {
  return { jobId: 'job_1', stage, framesDone, framesTotal: 100, progress: framesDone / 100 }
}

test('a frame of progress leaves the form’s fields shallow-equal; settings and the end of the job do not', () => {
  useExportSession.setState({
    progress: frame(1),
    history: addRecord([], {
      jobId: 'job_1',
      origin: 'you',
      outputPath: '/tmp/cut.mp4',
      summary: 'H.264',
      startedAt: 1,
      progress: frame(1),
      incomplete: null
    })
  })
  const before = exportFormFields(useExportSession.getState())
  assert.equal(before.running, true)

  // What the exporter does on every frame.
  useExportSession.setState((state) => ({ progress: frame(2), history: applyProgress(state.history, frame(2), 2) }))
  const whole = useExportSession.getState()
  assert.equal(whole.progress?.framesDone, 2, 'the specimen: the session itself did change')
  assert.equal(whole.history[0]?.progress.framesDone, 2, 'and so did the queue')
  assert.ok(shallow(before, exportFormFields(whole)), 'a frame must not change what the form reads')

  // The positive controls: what the form shows must still reach it.
  useExportSession.getState().setOutputPath('/tmp/other.mp4')
  assert.ok(!shallow(before, exportFormFields(useExportSession.getState())), 'a new destination reaches the form')
  const mid = exportFormFields(useExportSession.getState())
  useExportSession.setState({ progress: frame(100, 'done') })
  const done = exportFormFields(useExportSession.getState())
  assert.equal(done.running, false)
  assert.ok(!shallow(mid, done), 'the job ending unlocks the form')
})
