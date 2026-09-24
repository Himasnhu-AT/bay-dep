import { test } from 'node:test'
import assert from 'node:assert/strict'
import { activeTimeline } from '@shared/project'
import { emptyProject, useEditor } from '@/store/editor'
import { applyProjectSettings } from './projectSettingsApply'

const s = () => useEditor.getState()

function load(): void {
  s().setProject({ ...emptyProject(), name: 'Before' }, { resetHistory: true })
}

test('a refused canvas size changes nothing else either: no rename, rate, background or undo step', () => {
  load()
  const timeline = activeTimeline(s().project)!
  const project = s().project
  const past = s().past.length
  const outcome = applyProjectSettings(s(), {
    name: 'After',
    width: 1921, // odd: refused
    height: 1080,
    fit: 'auto',
    fps: timeline.fps === 30 ? 25 : 30,
    background: timeline.background.toLowerCase() === '#ffffff' ? '#000000' : '#ffffff'
  })
  assert.equal(outcome.ok, false)
  assert.match(outcome.ok ? '' : outcome.error, /even number of pixels/)
  assert.equal(s().project, project, 'the project is the same object: nothing was written')
  assert.equal(s().past.length, past)
})

test('an accepted Apply changes all of it as one undo step', () => {
  load()
  const timeline = activeTimeline(s().project)!
  const past = s().past.length
  const fps = timeline.fps === 30 ? 25 : 30
  const background = timeline.background.toLowerCase() === '#ffffff' ? '#000000' : '#ffffff'
  const width = timeline.width === 1080 ? 1920 : 1080
  const outcome = applyProjectSettings(s(), { name: 'After', width, height: 1920, fit: 'auto', fps, background })
  assert.equal(outcome.ok, true)
  const after = activeTimeline(s().project)!
  assert.deepEqual(
    [s().project.name, after.width, after.height, after.fps, after.background],
    ['After', width, 1920, fps, background]
  )
  assert.equal(s().past.length, past + 1)
  s().undo()
  assert.equal(s().project.name, 'Before')
})
