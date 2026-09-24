/**
 * The pointer gestures the shortcuts sheet lists under "Mouse gestures". They are not commands —
 * a drag has no key to put in the registry — so they are written out here, once, next to the
 * sheet that shows them. Each names where the gesture happens and what the modifier changes,
 * because a modifier held over the wrong part of a clip does something else (⌥ on an edge rolls,
 * ⌥ on the body slips).
 *
 * bay ships for the Mac only, so the modifiers are drawn as the Mac draws them.
 */

export interface MouseGesture {
  label: string
  /** How to do it, as the sheet draws it in the key column. */
  how: string
}

export interface MouseGestureGroup {
  group: string
  gestures: readonly MouseGesture[]
}

export const MOUSE_GESTURES: readonly MouseGestureGroup[] = [
  {
    group: 'Timeline',
    gestures: [
      { label: 'Move clips (⌘ suspends snapping)', how: 'Drag clip' },
      { label: 'Trim one side of a cut', how: 'Drag clip edge' },
      { label: 'Slip: change which footage plays', how: '⌥ Drag clip' },
      { label: 'Slide: move a clip between neighbours', how: '⌥⇧ Drag clip' },
      { label: 'Roll: move a cut, trimming both sides', how: '⌥ Drag clip edge' },
      { label: 'Cut a clip (Blade tool)', how: 'Click clip' },
      { label: 'Cut every track (Blade tool)', how: '⇧ Click clip' },
      { label: 'Select clips in a box', how: 'Drag empty lane' },
      { label: 'Add to the selection', how: '⇧ Click clip' },
      { label: 'Toggle a clip in the selection', how: '⌘ Click clip' },
      { label: 'Fade in or out', how: 'Drag top corner' },
      { label: 'Clip volume', how: 'Drag level line' }
    ]
  },
  {
    group: 'Viewer',
    gestures: [
      { label: 'Move the selected clip', how: 'Drag clip' },
      { label: 'Resize (⇧ keeps shape, ⌥ from centre)', how: 'Drag handle' },
      { label: 'Rotate (⇧ in 15° steps)', how: 'Drag knob' },
      { label: 'Crop, in crop mode (⇧ both sides)', how: 'Drag edge' }
    ]
  }
]
