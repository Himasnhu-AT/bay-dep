/**
 * The name bay runs under, which is also where its data lives (`app.getPath('userData')`).
 *
 * Always "bay", except for a test build made with `script/release-signed --app-name bay-<x>`.
 * That flag stamps `productName` into the packaged package.json, and a test build must keep its
 * data under its own name. An update test cannot pass `--user-data-dir` to the build it
 * relaunches into: Squirrel starts the new bundle with no arguments. Before this, main's
 * `setName('bay')` overrode the stamped name, and a test build's relaunch would have opened
 * the real ~/Library/Application Support/bay.
 *
 * Only a packaged build counts, and only a `bay-` prefix with a lowercase suffix, so a checkout
 * and a stray productName can never move a real install's data somewhere unexpected.
 */
export function appNameFor(packagedName: string, isPackaged: boolean): string {
  return isPackaged && /^bay-[a-z0-9][a-z0-9-]{0,40}$/.test(packagedName) ? packagedName : 'bay'
}
