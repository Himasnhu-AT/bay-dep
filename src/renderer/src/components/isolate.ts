/**
 * Handlers that keep a portalled surface's pointer events inside it.
 *
 * `createPortal` moves a surface's DOM to `document.body`, but React still bubbles its synthetic
 * events through the *component* tree — so a press in a popover opened from the timeline ruler
 * reached the ruler's `onPointerDown`, which started a scrub and captured the pointer. The click
 * then landed on the ruler: the marker popover's swatches, Go to and Delete did nothing with a
 * mouse and moved the playhead instead, while the keyboard (which Floating already isolated)
 * worked. Every popover, menu and dialog opened from a clip, a lane, a track header or the viewer
 * sits inside something that reacts to presses, so the surface stops them itself rather than each
 * trigger remembering to.
 *
 * Presses, releases, clicks and the context menu; not moves, so an ancestor's hover state is
 * left alone. A drag that starts inside the surface (a slider, a number field's label) listens on
 * its own element (`useDrag`), which fires before the event reaches the surface, so stopping here
 * does not break it. Stopping a synthetic event also stops the native one at `document.body`, so
 * `window` listeners in the bubble phase do not see these presses either; capture-phase
 * listeners (outside-press dismissal) still do.
 */
export const ISOLATED_POINTER_EVENTS = [
  'onPointerDown',
  'onPointerUp',
  'onMouseDown',
  'onMouseUp',
  'onClick',
  'onDoubleClick',
  'onContextMenu'
] as const

type Isolated = Record<(typeof ISOLATED_POINTER_EVENTS)[number], (event: { stopPropagation(): void }) => void>

const stop = (event: { stopPropagation(): void }): void => event.stopPropagation()

/** Spread onto a portalled surface's root element. */
export const isolatePointerEvents: Isolated = Object.fromEntries(
  ISOLATED_POINTER_EVENTS.map((name) => [name, stop])
) as Isolated
