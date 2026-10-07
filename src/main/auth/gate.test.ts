/**
 * The gate in main: a locked bay refuses the editor's IPC and every MCP tool call, and says how to
 * unlock. The socket case runs over the real socket server with the same wrapper `mcp/server.ts`
 * uses, so what is asserted is what a client on `bay-mcp.sock` would read.
 *
 *   node --import ./src/test-hooks.mjs --test src/main/auth/gate.test.ts
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { IPC } from '@shared/ipc'
import { lockedMessage, type AccessStatus } from '@shared/access'
import { OPEN_WHILE_LOCKED, gateToolRunner, refuseChannel } from './gate'
import { startSocketServer } from '../mcp/socket-server'
import { LineBuffer, encode } from '../mcp/jsonrpc'
import type { RunTool, ToolOutcome } from '../mcp/protocol'

const LOCKED: AccessStatus[] = [
  { state: 'signed-out' },
  { state: 'waiting', url: 'https://bay.himanshuat.com/desktop/sign-in?port=1&state=x', expiresAt: 0 },
  { state: 'checking', email: null },
  { state: 'no-access', email: 'a@example.com', reason: 'unverified-email' },
  { state: 'locked-offline', email: 'a@example.com', lastVerifiedAt: 0 },
  { state: 'revoked', email: 'a@example.com', code: 'USER_DISABLED' },
  { state: 'error', message: 'The browser sign-in was not finished within 5 minutes.' }
]
const ENTITLED: AccessStatus = {
  state: 'entitled',
  email: 'a@example.com',
  lastVerifiedAt: 0,
  lockAt: 1,
  offline: false,
  persisted: true,
  bypass: false
}

test('every locked state refuses the editor channels, with how to unlock', () => {
  for (const status of LOCKED) {
    for (const channel of ['projectOpen', 'projectCreate', 'agentStart', 'agentSend', 'exportStart', 'mediaImportPaths']) {
      const refusal = refuseChannel(channel, status)
      assert.ok(refusal, `${status.state} must refuse ${channel}`)
      assert.match(refusal, /bay is locked/)
      assert.match(refusal, /sign in/i)
      assert.match(refusal, /Nothing was changed/)
    }
  }
})

test('positive controls: entitled opens everything; locked still opens the access screen\'s channels', () => {
  for (const channel of Object.keys(IPC)) assert.equal(refuseChannel(channel, ENTITLED), null, channel)
  for (const status of LOCKED) {
    for (const channel of ['accessStatus', 'accessSignIn', 'accessSignOut', 'windowClose']) {
      assert.equal(refuseChannel(channel, status), null, `${status.state} ${channel}`)
    }
  }
})

test('locked, the telemetry notice can still read and turn the switches — bay sends from launch, before sign-in', () => {
  for (const status of LOCKED) {
    for (const channel of ['telemetryStatus', 'telemetrySet', 'telemetryDismissNotice']) {
      assert.equal(refuseChannel(channel, status), null, `${status.state} ${channel}`)
    }
    // Negative control beside it: the neighbouring editor channels stay refused, with how to unlock.
    for (const channel of ['projectSave', 'exportStart', 'agentStart']) {
      const refusal = refuseChannel(channel, status)
      assert.ok(refusal && refusal === lockedMessage(status), `${status.state} ${channel}: ${refusal}`)
    }
  }
})

test('the open-while-locked list names real channels and nothing that edits or reads projects', () => {
  for (const channel of OPEN_WHILE_LOCKED) assert.ok(channel in IPC, `${channel} is not an IPC channel`)
  const open = [...OPEN_WHILE_LOCKED]
  // The one named exception: the autosave sidecar, so losing access mid-session cannot throw away
  // unsaved work. It writes crash recovery only — never a project file, never a dialog — and the
  // test below pairs it with projectSave/projectSaveAs staying refused.
  assert.deepEqual(
    open.filter((c) => /^(project|media|composition|export|agent|whisper|mcp)/.test(c) && c !== 'projectAutosave'),
    []
  )
})

// -- over the real socket -------------------------------------------------------------------

function callOverSocket(path: string, tool: string): Promise<{ isError: boolean; text: string }> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(path)
    const buffer = new LineBuffer()
    socket.setEncoding('utf8')
    socket.on('error', reject)
    socket.on('data', (chunk: string) => {
      for (const line of buffer.push(chunk)) {
        const answer = JSON.parse(line) as { result: { isError: boolean; content: { text: string }[] } }
        socket.end()
        resolve({ isError: answer.result.isError, text: answer.result.content[0]?.text ?? '' })
      }
    })
    socket.write(encode({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: {} } } as never))
  })
}

test('a locked bay answers a socket tool call with the unlock message and never runs it', { timeout: 10_000 }, async () => {
  let status: AccessStatus = { state: 'locked-offline', email: 'a@example.com', lastVerifiedAt: 0 }
  const ran: string[] = []
  const inner: RunTool = async (tool) => {
    ran.push(tool)
    return { ok: true, value: `ran ${tool}` }
  }
  const socketPath = join(mkdtempSync(join(tmpdir(), 'bay-gate-')), 'g.sock')
  const running = await startSocketServer(
    () => socketPath,
    gateToolRunner(inner, () => status, (message): ToolOutcome => ({ ok: false, value: message })),
    () => null
  )
  try {
    assert.equal(running.status.ready, true)
    const refused = await callOverSocket(socketPath, 'read_project')
    assert.equal(refused.isError, true)
    assert.match(refused.text, /bay is locked/)
    assert.match(refused.text, /14 days/)
    assert.match(refused.text, /open the bay window and sign in/)
    assert.deepEqual(ran, [], 'a locked call must not reach the renderer')

    // Positive control: the same socket, entitled, runs the tool.
    status = ENTITLED
    const allowed = await callOverSocket(socketPath, 'read_project')
    assert.equal(allowed.isError, false)
    assert.equal(allowed.text, 'ran read_project')
    assert.deepEqual(ran, ['read_project'])
  } finally {
    await running.close()
  }
})

test('losing access mid-session keeps the work: the autosave sidecar is writable while locked, a real save is not', () => {
  // The renderer writes the open project to its crash-recovery sidecar the moment access is lost;
  // refusing that call is what threw unsaved edits away. The pair: saving over or beside the
  // project file stays refused, so the exception opens nothing a locked user could edit with.
  for (const status of LOCKED) {
    assert.equal(refuseChannel('projectAutosave', status), null, `${status.state} must allow projectAutosave`)
    assert.ok(refuseChannel('projectSave', status), `${status.state} must refuse projectSave`)
    assert.ok(refuseChannel('projectSaveAs', status), `${status.state} must refuse projectSaveAs`)
  }
})

test('a locked bay can still update itself, and the update channels open nothing else', () => {
  // An update is how a build that cannot sign in gets fixed, so checking, downloading and
  // restarting into one must work while locked.
  const update = ['updateStatus', 'updateCheck', 'updateDownload', 'updateInstall']
  for (const status of LOCKED) {
    for (const channel of update) assert.equal(refuseChannel(channel, status), null, `${status.state} must allow ${channel}`)
    // The pair: the channels a restart could be confused with stay refused. Saving the project
    // file is not an update step (a locked renderer writes the autosave sidecar only).
    for (const channel of ['projectSave', 'projectSaveAs', 'projectOpen', 'exportStart']) {
      assert.ok(refuseChannel(channel, status), `${status.state} must still refuse ${channel}`)
    }
  }
  for (const channel of update) assert.ok(channel in IPC, `${channel} is an IPC channel`)
})
