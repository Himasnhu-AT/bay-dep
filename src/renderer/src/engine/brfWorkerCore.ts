/**
 * What a `.brf` worker does with each message, apart from where it runs. The worker
 * (`./brf.worker.ts`) wraps this in the lockdown; the tests run it in-process through the
 * runtime's worker factory, so the protocol under test is the one the app uses.
 */

import type { BrfDocument } from '@shared/brf'
import { loadBrf, probeBrf, renderBrf, type BrfModule } from '@shared/brf-code'
import type { BrfWorkerReply, BrfWorkerRequest } from './brfCode'

export function createHandler(
  makeFunction?: (...args: string[]) => (...args: unknown[]) => unknown
): (request: BrfWorkerRequest) => BrfWorkerReply {
  let loaded: BrfModule | null = null
  return (request) => {
    if (request.type === 'load') {
      const result = loadBrf(request.source, makeFunction)
      if (!result.ok) return { id: request.id, ok: false, error: result.error }
      loaded = result.module
      const probed = probeBrf(loaded, request.fps, request.width, request.height)
      return probed.ok ? { id: request.id, ok: true, meta: probed.meta } : { id: request.id, ok: false, error: probed.error }
    }
    if (!loaded) return { id: request.id, ok: false, error: 'the module was not loaded before it was asked to render' }
    const scenes: BrfDocument[] = []
    for (const frame of request.frames) {
      const out = renderBrf(loaded, { frame, fps: request.fps, width: request.width, height: request.height, vars: request.vars })
      if (!out.ok) return { id: request.id, ok: false, error: out.error }
      scenes.push(out.doc)
    }
    return { id: request.id, ok: true, scenes }
  }
}
