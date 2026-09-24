/**
 * Where the updater may go, and whether it runs at all. Electron-free, so it is unit-tested.
 *
 * The feed is a generic-provider URL: a folder served over https that holds `latest-mac.yml`
 * and the zip it names. `script/release-signed` writes both. The shipped URL is
 * `UPDATE_FEED` in `@shared/update-feed`, and it is unset until there is somewhere to publish.
 * Then the app checks nothing, contacts nothing, and Settings says "Updates: releasing soon".
 *
 * `updater.ts` enforces `allowUpdateRequest` on electron-updater's own session
 * (`session.fromPartition('electron-updater')`), which carries every request the updater makes,
 * redirects included. The only host it allows is the feed's own origin. The editor's session
 * is untouched and stays offline (`offline.ts`).
 */

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]'])

/** A usable feed URL, normalised to end in `/`, or why it is not one. */
export function parseFeed(value: string, source: string): { url: string } | { error: string } {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return { error: `${source} is not a URL: ${value}` }
  }
  const loopback = LOOPBACK.has(parsed.hostname)
  if (parsed.protocol !== 'https:' && !(loopback && parsed.protocol === 'http:')) {
    return { error: `${source} must be https (plain http only on this Mac): ${value}` }
  }
  return { url: parsed.href.endsWith('/') ? parsed.href : `${parsed.href}/` }
}

export type UpdaterMode =
  /** Not a build that can update itself, or no feed yet. `reason` is what Settings says. */
  | { kind: 'off'; reason: string; soon: boolean }
  | { kind: 'feed'; url: string; canInstall: boolean; local: boolean }
  | { kind: 'invalid'; reason: string }

/**
 * `BAY_UPDATE_FEED` points the updater at a local feed, for testing an update end to end
 * without publishing anything. Only a loopback address is accepted, in any build. Honouring it
 * in a packaged build opens nothing: whoever can set this app's environment already runs code
 * as this user, and macOS installs an update only if it is signed by the same Developer ID as
 * the running bay.
 *
 * A checkout's `electron .` has no bundle to swap, so an unpackaged build is off unless a local
 * feed is named. Then it can check and download but says it cannot install.
 */
export function updaterMode(isPackaged: boolean, env: Record<string, string | undefined>, shippedFeed: string | null): UpdaterMode {
  const override = env['BAY_UPDATE_FEED']
  if (override) {
    const feed = parseFeed(override, 'BAY_UPDATE_FEED')
    if ('error' in feed) return { kind: 'invalid', reason: feed.error }
    if (!LOOPBACK.has(new URL(feed.url).hostname)) {
      return { kind: 'invalid', reason: `BAY_UPDATE_FEED must be a feed on this Mac (http://127.0.0.1:<port>/), not ${new URL(feed.url).host}.` }
    }
    return { kind: 'feed', url: feed.url, canInstall: isPackaged, local: true }
  }
  if (!isPackaged) {
    return {
      kind: 'off',
      soon: false,
      reason: 'This is a development build (bay run from a checkout), which never replaces itself. To test updates, set BAY_UPDATE_FEED to a local feed.'
    }
  }
  if (!shippedFeed) return { kind: 'off', soon: true, reason: 'Updates: releasing soon.' }
  const feed = parseFeed(shippedFeed, 'The update feed')
  if ('error' in feed) return { kind: 'invalid', reason: feed.error }
  return { kind: 'feed', url: feed.url, canInstall: true, local: false }
}

/** Whether the updater's session may make this request: the feed's own origin, nothing else. */
export function allowUpdateRequest(url: string, feed: string): { ok: true } | { ok: false; reason: string } {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { ok: false, reason: 'bay refused an update request to a malformed URL.' }
  }
  const allowed = new URL(feed)
  if (parsed.origin === allowed.origin) return { ok: true }
  return { ok: false, reason: `bay refused to contact ${parsed.host || url} for an update: updates come only from ${allowed.host}.` }
}

/**
 * The file electron-updater reads its provider from (`updateConfigPath`). Written by bay into
 * userData, not by electron-builder into the bundle, so the feed is one constant in the source
 * and a local feed needs no rebuilt app. `updaterCacheDirName` is where downloads are staged,
 * under ~/Library/Caches.
 */
export function updaterConfigYaml(url: string): string {
  return `provider: generic\nurl: ${JSON.stringify(url)}\nupdaterCacheDirName: bay-updater\n`
}
