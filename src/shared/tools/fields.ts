/**
 * Schema fragments more than one tool uses. Kept identical across tools on purpose: an agent
 * that learns what `itemId` means from one tool should find the same words in the next.
 */

export const frames = (description: string): Record<string, unknown> => ({
  type: 'integer',
  minimum: 0,
  description
})

export const itemId = {
  type: 'string',
  description:
    'Item id from read_project or inspect_item. The first 10 characters are enough; ' +
    'ids are never invented, always copied from a tool result.'
}
