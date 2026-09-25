/**
 * `fill_prompt_kit` — a kit and its slot values in, a generate request out. Pure text: the kits
 * and the filling are `@shared/prompt-kits`, where the tests hold them against the model catalog.
 */

import { fillPromptKit } from '@shared/prompt-kits'
import { fail, type Handlers } from './helpers'

export function fillKit(args: Record<string, unknown>): Record<string, unknown> {
  const slots = args.slots === undefined ? {} : args.slots
  if (typeof slots !== 'object' || slots === null || Array.isArray(slots)) {
    fail('slots must be an object of slot values, such as { "subject": "a lighthouse" }.')
  }
  const filled = fillPromptKit(String(args.kit), slots as Record<string, unknown>, { withReference: args.withReference === true })
  if (!filled.ok) fail(filled.error)
  const { ok: _ok, ...rest } = filled
  return {
    ...rest,
    next:
      `Call ${filled.tool} with this request and validateOnly: true to check it and see the price` +
      (filled.reference ? `, adding referenceAssetId — ${filled.reference.replace(/\.$/, '')}` : '') +
      '. Match aspectRatio to the timeline the result will go on.'
  }
}

export const handlers: Handlers = {
  fill_prompt_kit: (args) => fillKit(args)
}
