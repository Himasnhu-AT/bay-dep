import { useEffect, useState, type RefObject } from 'react'

/**
 * Whether an element is narrower than `width` px, tracked as it resizes. The inspector's tab row
 * drops to icons below its threshold rather than truncating seven labels into "Vi… Ti… Au…".
 */
export function useNarrow(ref: RefObject<HTMLElement | null>, width: number): boolean {
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const element = ref.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const measure = (): void => setNarrow(element.getBoundingClientRect().width < width)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref, width])
  return narrow
}
