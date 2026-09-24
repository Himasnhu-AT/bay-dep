/**
 * The agent-surface status line.
 *
 * The property under test is not "it returns a string" — it is that the **three states read as
 * three different kinds of sentence**, because the two that look alike from outside are exactly
 * the two this function exists to separate: a socket that never opened and a socket nobody has
 * connected to are both "nothing is happening". Conflating them is how a subsystem that never
 * worked survives as one nobody used.
 *
 * So each case asserts on *content the reader needs in order to act*: the failure must name the
 * reason, the idle case must name the socket path (that is what goes into an MCP client's
 * config), and the connected case must name the count. A test that only checked the three
 * differ would pass against three unhelpful strings.
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  dryRunRequest,
  findTool,
  publishedSchema,
  summariseAgentSurface,
  TOOLS,
  VALIDATE_ONLY,
  type AgentSurfaceStatus
} from './mcp'
import { validateArgs } from './validate'

const status = (patch: Partial<AgentSurfaceStatus>): AgentSurfaceStatus => ({
  ready: true,
  error: null,
  socketPath: '/Users/x/Library/Application Support/bay/bay-mcp.sock',
  connectionsSeen: 0,
  ...patch
})

test('a socket that did not open names the reason, so the line is actionable', () => {
  const line = summariseAgentSurface(
    status({ ready: false, error: 'socket path is 118 characters, over the 104 limit', socketPath: null })
  )
  assert.match(line, /over the 104 limit/, 'the reason must survive into the sentence')
  assert.match(line, /unavailable/)
})

test('a failure with no reason still says so rather than reading as fine', () => {
  const line = summariseAgentSurface(status({ ready: false, error: null, socketPath: null }))
  assert.match(line, /unavailable/)
  assert.match(line, /unknown/, 'a missing reason must be named as missing, not omitted')
})

test('ready with nothing connected names the socket path — the thing a user pastes into a client', () => {
  const line = summariseAgentSurface(status({ connectionsSeen: 0 }))
  assert.match(line, /ready/)
  assert.match(line, /bay-mcp\.sock/, 'the path is the only actionable part of the idle case')
})

test('a ready socket with no path does not print "null" at a user', () => {
  const line = summariseAgentSurface(status({ connectionsSeen: 0, socketPath: null }))
  assert.doesNotMatch(line, /null/)
})

test('one connection is singular, more than one is plural', () => {
  assert.match(summariseAgentSurface(status({ connectionsSeen: 1 })), /1 connection this session/)
  assert.match(summariseAgentSurface(status({ connectionsSeen: 4 })), /4 connections this session/)
})

test('the three states are three distinct sentences', () => {
  // The regression this guards is a refactor that collapses two branches — most simply, using
  // `ready` alone and dropping `connectionsSeen`, which is the boolean this status was widened
  // away from in the first place.
  const failed = summariseAgentSurface(status({ ready: false, error: 'no' }))
  const idle = summariseAgentSurface(status({ connectionsSeen: 0 }))
  const busy = summariseAgentSurface(status({ connectionsSeen: 2 }))
  assert.equal(new Set([failed, idle, busy]).size, 3)
})

// --- dry runs ------------------------------------------------------------------------------

test('every write tool either dry-runs or says why it cannot', () => {
  for (const spec of TOOLS.filter((t) => !t.readOnly)) {
    const answers = [
      spec.dryRunnable === true,
      spec.selfValidating === true,
      typeof spec.dryRunRefusal === 'string' && spec.dryRunRefusal.length > 0
    ].filter(Boolean).length
    assert.equal(answers, 1, `${spec.name} must carry exactly one of dryRunnable, selfValidating or dryRunRefusal`)
  }
  for (const spec of TOOLS.filter((t) => t.readOnly)) {
    assert.ok(!spec.dryRunnable, `${spec.name} only reads and has nothing to dry-run`)
    assert.ok(!spec.selfValidating, `${spec.name} only reads and has nothing to validate apart`)
  }
})

test('tools that reach outside the project are not dry-runnable', () => {
  // Written from the requirement, as a literal: each of these writes a file, starts a job or
  // registers a path with main, none of which a store restore can take back. Deriving this list
  // from the flag would assert nothing.
  for (const name of ['import_media', 'write_composition', 'add_template', 'export_timeline', 'generate_image', 'generate_video', 'track_generation']) {
    const spec = findTool(name)
    assert.ok(spec, `${name} is missing from the catalog`)
    assert.notEqual(spec.dryRunnable, true, `${name} has effects a dry run cannot undo`)
  }
  // Positive control: the surface is not simply refusing everything.
  assert.equal(findTool('remove_range')?.dryRunnable, true)
  assert.equal(findTool('edit_item')?.dryRunnable, true)
})

test('validateOnly is published exactly where the catalog allows it, and nowhere by hand', () => {
  for (const spec of TOOLS) {
    assert.ok(
      !(VALIDATE_ONLY in spec.inputSchema.properties),
      `${spec.name} spells validateOnly into its own schema; it must come from dryRunnable`
    )
    const published = publishedSchema(spec)
    assert.equal(VALIDATE_ONLY in published.properties, spec.dryRunnable === true || spec.selfValidating === true, spec.name)
    // And publishing does not mutate the catalog's own schema object.
    assert.ok(!(VALIDATE_ONLY in spec.inputSchema.properties), `${spec.name} was mutated`)
  }
})

test('the validator accepts validateOnly on a dry-runnable tool and names it elsewhere', () => {
  const dry = findTool('remove_range')!
  assert.equal(validateArgs(dry, { fromFrame: 0, toFrame: 10, validateOnly: true }), null)
  assert.match(
    validateArgs(dry, { fromFrame: 0, toFrame: 10, validateOnly: 'yes' }) ?? '',
    /"validateOnly" must be true or false/
  )
  const wet = findTool('export_timeline')!
  assert.match(
    validateArgs(wet, { outputPath: '/x.mp4', format: 'mp4', validateOnly: true }) ?? '',
    /has no argument "validateOnly"/
  )
})

test('dryRunRequest strips the flag for the handler and refuses with the reason', () => {
  const dry = findTool('remove_range')!
  assert.deepEqual(dryRunRequest(dry, { fromFrame: 0, toFrame: 10, validateOnly: true }), {
    mode: 'dry',
    args: { fromFrame: 0, toFrame: 10 }
  })
  // false is an ordinary call with the flag removed, so an approval made without it matches.
  assert.deepEqual(dryRunRequest(dry, { fromFrame: 0, toFrame: 10, validateOnly: false }), {
    mode: 'run',
    args: { fromFrame: 0, toFrame: 10 }
  })
  assert.deepEqual(dryRunRequest(dry, { fromFrame: 0 }), { mode: 'run', args: { fromFrame: 0 } })

  const wet = dryRunRequest(findTool('import_media')!, { paths: ['/a.mp4'], validateOnly: true })
  assert.equal(wet.mode, 'refused')
  const error = wet.mode === 'refused' ? wet.error : ''
  // The reason, and the way forward: which tools *can* be dry-run.
  assert.match(error, /import_media cannot be dry-run/)
  assert.match(error, /registers them with the app/)
  assert.match(error, /remove_range/)

  const read = dryRunRequest(findTool('read_project')!, { validateOnly: true })
  assert.equal(read.mode, 'refused')
  assert.match(read.mode === 'refused' ? read.error : '', /only reads/)
})

test('a self-validating tool receives validateOnly in its handler rather than a store dry run', () => {
  // generate_video's effect is a paid request on a provider: a store restore cannot undo it, so
  // the executor must not run the handler "for real" and roll back. The flag goes to the handler.
  const spec = findTool('generate_video')!
  assert.equal(spec.selfValidating, true)
  assert.notEqual(spec.dryRunnable, true)
  assert.deepEqual(dryRunRequest(spec, { model: 'veo-3.1-generate-preview', prompt: 'p', validateOnly: true }), {
    mode: 'run',
    args: { model: 'veo-3.1-generate-preview', prompt: 'p', validateOnly: true }
  })
  // false is an ordinary call with the flag removed, same as every other tool.
  assert.deepEqual(dryRunRequest(spec, { model: 'veo-3.1-generate-preview', prompt: 'p', validateOnly: false }), {
    mode: 'run',
    args: { model: 'veo-3.1-generate-preview', prompt: 'p' }
  })
  // The validator accepts the published flag; a tool that takes none still refuses it.
  assert.equal(validateArgs(spec, { model: 'veo-3.1-generate-preview', prompt: 'p', validateOnly: true }), null)
  assert.match(validateArgs(findTool('track_generation')!, { jobId: 'x', validateOnly: true }) ?? '', /has no argument "validateOnly"/)
  // And a refusal on another tool names it among the tools that take the flag.
  const wet = dryRunRequest(findTool('import_media')!, { paths: ['/a.mp4'], validateOnly: true })
  assert.match(wet.mode === 'refused' ? wet.error : '', /generate_video/)
})
