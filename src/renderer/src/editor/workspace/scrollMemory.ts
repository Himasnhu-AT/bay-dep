/**
 * Where a hosted region was scrolled, kept across the move a page switch makes.
 *
 * `appendChild` moves a hosted node without remounting anything, but Chromium drops the scroll
 * offset of every scroller inside the moved subtree — measured on the timeline: scrolled to
 * 5000/274, Edit → Audio → Edit read 0/0, the same through Color and Deliver. So the offsets are
 * remembered as the user scrolls (a capture listener on the hosted node; `scroll` does not bubble)
 * and put back right after each move.
 *
 * A scroller with no box — the parked node is `display: none`, and a page may give the region no
 * height — reads its offsets clamped to 0 and reports that as a scroll. That is not a position
 * anyone chose, so it is not recorded: the last one seen with a box is kept. Nor is the clamp a
 * restore itself meets on a page where the region is shorter (Edit 274px down, Audio's taller
 * timeline allows 107): the scroll event that restore causes is its own, and believing it
 * brought Edit back at 107.
 */

export interface Scrollable {
  scrollLeft: number
  scrollTop: number
  clientWidth: number
  clientHeight: number
}

export class ScrollMemory<E extends Scrollable> {
  #marks = new Map<E, { left: number; top: number }>()
  /** Where a restore left each scroller, clamped or not: the scroll event that follows is ours. */
  #restored = new Map<E, { left: number; top: number }>()

  /** A scroll event from `element`. */
  record(element: E): void {
    if (element.clientWidth === 0 || element.clientHeight === 0) return
    const restored = this.#restored.get(element)
    this.#restored.delete(element)
    if (restored && restored.left === element.scrollLeft && restored.top === element.scrollTop) return
    if (element.scrollLeft === 0 && element.scrollTop === 0) this.#marks.delete(element)
    else this.#marks.set(element, { left: element.scrollLeft, top: element.scrollTop })
  }

  /** After a move: every remembered scroller still inside back where it was. */
  restore(stillInside: (element: E) => boolean): void {
    for (const [element, mark] of this.#marks) {
      if (!stillInside(element)) {
        this.#marks.delete(element)
        continue
      }
      element.scrollLeft = mark.left
      element.scrollTop = mark.top
      this.#restored.set(element, { left: element.scrollLeft, top: element.scrollTop })
    }
  }
}
