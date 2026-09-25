/**
 * Delivering one user message to the running conversation: checked, its attachments prepared,
 * then handed to the runtime — in the order the user sent them, to the conversation they were
 * sent to.
 *
 * Split from `host.ts` (which needs Electron) so the ordering and the checks around the await run
 * under `pnpm test`. Three things this guarantees that a plain `async` handler did not:
 *
 * - **Order.** Messages are delivered one at a time, in arrival order. A message with a video
 *   takes seconds to prepare; a text-only message sent after it used to overtake it, and the model
 *   read the follow-up before the question it followed.
 * - **The same conversation.** The runtime is captured before preparing and checked after. If the
 *   conversation was disposed or replaced by another provider meanwhile, the message is refused
 *   rather than sent into a conversation the user did not write it to.
 * - **Stop means stop.** `cancel()` kills every preparation in flight (its ffmpeg runs are
 *   aborted) and refuses every message queued behind it, so a stop is not followed by a message
 *   the user had already given up on.
 */

import { validateAttachments, type AgentAttachmentInput } from '@shared/agent-attachments'
import type { PreparedAttachment } from './attachments'

/** The part of a runtime delivery needs. */
export interface DeliveryTarget {
  send(text: string, images?: readonly string[]): unknown
}

export type Prepared = { ok: true; attachments: PreparedAttachment[] } | { ok: false; error: string }

export interface DeliveryDeps {
  /** The conversation now, or null when none is running. */
  runtime(): DeliveryTarget | null
  /** Prepares one message's attachments; `signal` aborts it. */
  prepare(inputs: readonly AgentAttachmentInput[], signal: AbortSignal): Promise<Prepared>
  /** The text the model receives for a message and its prepared attachments. */
  compose(text: string, attachments: readonly PreparedAttachment[]): string
}

export type DeliveryResult = { ok: true } | { ok: false; error: string }

export class MessageDelivery {
  readonly #deps: DeliveryDeps
  #chain: Promise<unknown> = Promise.resolve()
  /** Bumped by `cancel`: a message whose epoch is older was sent before the stop. */
  #epoch = 0
  readonly #inflight = new Set<AbortController>()

  constructor(deps: DeliveryDeps) {
    this.#deps = deps
  }

  /** Queues one message behind every message sent before it. */
  send(text: string, attachments?: unknown): Promise<DeliveryResult> {
    const epoch = this.#epoch
    const run = this.#chain.then(() => this.#deliver(text, attachments, epoch))
    this.#chain = run.catch(() => undefined)
    return run
  }

  /** Aborts every preparation in flight and refuses every message not yet handed over. */
  cancel(): void {
    this.#epoch += 1
    for (const controller of this.#inflight) controller.abort()
  }

  async #deliver(text: string, attachments: unknown, epoch: number): Promise<DeliveryResult> {
    const stopped: DeliveryResult = { ok: false, error: 'The conversation was stopped before this message was sent, so it was not sent.' }
    if (epoch !== this.#epoch) return stopped
    const target = this.#deps.runtime()
    if (!target) return { ok: false, error: 'No agent conversation is running. Start one first.' }
    const checked = validateAttachments(attachments)
    if (!checked.ok) return { ok: false, error: checked.error }

    let images: string[] = []
    let message = text
    if (checked.attachments.length > 0) {
      const controller = new AbortController()
      this.#inflight.add(controller)
      let prepared: Prepared
      try {
        prepared = await this.#deps.prepare(checked.attachments, controller.signal)
      } catch (error) {
        prepared = { ok: false, error: `The attachments could not be prepared: ${(error as Error).message}` }
      } finally {
        this.#inflight.delete(controller)
      }
      if (epoch !== this.#epoch) return stopped
      if (!prepared.ok) return prepared
      images = prepared.attachments.map((a) => a.path)
      message = this.#deps.compose(text, prepared.attachments)
    }
    // Preparing takes a moment; the conversation may have been disposed or replaced meanwhile,
    // and a message written to one conversation must not arrive in another.
    if (this.#deps.runtime() !== target) {
      return { ok: false, error: 'The conversation ended or was replaced while this message was being prepared, so it was not sent. Send it again.' }
    }
    try {
      target.send(message, images)
      return { ok: true }
    } catch (error) {
      return { ok: false, error: (error as Error).message }
    }
  }
}
