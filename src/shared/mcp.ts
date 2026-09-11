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
  /**
   * Loaded into every session rather than discovered on demand. Keep this small: the whole
   * catalog in every context is the cost this flag exists to avoid. A tool earns it by being
   * needed to *orient* — you cannot edit what you have not read.
   */
  alwaysLoad: boolean
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
    alwaysLoad: true,
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
    alwaysLoad: true,
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
    alwaysLoad: false,
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
    alwaysLoad: true,
    inputSchema: {
      type: 'object',
      properties: { frame: frames('Timeline frame to render. Defaults to the playhead.') }
    }
  },

  // -- write -----------------------------------------------------------------
  {
    name: 'import_media',
    description:
      'Import files from absolute paths into the media pool. Returns one asset per path, ' +
      'including any that could not be read — check `error` on each before placing it. ' +
      'Importing a path already in the project reuses the existing asset rather than ' +
      'duplicating it.',
    category: 'write',
    readOnly: false,
    alwaysLoad: true,
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
    alwaysLoad: true,
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
    alwaysLoad: true,
    inputSchema: {
      type: 'object',
      properties: {
        itemId,
        from: frames('New start frame.'),
        durationInFrames: { type: 'integer', minimum: 1, description: 'New length in frames.' },
        trackId: { type: 'string' },
        left: { type: 'number', description: 'Canvas x in pixels. Negative is valid.' },
        top: { type: 'number', description: 'Canvas y in pixels. Negative is valid.' },
        width: { type: 'number' },
        height: { type: 'number' },
        opacity: { type: 'number', minimum: 0, maximum: 1 },
        volume: { type: 'number', minimum: 0, maximum: 2 },
        speed: { type: 'number', description: 'Playback rate. 1 is source speed.' },
        fadeInFrames: { type: 'integer', minimum: 0 },
        fadeOutFrames: { type: 'integer', minimum: 0 }
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
    alwaysLoad: false,
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
      'Remove items from the timeline. Leaves a gap by default; pass ripple to close it by ' +
      'pulling later items on the same track backwards. Ripple never touches other tracks, so ' +
      'it will desynchronise anything layered above or below unless you move that too.',
    category: 'write',
    readOnly: false,
    alwaysLoad: false,
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
    name: 'add_track',
    description:
      'Add a video or audio track. Video tracks stack — a later one draws over the ones before ' +
      'it — so an overlay needs its own track above the clip it covers, not a free slot on the ' +
      'same one.',
    category: 'write',
    readOnly: false,
    alwaysLoad: false,
    inputSchema: {
      type: 'object',
      properties: { kind: { type: 'string', enum: ['video', 'audio'] } },
      required: ['kind']
    }
  },
  {
    name: 'set_playhead',
    description:
      'Move the playhead, which is what the user is looking at and what frame-defaulting tools ' +
      'use. Cheap and safe; move it to where you are working so the user follows along.',
    category: 'write',
    readOnly: false,
    alwaysLoad: false,
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
    alwaysLoad: false,
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
    alwaysLoad: false,
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
    alwaysLoad: false,
    inputSchema: {
      type: 'object',
      properties: { jobId: { type: 'string' } },
      required: ['jobId']
    }
  }
]

export const ALWAYS_LOADED = TOOLS.filter((t) => t.alwaysLoad).map((t) => t.name)

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
