/**
 * The worker a `.brf` module runs in: one per module, so no module can reach another's globals.
 *
 * Its first act is `lockdown` (`@shared/brf-lockdown`): the network, code loading, storage and
 * every way to make new code are removed before any user code exists here, and the one message
 * handler is installed before the ways to add another are. After that it only ever compiles one
 * source, then turns frame numbers into scene documents for the compositor to paint
 * (`./brfWorkerCore.ts`).
 *
 * It has no bridge to main — a worker never does — and main cancels every remote request from
 * this window's session (`src/main/offline.ts`), so the lockdown is not the only wall.
 */

import { lockdown } from '@shared/brf-lockdown'
import { createHandler } from './brfWorkerCore'
import type { BrfWorkerRequest } from './brfCode'

let handle: ((request: BrfWorkerRequest) => unknown) | null = null
const { makeFunction, post } = lockdown(self as never, (data) => {
  if (handle) post(handle(data as BrfWorkerRequest))
})
handle = createHandler(makeFunction)
