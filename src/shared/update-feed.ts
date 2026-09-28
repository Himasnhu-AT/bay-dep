/**
 * Where a packaged bay looks for updates: a generic-provider feed, meaning an https folder that
 * holds `latest-mac.yml` and the zip it names. `script/release-signed` writes both into
 * `release/`; they are uploaded as assets of a release on the public repo below (release assets
 * only — no source from this repo is ever uploaded there). `releases/latest/download/` always
 * resolves to the newest non-draft, non-prerelease release.
 *
 * GitHub serves each file by redirecting to its asset host, so the updater may follow a GET to
 * those exact hosts when, and only when, this feed is on https://github.com
 * (`GITHUB_ASSET_HOSTS` in `main/update/policy.ts`, which cites the measurement). Set to null,
 * bay checks nothing, contacts nothing, and Preferences › About says "Updates: releasing soon".
 */
export const UPDATE_FEED: string | null = 'https://github.com/Himasnhu-AT/Himasnhu-AT/releases/latest/download/'
