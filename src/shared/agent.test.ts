/**
 * The approval gate.
 *
 * This is the only thing standing between an agent and a user's timeline, so the tests are
 * written against what a *bypass* would look like rather than against the happy path. Each one
 * names the way an unapproved edit would otherwise get through.
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  argsMatch,
  checkApproval,
  requiresApproval,
  type ApprovedProposal,
  type ProposalOperation
} from './agent'
import { TOOLS } from './mcp'

const op = (index: number, tool: string, args: Record<string, unknown>): ProposalOperation => ({
  index,
  tool,
  args
})

const approval = (operations: ProposalOperation[], consumed: number[] = []): ApprovedProposal => ({
  approvalId: 'apr_1',
  proposalId: 'prp_1',
  option: { id: 'o1', label: 'Tighten the opening', summary: 'x', operations },
  consumed
})

// --- what needs approval at all -----------------------------------------------------------

test('every write tool in the catalog is gated, and every read tool is not', () => {
  // Derived from the catalog rather than a list here, so this cannot drift: a write tool added
  // tomorrow is gated without anyone remembering to edit anything.
  for (const spec of TOOLS) {
    assert.equal(
      requiresApproval(spec.name),
      !spec.readOnly,
      `${spec.name} (readOnly: ${spec.readOnly})`
    )
  }
  // And the catalog actually contains both kinds, or the loop above proves nothing.
  assert.ok(TOOLS.some((t) => t.readOnly), 'no read tools in the catalog')
  assert.ok(TOOLS.some((t) => !t.readOnly), 'no write tools in the catalog')
})

test('an unknown tool is gated rather than waved through', () => {
  // The catalog and the executor are edited by different people. The safe side of a
  // disagreement between them is refusing.
  assert.equal(requiresApproval('some_tool_that_does_not_exist'), true)
})

test('reads run with no approval at all', () => {
  const verdict = checkApproval('read_project', {}, null)
  assert.equal(verdict.allowed, true)
  assert.equal(verdict.refusal, undefined)
})

// --- the gate ------------------------------------------------------------------------------

test('a write with nothing approved is refused, and told how to get approval', () => {
  const verdict = checkApproval('remove_range', { fromFrame: 0, toFrame: 10 }, null)
  assert.equal(verdict.allowed, false)
  assert.match(verdict.refusal ?? '', /nothing has been approved/)
  // The refusal must leave a next move. Naming the readable tools is what makes "plan first"
  // actionable rather than a scolding.
  assert.match(verdict.refusal ?? '', /read_project/)
})

test('an exactly matching call is allowed and names the operation it spent', () => {
  const approved = approval([op(0, 'remove_range', { fromFrame: 300, toFrame: 750 })])
  const verdict = checkApproval('remove_range', { fromFrame: 300, toFrame: 750 }, approved)
  assert.equal(verdict.allowed, true)
  assert.equal(verdict.index, 0)
})

test('the same approval cannot be spent twice', () => {
  // The bypass this stops: approve one ripple delete, run it in a loop.
  const operations = [op(0, 'remove_range', { fromFrame: 300, toFrame: 750 })]
  const first = checkApproval('remove_range', { fromFrame: 300, toFrame: 750 }, approval(operations))
  assert.equal(first.allowed, true)

  const second = checkApproval(
    'remove_range',
    { fromFrame: 300, toFrame: 750 },
    approval(operations, [0])
  )
  assert.equal(second.allowed, false)
  assert.match(second.refusal ?? '', /already been carried out/)
})

test('two identical operations can both run, once each', () => {
  // The inverse of the rule above, and the reason `consumed` holds indices rather than a count
  // of matches: a proposal may legitimately contain the same call twice.
  const operations = [
    op(0, 'split_at', { frame: 100 }),
    op(1, 'split_at', { frame: 100 })
  ]
  assert.equal(checkApproval('split_at', { frame: 100 }, approval(operations)).index, 0)
  assert.equal(checkApproval('split_at', { frame: 100 }, approval(operations, [0])).index, 1)
  assert.equal(checkApproval('split_at', { frame: 100 }, approval(operations, [0, 1])).allowed, false)
})

test('the right tool with drifted arguments is refused, and shown the difference', () => {
  // The most likely real miss: the agent recomputes a frame and is one off.
  const approved = approval([op(0, 'remove_range', { fromFrame: 300, toFrame: 750 })])
  const verdict = checkApproval('remove_range', { fromFrame: 300, toFrame: 751 }, approved)
  assert.equal(verdict.allowed, false)
  assert.match(verdict.refusal ?? '', /751/, 'must show what was attempted')
  assert.match(verdict.refusal ?? '', /750/, 'must show what was approved')
})

test('an approved edit does not authorise a different tool', () => {
  const approved = approval([op(0, 'edit_item', { itemId: 'itm_1', volume: 0.5 })])
  const verdict = checkApproval('delete_items', { itemIds: ['itm_1'] }, approved)
  assert.equal(verdict.allowed, false)
  assert.match(verdict.refusal ?? '', /Still approved/)
  assert.match(verdict.refusal ?? '', /edit_item/)
})

test('extra arguments are not covered by an approval', () => {
  // The sharpest bypass, and the reason matching is exact rather than a subset check: approve
  // a volume change, also change the speed.
  const approved = approval([op(0, 'edit_item', { itemId: 'itm_1', volume: 0.5 })])
  const verdict = checkApproval('edit_item', { itemId: 'itm_1', volume: 0.5, speed: 2 }, approved)
  assert.equal(verdict.allowed, false)
})

test('a refusal always leaves a way forward rather than only saying no', () => {
  const approved = approval([op(0, 'edit_item', { itemId: 'itm_1', volume: 0.5 })])
  for (const verdict of [
    checkApproval('remove_range', { fromFrame: 1, toFrame: 2 }, null),
    checkApproval('remove_range', { fromFrame: 1, toFrame: 2 }, approved),
    checkApproval('edit_item', { itemId: 'itm_1', volume: 0.9 }, approved)
  ]) {
    assert.equal(verdict.allowed, false)
    // Either it says how to get approval, or it says what is already approved. A refusal that
    // does neither ends the run.
    assert.match(verdict.refusal ?? '', /propose|Approved|Still approved/i)
  }
})

// --- argument matching ---------------------------------------------------------------------

test('key order does not change whether a call is approved', () => {
  assert.equal(argsMatch({ a: 1, b: 2 }, { b: 2, a: 1 }), true)
})

test('an absent key and an explicit undefined are the same call', () => {
  // A tool call built from a partial object and one built with an explicit `undefined` are the
  // same call; treating them differently would refuse edits the user did approve.
  assert.equal(argsMatch({ itemId: 'x' }, { itemId: 'x', trackId: undefined }), true)
})

test('nested values are compared structurally, not by reference or key order', () => {
  assert.equal(
    argsMatch({ crop: { left: 0.1, right: 0.2 } }, { crop: { right: 0.2, left: 0.1 } }),
    true
  )
  assert.equal(argsMatch({ crop: { left: 0.1 } }, { crop: { left: 0.2 } }), false)
})

test('array order is significant, because it is significant to the tools', () => {
  // `delete_items` with a ripple removes in order; two orders are two different edits.
  assert.equal(argsMatch({ itemIds: ['a', 'b'] }, { itemIds: ['b', 'a'] }), false)
  assert.equal(argsMatch({ itemIds: ['a', 'b'] }, { itemIds: ['a', 'b'] }), true)
})

test('types are not coerced', () => {
  // "300" and 300 reaching the same tool would be a bug worth catching, not smoothing over.
  assert.equal(argsMatch({ frame: 300 }, { frame: '300' }), false)
  assert.equal(argsMatch({ ripple: true }, { ripple: 'true' }), false)
  assert.equal(argsMatch({ a: null }, { a: undefined }), false)
})
