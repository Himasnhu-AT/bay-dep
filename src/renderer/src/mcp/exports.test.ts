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
    gradeIssues: [],
    placeholders: []
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

test('main’s read-back findings reach the agent, and a blocking one means not complete', () => {
  const noAudio = { severity: 'blocking' as const, message: 'The timeline has sound, but the exported file has no audio stream.' }
  const status = exportStatus({ ...done, findings: [{ severity: 'warn', message: 'length unknown' }, noAudio] }, '/out.mp4', null)
  assert.equal(status.complete, false)
  assert.match(String(status.warning), /no audio stream/)
  // Blocking first, whatever order main sent them in.
  assert.deepEqual((status.findings as { severity: string }[]).map((f) => f.severity), ['blocking', 'warn'])
  // The control: a warning alone leaves the export complete.
  const warned = exportStatus({ ...done, findings: [{ severity: 'warn', message: 'length unknown' }] }, '/out.mp4', null)
  assert.equal(warned.complete, true)
  assert.equal((warned.findings as unknown[]).length, 1)
})

test('a done export that wrote zero frames is not complete, though main found nothing wrong with the file', () => {
  const empty = exportStatus({ ...done, framesDone: 0, findings: [] }, '/out.mp4', null)
  assert.equal(empty.complete, false)
  assert.match(String(empty.warning), /zero frames/)
  assert.ok((empty.findings as { severity: string }[]).some((f) => f.severity === 'blocking'))
  // Positive control: the same export with its frames is complete.
  assert.equal(exportStatus({ ...done, findings: [] }, '/out.mp4', null).complete, true)
})

test('frames written with something missing are a blocking finding too', () => {
  const incomplete = describeIncomplete([{ frame: 3, missing: ['Title'], gradeIssues: [] }])
  const status = exportStatus({ ...done, findings: [] }, '/out.mp4', incomplete)
  const findings = status.findings as { severity: string; message: string }[]
  assert.equal(findings.length, 1)
  assert.equal(findings[0]!.severity, 'blocking')
  assert.match(findings[0]!.message, /"Title"/)
  // Clean: an empty list, said explicitly — and nothing before the job is done.
  assert.deepEqual(exportStatus({ ...done, findings: [] }, '/out.mp4', null).findings, [])
  assert.equal(exportStatus({ ...done, stage: 'encoding' }, '/out.mp4', null).findings, undefined)
})

test('a done export reports the delivered loudness, and warns when an unmastered file is too quiet', () => {
  // The real case: re-exported without loudness, −33.4 LUFS, and nobody was told.
  const quiet = exportStatus({ ...done, findings: [], deliveredLoudness: { integratedLufs: -33.43, truePeakDb: -12.3 } }, '/out.mp4', null)
  assert.deepEqual(quiet.deliveredLoudness, { integratedLufs: -33.4, truePeakDbtp: -12.3, mastered: false })
  assert.match(String(quiet.warning), /−33\.4 LUFS/)
  assert.match(String(quiet.warning), /loudness: "streaming"/)
  assert.equal(quiet.complete, true, 'the file is complete; its level is a warning, not a fault')
  assert.ok((quiet.findings as { severity: string; message: string }[]).some((f) => f.severity === 'warn' && /−33\.4 LUFS/.test(f.message)))

  // Too loud, the other side.
  const loud = exportStatus({ ...done, findings: [], deliveredLoudness: { integratedLufs: -7, truePeakDb: 0.2 } }, '/out.mp4', null)
  assert.match(String(loud.warning), /louder than −9\.0 LUFS/)

  // Controls: in range says the level and warns nothing; mastered never warns about its level.
  const fine = exportStatus({ ...done, findings: [], deliveredLoudness: { integratedLufs: -15, truePeakDb: -2 } }, '/out.mp4', null)
  assert.deepEqual(fine.deliveredLoudness, { integratedLufs: -15, truePeakDbtp: -2, mastered: false })
  assert.equal(fine.warning, undefined)
})

test('a mastered export reports the same delivered reading as mastered, with no level warning', () => {
  const measured = { integratedLufs: -14.1, truePeakDb: -1.4 }
  const report = {
    status: 'met' as const, target: { integratedLufs: -14, truePeakDb: -1 }, measured, before: { integratedLufs: -33.4, truePeakDb: -12 },
    gainDb: 19.3, limiterCeilingDb: -1.5, passes: 2, summary: 'Mastered to −14.1 LUFS.'
  }
  const status = exportStatus({ ...done, findings: [], loudness: report, deliveredLoudness: measured }, '/out.mp4', null)
  assert.deepEqual(status.deliveredLoudness, { integratedLufs: -14.1, truePeakDbtp: -1.4, mastered: true })
  assert.equal(status.warning, undefined)
})

test('a level warning follows a blocking fault rather than replacing it', () => {
  const noFrames = exportStatus({ ...done, framesDone: 0, findings: [], deliveredLoudness: { integratedLufs: -40, truePeakDb: -20 } }, '/out.mp4', null)
  const warning = String(noFrames.warning)
  assert.ok(warning.indexOf('zero frames') >= 0 && warning.indexOf('zero frames') < warning.indexOf('−40.0 LUFS'), warning)
})
