/**
 * The AI layout's tool palette follows the footage: a podcast's project offers the podcast
 * actions first, each filling the composer with its prompt; a project that is not clearly any
 * kind offers the skills alone, as before.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Asset } from '@shared/project'
import { FOOTAGE_MODES } from '@shared/footage-mode'
import { AGENT_STARTERS, footagePalette } from './agentStarters'

const media = (id: string, kind: 'video' | 'audio', seconds: number): Asset => ({
  id, kind, name: id, path: `/rec/${id}`, durationUs: seconds * 1_000_000,
  width: kind === 'video' ? 1920 : null, height: kind === 'video' ? 1080 : null, fps: kind === 'video' ? 30 : null,
  hasAudio: true, hasVideo: kind === 'video', posterPath: null, waveformPath: null, createdAt: 0
})

test('a podcast project puts the podcast actions first, each drafting its prompt', () => {
  const palette = footagePalette([media('camA', 'video', 3600), media('camB', 'video', 3601), media('mic1', 'audio', 3600)])
  const podcast = FOOTAGE_MODES.podcast.actions
  assert.deepEqual(palette.slice(0, podcast.length).map((s) => s.title), podcast.map((a) => a.label))
  assert.deepEqual(palette.slice(0, podcast.length).map((s) => s.draft), podcast.map((a) => a.prompt))
  assert.equal(palette[0]!.skill, 'podcast', 'the leading /slug is the starter\'s skill')
  // Every skill is still there after them, and no two buttons share a key.
  assert.deepEqual(palette.slice(podcast.length), AGENT_STARTERS)
  const keys = palette.map((s) => s.id ?? s.skill)
  assert.equal(new Set(keys).size, keys.length)
})

test('an empty or unclear project keeps the skills alone', () => {
  assert.equal(footagePalette([]), AGENT_STARTERS)
  assert.equal(footagePalette([media('a', 'video', 200), media('b', 'video', 150)]), AGENT_STARTERS)
})
