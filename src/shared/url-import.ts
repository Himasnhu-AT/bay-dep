/**
 * `import_url`: what counts as a web address bay will hand to yt-dlp, and the caps on a download.
 *
 * Shared because three places ask the same question and must not disagree: the renderer's handler
 * (a dry run answers without reaching main's downloader), main's policy (the in-app agent's
 * confirmation names the host), and main's downloader itself, which checks again rather than
 * trusting either — the address arrives from an agent, and text an agent read can carry an
 * injection.
 *
 * The check is about what yt-dlp would do with the string, not about URLs in general. yt-dlp reads
 * `file://` and local paths as happily as web addresses, and anything starting with `-` as an
 * option (`--exec`, `-o /etc/x`); so only `http:`/`https:` pass, with no whitespace or control
 * characters that could split one argument into several in some later layer. The argument list is
 * built as an array with `--` before the address as well — the check here is the first wall, not
 * the only one.
 */

/** 1080p is plenty for editing and keeps a download to minutes, not an hour. */
export const URL_IMPORT_MAX_HEIGHT = 1080
/** yt-dlp stops a download whose size it knows to exceed this. */
export const URL_IMPORT_MAX_BYTES = 2 * 1024 * 1024 * 1024
/** A download still running after this is killed and its folder removed. */
export const URL_IMPORT_TIMEOUT_MS = 15 * 60_000

/**
 * What main answers. A download lands at `path`, inside bay's downloads folder, not yet imported;
 * a dry run starts nothing and returns the exact argument list it would run.
 */
export type UrlImportResult =
  | { ok: true; path: string; ytDlp: string }
  | { ok: true; dryRun: true; ytDlp: string; args: string[] }
  | { ok: false; error: string }

export type CheckedUrl = { ok: true; url: string; host: string } | { ok: false; error: string }

export function checkDownloadUrl(raw: unknown): CheckedUrl {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return { ok: false, error: 'url is empty. Pass the page address of the video, starting with https://.' }
  }
  const given = raw.trim()
  if (given.length > 2048) return { ok: false, error: 'That address is over 2048 characters, which no video page needs. Pass the page address itself.' }
  // Whitespace and control characters: one "address" that is really an address plus options.
  if (/[\s\u0000-\u001f\u007f]/.test(given)) {
    return { ok: false, error: `"${given.slice(0, 80)}" contains spaces or control characters, so it is not one web address. Pass just the page address, starting with https://.` }
  }
  let parsed: URL
  try {
    parsed = new URL(given)
  } catch {
    return { ok: false, error: `"${given.slice(0, 80)}" is not a web address. Pass the page address of the video, starting with https://.` }
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return {
      ok: false,
      error:
        `import_url downloads from web pages only (http or https), not ${parsed.protocol} addresses. ` +
        `For a file already on this Mac, use import_media with its path.`
    }
  }
  if (!parsed.hostname) return { ok: false, error: `"${given.slice(0, 80)}" names no website. Pass the full page address.` }
  if (parsed.username || parsed.password) {
    return { ok: false, error: 'That address carries a user name or password. bay does not send credentials; pass the address without them.' }
  }
  return { ok: true, url: parsed.href, host: parsed.hostname }
}
