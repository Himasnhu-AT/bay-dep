/**
 * No downgrades: the version an update would install, read from the downloaded bundle itself.
 *
 * Squirrel.Mac checks only that the new bundle is signed by the same Developer ID. It installs an
 * *older* bay just as happily, and electron-updater's `allowDowngrade = false` compares only the
 * `version:` line of `latest-mac.yml` — so an old, genuinely signed zip re-served under a higher
 * `version:` would install. The feed's word is therefore not evidence. The zip electron-updater
 * downloaded (`UpdateDownloadedEvent.downloadedFile`, sha512-checked against the feed) is the exact
 * file its loopback proxy later hands to Squirrel, so the `CFBundleShortVersionString` in its
 * `<name>.app/Contents/Info.plist` is the version that would run. `updater.ts` reads it when the
 * download finishes and again right before `quitAndInstall`, and refuses unless it is strictly
 * newer than the running bay.
 *
 * The decisions are pure and unit-tested; `readBundleVersion` runs the system `unzip` and `plutil`.
 */

import { execFile } from 'node:child_process'
import { isNewer } from '@shared/update'

/** The one `<name>.app/Contents/Info.plist` at the top of the zip, or why there is not one. */
export function infoPlistEntry(entries: readonly string[]): { path: string } | { error: string } {
  // No unzip wildcard characters in the name: `unzip -p` reads its argument as a pattern.
  const found = entries.filter((entry) => /^[^/*?[\]\\]+\.app\/Contents\/Info\.plist$/.test(entry))
  if (found.length === 1) return { path: found[0]! }
  return { error: found.length === 0 ? 'the download holds no app' : `the download holds ${found.length} apps` }
}

/** `CFBundleShortVersionString` from an XML property list, or null. */
export function shortVersionFromPlist(xml: string): string | null {
  const match = /<key>\s*CFBundleShortVersionString\s*<\/key>\s*<string>\s*([^<]*?)\s*<\/string>/.exec(xml)
  return match?.[1] ? match[1] : null
}

/**
 * Whether bay may install a bundle holding `found` (null: it could not be read) while running
 * `current`. `advertised` is what the feed said, named in the refusal so the mismatch is visible.
 */
export function installVerdict(found: string | { error: string }, current: string, advertised: string): { ok: true } | { ok: false; reason: string } {
  if (typeof found !== 'string') {
    return { ok: false, reason: `bay did not install the update the feed called ${advertised}: it could not read the version inside the download (${found.error}). Nothing was installed.` }
  }
  if (isNewer(found, current)) return { ok: true }
  return {
    ok: false,
    reason: `bay did not install the update the feed called ${advertised}: the download contains bay ${found}, which is not newer than this bay (${current}). Nothing was installed.`
  }
}

function run(file: string, args: readonly string[], input?: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = execFile(file, args, { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 }, (error, stdout) => {
      if (error) reject(error)
      else resolve(stdout)
    })
    if (input) child.stdin?.end(input)
  })
}

/** The version inside a downloaded update zip, or why it could not be read. */
export async function readBundleVersion(zipPath: string): Promise<string | { error: string }> {
  try {
    const listing = (await run('/usr/bin/unzip', ['-Z1', zipPath])).toString('utf8').split('\n').filter(Boolean)
    const entry = infoPlistEntry(listing)
    if ('error' in entry) return entry
    const raw = await run('/usr/bin/unzip', ['-p', zipPath, entry.path])
    // Binary or XML, plutil answers XML.
    const xml = (await run('/usr/bin/plutil', ['-convert', 'xml1', '-o', '-', '-'], raw)).toString('utf8')
    return shortVersionFromPlist(xml) ?? { error: 'its Info.plist names no CFBundleShortVersionString' }
  } catch (error) {
    return { error: (error instanceof Error ? error.message : String(error)).split('\n')[0] ?? 'unreadable' }
  }
}
