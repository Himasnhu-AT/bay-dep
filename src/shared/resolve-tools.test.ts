/**
 * Which Resolve connector tools the in-app agent has — held as literals, because the list is a
 * security decision and a test that read it back from `RESOLVE_TOOLS` would agree with any edit.
 * Moving a tool between the two lists below is the decision; the test makes it a deliberate one.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { RESOLVE_ALLOWED_TOOLS, RESOLVE_TOOLS, RESOLVE_WITHHELD_TOOLS, resolveAllowedToolNames } from './resolve-tools'

/** Runs code, installs something Resolve runs, lists the disk, reaches the network, or is app-wide. */
const WITHHELD = [
  'script_plugin',
  'fuse_plugin',
  'dctl',
  'fusion_comp',
  'timeline_item_fusion',
  'media_storage',
  'layout_presets',
  'render_presets',
  'project_manager_cloud',
  'project_manager_database',
  'setup'
]

const ALLOWED = [
  'resolve_control',
  'project_manager',
  'project_manager_folders',
  'project_settings',
  'render',
  'media_pool',
  'folder',
  'media_pool_item',
  'media_pool_item_markers',
  'media_analysis',
  'timeline_versioning',
  'edit_engine',
  'timeline',
  'timeline_markers',
  'timeline_frame',
  'timeline_ai',
  'timeline_item',
  'timeline_item_markers',
  'timeline_item_color',
  'timeline_item_takes',
  'gallery',
  'gallery_stills',
  'graph',
  'color_group',
  'knowledge'
]

test('all 36 connector tools are decided, each once', () => {
  const names = RESOLVE_TOOLS.map((tool) => tool.name)
  assert.equal(names.length, 36)
  assert.equal(new Set(names).size, 36, 'a tool listed twice could be both allowed and withheld')
  assert.deepEqual([...names].sort(), [...ALLOWED, ...WITHHELD].sort())
})

test('the tools that run code or install plugins are withheld, and the editing tools are not', () => {
  assert.deepEqual([...RESOLVE_ALLOWED_TOOLS].sort(), [...ALLOWED].sort())
  assert.deepEqual(RESOLVE_WITHHELD_TOOLS.map((tool) => tool.name).sort(), [...WITHHELD].sort())
  // The ones a prompt injection would reach for first, by name, beside the nearest tools that
  // must stay: a list that withheld everything would pass the first half alone.
  for (const name of ['script_plugin', 'fuse_plugin', 'dctl', 'fusion_comp']) {
    assert.equal(RESOLVE_ALLOWED_TOOLS.includes(name), false, `${name} must not be allowed`)
  }
  for (const name of ['timeline', 'media_pool', 'timeline_item', 'project_manager']) {
    assert.ok(RESOLVE_ALLOWED_TOOLS.includes(name), `${name} must be allowed`)
  }
})

test('every withheld tool says why, and every tool says what it reaches', () => {
  for (const tool of RESOLVE_TOOLS) {
    assert.ok(tool.reach.length > 10, `${tool.name} has no reach`)
    if (!tool.allowed) assert.ok((tool.withheld ?? '').length > 10, `${tool.name} is withheld without a reason`)
  }
})

test('the allow-list is exact names under the server, never the server alone', () => {
  const names = resolveAllowedToolNames('resolve')
  assert.deepEqual(names, RESOLVE_ALLOWED_TOOLS.map((tool) => `mcp__resolve__${tool}`))
  assert.ok(names.includes('mcp__resolve__timeline'))
  assert.equal(names.includes('mcp__resolve__script_plugin'), false)
  // `mcp__resolve` is every tool the server publishes, withheld ones included; a wildcard is the
  // same thing spelt differently.
  for (const name of names) {
    assert.match(name, /^mcp__resolve__[a-z_]+$/, `${name} is not one exact tool name`)
  }
  assert.equal(names.includes('mcp__resolve'), false)
  // The prefix follows the name the server is given, so the two cannot drift apart.
  assert.ok(resolveAllowedToolNames('davinci').every((name) => name.startsWith('mcp__davinci__')))
})
