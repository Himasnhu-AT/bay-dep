import type { ToolSpec } from './spec'

export const order = 358

export const tool: ToolSpec = {
  name: 'track_dub',
  description:
    'Status of a dub apply_dub started. While lines are generating: how many are done, running, ' +
    'queued and failed — poll again after 15–30 seconds; each poll also starts queued lines as ' +
    'job slots free up. When every line has landed it imports them and places them at their cues ' +
    'on the "Dub (<language>)" audio track, fitted to their slots, and ducks or mutes the original — ' +
    'all one undo step — and returns what was placed, lines sped up (with warnings past the ' +
    'accepted tempo), lines refused as too long (with the cut to make), failed lines, and the ' +
    'translated lines as add_captions cues. Calling it again after placement returns the same ' +
    'result — and if the placed lines have been undone, places them again from the files already ' +
    'generated, paying nothing twice. Dubs are kept by the app, so a reload of the window does not ' +
    "lose one: queued lines still start and landed lines are still placed. Call with no dubId to list the dubs.",
  category: 'write',
  readOnly: false,
  dryRunRefusal:
    'track_dub imports the generated files and starts queued jobs, which reach outside the project ' +
    'where a dry run cannot undo them. While lines are running it changes nothing, so call it ' +
    'without validateOnly.',
  inputSchema: {
    type: 'object',
    properties: {
      dubId: { type: 'string', description: "The dubId apply_dub returned. Omit to list the dubs." }
    }
  }
}
