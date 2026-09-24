/**
 * The inspector's writes that mirror an agent tool go through **the tool's own executor** —
 * `editItem` for J/L cuts, ducking and key edits, `editAsset` for a name or a title's words — so
 * what a person sets here is validated by the same rules and stored in exactly the shape the
 * agent's `inspect_item` reads back. A second implementation of "set a duck" would be the second
 * opinion this codebase keeps having to delete.
 *
 * Called directly rather than through `executeToolCall`, which wraps the call in `asAgent`: these
 * are the person's edits, and the turn's Changes card must say so.
 */

import { editAsset } from '@/mcp/assets'
import { ToolError } from '@/mcp/helpers'
import { editItem } from '@/mcp/write'
import { useEditor } from '@/store/editor'

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * `edit_item` over each item, as one undo step. An item the tool refuses (a J-cut on a clip with
 * no sound) is skipped and named, and the rest still apply — refusing four clips because the
 * fifth cannot take a duck would be a worse answer than doing the four and saying which one did
 * not. Returns how many applied.
 */
export function editItems(
  itemIds: readonly string[],
  args: (itemId: string) => Record<string, unknown>
): number {
  const store = useEditor.getState()
  const errors: string[] = []
  let applied = 0
  store.transact(() => {
    for (const itemId of itemIds) {
      try {
        editItem({ itemId, ...args(itemId) })
        applied += 1
      } catch (error) {
        if (!(error instanceof ToolError)) throw error
        errors.push(message(error))
      }
    }
  })
  if (errors.length > 0) {
    const lead = itemIds.length > 1 ? `Applied to ${applied} of ${itemIds.length} clips. ` : ''
    store.notify(`${lead}${errors[0]}`, 'error')
  }
  return applied
}

/** `edit_asset` for one asset. The tool's refusal ("name is empty") becomes the toast. */
export function editAssetFields(assetId: string, fields: { name?: string; text?: string }): boolean {
  try {
    editAsset({ assetId, ...fields })
    return true
  } catch (error) {
    if (!(error instanceof ToolError)) throw error
    useEditor.getState().notify(message(error), 'error')
    return false
  }
}
