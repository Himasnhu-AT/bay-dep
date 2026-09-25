/**
 * Where a packaged bay looks for updates: a generic-provider feed, meaning an https folder that
 * holds `latest-mac.yml` and the zip it names. `script/release-signed` writes both into
 * `release/`. Upload them together to the feed folder.
 *
 * Unset until there is somewhere to publish. With it null, bay checks nothing, contacts nothing,
 * and Preferences › About says "Updates: releasing soon". Switching updates on is this one line
 * (README, "Releasing"). The updater may contact only this URL's origin (`main/update/policy.ts`),
 * so the feed must serve its files itself and must not redirect to another host.
 */
export const UPDATE_FEED: string | null = null
