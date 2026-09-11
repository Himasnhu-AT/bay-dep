import { useShallow } from 'zustand/react/shallow'
import type { Item } from '@shared/project'
import { selectSelectedItems, useEditor } from '@/store/editor'

/**
 * The selected items, subscribed safely.
 *
 * `selectSelectedItems` builds a fresh array on every call, and zustand v5 hands the
 * selector's result straight to `useSyncExternalStore` — an unmemoised array there is a
 * new snapshot on every store notification, which React reports as "the result of
 * getSnapshot should be cached" and can spin into a render loop. `useShallow` compares the
 * elements instead of the array, so moving the playhead 30 times a second no longer
 * re-renders the inspector.
 */
export function useSelectedItems(): Item[] {
  return useEditor(useShallow(selectSelectedItems))
}
