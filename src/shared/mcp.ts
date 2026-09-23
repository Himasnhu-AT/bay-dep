/**
 * The agent surface: bay's project model exposed over the Model Context Protocol.
 *
 * The shape of this is decided by one fact — **the renderer owns the project.** The store is
 * the only thing that knows the current timeline, and every mutation must go through its
 * `edit()` so it lands on the undo stack and the user can take it back. So a tool call cannot
 * be answered by the main process alone: it arrives over stdio, crosses into main, crosses
 * again into the renderer, is applied to the store, and the result comes back the same way.
 *
 *     claude ──stdio──▶ bay --mcp ──unix socket──▶ main ──ipc──▶ renderer ──▶ store
 *
 * The proxy is a separate short-lived process rather than a server inside the app, for the
 * same reason ChatCut's is: an MCP client wants a command to spawn, and the app is a GUI that
 * may not be running yet. The proxy launches it if needed.
 *
 * Three rules this surface holds itself to, each learned from a control that did not do what
 * it said:
 *
 * 1. **Every tool listed here must work.** A tool that returns "not implemented" is worse
 *    than an absent one — the agent will plan around it, spend a turn, and discover the gap
 *    after telling the user it is done.
 * 2. **An error is a recovery instruction.** "Invalid id" tells an agent nothing it can act
 *    on; "no item `a1b2c3d4e5` on the active timeline — call `read_project` and use an id
 *    from its output" tells it exactly what to do next.
 * 3. **Time is frames.** The same rule as everywhere else in this codebase, and the place an
 *    agent is most likely to guess seconds. Tools that accept a time take a frame number, and
 *    say so in their description.
 */

import { TEMPLATES } from './templates'

// ---------------------------------------------------------------------------
// The wire between main and the renderer
// ---------------------------------------------------------------------------

/**
 * One tool call travelling main → renderer.
 *
 * Electron has no main-side `invoke`, so the round trip is built by hand: main pushes a call
 * carrying an `id`, the renderer answers on the result channel with the same `id`. A call
 * that is never answered must reject rather than hang — a hang in this path would stall the
 * agent's turn with no verdict, which this project has already learned the cost of.
 */
export interface McpToolCall {
  id: string
  tool: string
  args: Record<string, unknown>
}

export type McpToolResult =
  | { id: string; ok: true; value: unknown }
  | { id: string; ok: false; error: string }

/** How long the renderer has to answer before main gives up and reports it as an error. */
export const MCP_CALL_TIMEOUT_MS = 30_000

// ---------------------------------------------------------------------------
// The catalog
// ---------------------------------------------------------------------------

export type ToolCategory = 'read' | 'write' | 'submit'

export interface ToolSpec {
  name: string
  /**
   * What the tool does, written for the model rather than for a reader of this file. Say
   * when to reach for it, not only what it does — a catalog entry that describes mechanism
   * without occasion gets used in the wrong place.
   */
  description: string
  category: ToolCategory
  /** Answers a question without changing anything. Safe to call speculatively. */
  readOnly: boolean
  /**
   * Accepts `validateOnly: true`: run against the real project, report what it would return,
   * and put the project and its undo history back exactly as they were.
   *
   * Only for tools whose every effect lands in the project document or the editor's session
   * state, because that is all the executor can put back. A file written, a job started or a
   * path registered with main is outside the store and a restore cannot reach it — a dry run
   * that wrote the file anyway would be a lie about the one thing it promises.
   *
   * The `validateOnly` property is not written into any schema below: `publishedSchema` adds
   * it from this flag, so the manifest, the validator and the gate cannot disagree about which
   * tools take it.
   */
  dryRunnable?: boolean
  /**
   * Why a tool that changes something cannot be dry-run, in the words an agent reads when it
   * asks. Every write tool carries either `dryRunnable: true` or this — asserted in the test —
   * so a new write tool cannot arrive with neither and answer a dry run with a bare "no".
   */
  dryRunRefusal?: string
  /** How long main waits for an answer, when longer than `MCP_CALL_TIMEOUT_MS`. */
  timeoutMs?: number
  /** JSON Schema for the arguments. Plain data so no validator leaks into `shared/`. */
  inputSchema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}

const frames = (description: string): Record<string, unknown> => ({
  type: 'integer',
  minimum: 0,
  description
})

const itemId = {
  type: 'string',
  description:
    'Item id from read_project or inspect_item. The first 10 characters are enough; ' +
    'ids are never invented, always copied from a tool result.'
}

export const TOOLS: ToolSpec[] = [
  // -- projects ----------------------------------------------------------------
  {
    name: 'list_projects',
    description:
      'The projects bay knows about — name, file path and when each was last edited, newest ' +
      'first — and which one is open now, if any. bay opens on a projects screen with no ' +
      'project open; every other tool is refused until one is, and this plus open_project is ' +
      'how you get there.',
    category: 'read',
    readOnly: true,
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'open_project',
    description:
      'Open a project in the editor, from a filePath list_projects returned (or any .bay file). ' +
      'It replaces whatever is open. If the open project has unsaved changes this is refused ' +
      "rather than discarding them — ask the user to save, or to open the project themselves. " +
      'Opening is not an edit and cannot be undone; the new project starts with fresh history.',
    category: 'write',
    readOnly: false,
    dryRunRefusal:
      'Opening a project replaces the document the user is looking at; a dry run could not put it back.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Absolute path to a .bay file.' }
      },
      required: ['filePath']
    }
  },

  // -- read ------------------------------------------------------------------
  {
    name: 'transcribe',
    description:
      'Transcribe a clip\'s speech on this Mac with whisper.cpp — nothing is uploaded. Use it ' +
      'for captions when the user has no transcript or subtitle file, or to find what is said ' +
      'where before cutting. Pass itemId for a clip on the timeline: the lines come back as ' +
      'cues in timeline frames, already shifted and clipped to what the clip plays, ready for ' +
      'add_captions. Pass assetId for a whole file: lines in seconds from its start, and SRT. ' +
      'Takes a few seconds per minute of audio. If whisper.cpp or a model is missing, the ' +
      'error says exactly what to install — tell the user; do not guess words.',
    category: 'read',
    readOnly: true,
    timeoutMs: 15 * 60_000,
    inputSchema: {
      type: 'object',
      properties: {
        itemId: { ...itemId, description: 'A clip on the timeline. ' + itemId.description },
        assetId: { type: 'string', description: 'An imported file, from browse_assets.' },
        language: {
          type: 'string',
          description: 'Spoken language as a code ("en", "fr", …) or "auto". Default "en".'
        }
      }
    }
  },
  {
    name: 'read_project',
    description:
      'The project as it stands: name, canvas size and frame rate, every track, and every ' +
      'item with its id, position and duration in frames, and every marker. Start here. ' +
      'Everything else takes ids that come from this output, and the frame rate here is what ' +
      'every other time in this surface is measured in. ' +
      'Call it to **orient**, not to confirm — the write tools return the item they changed, ' +
      'and that answer is authoritative. Measured on a 200-clip timeline, a turn that re-reads ' +
      'after every edit spends 99% of its bytes re-reading a project it changed by 263 of them.',
    category: 'read',
    readOnly: true,
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'browse_assets',
    description:
      'The media pool: what has been imported, with duration, dimensions, whether it carries ' +
      'audio, and whether it could be read at all. An asset with an `error` cannot be placed ' +
      'and re-importing it will not help — say so rather than retrying.',
    category: 'read',
    readOnly: true,
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'inspect_item',
    description:
      'Everything about one placed item: timing, the layout rectangle on the canvas, opacity, ' +
      'volume, fades, speed, and which asset it draws from. Read this before editing an item ' +
      'you did not just create — the user may have moved it since.',
    category: 'read',
    readOnly: true,
    inputSchema: { type: 'object', properties: { itemId }, required: ['itemId'] }
  },
  {
    name: 'preview_frame',
    description:
      'Render one frame of the timeline as it currently composites and return it as an image. ' +
      'This is the only way to see what the edit actually looks like; item positions and sizes ' +
      'do not tell you whether a clip is framed well, or whether an overlay covers a face. ' +
      'Use it to check your own work before reporting it done.',
    category: 'read',
    readOnly: true,
    inputSchema: {
      type: 'object',
      properties: {
        frame: frames('Timeline frame to render. Defaults to the playhead.'),
        includeTimecode: {
          type: 'boolean',
          description:
            'Burn the timecode and frame number into the bottom-left corner of the image. ' +
            'Useful when comparing several frames side by side; leave it off when the corner ' +
            'itself is what you are checking. The timecode is in the result as text either way.'
        }
      }
    }
  },

  {
    name: 'read_script',
    description:
      'The active timeline as an editable script: markdown, one line per clip in timeline ' +
      'order, grouped by track — `- [id] in → out · source · src <seconds>s · "text"`, with ' +
      'transitions as `~ [id]` lines under the clip they leave. Reach for it when an edit ' +
      'touches many clips at once — tightening a cut, reordering shots, fixing every title — ' +
      'and hand the edited text to apply_script instead of making one call per clip. The ' +
      'header (timeline, rev, fps) must come back unchanged. Format: bay://guide/script.',
    category: 'read',
    readOnly: true,
    inputSchema: { type: 'object', properties: {} }
  },

  {
    name: 'propose_edit',
    description:
      'Ask the user to approve an edit before you make it. Inside bay\'s own agent panel, every ' +
      'tool that changes the project is refused until the user has approved a plan, and this ' +
      'is how a plan reaches them: it appears as a card with one Approve button per option.\n' +
      'Give one to four options, each a genuinely different choice, with a label, a summary in ' +
      'the user\'s terms (clips, cuts, timing — never tool names or ids), and the exact calls ' +
      'it needs as [{ tool, args }]. Every operation is checked against its tool\'s schema ' +
      'now, so a plan that could not run is refused here rather than half-applied later.\n' +
      'After proposing, **end your turn and wait.** The user\'s choice arrives as their next ' +
      'message, naming the approved calls; then make exactly those calls, each once, with ' +
      'exactly those arguments. The approval covers nothing else. An operation cannot use an ' +
      'id that does not exist yet — if a later step needs an id an earlier step creates, ' +
      'propose the first stage, carry it out, then propose the next.\n' +
      'Outside the panel (a terminal client over the socket) nothing is gated, and this ' +
      'returns `needed: false` — make the edit directly.',
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
  },

  // -- write -----------------------------------------------------------------
  {
    name: 'write_composition',
    description:
      'Create or replace an HTML composition on disk and import it as an asset, ready to place. ' +
      'This is how you build motion graphics, titles, lower thirds, animated charts and ' +
      'anything else the timeline has no primitive for: you write the HTML, bay renders it as a ' +
      'clip. Read bay://guide/composition/contract first — the rules are short and the ones ' +
      'that matter produce a WRONG PICTURE rather than an error, so nothing will tell you. In ' +
      'brief: the root element needs data-composition-id, data-duration in SECONDS, and an ' +
      'explicit pixel width and height; it must register exactly one paused GSAP timeline at ' +
      'window.__timelines[<that id>]; and nothing may load over the network, because bay blocks ' +
      'remote origins silently and a CDN script tag renders as a still frame. Vendor libraries ' +
      'and fonts beside the file and reference them by relative path. Sound is declared, not ' +
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
  },
  {
    name: 'add_template',
    description:
      `Place one of bay's shipped templates — ${TEMPLATES.map((t) => t.id).join(', ')} — at ` +
      "the playhead in one call, sized to this timeline's canvas. " +
      'Reach for this before write_composition whenever a template fits: it writes the file, ' +
      'imports it and places it as ONE undo step, and it sizes the composition to the ' +
      'timeline so a template authored for a vertical frame fills a landscape one instead of ' +
      'landing as a narrow strip. resources/list shows each template (bay://template/<id>) ' +
      'with the variables it declares; pass values for them here, or set them later with ' +
      'edit_item({ variables }). Returns the placed item and the values it renders with.',
    category: 'write',
    readOnly: false,
    dryRunRefusal:
      'add_template writes the template file to disk before it places anything, and a file ' +
      'on disk is outside what a dry run can put back. Its variables are checked before ' +
      'anything is written, so a bad value is refused by the real call with nothing changed.',
    inputSchema: {
      type: 'object',
      properties: {
        templateId: {
          type: 'string',
          // Derived, so a template added to the catalog is placeable without a second edit here.
          enum: TEMPLATES.map((t) => t.id),
          description: 'Which template.'
        },
        variables: {
          type: 'object',
          description:
            'Optional values for the variables the template declares, as { id: value }. Any ' +
            'left out render with the template\'s default.'
        },
        atFrame: frames('Where it starts. Defaults to the playhead.')
      },
      required: ['templateId']
    }
  },
  {
    name: 'read_composition',
    description:
      'Read a composition back: its declared id, duration, size, variables and sounds, every ' +
      'fault with the line it is on, and optionally the HTML itself. `audio` lists the sounds ' +
      'that will play (<audio id src data-start> elements whose file exists locally); one that ' +
      'is missing, remote or undecodable is a fault instead. Use it to check what you wrote ' +
      'before placing it, and to inspect one you did not write before editing it. Faults are ' +
      'reported even when the composition is usable — the non-fatal ones are the ones that matter most, ' +
      'because a blocked network request renders as a still frame with nothing in any log.',
    category: 'read',
    readOnly: true,
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to the .html file.' },
        includeHtml: {
          type: 'boolean',
          description: 'Return the document text as well as its declared shape. Default false.'
        }
      },
      required: ['path']
    }
  },
  {
    name: 'import_media',
    description:
      'Import files from absolute paths into the media pool. Returns one asset per path, ' +
      'including any that could not be read — check `error` on each before placing it. ' +
      'Importing a path already in the project reuses the existing asset rather than ' +
      'duplicating it.',
    category: 'write',
    readOnly: false,
    dryRunRefusal:
      'import_media reads the files and registers them with the app so they can be played, ' +
      'and that registration lives outside the project where a dry run cannot undo it. ' +
      'Importing a path twice reuses the asset, so importing for real is safe to repeat.',
    inputSchema: {
      type: 'object',
      properties: {
        paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Absolute paths. Accepts @./file.json to read the array from a file.'
        }
      },
      required: ['paths']
    }
  },
  {
    name: 'place_asset',
    description:
      'Put an asset on the timeline. Chooses a track with room unless you name one, and picks ' +
      'video or audio by what the asset carries. The clip takes its full source duration; trim ' +
      'it afterwards with edit_item rather than trying to place a portion. ' +
      'Returns the new item complete — id, track, timing and layout. **That returned state is ' +
      'authoritative: you do not need to call read_project to confirm it.**',
    category: 'write',
    readOnly: false,
    dryRunnable: true,
    inputSchema: {
      type: 'object',
      properties: {
        assetId: { type: 'string', description: 'Asset id from browse_assets or import_media.' },
        atFrame: frames('Where it starts. Defaults to the playhead.'),
        trackId: { type: 'string', description: 'Optional. Omit to let bay choose a free track.' }
      },
      required: ['assetId']
    }
  },
  {
    name: 'edit_asset',
    description:
      'Change an asset itself — and so every clip placing it at once. Two things are asset-level: ' +
      'its name (how it reads in the media pool and on its clips), and for a text asset the ' +
      'words it draws. Reach for it to fix a typo in a title everywhere it appears, or to give ' +
      'an import a useful name. Anything about one placement — timing, position, look, text ' +
      'styling — is edit_item. Duration, size and frame rate are measured from the file and ' +
      'cannot be set. The result lists usedBy: every item the change reached, so check it if ' +
      'you meant to change only one; to reword a single title, place a new text asset instead.',
    category: 'write',
    readOnly: false,
    dryRunnable: true,
    inputSchema: {
      type: 'object',
      properties: {
        assetId: { type: 'string', description: 'Asset id from browse_assets or read_project.' },
        name: { type: 'string', description: 'The new display name.' },
        text: {
          type: 'string',
          description: 'Text assets only: the words to draw. Line breaks are kept.'
        }
      },
      required: ['assetId']
    }
  },
  {
    name: 'edit_item',
    description:
      'Change a placed item: when it starts, how long it runs, which track it sits on, where ' +
      'it sits on the canvas, its opacity, volume, fades or speed. Only the fields you pass ' +
      'change. Moving an item onto occupied time on the same track is refused rather than ' +
      'silently overlapping — move the other item first, or use a different track. ' +
      'Returns the item complete after the edit. **That returned state is authoritative: you ' +
      'do not need to call read_project to confirm it.** Re-reading the whole project to check ' +
      'one change is the most expensive thing you can do here — on a 200-clip timeline it is ' +
      '36KB to verify an edit that cost 263 bytes.',
    category: 'write',
    readOnly: false,
    dryRunnable: true,
    inputSchema: {
      type: 'object',
      properties: {
        itemId,
        from: frames('New start frame.'),
        durationInFrames: { type: 'integer', minimum: 1, description: 'New length in frames.' },
        sourceStartSeconds: {
          type: 'number',
          minimum: 0,
          description:
            'Which part of the source this clip plays — seconds from the beginning of the ' +
            'file, not a position on the timeline. This is how you use the middle of a clip: ' +
            'set it to 10 and the clip starts ten seconds into the footage while staying ' +
            'exactly where it is on the timeline.\n' +
            'Seconds rather than the model\'s microseconds because six zeros are easy to get ' +
            'wrong and the error is silent — a clip reading from the wrong place still plays.\n' +
            'It is also what gives a clip the room a transition needs: a clip starting at 0 ' +
            'has nothing before its start to dissolve from, and add_transition will say so.'
        },
        trackId: { type: 'string' },
        left: { type: 'number', description: 'Canvas x in pixels. Negative is valid.' },
        top: { type: 'number', description: 'Canvas y in pixels. Negative is valid.' },
        width: { type: 'number' },
        height: { type: 'number' },
        opacity: { type: 'number', minimum: 0, maximum: 1 },
        volume: { type: 'number', minimum: 0, maximum: 2 },
        speed: { type: 'number', description: 'Playback rate. 1 is source speed.' },
        fadeInFrames: { type: 'integer', minimum: 0 },
        fadeOutFrames: { type: 'integer', minimum: 0 },
        crop: {
          type: 'object',
          description:
            'Cut edges off this clip\'s source, as fractions from 0 to 1: ' +
            '{ left, top, right, bottom }. 0.1 removes a tenth. Cropping does NOT rescale what ' +
            'is left — the remainder stays exactly where and how big it was on screen, with ' +
            'less of it. Omitted edges keep their current value; pass 0 to restore one. ' +
            'Opposite edges cannot together take the whole source.'
        },
        variables: {
          type: 'object',
          description:
            'For an html item: values for the variables its composition declares, as ' +
            '{ id: value }. Only declared ids are honoured. read_composition lists what a ' +
            'composition declares, and inspect_item reports the values a clip is using. ' +
            'Values live on the clip, so one template placed several times can say something ' +
            'different each time.'
        },
        adjustments: {
          type: 'object',
          description:
            'Image adjustments — a look control, not a colour grade. Fields merge, so ' +
            'setting saturate leaves brightness alone. Defaults are the identity values, so ' +
            'an item with none looks exactly as it does today.',
          properties: {
            brightness: { type: 'number', minimum: 0, description: '1 is unchanged.' },
            contrast: { type: 'number', minimum: 0, description: '1 is unchanged.' },
            saturate: {
              type: 'number',
              minimum: 0,
              description: '1 is unchanged. 0 is greyscale, above 1 is richer.'
            },
            hueRotate: { type: 'number', description: 'Degrees. 0 is unchanged.' },
            blur: { type: 'number', minimum: 0, description: 'Canvas pixels. 0 is off.' },
            grayscale: { type: 'number', minimum: 0, maximum: 1 },
            sepia: { type: 'number', minimum: 0, maximum: 1 },
            invert: { type: 'number', minimum: 0, maximum: 1 }
          }
        },
        blendMode: {
          type: 'string',
          enum: [
            'normal',
            'multiply',
            'screen',
            'overlay',
            'darken',
            'lighten',
            'color-dodge',
            'color-burn',
            'hard-light',
            'soft-light',
            'difference',
            'exclusion',
            'hue',
            'saturation',
            'color',
            'luminosity'
          ],
          description:
            'How this clip combines with what is under it. Only meaningful on a clip that ' +
            'has something beneath it — on the lowest video track there is nothing to blend ' +
            'with and every mode looks the same. multiply darkens, screen lightens, overlay ' +
            'does both from the underlying tones.'
        },
        text: {
          type: 'object',
          description:
            'Type styling. Only for items whose asset is kind "text"; refused on anything ' +
            'else. Top-level fields merge, so setting color leaves size alone. The three ' +
            'effect groups — stroke, shadow and background — replace wholesale, or pass ' +
            'null to switch one off.',
          properties: {
            fontFamily: {
              type: 'string',
              description: 'A stack installed on this machine. There are no webfonts.'
            },
            fontSize: {
              type: 'number',
              minimum: 1,
              maximum: 2000,
              description:
                'Canvas pixels. What you ask for; bay shrinks it only when the words will ' +
                'not fit even wrapped, and says so when it does.'
            },
            fontWeight: {
              type: 'integer',
              minimum: 100,
              maximum: 900,
              description: 'A multiple of 100.'
            },
            italic: { type: 'boolean' },
            color: { type: 'string', description: 'Hex, such as "#FFFFFF".' },
            align: { type: 'string', enum: ['left', 'center', 'right'] },
            verticalAlign: { type: 'string', enum: ['top', 'middle', 'bottom'] },
            lineHeight: {
              type: 'number',
              minimum: 0.5,
              maximum: 4,
              description: 'Multiple of fontSize.'
            },
            letterSpacing: { type: 'number', description: 'Canvas pixels.' },
            // The three groups carry a description and deliberately no `type`. The
            // dispatcher's validator understands only the keywords this catalog uses and does
            // not recurse into objects, so the checking happens in the text-style validator
            // instead — where it can say `"text.fontWeight" must be a multiple of 100 between
            // 100 and 900, but got 550` rather than a schema violation on an object the agent
            // cannot see inside. An error an agent cannot act on is the thing this surface
            // exists to avoid.
            stroke: { description: 'An outline: { color, width }. null to remove.' },
            shadow: {
              description: 'A drop shadow: { color, blur, offsetX, offsetY }. null to remove.'
            },
            background: {
              description: 'A plate behind the words: { color, padding, radius }. null to remove.'
            }
          }
        }
      },
      required: ['itemId']
    }
  },
  {
    name: 'trim_item',
    description:
      'Refine an edit without changing the program\'s length: slip, slide or roll one clip.\n' +
      '- slip: the clip stays exactly where it is and shows a different part of its source. ' +
      'Reach for it when the timing is right but the moment is wrong — "start the take half a ' +
      'second later".\n' +
      '- slide: the clip moves along its track with its content unchanged, and the clips either ' +
      'side absorb the move — the one before it lengthens or shortens at its out-point, the one ' +
      'after at its in-point — so nothing downstream shifts. Reach for it to move a shot earlier ' +
      'or later between two others. A gap on one side absorbs the move up to its size; a clip ' +
      'touching nothing on either side cannot slide (use edit_item "from").\n' +
      '- roll: the cut between two abutting clips moves; the outgoing clip ends later and the ' +
      'incoming starts later by the same amount (or both earlier). Reach for it to cut on the ' +
      'action rather than just before it.\n' +
      'All three spend footage beyond the clips\' visible range. When there is not enough, or a ' +
      'clip would shrink to nothing, the call is REFUSED — never clamped — and the refusal gives ' +
      'the legal deltaFrames range; pass deltaFrames 0 to ask for the range without changing ' +
      'anything. Transitions stay on their cuts (every cut that existed still exists); the ' +
      'result reports any whose length the new handles now shorten. One call is one undo step.',
    category: 'write',
    readOnly: false,
    dryRunnable: true,
    inputSchema: {
      type: 'object',
      properties: {
        itemId: {
          ...itemId,
          description:
            'The clip to slip or slide, or for roll the clip on one side of the cut (see edge). ' +
            itemId.description
        },
        mode: { type: 'string', enum: ['slip', 'slide', 'roll'] },
        deltaFrames: {
          type: 'integer',
          description:
            'Signed frames. Positive slips to LATER source footage, slides the clip RIGHT, and ' +
            'rolls the cut LATER; negative is the opposite.'
        },
        edge: {
          type: 'string',
          enum: ['start', 'end'],
          description:
            'Roll only: which of itemId\'s cuts to move. "end" (default) is the cut with the ' +
            'clip that starts where it ends; "start" the cut with the clip that ends where it ' +
            'starts. Refused with slip or slide.'
        }
      },
      required: ['itemId', 'mode', 'deltaFrames']
    }
  },
  {
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
  },
  {
    name: 'split_at',
    description:
      'Cut every item crossing a frame into two, or only the items you name. A cut exactly on ' +
      'an item edge does nothing — it would make a zero-length clip — and is reported rather ' +
      'than silently skipped.',
    category: 'write',
    readOnly: false,
    dryRunnable: true,
    inputSchema: {
      type: 'object',
      properties: {
        frame: frames('Where to cut. Defaults to the playhead.'),
        itemIds: { type: 'array', items: { type: 'string' } }
      }
    }
  },
  {
    name: 'delete_items',
    description:
      'Remove whole items from the timeline. Leaves a gap by default; pass ripple to close it ' +
      'by pulling later items on the same track backwards. Ripple here never touches other ' +
      'tracks, so it will desynchronise anything layered above or below unless you move that ' +
      'too. To remove a stretch of time rather than a list of clips — and to keep every track ' +
      'in sync while doing it — use remove_range instead.',
    category: 'write',
    readOnly: false,
    dryRunnable: true,
    inputSchema: {
      type: 'object',
      properties: {
        itemIds: { type: 'array', items: { type: 'string' } },
        ripple: { type: 'boolean' }
      },
      required: ['itemIds']
    }
  },
  {
    name: 'remove_range',
    description:
      'Remove a span of time from the timeline and close the hole, keeping every unlocked ' +
      'track in step. This is the cut you want for trimming a recording: give it the frames to ' +
      'drop and it splits whatever clips straddle the boundaries, discards what is inside, and ' +
      'pulls everything after it backwards by the same amount on every track at once. ' +
      'fromFrame is the first frame removed and toFrame is the first frame kept, so two calls ' +
      'sharing a bound remove exactly the union and neither drops a frame twice. ' +
      'Prefer this over delete_items when the thing you want gone is a passage rather than a ' +
      'clip — it can cut the middle out of a single long take, which delete_items cannot ' +
      'express at all. A locked track cannot be shifted, so if one holds content after the ' +
      'cut the result names it under desyncedTracks and that track is now adrift.',
    category: 'write',
    readOnly: false,
    dryRunnable: true,
    inputSchema: {
      type: 'object',
      properties: {
        fromFrame: { type: 'number' },
        toFrame: { type: 'number' }
      },
      required: ['fromFrame', 'toFrame']
    }
  },
  {
    name: 'add_track',
    description:
      'Add a video or audio track. Video tracks stack — a later one draws over the ones before ' +
      'it — so an overlay needs its own track above the clip it covers, not a free slot on the ' +
      'same one.',
    category: 'write',
    readOnly: false,
    dryRunnable: true,
    inputSchema: {
      type: 'object',
      properties: { kind: { type: 'string', enum: ['video', 'audio'] } },
      required: ['kind']
    }
  },
  {
    name: 'add_transition',
    description:
      'Put a transition across the cut between two clips that meet on one track. The two ' +
      'must abut — the first ending exactly where the second begins — because a transition ' +
      'is a property of a cut and there is no cut across a gap.\n' +
      'It straddles the cut without moving anything: the outgoing clip plays on for half the ' +
      'duration and the incoming starts the same amount early, both using footage outside ' +
      'the range they occupy. A clip with none to spare gets a shorter transition than you ' +
      'asked for, and the result says so — read `clampedBecause` rather than assuming you got ' +
      'the length you requested.\n' +
      'Adding a second transition to a junction that already has one replaces it.',
    category: 'write',
    readOnly: false,
    dryRunnable: true,
    inputSchema: {
      type: 'object',
      properties: {
        fromItemId: { type: 'string', description: 'The clip being left.' },
        toItemId: { type: 'string', description: 'The clip being entered.' },
        kind: {
          type: 'string',
          enum: [
            'cross-dissolve',
            'dip-to-black',
            'dip-to-white',
            'wipe',
            'push',
            'slide',
            'iris'
          ],
          description:
            'cross-dissolve for ordinary continuity; dip-to-black for a scene break; wipe, ' +
            'push and slide for movement; iris for emphasis. When unsure, cross-dissolve is ' +
            'what an editor reaches for by default.'
        },
        durationInFrames: {
          type: 'integer',
          minimum: 2,
          description:
            'Total across the cut, half each side. Around a second reads as a dissolve; ' +
            'much longer reads as a statement.\n' +
            '**Omit it** and bay picks about a second, or the most this junction can take if ' +
            'that is less. There is no way to ask how long a transition *could* be here ' +
            'without creating one, so the result always reports `maxDurationInFrames` — read ' +
            'that rather than guessing and retrying.'
        },
        direction: {
          type: 'string',
          enum: ['left', 'right', 'up', 'down'],
          description: 'For wipe, push and slide. Ignored by the others.'
        }
      },
      required: ['fromItemId', 'toItemId', 'kind']
    }
  },
  {
    name: 'remove_transition',
    description:
      'Take a transition off a cut, leaving the clips and their timing untouched — the cut ' +
      'becomes a straight one again.',
    category: 'write',
    readOnly: false,
    dryRunnable: true,
    inputSchema: {
      type: 'object',
      properties: { transitionId: { type: 'string' } },
      required: ['transitionId']
    }
  },
  {
    name: 'add_captions',
    description:
      'Put captions on the timeline: every cue becomes a text item on a NEW video track above ' +
      'all others, in one call and one undo step. Reach for it for subtitles, a transcript, or ' +
      'any run of timed lines — rather than placing text assets one at a time, which is dozens ' +
      'of calls and dozens of undo steps. Pass EITHER cues, timed in timeline frames, OR srt, ' +
      'the text of an SRT or WebVTT file (timed in wall clock; bay converts at this timeline\'s ' +
      'frame rate). Cues may not overlap, because they share one track: the whole call is ' +
      'refused naming the overlapping pair and the frame that would fix it, and nothing is ' +
      'placed. Lines that overlap by less than a frame round onto the same frame and are fine. ' +
      'Captions sit in the lower third on a translucent plate sized to the frame; pass style to ' +
      'change the look for all of them. The result lists the item ids in time order.',
    category: 'write',
    readOnly: false,
    dryRunnable: true,
    inputSchema: {
      type: 'object',
      properties: {
        cues: {
          type: 'array',
          items: { type: 'object' },
          description:
            '[{ fromFrame, toFrame, text }]. toFrame is the first frame the caption is NOT ' +
            'shown, so one cue ending where the next begins do not overlap. Any order.'
        },
        srt: {
          type: 'string',
          description:
            'An SRT or WebVTT document as text (WebVTT when it starts with WEBVTT). Accepts ' +
            '@./captions.srt to read it from a file, which is the better route for anything long. ' +
            'Markup such as <i> is stripped; bay draws one style per caption.'
        },
        offsetFrames: {
          type: 'integer',
          description:
            'Shift every cue by this many frames — for captions of a clip that starts partway ' +
            'into the timeline. Negative is allowed as long as no cue lands before frame 0.'
        },
        style: {
          type: 'object',
          description:
            'Overrides for the caption look, the same fields as edit_item "text" (fontSize, ' +
            'color, background, …), merged over the caption default.'
        }
      }
    }
  },
  {
    name: 'add_marker',
    description:
      'Put a named marker on the timeline at a frame — a note in time that read_project hands ' +
      'back on every later call. Reach for it to mark something you will act on later ("the ' +
      'laugh", "chapter 2", "check this cut"), to leave the user a point to review, or to record ' +
      'beats you found before editing to them. Markers belong to the program, not to a clip: ' +
      'they stay put when clips are moved or replaced, and move with time only when time itself ' +
      'is removed (remove_range) or the frame rate changes.',
    category: 'write',
    readOnly: false,
    dryRunnable: true,
    inputSchema: {
      type: 'object',
      properties: {
        frame: frames('Where the marker goes. Defaults to the playhead.'),
        label: {
          type: 'string',
          description: 'What it says. Omit it and bay numbers it ("Marker 3").'
        },
        color: { type: 'string', description: 'Hex, such as "#F5A524". Omit for the default.' }
      }
    }
  },
  {
    name: 'remove_marker',
    description:
      'Take a marker off the timeline. Nothing else changes. Marker ids come from read_project ' +
      'or add_marker; an unknown id is refused with the list of markers that do exist.',
    category: 'write',
    readOnly: false,
    dryRunnable: true,
    inputSchema: {
      type: 'object',
      properties: { markerId: { type: 'string' } },
      required: ['markerId']
    }
  },
  {
    name: 'set_playhead',
    description:
      'Move the playhead, which is what the user is looking at and what frame-defaulting tools ' +
      'use. Cheap and safe; move it to where you are working so the user follows along.',
    category: 'write',
    readOnly: false,
    dryRunRefusal:
      'set_playhead moves what the user is looking at, not the project, so there is no ' +
      'document change to predict. Call it without validateOnly; the result reports the ' +
      'frame it actually landed on.',
    inputSchema: {
      type: 'object',
      properties: { frame: frames('Frame to move to.') },
      required: ['frame']
    }
  },
  {
    name: 'undo',
    description:
      'Take back the last change. One agent edit is one undo step, so this reverses exactly ' +
      'what you last did — not the whole turn.',
    category: 'write',
    readOnly: false,
    dryRunnable: true,
    inputSchema: { type: 'object', properties: {} }
  },

  // -- submit ----------------------------------------------------------------
  {
    name: 'export_timeline',
    description:
      'Render the timeline to a file. Returns a job id immediately — encoding a long timeline ' +
      'takes minutes, so poll track_export rather than waiting. Check the result before ' +
      'telling the user it is done: an export can finish with no frames if the timeline is ' +
      'empty over the range you asked for.',
    category: 'submit',
    readOnly: false,
    dryRunRefusal:
      'export_timeline starts an encode that writes a file, which a dry run cannot take ' +
      'back. Check the range with preview_frame at its first and last frames instead.',
    inputSchema: {
      type: 'object',
      properties: {
        outputPath: { type: 'string', description: 'Absolute path, with extension.' },
        format: { type: 'string', enum: ['mp4', 'mov', 'webm', 'wav', 'mp3'] },
        fromFrame: frames('First frame. Defaults to 0.'),
        toFrame: frames('Last frame, inclusive. Defaults to the end of the timeline.')
      },
      required: ['outputPath', 'format']
    }
  },
  {
    name: 'track_export',
    description:
      'Progress of an export job: stage, frames done, and the output path once it lands. ' +
      'Poll on a sensible interval rather than in a tight loop; a render reports progress only ' +
      'as frames are encoded.',
    category: 'read',
    readOnly: true,
    inputSchema: {
      type: 'object',
      properties: { jobId: { type: 'string' } },
      required: ['jobId']
    }
  }
]

/**
 * Whether bay can be driven over MCP, in the shape the bridge hands the renderer.
 *
 * Structurally identical to main's `SocketStatus` plus the live connection count, except that
 * the path is `socketPath` on this side. Declared here rather than imported from either end
 * because both ends need it and neither may import the other.
 */
export interface AgentSurfaceStatus {
  ready: boolean
  error: string | null
  socketPath: string | null
  connectionsSeen: number
}

/**
 * The three states the UI has to tell apart, as one line.
 *
 * `waiting` and `failed` look identical from outside — nothing is happening either way — and
 * conflating them is how a subsystem that never worked survives as one nobody used. So the
 * wording is deliberately different in kind: a failure names a reason, waiting names the
 * socket path, because the path is what a user needs in order to configure a client.
 *
 * It lives in `shared/` for a reason worth keeping: the first version sat in
 * `main/mcp/socket-server.ts`, where the renderer — the only process with a status bar to put
 * it in — could not import it. It had no callers for as long as it existed, so the distinction
 * this function was written to draw was never once drawn on screen, in the subsystem whose
 * whole point is that a silent failure is indistinguishable from an idle success. The type was
 * designed carefully, the IPC was plumbed, and the sentence was written on the wrong side of
 * the process boundary.
 */
export function summariseAgentSurface(status: AgentSurfaceStatus): string {
  if (!status.ready) return `Agent control unavailable — ${status.error ?? 'unknown reason'}`
  if (status.connectionsSeen === 0)
    return `Agent control ready — no agent has connected yet (${status.socketPath ?? 'no socket path'})`
  const n = status.connectionsSeen
  return `Agent control ready — ${n} connection${n === 1 ? '' : 's'} this session`
}

export function findTool(name: string): ToolSpec | undefined {
  return TOOLS.find((t) => t.name === name)
}

// ---------------------------------------------------------------------------
// Dry runs
// ---------------------------------------------------------------------------

export const VALIDATE_ONLY = 'validateOnly'

const validateOnlyProperty = {
  type: 'boolean',
  description:
    'Dry run. true: check the call against the real project and return what it would ' +
    'return, as { validateOnly: true, wouldReturn }, without changing anything — no undo ' +
    'step, nothing marked unsaved. Needs no approval. A call that would be refused is ' +
    'refused the same way, so this is how to test a plan before proposing or making it.'
}

/**
 * The schema a tool is published and validated with: its own, plus `validateOnly` when the
 * catalog marks it dry-runnable.
 *
 * One function feeding the manifest and the validator, so the two cannot disagree — a tool
 * that advertised the flag and then refused it as an unknown argument would be a control that
 * does nothing, and one that accepted it unadvertised would be one no agent finds.
 */
export function publishedSchema(spec: ToolSpec): ToolSpec['inputSchema'] {
  if (!spec.dryRunnable) return spec.inputSchema
  return {
    ...spec.inputSchema,
    properties: { ...spec.inputSchema.properties, [VALIDATE_ONLY]: validateOnlyProperty }
  }
}

/**
 * What a call asks for once `validateOnly` is read off it.
 *
 * - `run`: an ordinary call. `args` has `validateOnly: false` removed, so an approval made
 *   without the flag still matches a call that spells it out.
 * - `dry`: a dry run. `args` is what the handler receives — the flag removed, because no
 *   handler declares it and the dry run is the executor's business, not the tool's.
 * - `refused`: a dry run of a tool that cannot have one, with the reason.
 *
 * A non-boolean flag is left in place as a `run`, for the validator to name.
 */
export type DryRunRequest =
  | { mode: 'run'; args: Record<string, unknown> }
  | { mode: 'dry'; args: Record<string, unknown> }
  | { mode: 'refused'; error: string }

export function dryRunRequest(spec: ToolSpec, args: Record<string, unknown>): DryRunRequest {
  const flag = args[VALIDATE_ONLY]
  if (flag !== true && flag !== false) return { mode: 'run', args }
  const { [VALIDATE_ONLY]: _flag, ...rest } = args
  if (flag === false) return { mode: 'run', args: rest }
  if (spec.dryRunnable) return { mode: 'dry', args: rest }
  if (spec.readOnly) {
    return {
      mode: 'refused',
      error:
        `${spec.name} only reads, so it already changes nothing — call it without validateOnly.`
    }
  }
  return {
    mode: 'refused',
    error:
      `${spec.name} cannot be dry-run. ${spec.dryRunRefusal ?? 'Its effects reach outside the project, where a dry run cannot put them back.'} ` +
      `Tools that accept validateOnly: ${TOOLS.filter((t) => t.dryRunnable).map((t) => t.name).join(', ')}.`
  }
}

// ---------------------------------------------------------------------------
// Id matching
// ---------------------------------------------------------------------------

/**
 * Resolve an id an agent gave us against the ids that exist.
 *
 * Accepts a prefix because a full uuid is a lot of tokens to copy accurately, and a model
 * that retypes one will eventually retype it wrong. Ambiguity is an error rather than a
 * guess: two items matching a prefix means the agent is about to edit the wrong clip.
 */
export function resolveId(
  given: string,
  candidates: readonly string[]
): { ok: true; id: string } | { ok: false; error: string } {
  const needle = given.trim()
  if (needle.length === 0) return { ok: false, error: 'An id is required, but an empty string was given.' }

  const exact = candidates.find((id) => id === needle)
  if (exact) return { ok: true, id: exact }

  const matches = candidates.filter((id) => id.startsWith(needle))
  if (matches.length === 1) return { ok: true, id: matches[0]! }

  if (matches.length > 1) {
    return {
      ok: false,
      error:
        `"${needle}" matches ${matches.length} ids — it is too short to be unambiguous. ` +
        `Use more of the id: ${matches.map((m) => m.slice(0, 12)).join(', ')}.`
    }
  }
  return {
    ok: false,
    error:
      `No id starting with "${needle}" exists here. Ids are not guessable — call read_project ` +
      `and copy one from its output.`
  }
}
