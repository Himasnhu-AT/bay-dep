import type { ToolSpec } from './spec'

export const order = 100

export const tool: ToolSpec = {
  name: 'write_composition',
  description:
    'Create or replace an HTML composition on disk and import it as an asset, ready to place. ' +
    'This is how you build motion graphics, titles, lower thirds, animated charts and ' +
    'anything else the timeline has no primitive for: you write the HTML, bay renders it as a ' +
    'clip. Read bay://guide/composition/contract first — the rules are short and the ones ' +
    'that matter produce a WRONG PICTURE rather than an error, so nothing will tell you. In ' +
    'brief: the root element needs data-composition-id, data-duration in SECONDS, and an ' +
    'explicit pixel width and height; it must register exactly one timeline at ' +
    'window.__timelines[<that id>] — a plain object { time(t) { /* set every style from t */ }, ' +
    'duration: () => <seconds> }, since bay ships no animation library; and nothing may load ' +
    'over the network, because bay blocks remote origins. A remote <script src> (a GSAP CDN ' +
    'tag, say) is refused: the file is written but not imported until the tag is gone. The ' +
    'one script bay supplies is its move library: put <script src="bay-motion.js"></script> ' +
    'above your own script and bay writes that file beside the composition, giving window.BM ' +
    '— springs, entrances, carries and a camera as pure functions of t that return numbers ' +
    '(the contract lists them). Put ' +
    'fonts, and any library you are licensed to use, beside the file and reference them by ' +
    'relative path. Sound is declared, not ' +
    'captured: <audio id="whoosh" src="./whoosh.wav" data-start="0.2" data-volume="0.8"> with ' +
    'a local file beside the composition is mixed in preview and export under the clip\'s ' +
    'volume and fades; anything else on the page is silent. The result reports every ' +
    'problem found, with the line, before you place anything.',
  category: 'write',
  readOnly: false,
  dryRunRefusal:
    'write_composition writes an HTML file to disk and imports it, and a file on disk is ' +
    'outside what a dry run can put back. To check a composition without committing it, ' +
    'write it and read it back with read_composition before placing it.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description:
          'Absolute path to write to, ending .html. Its directory is created if missing, and ' +
          'an existing file at this path is overwritten.'
      },
      html: {
        type: 'string',
        description:
          'The complete document. Accepts @./file.html to read it from a file, which is the ' +
          'better route for anything long.'
      },
      import: {
        type: 'boolean',
        description:
          'Import as an asset after writing. Default true. Pass false to write a ' +
          'sub-composition or a vendored file that is not itself a clip.'
      }
    },
    required: ['path', 'html']
  }
}
