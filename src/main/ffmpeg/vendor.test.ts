/**
 * Where the app looks for its ffmpeg. The packaged location is the one no test run can otherwise
 * reach (electron-builder's `extraResources` puts the binaries at `Contents/Resources/ffmpeg/`,
 * and only Electron sets `process.resourcesPath`), so it is exercised here with a stand-in
 * resources folder laid out exactly as electron-builder.yml writes it.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { vendoredTools, vendorPlatformDir } from './vendor'

function tools(dir: string, executable = true): void {
  mkdirSync(dir, { recursive: true })
  for (const name of ['ffmpeg', 'ffprobe']) {
    const path = join(dir, name)
    writeFileSync(path, '#!/bin/sh\n')
    chmodSync(path, executable ? 0o755 : 0o644)
  }
}

test('a packaged app runs the binaries in Resources/ffmpeg, before any checkout copy', () => {
  const root = mkdtempSync(join(tmpdir(), 'bay-vendor-'))
  const resources = join(root, 'bay.app', 'Contents', 'Resources')
  tools(join(resources, 'ffmpeg'))
  // A checkout copy is also reachable from `from`, so the order is what is being tested.
  tools(join(root, 'repo', 'vendor', 'ffmpeg', vendorPlatformDir()))
  const from = join(root, 'repo', 'out', 'main', 'index.js')
  assert.equal(vendoredTools(from, resources)?.ffmpeg, join(resources, 'ffmpeg', 'ffmpeg'))
  assert.equal(vendoredTools(from, resources)?.ffprobe, join(resources, 'ffmpeg', 'ffprobe'))
})

test('a checkout finds vendor/ffmpeg/<platform>-<arch> above the built bundle and above the source', () => {
  const root = mkdtempSync(join(tmpdir(), 'bay-vendor-'))
  const dir = join(root, 'vendor', 'ffmpeg', vendorPlatformDir())
  tools(dir)
  const noResources = join(root, 'Electron.app', 'Contents', 'Resources') // Electron's own, no ffmpeg in it
  assert.equal(vendoredTools(join(root, 'out', 'main', 'index.js'), noResources)?.dir, dir)
  assert.equal(vendoredTools(join(root, 'src', 'main', 'ffmpeg', 'vendor.ts'), undefined)?.dir, dir)
})

test('no usable pair is no tools: missing, the wrong platform, or not executable', () => {
  const root = mkdtempSync(join(tmpdir(), 'bay-vendor-'))
  const from = join(root, 'out', 'main', 'index.js')
  assert.equal(vendoredTools(from, undefined), null, 'nothing there')
  tools(join(root, 'vendor', 'ffmpeg', process.platform === 'win32' ? 'linux-x64' : 'win32-x64'))
  assert.equal(vendoredTools(from, undefined), null, "another platform's binaries are not ours")
  tools(join(root, 'vendor', 'ffmpeg', vendorPlatformDir()), false)
  assert.equal(vendoredTools(from, undefined), null, 'a file that cannot be spawned is not a tool')
  // Positive control: the same folder, made executable, is found.
  tools(join(root, 'vendor', 'ffmpeg', vendorPlatformDir()), true)
  assert.ok(vendoredTools(from, undefined))
})
