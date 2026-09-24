import type { ToolSpec } from './spec'

export const order = 180

export const tool: ToolSpec = {
  name: 'apply_script',
  description:
    'Apply an edited read_script document as one undo step. bay diffs it against the timeline ' +
    'and does exactly what changed: a deleted line removes the clip (`ripple: on` in the ' +
    'header closes the gap on that track only); lines reordered within a track resequence it ' +
    'end to end; changed in/out moves or trims (in alone is a head trim, the source advancing ' +
    'with it); changed src slips; changed quoted text rewrites a title; a deleted `~` line ' +
    'removes a transition. A transition whose cut the edit breaks is removed and reported. ' +
    'Anything else — a line with no id, a clip moved between track sections, a changed source ' +
    'name, an edited header — is refused with its line number, and nothing is applied. If ' +
    'the timeline changed since the read, the script is refused; read it again. Returns what ' +
    'changed and the new script. Pass a long script as `@./path.md` to save tokens.',
  category: 'write',
  readOnly: false,
  dryRunnable: true,
  inputSchema: {
    type: 'object',
    properties: {
      script: {
        type: 'string',
        description:
          'The whole script as read_script returned it, with your edits — header included. ' +
          'Every track section must be present; delete lines, not sections.'
      }
    },
    required: ['script']
  }
}
