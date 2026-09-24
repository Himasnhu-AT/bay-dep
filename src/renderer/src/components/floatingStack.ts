/**
 * Which floating surfaces (menus, context menus, popovers) are open right now, for the one rule
 * that needs to know across components: **a tooltip does not draw over an open menu.** Tooltips
 * sit above popovers in the z-order (`--z-tooltip` > `--z-popover`) so that a control inside a
 * popover can still explain itself — which also let a media tile's tooltip, still hovering from
 * before the right-click, cover the lower items of the tile's own context menu. The rule lives in
 * `Tooltip`, so it holds for every trigger at once; a tooltip whose trigger is *inside* the open
 * surface is still allowed.
 *
 * Plain module state, because a surface and a tooltip share no React tree (both portal to
 * `document.body`). Each opening holds one claim and releases it exactly once.
 */

let open = 0
const listeners = new Set<() => void>()

function changed(): void {
  for (const listener of listeners) listener()
}

/** Marks a surface open; call the returned function when it closes. Releasing twice is harmless. */
export function claimFloating(): () => void {
  open += 1
  changed()
  let released = false
  return () => {
    if (released) return
    released = true
    open -= 1
    changed()
  }
}

export function anyFloatingOpen(): boolean {
  return open > 0
}

/** Called whenever a surface opens or closes. Returns an unsubscribe. */
export function onFloatingChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Whether a tooltip may show for a trigger: always inside an open surface, otherwise only when none is open. */
export function tooltipAllowed(triggerInsideSurface: boolean): boolean {
  return triggerInsideSurface || !anyFloatingOpen()
}
