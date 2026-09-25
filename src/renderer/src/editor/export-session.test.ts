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
import { DEFAULT_EXPORT_SETTINGS, matchExportPreset } from '@shared/export-presets'
import { exportFormFields, firstFittingPreset, useExportSession } from './export-session'
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

test('the Deliver page’s first look picks the preset that fits the canvas, only over untouched defaults', () => {
  const fresh = (): void => useExportSession.setState({ settings: DEFAULT_EXPORT_SETTINGS, progress: null, starting: false })
  // The specimen: the defaults match no preset, which is why the cards lit Custom.
  assert.equal(matchExportPreset(DEFAULT_EXPORT_SETTINGS), 'custom')

  fresh()
  assert.equal(useExportSession.getState().adoptFittingPreset(1920, 1080), true)
  assert.equal(matchExportPreset(useExportSession.getState().settings), 'youtube-1080')
  assert.equal(useExportSession.getState().adoptFittingPreset(1080, 1920), false, 'once chosen, not chosen again')
  assert.equal(matchExportPreset(useExportSession.getState().settings), 'youtube-1080')

  fresh()
  useExportSession.getState().adoptFittingPreset(1080, 1920)
  assert.equal(matchExportPreset(useExportSession.getState().settings), 'vertical', 'a vertical canvas is not letterboxed')
  assert.equal(firstFittingPreset(1000, 700).id, 'master', 'no frame preset fits: canvas size')

  // Settings someone set, even back to the default values, are theirs.
  useExportSession.setState({ settings: { ...DEFAULT_EXPORT_SETTINGS }, progress: null })
  assert.equal(useExportSession.getState().adoptFittingPreset(1920, 1080), false)
  assert.equal(matchExportPreset(useExportSession.getState().settings), 'custom')
})
