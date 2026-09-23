/**
 * `propose_edit` — how a plan reaches the approval card.
 *
 * The gate in `@shared/agent` refused every write in an agent session until something was
 * approved, and nothing could ever be approved: no tool produced a proposal and the stream parser
 * had no proposal handling, so the card had only ever been driven by a probe. An in-app agent
 * could read and talk and never change a frame. This is the missing producer.
 *
 * It is a tool rather than markup in the agent's prose, because a tool call arrives already
 * structured and already validated against a schema, while markup has to be found in a stream
 * of text deltas, reassembled, and parsed — and a parse failure there is silent: the card simply
 * does not appear, and the model believes it asked.
 */

import { buildProposal, type Proposal } from '@shared/agent'
import { newId } from '@/store/editor'
import { fail, store } from './helpers'
import { validateArgs } from '@shared/validate'

export function proposeEdit(args: Record<string, unknown>): Record<string, unknown> {
  // No gate means nothing to approve: either "Ask before editing" is off (the agent edits
  // directly, and the turn's Changes card is the review), or this is a terminal client over the
  // socket, with a person watching every call. Presenting a card here would be worse than
  // useless — approving it would *create* a gate, and lock out the client that asked.
  if (!store().agentGate) {
    return {
      needed: false,
      message:
        'Nothing is gated: "Ask before editing" is off, or no in-app session is running. ' +
        'Make the edit directly.'
    }
  }

  const built = buildProposal(args, validateArgs, newId)
  if (!built.ok) fail(built.error)

  present(built.proposal)
  return {
    needed: true,
    proposalId: built.proposal.id,
    status: 'awaiting-approval',
    options: built.proposal.options.map((option) => ({
      label: option.label,
      operations: option.operations.length
    })),
    message:
      'The plan is in front of the user. End your turn now and wait — their decision arrives as ' +
      'their next message. Until then every change is refused.'
  }
}

function present(proposal: Proposal): void {
  store().applyAgentEvent({ type: 'proposal', runId: 'executor', proposal })
}
