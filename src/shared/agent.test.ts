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
  formatElapsed,
  approvalMessage,
  argsMatch,
  buildProposal,
  checkApproval,
  MAX_PROPOSAL_OPTIONS,
  requiresApproval,
  type AgentGate,
  type ProposalOperation
} from './agent'
import { TOOLS } from './mcp'
import { validateArgs } from './validate'

const op = (index: number, tool: string, args: Record<string, unknown>): ProposalOperation => ({
  index,
  tool,
  args
})

/** A gated session with this plan approved. */
const approval = (operations: ProposalOperation[], consumed: number[] = []): AgentGate => ({
  approved: {
    approvalId: 'apr_1',
    proposalId: 'prp_1',
    option: { id: 'o1', label: 'Tighten the opening', summary: 'x', operations },
    consumed
  }
})

/** A gated session with nothing approved yet. */
const gatedButUnapproved: AgentGate = { approved: null }

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

test('reads run inside a gated session with nothing approved', () => {
  const verdict = checkApproval('read_project', {}, gatedButUnapproved)
  assert.equal(verdict.allowed, true)
  assert.equal(verdict.refusal, undefined)
})

test('with no session at all, nothing is gated — not even writes', () => {
  // This is bay answering Claude Code over the socket: the person is in a terminal watching
  // every call go past, and there is no panel to approve anything in. The first version of
  // this file refused here regardless of who was asking, which locked out the surface bay
  // already ships — a broken probe run is what surfaced it. The gate exists to stop an agent
  // *deviating from an approved plan*, not to require a plan for every edit.
  for (const tool of ['remove_range', 'edit_item', 'delete_items', 'export_timeline']) {
    const verdict = checkApproval(tool, { anything: true }, null)
    assert.equal(verdict.allowed, true, `${tool} must not be gated without a session`)
  }
})

// --- the gate ------------------------------------------------------------------------------

test('inside a session, a write with nothing approved is refused and told how to proceed', () => {
  const verdict = checkApproval('remove_range', { fromFrame: 0, toFrame: 10 }, gatedButUnapproved)
  assert.equal(verdict.allowed, false)
  assert.match(verdict.refusal ?? '', /nothing has been approved/)
  // The refusal must leave a next move. Naming the readable tools is what makes "plan first"
  // actionable rather than a scolding.
  assert.match(verdict.refusal ?? '', /read_project/)
  // And it names the tool that makes a proposal. "Propose first" with no way to propose is the
  // dead end this gate sat in until propose_edit existed.
  assert.match(verdict.refusal ?? '', /propose_edit/)
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
    checkApproval('remove_range', { fromFrame: 1, toFrame: 2 }, gatedButUnapproved),
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

// --- building a proposal ------------------------------------------------------------------

let counter = 0
const ids = (prefix: string): string => `${prefix}_${++counter}`
const build = (raw: Record<string, unknown>): ReturnType<typeof buildProposal> =>
  buildProposal(raw, validateArgs, ids)

const trim = {
  label: 'Tighten the opening',
  summary: 'Drops the false start before the first line.',
  operations: [{ tool: 'remove_range', args: { fromFrame: 0, toFrame: 45 } }]
}

test('propose_edit is in the catalog and is not itself gated', () => {
  // If proposing needed approval, nothing could ever be approved: the gate would require the
  // one thing it exists to wait for.
  const spec = TOOLS.find((t) => t.name === 'propose_edit')
  assert.ok(spec, 'propose_edit is missing from the catalog')
  assert.equal(requiresApproval('propose_edit'), false)
  const inSession = checkApproval('propose_edit', { question: 'q', options: [] }, gatedButUnapproved)
  assert.equal(inSession.allowed, true)
})

test('a valid proposal builds, and what it builds is what the gate then admits', () => {
  const built = build({ question: 'Cut the false start?', options: [trim] })
  assert.ok(built.ok, built.ok ? '' : built.error)
  const option = built.proposal.options[0]!
  assert.deepEqual(option.operations, [
    { index: 0, tool: 'remove_range', args: { fromFrame: 0, toFrame: 45 } }
  ])
  // The round trip that matters: approve what was built, and the call the model makes from the
  // approval message goes through — while the same tool with a drifted bound does not.
  const gate: AgentGate = {
    approved: { approvalId: 'a', proposalId: built.proposal.id, option, consumed: [] }
  }
  assert.equal(checkApproval('remove_range', { fromFrame: 0, toFrame: 45 }, gate).allowed, true)
  assert.equal(checkApproval('remove_range', { fromFrame: 0, toFrame: 46 }, gate).allowed, false)
})

test('an operation that would be refused later is refused now, naming where and why', () => {
  // The failure this prevents: approve a four-step plan, watch steps one and two apply, and
  // step three bounce off the schema — a half-edited timeline nobody agreed to.
  const bad = {
    ...trim,
    operations: [
      { tool: 'remove_range', args: { fromFrame: 0, toFrame: 45 } },
      { tool: 'edit_item', args: { itemId: 'abc', volumee: 0.5 } }
    ]
  }
  const built = build({ question: 'q', options: [bad] })
  assert.equal(built.ok, false)
  const error = built.ok ? '' : built.error
  assert.match(error, /Option 1 \("Tighten the opening"\), operation 2 \(edit_item\)/)
  assert.match(error, /volumee/)
  // …and names what IS accepted, so the next call can be right.
  assert.match(error, /"volume"/)

  // Positive control: the same plan with the field spelled right builds.
  const fixed = { ...bad, operations: [bad.operations[0]!, { tool: 'edit_item', args: { itemId: 'abc', volume: 0.5 } }] }
  assert.equal(build({ question: 'q', options: [fixed] }).ok, true)
})

test('a missing required argument is caught at proposal time', () => {
  const built = build({
    question: 'q',
    options: [{ ...trim, operations: [{ tool: 'remove_range', args: { fromFrame: 0 } }] }]
  })
  assert.equal(built.ok, false)
  assert.match(built.ok ? '' : built.error, /requires "toFrame"/)
})

test('a read inside a plan is refused, with the reason and the alternative', () => {
  const built = build({
    question: 'q',
    options: [{ ...trim, operations: [{ tool: 'read_project', args: {} }] }]
  })
  assert.equal(built.ok, false)
  assert.match(built.ok ? '' : built.error, /only reads.*Call it directly/)
})

test('an unknown tool is refused and the proposable ones are listed', () => {
  const built = build({
    question: 'q',
    options: [{ ...trim, operations: [{ tool: 'ripple_delete', args: {} }] }]
  })
  assert.equal(built.ok, false)
  const error = built.ok ? '' : built.error
  assert.match(error, /no tool "ripple_delete"/)
  assert.match(error, /remove_range/)
  // Reads are not offered as proposable.
  assert.doesNotMatch(error.split('proposed:')[1] ?? '', /read_project/)
})

test('the client namespace prefix is accepted and stripped', () => {
  // Claude Code names bay's tools mcp__bay__x in its own transcript, and a model that copies
  // the name it sees must not be refused for it — nor approved under a name the gate never
  // sees, since the executor matches on the bare name.
  const built = build({
    question: 'q',
    options: [{ ...trim, operations: [{ tool: 'mcp__bay__remove_range', args: { fromFrame: 0, toFrame: 45 } }] }]
  })
  assert.ok(built.ok)
  assert.equal(built.proposal.options[0]!.operations[0]!.tool, 'remove_range')
})

test('shape errors each say what the field must be', () => {
  const cases: [Record<string, unknown>, RegExp][] = [
    [{ options: [trim] }, /"question"/],
    [{ question: 'q', options: [] }, /non-empty array/],
    [{ question: 'q', options: Array(MAX_PROPOSAL_OPTIONS + 1).fill(trim) }, /at most 4 options/],
    [{ question: 'q', options: [{ ...trim, label: '' }] }, /"label"/],
    [{ question: 'q', options: [{ ...trim, summary: '' }] }, /"summary"/],
    [{ question: 'q', options: [{ ...trim, operations: [] }] }, /"operations"/],
    [{ question: 'q', options: [{ ...trim, operations: [{ tool: 'remove_range', args: [1] }] }] }, /"args" must be an object/]
  ]
  for (const [raw, expected] of cases) {
    const built = build(raw)
    assert.equal(built.ok, false, JSON.stringify(raw))
    assert.match(built.ok ? '' : built.error, expected)
  }
  // Positive control: exactly MAX options is fine.
  assert.equal(build({ question: 'q', options: Array(MAX_PROPOSAL_OPTIONS).fill(trim) }).ok, true)
})

test('the approval message repeats every call byte for byte, in order', () => {
  // The model works from this message, and the gate matches exactly. Paraphrase here is drift
  // there.
  const built = build({
    question: 'q',
    options: [
      {
        ...trim,
        operations: [
          { tool: 'remove_range', args: { fromFrame: 0, toFrame: 45 } },
          { tool: 'set_playhead', args: { frame: 0 } }
        ]
      }
    ]
  })
  assert.ok(built.ok)
  const message = approvalMessage(built.proposal.options[0]!)
  assert.match(message, /1\. remove_range \{"fromFrame":0,"toFrame":45\}/)
  assert.match(message, /2\. set_playhead \{"frame":0\}/)
  assert.ok(message.indexOf('remove_range') < message.indexOf('set_playhead'))
})

// --- dry runs ------------------------------------------------------------------------------

test('a dry run passes the gate with nothing approved, and the same call without it does not', () => {
  // The pair is the test. A gate that let everything through would pass the first half alone,
  // and one that refused everything would pass the second half alone.
  const args = { fromFrame: 0, toFrame: 45 }
  const dry = checkApproval('remove_range', { ...args, validateOnly: true }, gatedButUnapproved)
  assert.equal(dry.allowed, true, dry.refusal)
  assert.equal(dry.index, undefined, 'a dry run must not name an operation to spend')

  const real = checkApproval('remove_range', args, gatedButUnapproved)
  assert.equal(real.allowed, false)
  assert.match(real.refusal ?? '', /propose_edit/)

  // validateOnly: false is an ordinary call, and is gated like one.
  const explicitFalse = checkApproval(
    'remove_range',
    { ...args, validateOnly: false },
    gatedButUnapproved
  )
  assert.equal(explicitFalse.allowed, false)
})

test('a dry run does not spend the approval the real call needs', () => {
  const operations = [op(0, 'remove_range', { fromFrame: 0, toFrame: 45 })]
  const dry = checkApproval(
    'remove_range',
    { fromFrame: 0, toFrame: 45, validateOnly: true },
    approval(operations)
  )
  assert.equal(dry.allowed, true)
  assert.equal(dry.index, undefined)
  // Nothing was consumed, so the real call still matches operation 0.
  const real = checkApproval('remove_range', { fromFrame: 0, toFrame: 45 }, approval(operations))
  assert.equal(real.index, 0)
})

test('validateOnly on a tool that cannot dry-run is not a way past the gate', () => {
  // export_timeline writes a file. If the executor ever failed to refuse the flag, a gate that
  // trusted it would have let an unapproved encode run.
  const spec = TOOLS.find((t) => t.name === 'export_timeline')
  assert.ok(spec && !spec.readOnly && !spec.dryRunnable, 'specimen must be gated and not dry-runnable')
  const verdict = checkApproval(
    'export_timeline',
    { outputPath: '/tmp/x.mp4', format: 'mp4', validateOnly: true },
    gatedButUnapproved
  )
  assert.equal(verdict.allowed, false)
})

test('validateOnly on a self-validating generate tool passes the gate; the paid call does not', () => {
  const args = { model: 'veo-3.1-generate-preview', prompt: 'a lighthouse at dusk' }
  const dry = checkApproval('generate_video', { ...args, validateOnly: true }, gatedButUnapproved)
  assert.equal(dry.allowed, true)
  assert.equal(dry.index, undefined)
  // Positive control for the gate: the same call without the flag is a paid job, and is refused.
  const real = checkApproval('generate_video', args, gatedButUnapproved)
  assert.equal(real.allowed, false)
  assert.match(real.refusal ?? '', /propose_edit/)
})

test('a dry run inside a proposal is refused, and told to make it directly', () => {
  const built = build({
    question: 'q',
    options: [
      {
        ...trim,
        operations: [
          { tool: 'remove_range', args: { fromFrame: 0, toFrame: 45, validateOnly: true } }
        ]
      }
    ]
  })
  assert.equal(built.ok, false)
  assert.match(built.ok ? '' : built.error, /need no approval/)
  assert.match(built.ok ? '' : built.error, /without validateOnly/)
  // Positive control: the same operation without the flag builds.
  assert.equal(build({ question: 'q', options: [trim] }).ok, true)
})

// --- the Script surface through the gate --------------------------------------------------

test('apply_script is gated, and read_script is not', () => {
  assert.equal(requiresApproval('apply_script'), true)
  assert.equal(requiresApproval('read_script'), false)
  assert.equal(checkApproval('read_script', {}, gatedButUnapproved).allowed, true)
  assert.equal(checkApproval('apply_script', { script: 'x' }, gatedButUnapproved).allowed, false)
})

test('a proposal carrying a whole script builds, and admits exactly that script', () => {
  // A script is long, multi-line and full of characters a paraphrase would normalise — the
  // arrow, the middle dot, escaped quotes — which is the case where exact matching would break
  // first if it were anything less than exact.
  const script = [
    '# Script · Interview',
    '',
    'timeline: tl_main',
    'rev: 0123abcd',
    'fps: 30',
    'ripple: on',
    '',
    '## V1 · video · [trk_v1]',
    '- [itm_1] 00:00:00:00 → 00:00:03:00 · goodall.mp4 · src 10.000s',
    '## V2 · video · [trk_v2]',
    '- [itm_2] 00:00:00:15 → 00:00:02:00 · text · "Jane \\"JG\\" Goodall"'
  ].join('\n')
  const built = build({
    question: 'Drop the b-roll and retitle?',
    options: [
      {
        label: 'Tighten',
        summary: 'Removes the b-roll shot and closes the gap.',
        operations: [{ tool: 'apply_script', args: { script } }]
      }
    ]
  })
  assert.ok(built.ok, built.ok ? '' : built.error)
  const option = built.proposal.options[0]!
  assert.deepEqual(option.operations, [{ index: 0, tool: 'apply_script', args: { script } }])

  const gate: AgentGate = {
    approved: { approvalId: 'a', proposalId: built.proposal.id, option, consumed: [] }
  }
  const verdict = checkApproval('apply_script', { script }, gate)
  assert.equal(verdict.allowed, true)
  assert.equal(verdict.index, 0)
  // One character of drift is a different edit, and is refused with the approved script shown.
  const drifted = checkApproval('apply_script', { script: script.replace('ripple: on', 'ripple: off') }, gate)
  assert.equal(drifted.allowed, false)
  assert.match(drifted.refusal ?? '', /ripple: on/)
})

test('a proposal whose apply_script has no script is refused when proposed', () => {
  const built = build({
    question: 'q',
    options: [{ label: 'x', summary: 'y', operations: [{ tool: 'apply_script', args: {} }] }]
  })
  assert.equal(built.ok, false)
  assert.match(built.ok ? '' : built.error, /apply_script.*script/)
})

test('elapsed time reads the way a person says it', () => {
  assert.deepEqual([0, 8.4, 60, 72, 144, 600, 725].map(formatElapsed), ['0s', '8s', '1m', '1m 12s', '2m 24s', '10m', '12m'])
})

// --- tokens ----------------------------------------------------------------------------------

test('token counts read at a glance', async () => {
  const { formatTokens, formatUsd } = await import('./agent')
  assert.deepEqual(
    [0, 950, 1000, 1234, 12_400, 110_662, 999_949, 1_250_000].map(formatTokens),
    ['0', '950', '1k', '1.23k', '12.4k', '110.7k', '999.9k', '1.25M']
  )
  assert.deepEqual([0, 0.0004, 0.014166, 1.2].map(formatUsd), ['$0.000', '<$0.001', '$0.014', '$1.20'])
})

test('a turn’s line names the cached part and the cost only when there are any', async () => {
  const { describeUsage } = await import('./agent')
  assert.equal(
    describeUsage({ inputTokens: 110_662, cachedInputTokens: 87_808, outputTokens: 1256, costUsd: 0.041 }),
    '110.7k in (87.8k cached) · 1.26k out · $0.041'
  )
  assert.equal(describeUsage({ inputTokens: 500, cachedInputTokens: 0, outputTokens: 20 }), '500 in · 20 out')
})

test('the conversation total sums its turns, and drops the cost if any turn had none', async () => {
  const { conversationUsage } = await import('./agent')
  const priced = { kind: 'usage' as const, id: 'a', usage: { inputTokens: 100, cachedInputTokens: 40, outputTokens: 10, costUsd: 0.5 } }
  const unpriced = { kind: 'usage' as const, id: 'b', usage: { inputTokens: 50, cachedInputTokens: 0, outputTokens: 5 } }
  const words = { kind: 'assistant' as const, id: 'c', text: 'hi' }
  assert.equal(conversationUsage([words]), null)
  assert.deepEqual(conversationUsage([priced, words, priced]), {
    turns: 2,
    inputTokens: 200,
    cachedInputTokens: 80,
    outputTokens: 20,
    costUsd: 1
  })
  // A total over some turns' cost would read as the whole conversation's.
  assert.deepEqual(conversationUsage([priced, unpriced]), { turns: 2, inputTokens: 150, cachedInputTokens: 40, outputTokens: 15 })
})
