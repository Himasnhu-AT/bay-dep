/**
 * No downgrades: an update installs only if the bay inside the downloaded zip is strictly newer
 * than the running one, whatever the feed's `version:` line says. The zips here are built the way
 * `script/release-signed` builds the update zip (`ditto -c -k --keepParent`), in a temp folder.
 *
 *   node --import ./src/test-hooks.mjs --test src/main/update/bundle-version.test.ts
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { infoPlistEntry, installVerdict, readBundleVersion, shortVersionFromPlist } from './bundle-version'

const plist = (version: string): string =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n  <key>CFBundleName</key>\n  <string>bay</string>\n  <key>CFBundleShortVersionString</key>\n  <string>${version}</string>\n  <key>CFBundleVersion</key>\n  <string>9.9.9</string>\n</dict>\n</plist>\n`

test('the running bay installs only a strictly newer bundle', () => {
  // Positive control.
  assert.deepEqual(installVerdict('0.1.1', '0.1.0', '0.1.1'), { ok: true })
  assert.deepEqual(installVerdict('1.0.0', '0.9.9', '1.0.0'), { ok: true })
  // The attack: an older, genuinely signed bay re-served under a higher `version:`.
  const older = installVerdict('0.0.9', '0.1.0', '9.0.0')
  assert.equal(older.ok, false)
  // Assert on the content: the reader learns what was inside, what runs, and what the feed claimed.
  if (!older.ok) {
    assert.match(older.reason, /contains bay 0\.0\.9/)
    assert.match(older.reason, /this bay \(0\.1\.0\)/)
    assert.match(older.reason, /the feed called 9\.0\.0/)
    assert.match(older.reason, /Nothing was installed/)
  }
  // The same version again is not an update either.
  assert.equal(installVerdict('0.1.0', '0.1.0', '0.1.1').ok, false)
  // Unreadable is a refusal that says why, never a pass.
  const unreadable = installVerdict({ error: 'the download holds no app' }, '0.1.0', '0.1.1')
  assert.ok(!unreadable.ok && /could not read the version inside the download \(the download holds no app\)/.test(unreadable.reason))
  assert.equal(installVerdict('not-a-version', '0.1.0', '0.1.1').ok, false)
})

test('the version is CFBundleShortVersionString, not CFBundleVersion or another key', () => {
  assert.equal(shortVersionFromPlist(plist('0.2.0')), '0.2.0')
  // The fixture's CFBundleVersion is 9.9.9: reading the wrong key would pass a downgrade.
  assert.notEqual(shortVersionFromPlist(plist('0.0.1')), '9.9.9')
  assert.equal(shortVersionFromPlist('<plist><dict><key>CFBundleVersion</key><string>9.9.9</string></dict></plist>'), null)
})

test('the plist is the one app at the top of the zip', () => {
  assert.deepEqual(infoPlistEntry(['bay.app/', 'bay.app/Contents/', 'bay.app/Contents/Info.plist', 'bay.app/Contents/Frameworks/x.framework/Resources/Info.plist']), {
    path: 'bay.app/Contents/Info.plist'
  })
  assert.deepEqual(infoPlistEntry(['bay-reltest.app/Contents/Info.plist']), { path: 'bay-reltest.app/Contents/Info.plist' })
  // A nested app's plist is not the bundle's; two apps is ambiguous; a pattern name is refused.
  assert.ok('error' in infoPlistEntry(['x/bay.app/Contents/Info.plist']))
  assert.ok('error' in infoPlistEntry(['a.app/Contents/Info.plist', 'b.app/Contents/Info.plist']))
  assert.ok('error' in infoPlistEntry(['*.app/Contents/Info.plist']))
})

test('readBundleVersion reads the zip electron-updater downloaded, XML or binary plist', { skip: process.platform !== 'darwin' && 'needs macOS unzip and plutil', timeout: 30_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bay-bundle-version-'))
  try {
    const make = (name: string, version: string, binary: boolean): string => {
      const root = join(dir, name)
      mkdirSync(join(root, 'bay.app', 'Contents'), { recursive: true })
      const file = join(root, 'bay.app', 'Contents', 'Info.plist')
      writeFileSync(file, plist(version))
      if (binary) execFileSync('/usr/bin/plutil', ['-convert', 'binary1', file])
      const zip = join(dir, `${name}.zip`)
      execFileSync('/usr/bin/ditto', ['-c', '-k', '--keepParent', join(root, 'bay.app'), zip])
      return zip
    }
    assert.equal(await readBundleVersion(make('xml', '0.1.1', false)), '0.1.1')
    assert.equal(await readBundleVersion(make('bin', '0.0.9', true)), '0.0.9')
    const missing = await readBundleVersion(join(dir, 'nope.zip'))
    assert.ok(typeof missing !== 'string' && missing.error.length > 0, 'a missing file is an error, not a version')
    // End to end: an old bundle behind a feed that says 9.0.0 is refused.
    assert.equal(installVerdict(await readBundleVersion(make('old', '0.0.9', false)), '0.1.0', '9.0.0').ok, false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
