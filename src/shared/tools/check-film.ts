import type { ToolSpec } from './spec'
import { itemId } from './fields'

export const order = 125

export const tool: ToolSpec = {
  name: 'check_film',
  description:
    'Measure whether a motion composition reads as one film or as slides, before anyone has to ' +
    'watch it. Run it as soon as a composition plays end to end, and again after every change to ' +
    'its beats — a failure is an edit to the composition, not a re-render. It needs the ' +
    'composition to declare window.__film = { beats, track(t) } (a composition without one is ' +
    'refused with the shape to add; bay://guide/motion-design has the whole contract, what to ' +
    'change for each failing leg, and a kit that passes). It seeks every frame, follows the boxes track(t) returns, ' +
    'and answers five legs, each pass / warn / fail / unmeasured with its numbers: continuity — ' +
    'at each beat boundary, did a tracked thing survive and move or scale into the next beat ' +
    '(carried), survive unmoved (anchored), or was the picture replaced (bare); the carry score ' +
    'fails under 0.5, which is what a slideshow scores, and warns under 0.7. rhythm — beats that ' +
    'are all one length fail, and so does a film that is never dead still for a second. curves — ' +
    'any move over 80 px/frame (at 1080p) without motion blur fails. framing — a subject named in ' +
    'inFrame that leaves the frame fails. faults — time(t) or track(t) throwing, or one time ' +
    'drawing two different pictures. `findings` lists every failure with what to change, the ' +
    'ones nobody can see by watching first; `blind` lists what it cannot see, so a pass is not ' +
    'the same as having looked — frame_grid is still the look. Pass assetId for a composition in ' +
    "the pool, or itemId for one on the timeline (that clip's variables are applied). Changes " +
    'nothing. A 30 s film takes about half a minute; pictures: false answers in about a second ' +
    'without the stillness numbers.',
  category: 'read',
  readOnly: true,
  timeoutMs: 5 * 60_000,
  inputSchema: {
    type: 'object',
    properties: {
      assetId: { type: 'string', description: 'A composition (.html) in the media pool, from browse_assets or write_composition.' },
      itemId: { ...itemId, description: 'A composition clip on the timeline. ' + itemId.description },
      pictures: {
        type: 'boolean',
        description:
          'Capture pictures for the stillness numbers (rhythm). Default true. False skips them: carry, curves, framing and faults only, in about a second — for iterating on the beats.'
      }
    }
  }
}
