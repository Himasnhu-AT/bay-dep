/**
 * `preview_frame` — the only tool that lets an agent see its own work.
 *
 * The rendering belongs to the engine, not here, and that is a boundary worth keeping: a
 * still has to **await every seek** before it draws, the way the exporter does, rather than
 * drawing whatever the decoder currently holds the way the live preview does. A
 * `preview_frame` that returns the frame before, or black because a seek had not landed, is
 * worse than no tool at all — the agent looks at it, concludes a correct edit is wrong, and
 * confidently breaks something. Writing a second copy of that logic here is how one copy
 * gets fixed and the other does not.
 *
 * So this file is the adapter and nothing more. It reads the engine's still-rendering seam
 * through a namespace import so that it compiles before the seam lands and wires itself the
 * moment it does.
 */

import * as engine from '@/engine'
import { fail, project, timeline } from './helpers'
import { frameOrPlayhead } from './read'

/** The shape asked of the engine. Kept here so the expectation is checkable, not implied. */
interface StillRenderer {
  renderFrame(options: {
    project: ReturnType<typeof project>
    timelineId: string
    frame: number
    maxSize?: number
  }): Promise<{ dataUrl: string; width: number; height: number }>
}

/**
 * Bounded on purpose: the result is base64 inside a JSON-RPC message, and a 4K still would
 * be tens of megabytes of context for a question — "is the caption covering her face?" —
 * that a small image answers just as well.
 */
const MAX_EDGE = 640

export async function previewFrame(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const tl = timeline()
  const frame = frameOrPlayhead(args)

  const renderer = engine as Partial<StillRenderer>
  if (typeof renderer.renderFrame !== 'function') {
    fail(
      'preview_frame cannot render in this build: the engine exposes no still renderer yet. ' +
        'Nothing else is affected — read_project and inspect_item still describe the edit, ' +
        'they just cannot show it.'
    )
  }

  const still = await renderer.renderFrame({
    project: project(),
    timelineId: tl.id,
    frame,
    maxSize: MAX_EDGE
  })

  return {
    frame,
    width: still.width,
    height: still.height,
    // The canvas size is reported beside the image size so the agent can reason about
    // layout numbers, which are in canvas pixels, against a picture that is not.
    canvas: { width: tl.width, height: tl.height },
    image: still.dataUrl
  }
}
