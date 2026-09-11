import { useEffect, useState, type RefObject } from 'react'

export interface Size {
  width: number
  height: number
}

/**
 * The observed content-box size of an element. The preview needs this because letterboxing
 * is arithmetic on real pixels, not something CSS `object-fit` can do for a `<canvas>`
 * whose backing store has to be resized to match.
 */
export function useElementSize(ref: RefObject<HTMLElement | null>): Size {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 })

  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const box = entry.contentRect
      setSize((previous) =>
        previous.width === box.width && previous.height === box.height
          ? previous
          : { width: box.width, height: box.height }
      )
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])

  return size
}
