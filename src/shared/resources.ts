/**
 * The documents bay serves to an agent over MCP.
 *
 * Tools say what bay can do; resources say **how to edit video with them**. The distinction
 * matters because a tool schema can only carry what an argument is named and typed — it has
 * nowhere to put "time is frames, except `sourceStartSeconds`, which is seconds because the
 * source has a rate the timeline does not control". That sentence has to live somewhere an
 * agent can read before it starts, and a resource is that somewhere.
 *
 * Two kinds sit here. `bay://guide/editing` is bay's own, and is the one to read first. The
 * `bay://guide/composition/*` set is carried from the HyperFrames project (Apache-2.0) because
 * bay renders HyperFrames compositions, and an agent writing one has to satisfy the same
 * contract the renderer enforces — a second, paraphrased copy of those rules would drift from
 * the renderer on the first edit to either.
 *
 * Listed here rather than discovered from the filesystem so the catalog is a compile-time fact:
 * the bundle inlines each document, so a resource that is listed but missing is a build error
 * rather than a read that fails on a user's machine.
 */

export interface ResourceSpec {
  /** Stable across versions. An agent may cache against it. */
  uri: string
  name: string
  description: string
  mimeType: string
}

export const RESOURCES: readonly ResourceSpec[] = [
  {
    uri: 'bay://guide/editing',
    name: 'Editing video with bay',
    description:
      'Read this first. The project model, why every time is a frame index, how to remove a ' +
      'span without losing sync, how transitions need footage either side of a cut, and the ' +
      'mistakes that produce a wrong picture rather than an error.',
    mimeType: 'text/markdown'
  },
  {
    uri: 'bay://guide/composition/contract',
    name: 'HTML compositions: the contract',
    description:
      'What makes an HTML file renderable by bay: one paused timeline, a sized root, a declared ' +
      'duration, and the determinism rules. Read before writing a composition.',
    mimeType: 'text/markdown'
  },
  {
    uri: 'bay://guide/composition/minimal',
    name: 'The smallest composition that renders',
    description: 'A skeleton to start from, with the sizing that an unsized root gets wrong.',
    mimeType: 'text/markdown'
  },
  {
    uri: 'bay://guide/composition/data-attributes',
    name: 'Composition data-* attributes',
    description:
      'Every data-* attribute a composition root, clip or sub-composition host may carry, and ' +
      'what each one does.',
    mimeType: 'text/markdown'
  },
  {
    uri: 'bay://guide/composition/determinism',
    name: 'Determinism rules',
    description:
      'The bans that make a composition seekable — no render-time clocks, no unseeded random, ' +
      'no network, no infinite repeats. bay photographs a seeked page, so a composition that ' +
      'depends on anything but time renders differently every run.',
    mimeType: 'text/markdown'
  },
  {
    uri: 'bay://guide/composition/patterns',
    name: 'Composition patterns',
    description: 'Monolithic against modular, how to structure an index, and sub-comp archetypes.',
    mimeType: 'text/markdown'
  },
  {
    uri: 'bay://guide/composition/tracks-and-clips',
    name: 'Tracks and clips inside a composition',
    description:
      'What data-track-index controls and what it does not, z-order, and timing one clip ' +
      'relative to another.',
    mimeType: 'text/markdown'
  },
  {
    uri: 'bay://guide/composition/variables-and-media',
    name: 'Variables and media in a composition',
    description: 'Declaring variables, placing video and audio, setting volume, trimming.',
    mimeType: 'text/markdown'
  },
  {
    uri: 'bay://guide/composition/sub-compositions',
    name: 'Sub-compositions',
    description: 'Host attributes, the template wrapper, per-instance variables, animating inside.',
    mimeType: 'text/markdown'
  },
  {
    uri: 'bay://guide/composition/editing-recipes',
    name: 'Composition editing recipes',
    description:
      'Cut, trim, reorder, retime, freeze, camera, mask, crossfade and audio recipes — with ' +
      'their limits stated rather than implied.',
    mimeType: 'text/markdown'
  },
  {
    uri: 'bay://guide/composition/full-screen-motion',
    name: 'Full-screen motion',
    description: 'Authoring full-frame motion with shared backgrounds.',
    mimeType: 'text/markdown'
  }
] as const

export function findResource(uri: string): ResourceSpec | undefined {
  return RESOURCES.find((resource) => resource.uri === uri)
}
