import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NO_VENDORED_FFMPEG, vendoredTools } from '../ffmpeg/vendor'
import { detectSceneCuts, parseSceneCuts } from './scene-cuts'

const FFMPEG = vendoredTools()?.ffmpeg ?? ''
const SKIP = FFMPEG ? false : NO_VENDORED_FFMPEG

test('parseSceneCuts reads metadata=print output, frame line then keys', () => {
  // Recorded from the vendored ffmpeg on the three-shot specimen below.
  const out = [
    'frame:0    pts:19456   pts_time:1.52',
    'lavfi.scd.mafd=37.296',
    'lavfi.scd.score=36.027',
    'lavfi.scd.time=1.52',
    'frame:1    pts:38912   pts_time:3.04',
    'lavfi.scd.mafd=41.322',
    'lavfi.scd.score=41.322',
    'lavfi.scd.time=3.04',
    ''
  ].join('\n')
  assert.deepEqual(parseSceneCuts(out), [
    { us: 1_520_000, score: 36.027 },
    { us: 3_040_000, score: 41.322 }
  ])
  assert.deepEqual(parseSceneCuts(''), [])
  // A frame with no scd.time still counts, at its pts_time; a cut at 0 is the file's start, not a cut.
  assert.deepEqual(parseSceneCuts('frame:0 pts:0 pts_time:0\nlavfi.scd.score=80\nframe:1 pts:1 pts_time:2.5\nlavfi.scd.score=12.5\n'), [
    { us: 2_500_000, score: 12.5 }
  ])
})

test('three shots are two cuts, where the shots change', { skip: SKIP }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bay-cuts-'))
  const path = join(dir, 'three-shots.mov')
  execFileSync(FFMPEG, [
    '-v', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=s=320x240:r=25:d=1.6',
    '-f', 'lavfi', '-i', 'color=c=blue:s=320x240:r=25:d=1.6',
    '-f', 'lavfi', '-i', 'testsrc=s=320x240:r=25:d=1',
    '-filter_complex', '[0][1][2]concat=n=3,format=yuv420p',
    '-c:v', 'mjpeg', path
  ])
  const cuts = await detectSceneCuts(path)
  assert.equal(cuts.length, 2, JSON.stringify(cuts))
  assert.ok(Math.abs(cuts[0]!.us - 1_600_000) <= 40_000, `first cut at ${cuts[0]!.us}`)
  assert.ok(Math.abs(cuts[1]!.us - 3_200_000) <= 40_000, `second cut at ${cuts[1]!.us}`)

  // The negative beside it: one continuous moving shot is no cuts at all.
  const one = join(dir, 'one-shot.mov')
  execFileSync(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=320x240:r=25:d=3', '-c:v', 'mjpeg', one])
  assert.deepEqual(await detectSceneCuts(one), [])
})
