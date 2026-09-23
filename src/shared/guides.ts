/**
 * The two guides that are *generated* rather than written: the tool reference and the worked
 * examples.
 *
 * Both exist because hand-written documentation about an API drifts from it the first time
 * either changes, and here the reader cannot tell. An agent that reads an argument name from a
 * stale guide sends it, gets a refusal, and has to discover by trial what the guide should have
 * told it. So:
 *
 * - `toolReference` renders `TOOLS` itself — names, read or write, when to use, every argument
 *   with its type, bounds and choices. There is nothing to keep in step; the catalog is the text.
 * - `EXAMPLES` is data: sequences of real `{ tool, args }` calls. `guides.test.ts` pushes every
 *   call through `validateArgs` against the catalog, every `propose_edit` through `buildProposal`,
 *   and every call made after an approval through `checkApproval` — so an example that would be
 *   refused by bay fails the build instead of teaching the refusal.
 *
 * Pure strings from shared data, so the main process serves them without a file and `pnpm test`
 * can check them without Vite.
 */

import { TOOLS, type ToolSpec } from './mcp'
import { approvalMessage, type ProposalOption } from './agent'

// ---------------------------------------------------------------------------
// bay://guide/tools
// ---------------------------------------------------------------------------

type Schema = Record<string, unknown>

/** One line per argument: name, type with its bounds or choices, required or not, what it is. */
function describeArgument(name: string, schema: Schema, required: boolean): string {
  const type = schema.type as string | undefined
  const parts: string[] = []
  if (type === 'array') {
    const items = schema.items as Schema | undefined
    parts.push(`array of ${(items?.type as string | undefined) ?? 'values'}`)
  } else {
    parts.push(type ?? 'any')
  }
  if (typeof schema.minimum === 'number') parts.push(`≥ ${schema.minimum}`)
  if (typeof schema.maximum === 'number') parts.push(`≤ ${schema.maximum}`)
  const choices = schema.enum as unknown[] | undefined
  if (choices) parts.push(`one of ${choices.map((c) => `\`${String(c)}\``).join(', ')}`)
  parts.push(required ? '**required**' : 'optional')

  const description = typeof schema.description === 'string' ? schema.description : ''
  const nested =
    type === 'object' && schema.properties
      ? ` Fields: ${Object.keys(schema.properties as Schema).map((k) => `\`${k}\``).join(', ')}.`
      : ''
  const text = `${description}${nested}`.replace(/\s*\n\s*/g, ' ').trim()
  return `- \`${name}\` (${parts.join(', ')})${text ? ` — ${text}` : ''}`
}

const CATEGORY_TITLES: Record<ToolSpec['category'], string> = {
  read: 'Reading — these change nothing',
  submit: 'Proposing — asks the user before anything changes, when “Ask before editing” is on',
  write: 'Writing — these change the project, one undo step per call'
}

/**
 * The reference, rendered from the catalog it describes.
 *
 * Takes the catalog as an argument so the test can hand it a mutated one; the resource is
 * `toolReference(TOOLS)`.
 */
export function toolReference(tools: readonly ToolSpec[] = TOOLS): string {
  const lines: string[] = [
    '# bay tool reference',
    '',
    'Generated from the tool catalog this build of bay serves, so it cannot disagree with it. ' +
      'Every time is a frame index at the timeline’s rate unless an argument says seconds; ' +
      'every id is copied from a tool result, never invented. For whole edits as sequences of ' +
      'calls, read bay://guide/examples; for the model behind them, bay://guide/editing.',
    ''
  ]
  const order: ToolSpec['category'][] = ['read', 'submit', 'write']
  for (const category of order) {
    const group = tools.filter((t) => t.category === category)
    if (group.length === 0) continue
    lines.push(`## ${CATEGORY_TITLES[category]}`, '')
    for (const tool of group) {
      lines.push(`### \`${tool.name}\``, '')
      lines.push(
        tool.readOnly
          ? '*Read-only* — safe to call speculatively; never needs approval.'
          : '*Writes* — changes the project; in bay’s agent panel with “Ask before editing” on, it needs an approved proposal.',
        ''
      )
      lines.push(tool.description.trim(), '')
      const properties = Object.entries(tool.inputSchema.properties) as [string, Schema][]
      const required = tool.inputSchema.required ?? []
      if (properties.length === 0) {
        lines.push('Arguments: none.', '')
      } else {
        lines.push('Arguments:', '')
        for (const [name, schema] of properties) {
          lines.push(describeArgument(name, schema, required.includes(name)))
        }
        lines.push('')
      }
    }
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// bay://guide/examples
// ---------------------------------------------------------------------------

/** One call, exactly as an agent would send it. */
export interface ExampleCall {
  tool: string
  args: Record<string, unknown>
  /** Why this call, and what to read in its result. */
  note: string
}

/** A step that is not a call: a decision, a wait, a message from the user. */
export interface ExampleProse {
  say: string
}

export type ExampleStep = ExampleCall | ExampleProse

export interface GuideExample {
  title: string
  /** When an editor reaches for this. */
  when: string
  steps: readonly ExampleStep[]
}

export const isCall = (step: ExampleStep): step is ExampleCall => 'tool' in step

// Ids in the examples are placeholders in the shape bay mints. Real ones come from
// read_project and from the result of the call that created the thing — never from here.
const TALK = 'itm_m1talk0a4f'
const BROLL = 'itm_m1broll9c2'
const INTERVIEW_A = 'itm_m1inta7e31'
const INTERVIEW_B = 'itm_m1intb2d08'
const CARD_ASSET = 'ast_m1card5b17'
const MOTION_ITEM = 'itm_m1motn3c90'

/**
 * The operations of the proposal in the approval example, kept as a constant because the calls
 * made after approval must be these exact calls with these exact arguments — the example shows
 * that by construction, and the test checks it against the real gate.
 */
const TIGHTEN_OPERATIONS = [
  { tool: 'remove_range', args: { fromFrame: 412, toFrame: 471 } },
  { tool: 'remove_range', args: { fromFrame: 0, toFrame: 96 } }
] as const

const TIGHTEN_OPTIONS = [
  {
    label: 'Cut both',
    summary:
      'Take out the false start at the top and the repeated sentence around 0:14, keeping ' +
      'picture and sound together.',
    operations: TIGHTEN_OPERATIONS.map((op) => ({ tool: op.tool, args: { ...op.args } }))
  },
  {
    label: 'Only the false start',
    summary: 'Take out the first three seconds and leave the rest as it is.',
    operations: [{ tool: 'remove_range', args: { fromFrame: 0, toFrame: 96 } }]
  }
]

export const EXAMPLES: readonly GuideExample[] = [
  {
    title: 'Trim a false start',
    when:
      'The recording opens with a stumble before the real take. Remove the time, not the clip, ' +
      'so the audio and every layer above stay in sync.',
    steps: [
      {
        tool: 'read_project',
        args: {},
        note: 'Learn the frame rate (here 30fps) and what sits on which track.'
      },
      {
        tool: 'preview_frame',
        args: { frame: 96, includeTimecode: true },
        note:
          'Look at where the real take starts. Check a frame or two either side before choosing ' +
          'the bound — preview_frame cannot hear, so confirm the words by the transcript or the ' +
          'user, not the picture.'
      },
      {
        tool: 'remove_range',
        args: { fromFrame: 0, toFrame: 96 },
        note:
          'fromFrame is the first frame removed, toFrame the first kept: frames 0–95 go, frame 96 ' +
          'becomes frame 0 on every unlocked track. If the result lists desyncedTracks, a locked ' +
          'track did not move — say so.'
      },
      {
        tool: 'preview_frame',
        args: { frame: 0 },
        note: 'Confirm the new first frame is the start of the real take.'
      }
    ]
  },
  {
    title: 'Cut a repeated line out of the middle of one long take',
    when:
      'A sentence was said twice. delete_items cannot express this — it removes whole clips — ' +
      'but remove_range splits whatever straddles the bounds and closes the hole.',
    steps: [
      {
        tool: 'remove_range',
        args: { fromFrame: 412, toFrame: 471 },
        note:
          'Removes 59 frames from every unlocked track. Two cuts sharing a bound remove exactly ' +
          'the union, so cut from the end of the timeline backwards and earlier bounds stay valid.'
      },
      {
        tool: 'preview_frame',
        args: { frame: 411 },
        note: 'The last frame before the join…'
      },
      {
        tool: 'preview_frame',
        args: { frame: 412 },
        note: '…and the first after it. A jump in framing here is a jump cut the user will see.'
      }
    ]
  },
  {
    title: 'Lower third from a template',
    when:
      'Someone needs a name and role on screen. A shipped template fits, so it is one call and ' +
      'one undo step, sized to this canvas.',
    steps: [
      {
        tool: 'add_template',
        args: {
          templateId: 'lower-third',
          atFrame: 45,
          variables: { name: 'Jane Goodall', role: 'Primatologist' }
        },
        note:
          'Writes, imports and places it on a video track with room at frame 45 — above the ' +
          'footage, because the footage track has no room there. The result names the item and ' +
          'the values it renders with.'
      },
      {
        tool: 'preview_frame',
        args: { frame: 75 },
        note:
          'Check it at a frame where it has finished animating in, and that it does not cover a ' +
          'face. A textWarnings entry about a substituted font means the typeface is wrong even ' +
          'though the picture looks deliberate.'
      }
    ]
  },
  {
    title: 'A lower third as a .brf module',
    when:
      'No template fits and the graphic is text and shapes — which is nearly every title, ' +
      'lower third, callout and caption. One call writes, validates and places it; bay draws it ' +
      'natively, so it scrubs and exports instantly.',
    steps: [
      {
        tool: 'write_brf',
        args: {
          name: 'Name card',
          atFrame: 45,
          code: [
            "import { spring, interpolate } from 'bay'",
            "export const vars = { name: 'Jane Goodall', role: 'Primatologist', accent: '#11D1A0' }",
            'export default ({ t, vars }) => (',
            '  <scene duration={4}>',
            '    <group x="6%" y="80%" anchor={[0, 0.5]} out={[\'fade\', 0.3]}>',
            '      <rect anchor={[0, 0.5]} w={10} h={130} radius={5} fill={vars.accent} sy={spring(t, { damping: 14 })} />',
            '      <text x={34} y={-26} anchor={[0, 0.5]} align="left" size={64} weight={900} in={[\'left\', 0.45, 0.1]}>{vars.name}</text>',
            '      <text x={34} y={40} anchor={[0, 0.5]} align="left" size={36} fill={vars.accent} opacity={interpolate(t, [0.2, 0.6], [0, 1])}>{vars.role}</text>',
            '    </group>',
            '  </scene>',
            ')'
          ].join('\n')
        },
        note:
          'A module written as React/Remotion is written: t is seconds from its start, atFrame is ' +
          'where it lands on the timeline. It is run across its whole duration first; a compile or ' +
          'runtime error comes back with its line and frame and nothing changes.'
      },
      {
        tool: 'preview_frame',
        args: { frame: 75 },
        note: 'Look at it at rest, and mid-entrance: an anchor on the wrong corner is the usual surprise.'
      },
      {
        tool: 'edit_item',
        args: { itemId: MOTION_ITEM, variables: { name: 'Louis Leakey', role: 'Palaeoanthropologist' } },
        note:
          'Its vars are per placement: place the same asset again for the next person and change ' +
          'only the words. To change the design everywhere, read_brf, edit the code, and write_brf ' +
          'with its assetId.'
      }
    ]
  },
  {
    title: 'Lower third written by hand as HTML',
    when:
      'No template matches the brief and it needs a web page — CSS layout or a JS library; ' +
      'otherwise prefer the .brf route above. Write the composition, then place it on its own track ' +
      'so it draws over the footage.',
    steps: [
      {
        tool: 'write_composition',
        args: {
          path: '/Users/me/Movies/goodall/titles/name-card.html',
          html: '@./name-card.html'
        },
        note:
          'Read bay://guide/composition/contract first. `@./name-card.html` is read from a file ' +
          'beside you by the terminal client; pass the document itself as the string otherwise. ' +
          'The result lists every problem with its line; nothing fatal means it was imported, ' +
          'and it returns the assetId.'
      },
      {
        tool: 'add_track',
        args: { kind: 'video' },
        note: 'A new video track is the topmost, so what is placed on it draws over everything.'
      },
      {
        tool: 'place_asset',
        args: { assetId: CARD_ASSET, atFrame: 45, trackId: 'trk_m1top3e9a1' },
        note:
          'The trackId is the one add_track returned. The clip takes the composition’s declared ' +
          'duration; shorten it afterwards with edit_item if needed.'
      },
      {
        tool: 'preview_frame',
        args: { frame: 75 },
        note:
          'If the result says incomplete, the composition was still rendering — call again ' +
          'rather than judging a frame that is missing its overlay.'
      }
    ]
  },
  {
    title: 'Cross-dissolve between two clips',
    when:
      'Two interview clips cut hard and the user wants the change softened. A transition ' +
      'belongs to the cut, so the clips must abut on one track.',
    steps: [
      {
        tool: 'inspect_item',
        args: { itemId: INTERVIEW_A },
        note:
          'Where the outgoing clip ends. If the incoming one does not start on that frame, close ' +
          'the gap first — a transition only exists at a cut.'
      },
      {
        tool: 'edit_item',
        args: { itemId: INTERVIEW_B, from: 300 },
        note: 'Here the second clip started at 310; moving it to 300 makes the two abut.'
      },
      {
        tool: 'add_transition',
        args: { fromItemId: INTERVIEW_A, toItemId: INTERVIEW_B, kind: 'cross-dissolve' },
        note:
          'No duration: bay picks about a second, or the most the handles allow. The result ' +
          'carries maxDurationInFrames and, if it was shortened, which side ran out of footage.'
      },
      {
        tool: 'preview_frame',
        args: { frame: 300 },
        note:
          'The middle of the dissolve. One still shows the blend, not the motion — it cannot tell ' +
          'you the dissolve feels too slow; say what you checked.'
      }
    ]
  },
  {
    title: 'Propose, wait for approval, then carry it out (“Ask before editing” on)',
    when:
      'In bay’s agent panel with “Ask before editing” on, every write is refused until the ' +
      'user approves a plan. Read first, propose with exact calls, end the turn, then make ' +
      'exactly the approved calls. With the setting off (the default) propose_edit answers ' +
      '`needed: false` and you edit directly.',
    steps: [
      {
        tool: 'read_project',
        args: {},
        note: 'Reads need no approval. Get the ids and frames right before proposing.'
      },
      {
        tool: 'propose_edit',
        args: {
          question: 'How much of the stumbling should come out?',
          options: TIGHTEN_OPTIONS
        },
        note:
          'Each option is a genuinely different choice, summarised in the user’s terms. Every ' +
          'operation is checked against its tool’s schema now. The later cut is listed first, ' +
          'so the earlier one’s frames still mean the same thing when it runs.'
      },
      {
        say:
          'End the turn. The user sees a card with one Approve button per option. Their choice ' +
          'arrives as the next message, for example:\n\n' +
          '```\n' +
          approvalMessage({
            id: 'opt_example',
            label: TIGHTEN_OPTIONS[0]!.label,
            summary: TIGHTEN_OPTIONS[0]!.summary,
            operations: TIGHTEN_OPERATIONS.map((op, index) => ({ index, tool: op.tool, args: { ...op.args } }))
          } satisfies ProposalOption) +
          '\n```'
      },
      ...TIGHTEN_OPERATIONS.map(
        (op, index): ExampleCall => ({
          tool: op.tool,
          args: { ...op.args },
          note:
            index === 0
              ? 'Exactly the approved call, with exactly the approved arguments. A different call ' +
                'is refused, and so is this one a second time.'
              : 'Then the next, in order.'
        })
      ),
      {
        tool: 'preview_frame',
        args: { frame: 0 },
        note: 'Look before reporting it done. Then tell the user what changed, in their words.'
      }
    ]
  },
  {
    title: 'Speed up a B-roll clip and duck it under the talk',
    when: 'Several properties of one clip change at once. One edit_item call is one undo step.',
    steps: [
      {
        tool: 'edit_item',
        args: { itemId: BROLL, speed: 2, volume: 0.2, fadeInFrames: 6, fadeOutFrames: 6 },
        note:
          'Only the fields passed change. The result is the item complete after the edit — ' +
          'that is authoritative, so there is no need to re-read the project to confirm it.'
      },
      {
        tool: 'inspect_item',
        args: { itemId: TALK },
        note: 'Check the talk clip underneath is untouched before moving on.'
      }
    ]
  }
]

function renderStep(step: ExampleStep, number: number): string {
  if (!isCall(step)) return step.say
  return [
    `${number}. \`${step.tool}\``,
    '',
    '```json',
    JSON.stringify(step.args, null, 2),
    '```',
    '',
    step.note
  ].join('\n')
}

export function examplesGuide(examples: readonly GuideExample[] = EXAMPLES): string {
  const out: string[] = [
    '# Worked edits in bay',
    '',
    'Each example is a sequence of real tool calls with real argument shapes — the same ' +
      'sequences bay’s test suite validates against the tool catalog, so none of them will be ' +
      'refused for its shape. Ids and paths are placeholders: copy real ids from read_project ' +
      'and from the result of the call that created the thing. Frames assume a 30fps timeline. ' +
      'The full argument list for every tool is bay://guide/tools.',
    ''
  ]
  for (const example of examples) {
    out.push(`## ${example.title}`, '', example.when, '')
    let number = 0
    for (const step of example.steps) {
      if (isCall(step)) number += 1
      out.push(renderStep(step, number), '')
    }
  }
  return out.join('\n')
}
