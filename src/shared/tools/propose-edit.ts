import type { ToolSpec } from './spec'

export const order = 90

export const tool: ToolSpec = {
  name: 'propose_edit',
  description:
    'Ask the user to approve an edit before you make it. When the user has turned on "Ask ' +
    'before editing" in bay\'s agent panel, every tool that changes the project is refused ' +
    'until the user has approved a plan, and this is how a plan reaches them: it appears as ' +
    'a card with one Approve button per option.\n' +
    'Give one to four options, each a genuinely different choice, with a label, a summary in ' +
    'the user\'s terms (clips, cuts, timing — never tool names or ids), and the exact calls ' +
    'it needs as [{ tool, args }]. Every operation is checked against its tool\'s schema ' +
    'now, so a plan that could not run is refused here rather than half-applied later.\n' +
    'After proposing, **end your turn and wait.** The user\'s choice arrives as their next ' +
    'message, naming the approved calls; then make exactly those calls, each once, with ' +
    'exactly those arguments. The approval covers nothing else. An operation cannot use an ' +
    'id that does not exist yet — if a later step needs an id an earlier step creates, ' +
    'propose the first stage, carry it out, then propose the next.\n' +
    'When nothing is gated (the setting is off, or a terminal client over the socket), ' +
    'this returns `needed: false` — make the edit directly.',
  category: 'submit',
  readOnly: true,
  inputSchema: {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description: 'What the user is deciding, in one line.'
      },
      options: {
        type: 'array',
        items: { type: 'object' },
        description:
          'One to four of { label, summary, operations: [{ tool, args }] }. Reads such as ' +
          'read_project or preview_frame need no approval and must not be listed.'
      }
    },
    required: ['question', 'options']
  }
}
