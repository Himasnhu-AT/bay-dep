/**
 * The composition sandbox: its own folder, nothing else. Run with `pnpm test`.
 *
 * Specimens are built by string concatenation, never `path.join`, which would normalise away the
 * very `..` the check exists to catch (CLAUDE.md: the traversal test that tested nothing).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { decideCompositionRequest, isInside } from './sandbox'

async function fixture(): Promise<{ root: string; folder: string; secret: string }> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bay-sandbox-')))
  const folder = `${root}/comp`
  await mkdir(`${folder}/assets`, { recursive: true })
  await writeFile(`${folder}/index.html`, '<html></html>')
  await writeFile(`${folder}/assets/logo.png`, 'png')
  await writeFile(`${root}/secret.txt`, 'secret')
  return { root, folder, secret: `${root}/secret.txt` }
}

const decide = (url: string, folder: string | null) => decideCompositionRequest(url, folder, realpath)

test('the composition’s own files load; a sibling of its folder does not', async () => {
  const { folder, secret } = await fixture()
  assert.deepEqual(await decide(pathToFileURL(`${folder}/index.html`).href, folder), { allow: true })
  assert.deepEqual(await decide(pathToFileURL(`${folder}/assets/logo.png`).href, folder), { allow: true })
  const refused = await decide(pathToFileURL(secret).href, folder)
  assert.equal(refused.allow, false)
  assert.match(!refused.allow ? refused.reason : '', /outside the composition's folder/)
})

test('.. and its encodings cannot climb out', async () => {
  const { folder } = await fixture()
  const raw = `file://${folder}/../secret.txt`
  assert.ok(raw.includes('/../'), 'specimen: the traversal survives into the URL string')
  assert.equal((await decide(raw, folder)).allow, false)
  assert.equal((await decide(`file://${folder}/%2e%2e/secret.txt`, folder)).allow, false)
  // A folder whose name merely starts like this one is not inside it.
  assert.equal(isInside('/a/comp', '/a/comp-evil/x'), false)
  assert.equal(isInside('/a/comp', '/a/comp/x'), true)
})

test('a symlink inside the folder cannot point out of it', async () => {
  const { folder, secret } = await fixture()
  await symlink(secret, `${folder}/assets/innocent.txt`)
  assert.equal((await decide(pathToFileURL(`${folder}/assets/innocent.txt`).href, folder)).allow, false)
})

test('no network and no app URLs; the self-contained schemes pass', async () => {
  const { folder } = await fixture()
  for (const url of [
    'https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js',
    'http://127.0.0.1:9222/json',
    'wss://example.com/socket',
    'bay://media/Users/x/secret.mp4'
  ]) {
    const verdict = await decide(url, folder)
    assert.equal(verdict.allow, false, url)
  }
  for (const url of ['data:text/plain,hi', 'blob:file:///6f1c', 'about:blank']) {
    assert.deepEqual(await decide(url, folder), { allow: true }, url)
  }
})

test('a window with no known folder loads no files at all', async () => {
  const { folder } = await fixture()
  assert.equal((await decide(pathToFileURL(`${folder}/index.html`).href, null)).allow, false)
})
