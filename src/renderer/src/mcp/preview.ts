/**
 * `preview_frame` — the only tool that lets an agent see its own work.
 *
 * The rendering belongs to the engine and this file is the adapter. That boundary is worth
 * keeping: a still has to **await every seek** before it draws, rather than drawing whatever
 * the decoder currently holds the way the live preview does. A `preview_frame` that returned
 * the frame before, or black because a seek had not landed, would be worse than no tool —
 * the agent looks at it, concludes a correct edit is wrong, and confidently breaks it.
 *
 * The adapter's own job is the honesty around the picture. `renderFrame` reports how many
 * items never became drawable, and that count has to reach the agent as words rather than
 * be dropped in favour of the image: a frame missing two of its three clips looks exactly
 * like a frame of a nearly-empty timeline, and a model cannot tell those apart by looking.
 */

import { renderFrame } from '@/engine'
import { fail, project, timeline } from './helpers'
import { frameOrPlayhead } from './read'

/**
 * Bounded on purpose: the result is base64 inside a JSON-RPC message, and a 4K still would
 * be tens of megabytes of context for a question — "is the caption covering her face?" —
 * that a small image answers just as well.
 */
const MAX_EDGE = 640

export async function previewFrame(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const tl = timeline()
  const frame = frameOrPlayhead(args)

  let still
  try {
    still = await renderFrame({ project: project(), timelineId: tl.id, frame, maxSize: MAX_EDGE })
  } catch (error) {
    fail(`Frame ${frame} could not be rendered: ${error instanceof Error ? error.message : String(error)}`)
  }

  const incomplete = still.pending > 0 || still.placeholders > 0
  return {
    frame,
    width: still.width,
    height: still.height,
    // Layout numbers are in canvas pixels and the image is not, so both are reported
    // rather than leaving the agent to infer a scale it would get wrong.
    canvas: { width: tl.width, height: tl.height },
    itemsDrawn: still.drawn,
    image: still.dataUrl,
    ...(incomplete
      ? {
          incomplete: true,
          pending: still.pending,
          placeholders: still.placeholders,
          unresolved: still.unresolved,
          warning:
            `This picture is missing ${still.pending + still.placeholders} of its items ` +
            `(${still.unresolved.join(', ')}), so it does not show what an export would ` +
            `produce. Do not judge the edit from it — call preview_frame again in a moment ` +
            `if the media was still loading, or check browse_assets for an asset that could ` +
            `not be read.`
        }
      : {})
  }
}
