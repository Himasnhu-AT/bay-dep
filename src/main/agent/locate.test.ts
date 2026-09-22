/**
 * Finding `claude` from a GUI application.
 *
 * The case that matters cannot be arranged on this machine: a user whose `claude` lives under a
 * version manager the test runner has never heard of, in a process whose `PATH` is the four
 * directories Finder hands out. So the filesystem is injected and every test states the
 * install shape it stands for.
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findClaude, notFoundMessage, searchDirs } from './locate'

const HOME = '/Users/x'
/** A GUI-launched process on macOS gets this and nothing else. */
const GUI_ENV = { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' } as NodeJS.ProcessEnv

const withFiles = (present: string[]) => ({
  isExecutable: async (path: string) => present.includes(path),
  children: async () => []
})

test('a Homebrew install is found from a GUI PATH that does not include it', () => {
  // The case that made this file exist: `spawn("claude")` fails, `which claude` in a terminal
  // succeeds, and the difference is invisible unless you know to look for it.
  return findClaude({
    env: GUI_ENV,
    homeDir: HOME,
    platform: 'darwin',
    ...withFiles(['/opt/homebrew/bin/claude'])
  }).then((found) => {
    assert.equal(found?.path, '/opt/homebrew/bin/claude')
    assert.equal(found?.from, '/opt/homebrew/bin')
  })
})

test('PATH wins over everything else', async () => {
  // A user who arranged for a particular claude to be first has said which one they mean.
  const found = await findClaude({
    env: { PATH: '/custom/bin:/usr/bin' } as NodeJS.ProcessEnv,
    homeDir: HOME,
    platform: 'darwin',
    ...withFiles(['/custom/bin/claude', '/opt/homebrew/bin/claude'])
  })
  assert.equal(found?.path, '/custom/bin/claude')
})

test('an nvm install is found, though its directory has a version number nothing can guess', async () => {
  const found = await findClaude({
    env: GUI_ENV,
    homeDir: HOME,
    platform: 'darwin',
    isExecutable: async (p) => p === `${HOME}/.nvm/versions/node/v22.14.0/bin/claude`,
    children: async (path) =>
      path === `${HOME}/.nvm/versions/node/` || path === `${HOME}/.nvm/versions/node`
        ? ['v20.11.1', 'v22.14.0']
        : []
  })
  assert.equal(found?.path, `${HOME}/.nvm/versions/node/v22.14.0/bin/claude`)
})

test('fnm, asdf and mise are searched too, each with its own layout', async () => {
  const dirs = await searchDirs({
    env: GUI_ENV,
    homeDir: HOME,
    platform: 'darwin',
    children: async (path) => (path.includes('node') || path.includes('nodejs') ? ['v22.0.0'] : [])
  })
  // The layouts genuinely differ — fnm interposes `installation` — and getting one wrong means
  // silently never finding that user's install.
  assert.ok(dirs.includes(`${HOME}/.fnm/node-versions/v22.0.0/installation/bin`))
  assert.ok(dirs.includes(`${HOME}/.asdf/installs/nodejs/v22.0.0/bin`))
  assert.ok(dirs.includes(`${HOME}/.local/share/mise/installs/node/v22.0.0/bin`))
  assert.ok(dirs.includes(`${HOME}/.nvm/versions/node/v22.0.0/bin`))
})

test('Claude Code’s own installer directory is searched', async () => {
  const found = await findClaude({
    env: GUI_ENV,
    homeDir: HOME,
    platform: 'darwin',
    ...withFiles([`${HOME}/.claude/local/claude`])
  })
  assert.equal(found?.path, `${HOME}/.claude/local/claude`)
})

test('npm and pnpm prefixes from the environment are honoured', async () => {
  const dirs = await searchDirs({
    env: { PATH: '', NPM_CONFIG_PREFIX: '/opt/npm', PNPM_HOME: '/opt/pnpm' } as NodeJS.ProcessEnv,
    homeDir: HOME,
    platform: 'darwin',
    children: async () => []
  })
  assert.ok(dirs.includes('/opt/npm/bin'), 'npm prefix gets /bin appended on unix')
  assert.ok(dirs.includes('/opt/pnpm'), 'PNPM_HOME is already the bin directory')
})

test('on Windows the extension is part of the name', async () => {
  // Asserted on the filename rather than the whole path: `path.join` takes its separator from
  // the *runtime*, not from the `platform` argument, so this test running on macOS produces
  // `C:\\bin/claude.cmd`. That is an artefact of the test host and not a fault — on Windows
  // `join` is `win32.join`. The property being checked is that the extension is tried at all:
  // searching for bare `claude` finds nothing there, which reads as "not installed".
  const found = await findClaude({
    env: { PATH: 'C:\\bin' } as NodeJS.ProcessEnv,
    homeDir: 'C:\\Users\\x',
    platform: 'win32',
    isExecutable: async (path) => path.endsWith('claude.cmd'),
    children: async () => []
  })
  assert.ok(found, 'claude.cmd must be found')
  assert.ok(found.path.endsWith('claude.cmd'))
})

test('an empty PATH does not stop the search', async () => {
  const dirs = await searchDirs({
    env: {} as NodeJS.ProcessEnv,
    homeDir: HOME,
    platform: 'darwin',
    children: async () => []
  })
  assert.ok(dirs.length > 5)
  assert.ok(dirs.includes('/opt/homebrew/bin'))
})

test('no duplicates, so a repeated PATH entry does not multiply the work', async () => {
  const dirs = await searchDirs({
    env: { PATH: '/usr/bin:/usr/bin:/opt/homebrew/bin' } as NodeJS.ProcessEnv,
    homeDir: HOME,
    platform: 'darwin',
    children: async () => []
  })
  assert.equal(new Set(dirs).size, dirs.length)
})

test('a missing binary is an answer, not a throw', async () => {
  const found = await findClaude({
    env: GUI_ENV,
    homeDir: HOME,
    platform: 'darwin',
    isExecutable: async () => false,
    children: async () => []
  })
  assert.equal(found, null)
})

test('the not-found message names the likely cause, not just the symptom', () => {
  const message = notFoundMessage(24)
  // "claude not found" invites the reasonable and wrong conclusion that it is not installed.
  assert.match(message, /24 places/)
  assert.match(message, /which claude/)
  assert.match(message, /npm install -g/)
})
