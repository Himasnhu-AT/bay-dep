/**
 * `import_url` — a web page's video into the media pool.
 *
 * The download is main's (`main/media/url-import.ts`: the user's yt-dlp, bay's folder, capped and
 * killable); this adapter checks the address first so a bad one is refused without a round trip,
 * then imports the landed file through the ordinary import path, exactly as `import_media` would
 * — deduplicated by path, admitted to `bay://` by main.
 *
 * `selfValidating`: a store dry run cannot undo a download, so `validateOnly` reaches this handler,
 * which asks main to check and locate without running anything.
 */

import { VALIDATE_ONLY } from '@shared/mcp'
import { checkDownloadUrl } from '@shared/url-import'
import { bay } from '@/lib/bay'
import { fail, store, usToFramesAtTimeline, type Handlers } from './helpers'

export async function importUrl(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const checked = checkDownloadUrl(args.url)
  if (!checked.ok) fail(checked.error)
  const api = bay()
  if (!api) fail('This window has no bridge to the app, so nothing can be downloaded.')

  if (args[VALIDATE_ONLY] === true) {
    const planned = await api.media.importUrl(checked.url, { dryRun: true })
    if (!planned.ok) fail(planned.error)
    return {
      valid: true,
      url: checked.url,
      host: checked.host,
      ...('args' in planned ? { ytDlp: planned.ytDlp, args: planned.args } : {}),
      note: 'Nothing was downloaded. Call again without validateOnly to download and import it.'
    }
  }

  const landed = await api.media.importUrl(checked.url)
  if (!landed.ok) fail(landed.error)
  if (!('path' in landed)) fail('The download answered without a file. Try again.')

  const [imported] = await api.media.importPaths([landed.path])
  if (!imported) fail(`The download landed at ${landed.path} but could not be imported.`)
  const asset = imported.asset
  if (asset.error) {
    fail(`The download landed at ${landed.path}, but bay cannot read it (${asset.error}). The site may have served something that is not a video.`)
  }
  store().addAssets([asset])
  return {
    asset: {
      id: asset.id,
      name: asset.name,
      kind: asset.kind,
      path: asset.path,
      durationInFrames: usToFramesAtTimeline(asset.durationUs),
      width: asset.width,
      height: asset.height,
      hasAudio: asset.hasAudio,
      hasVideo: asset.hasVideo,
      reused: imported.reused
    },
    from: checked.url,
    next: `Place it with place_asset { assetId: "${asset.id}" }.`
  }
}

export const handlers: Handlers = {
  import_url: (args) => importUrl(args)
}
