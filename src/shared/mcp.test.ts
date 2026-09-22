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
import { summariseAgentSurface, type AgentSurfaceStatus } from './mcp'

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
