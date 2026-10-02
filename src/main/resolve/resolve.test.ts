import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { resolveStatusMessage } from '@shared/host'
import {
  connectorCandidates,
  connectorEntry,
  connectorEnv,
  locateConnector,
  setupCommand
} from './connector'
import {
  bridgeScriptPath,
  decideStatus,
  editionOf,
  parseProbeOutput,
  PROBE_MARKER,
  PROBE_SCRIPT,
  runProbe,
  type StatusFacts
} from './status'

// ── Locating the connector ──────────────────────────────────────────────────────────────────

const PLACES = { envDir: '/env', userDataDir: '/data/resolve-mcp', repoDir: '/repo/vendor/x' }

function setUp(...dirs: string[]): (path: string) => boolean {
  const present = new Set(dirs.flatMap((d) => [`${d}/src/server.py`, `${d}/venv/bin/python`]))
  return (path) => present.has(path)
}

test('the connector is searched for in the env folder, then userData, then the checkout', () => {
  assert.deepEqual(connectorCandidates(PLACES), ['/env', '/data/resolve-mcp', '/repo/vendor/x'])
  // All three set up: the env folder wins. Without it, userData; without that, the checkout.
  const all = setUp('/env', '/data/resolve-mcp', '/repo/vendor/x')
  assert.equal(locateConnector(PLACES, all)?.dir, '/env')
  assert.equal(
    locateConnector(PLACES, setUp('/data/resolve-mcp', '/repo/vendor/x'))?.dir,
    '/data/resolve-mcp'
  )
  assert.equal(locateConnector(PLACES, setUp('/repo/vendor/x'))?.dir, '/repo/vendor/x')
})

test('a packaged build, which passes no checkout folder, never looks in one', () => {
  const packaged = { userDataDir: '/data/resolve-mcp' }
  assert.deepEqual(connectorCandidates(packaged), ['/data/resolve-mcp'])
  assert.equal(locateConnector(packaged, setUp('/repo/vendor/x')), null)
  // The nearest legal case: the same folder set up is found.
  assert.equal(locateConnector(packaged, setUp('/data/resolve-mcp'))?.dir, '/data/resolve-mcp')
})

test('a clone without its venv, or a venv without the server, is not set up', () => {
  const only = { userDataDir: '/data/resolve-mcp' }
  const cloneOnly = (path: string): boolean => path === '/data/resolve-mcp/src/server.py'
  const venvOnly = (path: string): boolean => path === '/data/resolve-mcp/venv/bin/python'
  assert.equal(locateConnector(only, cloneOnly), null)
  assert.equal(locateConnector(only, venvOnly), null)
  assert.notEqual(locateConnector(only, setUp('/data/resolve-mcp')), null)
})

test('a half-made env folder is passed over for a complete one further down', () => {
  const exists = (path: string): boolean =>
    path === '/env/src/server.py' || setUp('/data/resolve-mcp')(path)
  assert.equal(locateConnector(PLACES, exists)?.dir, '/data/resolve-mcp')
})

test('the entry runs the compound server with the venv python and switches its network use off', () => {
  const connector = locateConnector(PLACES, setUp('/env'))
  assert.ok(connector)
  const entry = connectorEntry(connector)
  assert.equal(entry.command, '/env/venv/bin/python')
  assert.deepEqual(entry.args, ['/env/src/server.py'])
  assert.ok(!entry.args.includes('--full'))
  // The literal names the connector reads (src/utils/update_check.py): a rename here would
  // quietly turn its GitHub request back on.
  assert.equal(entry.env.DAVINCI_RESOLVE_MCP_UPDATE_CHECK, '0')
  assert.equal(entry.env.DAVINCI_RESOLVE_MCP_UPDATE_MODE, 'never')
  assert.equal(
    entry.env.RESOLVE_SCRIPT_API,
    '/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Scripting'
  )
  assert.equal(
    entry.env.RESOLVE_SCRIPT_LIB,
    '/Applications/DaVinci Resolve/DaVinci Resolve.app/Contents/Libraries/Fusion/fusionscript.so'
  )
  assert.equal(entry.env.PYTHONPATH, `${entry.env.RESOLVE_SCRIPT_API}/Modules`)
  // Forcing the bridge would stop Studio's outside scripting being tried at all.
  assert.ok(!('DAVINCI_RESOLVE_BRIDGE' in entry.env))
  assert.deepEqual(entry.env, connectorEnv())
})

test('the setup command names the folder when there is one', () => {
  assert.equal(setupCommand(), 'script/setup-resolve-mcp.sh')
  assert.equal(setupCommand('/a b/resolve-mcp'), 'script/setup-resolve-mcp.sh --dir "/a b/resolve-mcp"')
})

// ── Deciding the status ─────────────────────────────────────────────────────────────────────

const READY: StatusFacts = {
  installed: true,
  version: '21.0.4',
  located: true,
  running: true,
  probe: {
    report: {
      connected: true,
      product: 'DaVinci Resolve',
      version: '21.0.4.5',
      projectName: 'Reel',
      transport: 'bridge'
    }
  },
  bridgeInstalled: true,
  setup: 'script/setup-resolve-mcp.sh'
}

test('every fact in place is ready, with what Resolve said about itself', () => {
  assert.deepEqual(decideStatus(READY), {
    state: 'ready',
    version: '21.0.4.5',
    edition: 'free',
    projectName: 'Reel'
  })
  assert.equal(
    resolveStatusMessage(decideStatus(READY)),
    'Connected to Resolve 21.0.4.5 (free) — project “Reel”.'
  )
})

test('each missing fact is its own state, in the order a person would fix them', () => {
  // Each line removes one fact from the ready case, which is the positive control above.
  assert.deepEqual(decideStatus({ ...READY, installed: false }), { state: 'not-installed' })
  assert.deepEqual(decideStatus({ ...READY, located: false }), {
    state: 'not-set-up',
    version: '21.0.4',
    setup: 'script/setup-resolve-mcp.sh'
  })
  assert.deepEqual(decideStatus({ ...READY, running: false }), {
    state: 'not-running',
    version: '21.0.4'
  })
  // Nothing at all: the first thing to fix is the install, not the connector.
  assert.equal(
    decideStatus({ ...READY, installed: false, located: false, running: false, probe: null }).state,
    'not-installed'
  )
  assert.equal(decideStatus({ ...READY, located: false, running: false }).state, 'not-set-up')
})

test('a running Resolve the probe could not reach needs the bridge, and says whether it is installed', () => {
  const refused = { report: { connected: false, error: 'no Resolve object' } }
  const installed = decideStatus({ ...READY, probe: refused })
  assert.deepEqual(installed, {
    state: 'bridge-needed',
    version: '21.0.4',
    bridgeInstalled: true,
    setup: 'script/setup-resolve-mcp.sh',
    detail: 'no Resolve object'
  })
  const missing = decideStatus({ ...READY, probe: refused, bridgeInstalled: false })
  assert.equal(missing.bridgeInstalled, false)
  // The two read differently, which is why the field exists.
  assert.notEqual(resolveStatusMessage(installed), resolveStatusMessage(missing))
  assert.match(resolveStatusMessage(missing), /not installed in it/)
  assert.match(resolveStatusMessage(installed), /Workspace › Scripts › resolve_bridge/)
})

test('a probe that hung or died is bridge-needed with its reason, never ready', () => {
  const hung = decideStatus({ ...READY, probe: { failed: 'Resolve did not answer within 10 seconds.' } })
  assert.equal(hung.state, 'bridge-needed')
  assert.equal(hung.detail, 'Resolve did not answer within 10 seconds.')
  const untried = decideStatus({ ...READY, probe: null })
  assert.equal(untried.state, 'bridge-needed')
  assert.equal(untried.detail, 'The connection to Resolve was not tried.')
})

test('ready without an open project, and with one that could not be read', () => {
  const report = { connected: true, product: 'DaVinci Resolve Studio', version: '20.1' }
  const none = decideStatus({ ...READY, probe: { report } })
  assert.deepEqual(none, { state: 'ready', version: '20.1', edition: 'studio' })
  assert.match(resolveStatusMessage(none), /No project is open there yet/)
  const unread = decideStatus({ ...READY, probe: { report: { ...report, error: 'boom' } } })
  assert.equal(unread.state, 'ready')
  assert.equal(unread.detail, 'boom')
  // No version from Resolve: the app bundle's stands in.
  const bare = decideStatus({ ...READY, probe: { report: { connected: true } } })
  assert.deepEqual(bare, { state: 'ready', version: '21.0.4' })
})

test('the edition is read from the product name, and an unknown name is not guessed', () => {
  assert.equal(editionOf('DaVinci Resolve'), 'free')
  assert.equal(editionOf('DaVinci Resolve Studio'), 'studio')
  assert.equal(editionOf('Fusion'), undefined)
  assert.equal(editionOf(undefined), undefined)
})

// ── The probe's answer ──────────────────────────────────────────────────────────────────────

test('the probe answer is the last marked line, whatever else was printed', () => {
  const noise = `fusionscript says hello\n${PROBE_MARKER}{"connected": false}\nmore\n`
  assert.deepEqual(parseProbeOutput(noise), {
    connected: false,
    product: undefined,
    version: undefined,
    projectName: undefined,
    transport: undefined,
    error: undefined
  })
  const two = `${PROBE_MARKER}{"connected": false}\n${PROBE_MARKER}{"connected": true, "product": "DaVinci Resolve", "version": "21.0.4.5", "projectName": " Reel ", "transport": "bridge"}\n`
  assert.deepEqual(parseProbeOutput(two), {
    connected: true,
    product: 'DaVinci Resolve',
    version: '21.0.4.5',
    projectName: 'Reel',
    transport: 'bridge',
    error: undefined
  })
})

test('an answer that is missing, broken or the wrong shape is no answer', () => {
  assert.equal(parseProbeOutput(''), null)
  assert.equal(parseProbeOutput('{"connected": true}\n'), null)
  assert.equal(parseProbeOutput(`${PROBE_MARKER}{"connected": tru`), null)
  assert.equal(parseProbeOutput(`${PROBE_MARKER}null\n`), null)
  // "connected" must be the boolean true: a truthy string is not a connection.
  assert.equal(parseProbeOutput(`${PROBE_MARKER}{"connected": "yes"}\n`)?.connected, false)
  assert.equal(parseProbeOutput(`${PROBE_MARKER}{"connected": true}\n`)?.connected, true)
  assert.equal(
    parseProbeOutput(`${PROBE_MARKER}{"connected": true, "transport": "carrier pigeon"}\n`)?.transport,
    undefined
  )
})

test('the bridge script is looked for in Resolve’s own Scripts folder', () => {
  assert.equal(
    bridgeScriptPath('/Users/someone'),
    '/Users/someone/Library/Application Support/Blackmagic Design/DaVinci Resolve/Fusion/Scripts/Utility/resolve_bridge.py'
  )
})

// ── Running the probe: a stand-in for the venv python, so no Resolve and no Python needed ───

function fakeConnector(body: string): { dir: string; python: string; server: string } {
  const dir = mkdtempSync(join(tmpdir(), 'bay-resolve-probe-'))
  mkdirSync(join(dir, 'venv', 'bin'), { recursive: true })
  const python = join(dir, 'venv', 'bin', 'python')
  writeFileSync(python, `#!/bin/sh\n${body}\n`)
  chmodSync(python, 0o755)
  return { dir, python, server: join(dir, 'src', 'server.py') }
}

test('the probe is run in the connector’s folder with its environment, and its answer returned', { timeout: 20_000 }, async () => {
  const connector = fakeConnector(
    `printf '%s{"connected": true, "product": "%s|%s|%s"}\\n' '${PROBE_MARKER}' "$(pwd -P)" "$DAVINCI_RESOLVE_MCP_UPDATE_CHECK" "$1"`
  )
  try {
    const outcome = await runProbe(connector, { script: 'the script' })
    assert.ok('report' in outcome, JSON.stringify(outcome))
    const [cwd, updateCheck, flag] = (outcome.report.product ?? '').split('|')
    assert.equal(outcome.report.connected, true)
    assert.ok(cwd && cwd.endsWith(connector.dir.replace(/^\/private/, '')), cwd)
    assert.equal(updateCheck, '0')
    assert.equal(flag, '-c')
  } finally {
    rmSync(connector.dir, { recursive: true, force: true })
  }
})

test('a probe that hangs becomes a named failure within its timeout', { timeout: 20_000 }, async () => {
  const connector = fakeConnector('exec sleep 30')
  try {
    const started = Date.now()
    const outcome = await runProbe(connector, { timeoutMs: 400 })
    assert.ok('failed' in outcome, JSON.stringify(outcome))
    assert.match(outcome.failed, /did not answer within/)
    assert.ok(Date.now() - started < 5000, 'the hang was not cut short')
  } finally {
    rmSync(connector.dir, { recursive: true, force: true })
  }
})

test('a probe that exits without an answer, or cannot start, says which', { timeout: 20_000 }, async () => {
  const dies = fakeConnector('echo "ModuleNotFoundError: No module named src" >&2; exit 3')
  try {
    const outcome = await runProbe(dies)
    assert.ok('failed' in outcome, JSON.stringify(outcome))
    assert.match(outcome.failed, /exited with code 3/)
    assert.match(outcome.failed, /No module named src/)
    const gone = await runProbe({ ...dies, python: join(dies.dir, 'venv', 'bin', 'nope') })
    assert.ok('failed' in gone, JSON.stringify(gone))
    assert.match(gone.failed, /could not be started/)
  } finally {
    rmSync(dies.dir, { recursive: true, force: true })
  }
})

test('the probe script mirrors the server: no module and no forced bridge means no attempt', () => {
  // Textual, and only a tripwire: the behaviour is measured against the real venv by hand.
  assert.match(PROBE_SCRIPT, /from src\.utils\.resolve_connection import connect_resolve/)
  assert.match(PROBE_SCRIPT, /if \(dvr is not None or forced\) else None/)
  assert.ok(PROBE_SCRIPT.includes(`"\\n${PROBE_MARKER}"`))
})
