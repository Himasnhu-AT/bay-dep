/**
 * The generated guides cannot drift from the catalog: the tool reference names every tool and
 * every argument, and every call in the worked examples is one bay would accept.
 *
 * "Accept" is checked by the same code bay runs, not by a copy of its rules: `validateArgs` for
 * each call's shape, `buildProposal` for each `propose_edit`, and `checkApproval` for each write
 * made after an approval — so an example that teaches a call the gate would refuse fails here.
 *
 * Run with `pnpm test`, or on its own:
 *   node --import ./src/test-hooks.mjs --test src/shared/guides.test.ts
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findTool, TOOLS, type ToolSpec } from './mcp'
import { validateArgs } from './validate'
import { buildProposal, checkApproval, type AgentGate } from './agent'
import { findTemplate } from './templates'
import { EXAMPLES, examplesGuide, isCall, toolReference } from './guides'
import { findResource } from './resources'

// ---------------------------------------------------------------------------
// bay://guide/tools
// ---------------------------------------------------------------------------

test('the tool reference names every catalog tool, and says whether it writes', () => {
  const reference = toolReference(TOOLS)
  for (const tool of TOOLS) {
    const heading = `### \`${tool.name}\``
    const at = reference.indexOf(heading)
    assert.ok(at >= 0, `${tool.name} is missing from bay://guide/tools`)
    const next = reference.indexOf('\n### ', at + 1)
    const section = reference.slice(at, next < 0 ? undefined : next)
    assert.match(
      section,
      tool.readOnly ? /\*Read-only\*/ : /\*Writes\*/,
      `${tool.name} is described with the wrong read/write marker`
    )
    // Every argument by name, and the description's opening, so it is the catalog's own text.
    for (const name of Object.keys(tool.inputSchema.properties)) {
      assert.ok(section.includes(`\`${name}\``), `${tool.name}.${name} is missing from its section`)
    }
    assert.ok(section.includes(tool.description.trim().slice(0, 60)), `${tool.name}'s description`)
  }
})

test('required arguments and enum choices come through from the schema', () => {
  const reference = toolReference(TOOLS)
  const removeRange = findTool('remove_range')!
  for (const name of removeRange.inputSchema.required ?? []) {
    assert.match(reference, new RegExp(`\`${name}\` \\([^)]*\\*\\*required\\*\\*`))
  }
  // A choice list taken from the schema, not typed here: the check moves with the catalog.
  const kinds = (findTool('add_transition')!.inputSchema.properties.kind as { enum: string[] }).enum
  for (const kind of kinds) assert.ok(reference.includes(`\`${kind}\``), `transition kind ${kind}`)
})

test('the reference is generated, so a tool added to the catalog appears without an edit', () => {
  // The positive control for "generated": hand the generator a catalog with a tool it has never
  // seen. A hand-written reference would pass the test above and fail this one.
  const invented: ToolSpec = {
    name: 'zz_invented_tool',
    description: 'A tool that exists only in this test, to prove the text follows the catalog.',
    category: 'write',
    readOnly: false,
    inputSchema: { type: 'object', properties: { zzArgument: { type: 'integer', minimum: 3 } } }
  }
  const reference = toolReference([...TOOLS, invented])
  assert.ok(reference.includes('### `zz_invented_tool`'))
  assert.ok(reference.includes('`zzArgument` (integer, ≥ 3, optional)'))
})

// ---------------------------------------------------------------------------
// bay://guide/examples
// ---------------------------------------------------------------------------

test('the examples cover the edits the guide promises', () => {
  const tools = new Set(EXAMPLES.flatMap((e) => e.steps.filter(isCall).map((s) => s.tool)))
  for (const promised of ['remove_range', 'add_template', 'write_composition', 'add_transition', 'propose_edit']) {
    assert.ok(tools.has(promised), `no worked example uses ${promised}`)
  }
})

test('every call in every example names a real tool with arguments bay would accept', () => {
  let checked = 0
  for (const example of EXAMPLES) {
    for (const step of example.steps.filter(isCall)) {
      const where = `"${example.title}": ${step.tool}`
      const spec = findTool(step.tool)
      assert.ok(spec, `${where} is not a tool in the catalog`)
      assert.equal(validateArgs(spec, step.args), null, `${where} would be refused`)
      assert.ok(step.note.length > 20, `${where} has no note saying why`)
      checked += 1
    }
  }
  assert.ok(checked >= 15, `only ${checked} calls were checked — did the walk find the steps?`)
})

test('template variables in the examples are ones the template declares', () => {
  // `variables` is an open object in the schema, so validateArgs cannot see a misspelled id;
  // add_template refuses one at run time. Checked against the template catalog instead.
  for (const step of EXAMPLES.flatMap((e) => e.steps.filter(isCall))) {
    if (step.tool !== 'add_template') continue
    const template = findTemplate(String(step.args.templateId))
    assert.ok(template, `template ${String(step.args.templateId)} does not exist`)
    for (const id of Object.keys((step.args.variables ?? {}) as Record<string, unknown>)) {
      assert.ok(
        template.variables.some((v) => v.id === id),
        `${template.id} declares no variable "${id}"`
      )
    }
  }
})

test('the approval example proposes a valid plan and then makes only calls the gate allows', () => {
  let ids = 0
  const newId = (prefix: string): string => `${prefix}_${(ids += 1)}`
  let proposals = 0

  for (const example of EXAMPLES) {
    let gate: AgentGate | null = null
    for (const step of example.steps.filter(isCall)) {
      if (step.tool === 'propose_edit') {
        const built = buildProposal(step.args, validateArgs, newId)
        assert.ok(built.ok, `"${example.title}": ${built.ok ? '' : built.error}`)
        const option = built.proposal.options[0]!
        // The user approves the first option, which is what the example's message shows.
        gate = {
          approved: { approvalId: 'apr_1', proposalId: built.proposal.id, option, consumed: [] }
        }
        proposals += 1
        continue
      }
      if (!gate) continue
      const verdict = checkApproval(step.tool, step.args, gate)
      assert.ok(
        verdict.allowed,
        `"${example.title}": ${step.tool} after approval would be refused: ${verdict.refusal}`
      )
      if (verdict.index !== undefined) {
        gate = { approved: { ...gate.approved!, consumed: [...gate.approved!.consumed, verdict.index] } }
      }
    }
    if (gate?.approved) {
      // Every approved operation carried out: an example that proposed three calls and made two
      // would teach an agent to leave the plan half done.
      assert.equal(
        gate.approved.consumed.length,
        gate.approved.option.operations.length,
        `"${example.title}" does not carry out every approved call`
      )
    }
  }
  assert.ok(proposals >= 1, 'no example exercises propose_edit through approval')
})

test('a call the gate would refuse after approval is caught by the check above', () => {
  // The negative control, so the approval test is known to be able to fail: the same gate
  // refuses an unapproved argument, and allows the approved one (positive control).
  const approved = EXAMPLES.flatMap((e) => e.steps.filter(isCall)).find((s) => s.tool === 'propose_edit')!
  const built = buildProposal(approved.args, validateArgs, (p) => `${p}_x`)
  assert.ok(built.ok)
  const option = built.proposal.options[0]!
  const gate: AgentGate = { approved: { approvalId: 'a', proposalId: 'p', option, consumed: [] } }
  const first = option.operations[0]!
  assert.equal(checkApproval(first.tool, first.args, gate).allowed, true)
  assert.equal(
    checkApproval(first.tool, { ...first.args, toFrame: Number(first.args.toFrame) + 1 }, gate).allowed,
    false
  )
})

test('the rendered examples carry every call as JSON an agent can copy', () => {
  const text = examplesGuide()
  for (const step of EXAMPLES.flatMap((e) => e.steps.filter(isCall))) {
    assert.ok(text.includes(JSON.stringify(step.args, null, 2)), `${step.tool} args not rendered`)
  }
  assert.match(text, /Approved: "/, 'the approval message is rendered from approvalMessage')
})

test('both generated guides are in the resource catalog', () => {
  assert.ok(findResource('bay://guide/tools'))
  assert.ok(findResource('bay://guide/examples'))
})
