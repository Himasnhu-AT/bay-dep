/**
 * The two lifecycle rules of the 3D renderer's WebGL context, apart from three.js so they are
 * tested under Node against a stand-in (`glContext.test.ts`).
 *
 * - **Release loses the context first.** `WebGLRenderer.dispose()` frees three's resources but not
 *   the context: that lives until the canvas is garbage-collected. Chromium caps a page at about 16
 *   live contexts and, past it, drops the *oldest* — which is grade's (`engine/grade.ts`). Every
 *   engine detach and every rebuild after a loss would otherwise leave one more behind.
 * - **Resize only on change.** One canvas serves every 3D layer; `setSize` reallocates the drawing
 *   buffer (with MSAA, several of them), so it runs when a layer's device size differs from the
 *   last one drawn, not for every layer on every frame.
 */

/** What these rules need of a renderer — `WebGLRenderer` has all of it. */
export interface ContextOwner {
  forceContextLoss(): void
  dispose(): void
  setSize(width: number, height: number, updateStyle: boolean): void
}

/** Loses the context, then disposes. A context already lost stays lost; dispose still runs. */
export function releaseRenderer(renderer: ContextOwner): void {
  try {
    renderer.forceContextLoss()
  } catch {
    // An already-lost context may refuse; what matters is that it does not outlive this call.
  }
  renderer.dispose()
}

/** Calls `setSize` only when the size changes; `reset` after a new renderer is made. */
export class CanvasSize {
  #width = 0
  #height = 0

  resize(renderer: Pick<ContextOwner, 'setSize'>, width: number, height: number): void {
    if (width === this.#width && height === this.#height) return
    renderer.setSize(width, height, false)
    this.#width = width
    this.#height = height
  }

  reset(): void {
    this.#width = 0
    this.#height = 0
  }
}
