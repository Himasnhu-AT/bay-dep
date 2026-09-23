/**
 * Which links bay hands to the system browser.
 *
 * Links reach here from the agent's own replies (rendered markdown), so their text can come from
 * a prompt injection. `shell.openExternal` opens any scheme the system knows — `file:` URLs,
 * `x-apple.systempreferences:`, an installed app's custom handler — so only `https:` passes: a
 * web page is the only thing a link in bay's panel is ever for. No Electron import, so it is
 * tested on its own.
 */
export function isOpenableExternally(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:'
  } catch {
    return false
  }
}
