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
  // -- read ------------------------------------------------------------------
  {
    name: 'read_project',
    description:
      'The project as it stands: name, canvas size and frame rate, every track, and every ' +
      'item with its id, position and duration in frames. Start here. Everything else takes ' +
      'ids that come from this output, and the frame rate here is what every other time in ' +
      'this surface is measured in. ' +
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
      properties: { frame: frames('Timeline frame to render. Defaults to the playhead.') }
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
      'and fonts beside the file and reference them by relative path. The result reports every ' +
      'problem found, with the line, before you place anything.',
    category: 'write',
    readOnly: false,
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
    name: 'read_composition',
    description:
      'Read a composition back: its declared id, duration and size, every fault with the line ' +
      'it is on, and optionally the HTML itself. Use it to check what you wrote before placing ' +
      'it, and to inspect one you did not write before editing it. Faults are reported even ' +
      'when the composition is usable — the non-fatal ones are the ones that matter most, ' +
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
    name: 'split_at',
    description:
      'Cut every item crossing a frame into two, or only the items you name. A cut exactly on ' +
      'an item edge does nothing — it would make a zero-length clip — and is reported rather ' +
      'than silently skipped.',
    category: 'write',
    readOnly: false,
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
    inputSchema: {
      type: 'object',
      properties: { transitionId: { type: 'string' } },
      required: ['transitionId']
    }
  },
  {
    name: 'set_playhead',
    description:
      'Move the playhead, which is what the user is looking at and what frame-defaulting tools ' +
      'use. Cheap and safe; move it to where you are working so the user follows along.',
    category: 'write',
    readOnly: false,
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
