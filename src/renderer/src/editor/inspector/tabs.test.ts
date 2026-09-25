/**
 * The inspector's tabs per selection — the WP4 acceptance cases, spelled out.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chooseTab, inspectorTabs, tabForSection, type SelectionShape } from './tabs'

const none: SelectionShape = { count: 0, visual: 0, text: 0, composed: 0, source: 0, sound: 0, detached: 0 }
const videoWithSound: SelectionShape = { ...none, count: 1, visual: 1, source: 1, sound: 1 }
const title: SelectionShape = { ...none, count: 1, visual: 1, text: 1 }
const musicBed: SelectionShape = { ...none, count: 1, sound: 1 }

const enabled = (shape: SelectionShape): string[] =>
  inspectorTabs(shape).filter((tab) => tab.enabled).map((tab) => tab.value)

test('a video clip with sound gets Video, Audio, Effects, Color and File (and its cuts)', () => {
  assert.deepEqual(enabled(videoWithSound), ['video', 'audio', 'effects', 'transition', 'color', 'file'])
})

test('a title adds Title and has no Color: a grade does not reach glyphs', () => {
  const tabs = enabled(title)
  assert.ok(tabs.includes('title'))
  assert.ok(!tabs.includes('color'))
  assert.ok(!tabs.includes('audio'))
})

test('an audio clip shows only Audio, Effects and File', () => {
  assert.deepEqual(enabled(musicBed), ['audio', 'effects', 'file'])
})

test('tabs that do not apply are greyed with a reason, not removed — the row never shifts', () => {
  const tabs = inspectorTabs(musicBed)
  assert.equal(tabs.length, inspectorTabs(videoWithSound).length)
  for (const tab of tabs.filter((t) => !t.enabled)) assert.ok(tab.hint && tab.hint.length > 10, tab.value)
})

test('with nothing selected there is only the Timeline tab', () => {
  assert.deepEqual(enabled(none), ['timeline'])
})

test('the remembered tab is kept when it applies and falls back to the first that does', () => {
  assert.equal(chooseTab('color', inspectorTabs(videoWithSound)), 'color')
  // A music bed has no Color tab: the first enabled, Audio, is shown instead.
  assert.equal(chooseTab('color', inspectorTabs(musicBed)), 'audio')
  assert.equal(chooseTab('video', inspectorTabs(none)), 'timeline')
})

test('openSection("inspector.clip") lands on the tab that shows the clip name', () => {
  assert.equal(tabForSection('inspector.clip', videoWithSound), 'file')
  // A title's words live in its Clip section, which the Title tab shows.
  assert.equal(tabForSection('inspector.clip', title), 'title')
  assert.equal(tabForSection('inspector.retime', musicBed), 'audio')
  assert.equal(tabForSection('inspector.retime', videoWithSound), 'video')
  assert.equal(tabForSection('settings.agent', videoWithSound), null)
})
