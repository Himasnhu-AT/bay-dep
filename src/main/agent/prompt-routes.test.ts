/**
 * The system prompt and the guides point at things by name — a guide by `bay://` uri, a tool by
 * its snake_case name — and nothing else checks either name is real. A route to a guide bay
 * does not serve reads as empty, and the agent concludes bay has nothing to say; a tool the
 * prompt names that the catalog lacks is a call the agent will make in front of the user and
 * have refused. Both are checked here against the catalog this build serves.
 *
 * The guide bodies are inlined into the bundle with `?raw`, which plain Node cannot load, so
 * the files are found through `resources.ts`'s own import lines rather than a second list.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { AGENT_SYSTEM_PROMPT, agentSystemPrompt, GUIDE_ROUTES, RESOLVE_SECTION, SKILLS_SECTION, skillsSection } from './prompt'
import { RESOLVE_ALLOWED_TOOLS, RESOLVE_TOOLS } from '@shared/resolve-tools'
import { BAY_SKILLS } from '@shared/skills'
import { findResource } from '@shared/resources'
import { TOOLS } from '@shared/mcp'

const DOCS_ROOT = join('src', 'main', 'mcp')

/** bay's own guides (not the carried HyperFrames set), by uri, read from the files bundled. */
function ownGuides(): { uri: string; path: string; body: string }[] {
  const source = readFileSync(join(DOCS_ROOT, 'resources.ts'), 'utf8')
  const files = new Map<string, string>()
  for (const [, name, file] of source.matchAll(/^import (\w+) from '\.\/(docs\/[\w-]+\.md)\?raw'$/gm)) {
    files.set(name!, file!)
  }
  const guides: { uri: string; path: string; body: string }[] = []
  for (const [, uri, name] of source.matchAll(/^\s+'(bay:\/\/guide\/[\w/-]+)': (\w+),$/gm)) {
    const file = files.get(name!)
    if (!file) continue
    const path = join(DOCS_ROOT, file)
    guides.push({ uri: uri!, path, body: readFileSync(path, 'utf8') })
  }
  return guides
}

function guideUris(text: string): string[] {
  return [...text.matchAll(/bay:\/\/guide\/[a-z0-9/-]*[a-z0-9]/g)].map((m) => m[0])
}

/** Every `snake_case` name in backticks: the way the prompt and the guides name a tool. */
function backtickedToolNames(text: string): string[] {
  return [...text.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)].map((m) => m[1]!)
}

const TOOL_NAMES = new Set(TOOLS.map((tool) => tool.name))

function unknownTools(text: string): string[] {
  return backtickedToolNames(text).filter((name) => !TOOL_NAMES.has(name))
}

function unknownGuides(text: string): string[] {
  return guideUris(text).filter((uri) => !findResource(uri))
}

test('the guide files are found, so the checks below have something to read', () => {
  const guides = ownGuides()
  const uris = guides.map((g) => g.uri)
  // Specimens: a guide that predates this test and one of the new format playbooks. If the
  // import-line parse broke, both would be missing and every check below would pass on nothing.
  for (const uri of ['bay://guide/editing', 'bay://guide/review', 'bay://guide/format/talking-head', 'bay://guide/generation']) {
    assert.ok(uris.includes(uri), `${uri} not found among ${uris.join(', ')}`)
  }
  assert.ok(guides.length >= 10, `only ${guides.length} guide files found`)
})

test('every guide the routing table names is served', () => {
  assert.ok(GUIDE_ROUTES.length >= 10)
  for (const route of GUIDE_ROUTES) {
    assert.ok(findResource(route.uri), `route "${route.when}" points at ${route.uri}, which bay does not serve`)
  }
})

test('the routing table is in the prompt, row by row', () => {
  for (const route of GUIDE_ROUTES) {
    assert.ok(AGENT_SYSTEM_PROMPT.includes(route.uri), `${route.uri} missing from the rendered prompt`)
  }
})

test('every bay://guide uri in the prompt, the skills and the guides resolves', () => {
  const sources: [string, string][] = [
    ['the system prompt', AGENT_SYSTEM_PROMPT],
    ...BAY_SKILLS.map((skill): [string, string] => [`skill ${skill.slug}`, skill.body]),
    ...ownGuides().map((g): [string, string] => [g.path, g.body])
  ]
  let seen = 0
  for (const [where, text] of sources) {
    seen += guideUris(text).length
    assert.deepEqual(unknownGuides(text), [], `${where} names a guide bay does not serve`)
  }
  assert.ok(seen >= 15, `only ${seen} guide references found — is the pattern still matching?`)
})

test('every backticked tool name in the prompt and the guides is a real tool', () => {
  const sources: [string, string][] = [
    ['the system prompt', AGENT_SYSTEM_PROMPT],
    ...ownGuides().map((g): [string, string] => [g.path, g.body])
  ]
  let seen = 0
  for (const [where, text] of sources) {
    seen += backtickedToolNames(text).length
    assert.deepEqual(unknownTools(text), [], `${where} names a tool that is not in the catalog`)
  }
  assert.ok(seen >= 50, `only ${seen} tool names found — is the pattern still matching?`)
})

test('the checks catch a bogus tool and a bogus guide (the proof they can fail)', () => {
  // The same functions the tests above use, on the real prompt with one name spoiled.
  assert.ok(AGENT_SYSTEM_PROMPT.includes('`frame_grid`'), 'specimen: the prompt must name frame_grid')
  const spoiled = AGENT_SYSTEM_PROMPT.replace('`frame_grid`', '`frame_grids_now`')
  assert.notEqual(spoiled, AGENT_SYSTEM_PROMPT, 'the spoiling replacement must land')
  assert.deepEqual(unknownTools(spoiled), ['frame_grids_now'])
  assert.deepEqual(unknownTools(AGENT_SYSTEM_PROMPT), [])

  const badGuide = AGENT_SYSTEM_PROMPT.replace('bay://guide/review', 'bay://guide/reveiw')
  assert.notEqual(badGuide, AGENT_SYSTEM_PROMPT)
  assert.deepEqual(unknownGuides(badGuide), ['bay://guide/reveiw'])
})

test('the skills paragraph is one block, in the prompt once', () => {
  // Another runtime words skill loading differently; it replaces this block and nothing else.
  assert.equal(AGENT_SYSTEM_PROMPT.split(SKILLS_SECTION).length, 2)
  assert.equal(AGENT_SYSTEM_PROMPT.match(/Skill\s+tool/g)?.length, 1)
  for (const skill of BAY_SKILLS) assert.ok(SKILLS_SECTION.includes(`\`${skill.slug}\``), skill.slug)
})

test('the Claude agent loads the skills a task needs; Codex, which cannot, asks for them', () => {
  // A skill that only loads when the user types its name is a skill most users never get: the
  // launch-film brief that needed it named /motion-graphics instead. Written from that miss.
  assert.match(SKILLS_SECTION, /whenever the task matches its description/)
  assert.match(SKILLS_SECTION, /does not have to name it/)
  for (const skill of BAY_SKILLS) assert.ok(SKILLS_SECTION.includes(skill.description), `${skill.slug} description`)
  const codex = skillsSection('codex')
  assert.doesNotMatch(codex, /whenever the task matches its description/)
  assert.match(codex, /cannot load a skill/)
})

test('the prompt keeps its standing sections', () => {
  for (const heading of ['## How to work', '## Money', '## When something fails', '## Done means watched', '## Review comments', '## Which guide to read', '## Skills', '## Talking to them']) {
    assert.ok(AGENT_SYSTEM_PROMPT.includes(heading), `${heading} missing`)
  }
  // The money rule: a dry run for the estimate, then the user's go-ahead.
  assert.match(AGENT_SYSTEM_PROMPT, /validateOnly: true/)
  assert.match(AGENT_SYSTEM_PROMPT, /go-ahead/)
})

// --- a project edited in DaVinci Resolve ------------------------------------------------------

const RESOLVE_PROMPT = agentSystemPrompt('claude', 'resolve')

/** Every single-backticked word in a text: tools, actions and arguments alike. */
function backticked(text: string): string[] {
  return [...text.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]!)
}

/**
 * The connector's actions and arguments the Resolve section names, each read from the
 * connector's own source (`src/server.py`, 2.103.3). Anything backticked there that is not a
 * bay tool, a connector tool or one of these is a name nobody checked.
 */
const RESOLVE_ACTIONS_AND_ARGUMENTS = new Set([
  'resolve', 'action', 'params', 'list', 'get_items', 'probe_timeline_structure', 'project_summary', 'capture',
  'safe_import_media', 'set_current', 'timeline_name', 'save', 'create_timeline_from_clips', 'clip_infos',
  'end_frame', 'record_frame', 'plan_silence_ripple', 'execute_silence_ripple', 'apply_cuts', 'get_clip_property',
  'FPS', 'add_keyframe', 'runtime_mode', 'topics', 'get', 'api_truth'
])

test('a bay project’s prompt is the prompt it had: the host defaults to bay and adds nothing', () => {
  assert.equal(agentSystemPrompt('claude'), AGENT_SYSTEM_PROMPT)
  assert.equal(agentSystemPrompt('claude', 'bay'), AGENT_SYSTEM_PROMPT)
  assert.equal(agentSystemPrompt('codex', 'bay'), agentSystemPrompt('codex'))
  // Nothing of Resolve reaches a bay project, where its tools do not exist.
  for (const prompt of [AGENT_SYSTEM_PROMPT, agentSystemPrompt('codex')]) {
    assert.doesNotMatch(prompt, /DaVinci/)
    assert.doesNotMatch(prompt, /`resolve` tools/)
    assert.equal(prompt.includes(RESOLVE_SECTION), false)
  }
  assert.match(AGENT_SYSTEM_PROMPT, /^You are editing video inside bay, alongside the person using it\./)
  assert.match(AGENT_SYSTEM_PROMPT, /lands on their undo stack as one step/)
})

test('a Resolve project’s prompt says where the edit lives, once, and keeps the standing sections', () => {
  assert.notEqual(RESOLVE_PROMPT, AGENT_SYSTEM_PROMPT)
  assert.equal(RESOLVE_PROMPT.split(RESOLVE_SECTION).length, 2)
  assert.match(RESOLVE_PROMPT, /^You are editing video in DaVinci Resolve/)
  for (const heading of ['## This project is edited in DaVinci Resolve', '## How to work', '## Money', '## When something fails', '## Which guide to read', '## Skills', '## Talking to them']) {
    assert.ok(RESOLVE_PROMPT.includes(heading), `${heading} missing`)
  }
  assert.ok(RESOLVE_PROMPT.includes(SKILLS_SECTION))
  assert.ok(agentSystemPrompt('codex', 'resolve').includes(skillsSection('codex')))
  // What is true of bay's editor and false of Resolve is not said: no undo step, no Revert.
  assert.doesNotMatch(RESOLVE_PROMPT, /lands on their undo stack/)
  assert.doesNotMatch(RESOLVE_PROMPT, /a wrong edit costs them one click/)
  assert.match(RESOLVE_PROMPT, /has no Revert for it/)
})

test('the Resolve section carries the rules that cost real edits', () => {
  // bay's timeline tools are not what the user sees.
  assert.match(RESOLVE_SECTION, /never make the edit with them/)
  // The call that deletes whole items and reports success.
  assert.match(RESOLVE_SECTION, /Never call `timeline` `apply_cuts`/)
  assert.match(RESOLVE_SECTION, /`end_frame` exclusive/)
  assert.match(RESOLVE_SECTION, /Never rely on\s+"the current timeline"/)
  assert.match(RESOLVE_SECTION, /Read every write back/)
  assert.match(RESOLVE_SECTION, /`project_manager` `save`/)
  assert.match(RESOLVE_SECTION, /`get_clip_property` for\s+`FPS`/)
  assert.match(RESOLVE_SECTION, /`timeline_item` `add_keyframe` does not exist/)
  // The exact step when Resolve is not reachable.
  assert.match(RESOLVE_SECTION, /Workspace › Scripts › resolve_bridge/)
})

test('every name the Resolve prompt backticks is a bay tool, a tool the agent has, or a checked action', () => {
  const connector = new Set(RESOLVE_TOOLS.map((tool) => tool.name))
  const allowed = new Set(RESOLVE_ALLOWED_TOOLS)
  const names = backticked(RESOLVE_SECTION)
  assert.ok(names.length >= 40, `only ${names.length} names found — is the pattern still matching?`)
  const unknown = names.filter((name) => !TOOL_NAMES.has(name) && !connector.has(name) && !RESOLVE_ACTIONS_AND_ARGUMENTS.has(name))
  assert.deepEqual(unknown, [])
  // A tool the agent is told to call must be one it has: naming a withheld one is a call made
  // in front of the user and denied.
  const withheldNamed = names.filter((name) => connector.has(name) && !allowed.has(name))
  assert.deepEqual(withheldNamed, [])
  // Specimens, so the two checks above are known to be looking at something.
  for (const name of ['timeline', 'media_pool', 'project_manager', 'edit_engine', 'transcribe', 'search_footage']) {
    assert.ok(names.includes(name), `the section must name ${name}`)
  }
  // And the proof they can fail: a withheld tool and a misspelt bay tool, put in.
  const spoiled = RESOLVE_SECTION.replace('`edit_engine`', '`script_plugin`').replace('`transcribe`', '`transcribe_it`')
  assert.notEqual(spoiled, RESOLVE_SECTION)
  const spoiledNames = backticked(spoiled)
  assert.deepEqual(spoiledNames.filter((name) => connector.has(name) && !allowed.has(name)), ['script_plugin'])
  assert.deepEqual(
    spoiledNames.filter((name) => !TOOL_NAMES.has(name) && !connector.has(name) && !RESOLVE_ACTIONS_AND_ARGUMENTS.has(name)),
    ['transcribe_it']
  )
})

test('the whole Resolve prompt names no bay tool that does not exist', () => {
  // The same check the bay prompt gets, on what is shared: the Resolve section is taken out
  // because its snake_case names are the connector's, checked above.
  const shared = RESOLVE_PROMPT.replace(RESOLVE_SECTION, '')
  assert.notEqual(shared, RESOLVE_PROMPT)
  const connector = new Set(RESOLVE_TOOLS.map((tool) => tool.name))
  const unknown = unknownTools(shared).filter((name) => !connector.has(name) && !RESOLVE_ACTIONS_AND_ARGUMENTS.has(name))
  assert.deepEqual(unknown, [])
  assert.deepEqual(unknownGuides(RESOLVE_PROMPT), [])
})
