/**
 * MCP's method dispatch, as a pure function of a request and a way to run a tool.
 *
 * Hand-written rather than taken from `@modelcontextprotocol/sdk`, and the reason is a
 * constraint rather than a preference: the brief called for the SDK and also forbade new
 * dependencies, and the SDK is not in `package.json`, `node_modules` or the lockfile. MCP
 * over stdio is newline-delimited JSON-RPC 2.0 with five methods, the framing is already
 * needed for the unix socket, and a proxy an MCP client spawns is better off with no
 * `node_modules` at all. If the SDK is added later this file is the only thing that goes.
 *
 * `runTool` is injected so the whole protocol layer can be tested without a socket, without
 * Electron, and without the app running — which is also what lets the proxy answer
 * `tools/list` before bay has started.
 */

import { TOOLS, findTool, publishedSchema, type ToolSpec } from '@shared/mcp'
import { ALL_RESOURCES, RESOURCES, findResource } from '@shared/resources'
import {
  RPC_INVALID_PARAMS,
  RPC_METHOD_NOT_FOUND,
  failure,
  success,
  type JsonRpcRequest,
  type JsonRpcResponse
} from './jsonrpc'

/**
 * The protocol revision this server speaks.
 *
 * Pinned as a literal and asserted in the test: it is a compatibility surface with every
 * client that has ever connected, and the negotiation rule is that a server answering with a
 * version the client did not offer must be tolerated by the client but cannot be relied on.
 */
export const PROTOCOL_VERSION = '2024-11-05'

const SERVER_INFO = { name: 'bay', version: '0.1.0' } as const

export interface ToolOutcome {
  ok: boolean
  /** Rendered into MCP's content array. A string for text, anything else is JSON-stringified. */
  value: unknown
  /**
   * Content already in MCP's shape, passed through untouched. Only the proxy sets this: it is
   * relaying an answer bay already rendered, and re-rendering it would flatten an image block
   * back into text — which is exactly how `preview_frame` came to reach the agent as half a
   * megabyte of base64 it could not look at.
   */
  content?: McpContent[]
}

export type McpContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }

/**
 * `signal` is the caller going away — its connection closed. A tool waiting on a job stops
 * waiting when it fires; nothing else reads it.
 */
export type RunTool = (name: string, args: Record<string, unknown>, signal?: AbortSignal) => Promise<ToolOutcome>

/** What MCP puts on the wire for a tool, which is a subset of what `ToolSpec` carries. */
function publicTool(spec: ToolSpec): Record<string, unknown> {
  // `readOnlyHint` is MCP's name for the catalog's own `readOnly`. It lets a client that
  // decides permissions per call wave reads through without asking.
  return {
    name: spec.name,
    description: spec.description,
    inputSchema: publishedSchema(spec),
    annotations: { readOnlyHint: spec.readOnly }
  }
}

export function toolManifest(): Record<string, unknown>[] {
  return TOOLS.map(publicTool)
}

// ---------------------------------------------------------------------------
// Gateway mode
// ---------------------------------------------------------------------------

/**
 * Which tool surface `tools/list` publishes.
 *
 * - `full` — every catalog tool, each with its schema. The default, and what bay's own agent
 *   panel uses: it allows the agent tools by name, so the names have to exist.
 * - `gateway` — three tools, for external clients that load every schema into every context
 *   and do no tool search. Twenty-odd schemas is a real cost paid on every turn by a client
 *   that may call three of them. `get_guidelines` returns the whole catalog once, on demand,
 *   and `execute` runs any of it — through the same `runTool` path, so validation, the
 *   approval gate, `@./file` arguments and image content behave exactly as a direct call.
 */
export type ToolMode = 'full' | 'gateway'

/** The environment variable the proxy reads its mode from. See `entry.ts`. */
export const TOOL_MODE_ENV = 'BAY_MCP_MODE'

/**
 * The mode an environment value asks for.
 *
 * An unrecognised value falls back to `full` — the mode every client works with — and says so,
 * because a typo that silently published the full catalog would look like gateway mode not
 * existing. The warning goes to stderr; stdout belongs to the protocol.
 */
export function toolModeFromEnv(value: string | undefined): {
  mode: ToolMode
  warning: string | null
} {
  const given = value?.trim().toLowerCase() ?? ''
  if (given === '' || given === 'full') return { mode: 'full', warning: null }
  if (given === 'gateway') return { mode: 'gateway', warning: null }
  return {
    mode: 'full',
    warning:
      `${TOOL_MODE_ENV}="${value}" is not a mode bay knows, so the full tool catalog is being ` +
      `published. Use ${TOOL_MODE_ENV}=gateway for the three-tool surface, or leave it unset.`
  }
}

const GATEWAY_TOOLS: readonly Record<string, unknown>[] = [
  {
    name: 'get_active_project',
    description:
      'Start here. A cheap summary of the project open in bay — name, canvas size, frame ' +
      'rate, duration, and how many tracks and items it has — plus whether bay is reachable ' +
      'at all. Launches bay if it is not running. For ids and positions, run read_project ' +
      'through execute.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true }
  },
  {
    name: 'get_guidelines',
    description:
      "bay's full editing toolset as compact text: every operation's name, what it is for, " +
      'and its exact argument schema, plus the guides worth reading before editing. Call it ' +
      'once, before your first execute. Never guess an operation name or argument.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true }
  },
  {
    name: 'execute',
    description:
      'Run one bay operation listed by get_guidelines: { tool, args }. It behaves exactly as ' +
      'calling that operation directly — the same validation, the same errors, and an image ' +
      'result (preview_frame) arrives as an image.',
    inputSchema: {
      type: 'object',
      properties: {
        tool: { type: 'string', description: 'Operation name, exactly as get_guidelines lists it.' },
        args: {
          type: 'object',
          description: "The operation's arguments, matching its schema. Omit for none."
        }
      },
      required: ['tool']
    },
    annotations: { readOnlyHint: false }
  }
]

/** One line of what a tool is for: its description up to the first sentence break. */
function purpose(description: string): string {
  const first = description.split(/(?<=[.!?])\s+/)[0] ?? description
  return first.replace(/\s+/g, ' ').trim()
}

/**
 * The catalog as text, for `get_guidelines`.
 *
 * Every tool, in catalog order, with its **published** schema — `validateOnly` included where
 * the catalog allows it — as one line of JSON. The schema is not abbreviated: an argument's
 * description is where "frames, not seconds" and "accepts @./file.json" live, and a gateway
 * that dropped them to save bytes would save them from the one call that is meant to carry them.
 */
function guidelinesText(): string {
  const lines: string[] = [
    "bay's operations. Run any of them with execute { tool, args }. Every time is a frame " +
      'index at the timeline fps (get_active_project reports it), never seconds. Ids are ' +
      'copied from tool results, never invented.',
    '',
    'Read these before editing (resources/read <uri>):',
    ...RESOURCES.map((r) => `- ${r.uri} — ${r.name}`),
    `- ${ALL_RESOURCES.length - RESOURCES.length} templates under bay://template/<id>; ` +
      'resources/list names them.',
    '',
    'Operations (read = changes nothing, write = changes the project):'
  ]
  for (const spec of TOOLS) {
    lines.push(
      '',
      `${spec.name} [${spec.readOnly ? 'read' : 'write'}] — ${purpose(spec.description)}`,
      `  args: ${JSON.stringify(publishedSchema(spec))}`
    )
  }
  lines.push(
    '',
    'An operation whose args include validateOnly can be dry-run: validateOnly: true returns ' +
      'what the call would return without changing anything.'
  )
  return lines.join('\n')
}

/**
 * A tool's answer as a value, whether it arrived as a value or as content the proxy relayed.
 *
 * The proxy hands `read_project` back as already-rendered content, so `get_active_project`
 * has to read the JSON out of the text block to summarise it.
 */
function outcomeValue(outcome: ToolOutcome): unknown {
  if (!outcome.content) return outcome.value
  const text = outcome.content.find((block) => block.type === 'text')
  if (!text || text.type !== 'text') return null
  try {
    return JSON.parse(text.text)
  } catch {
    return text.text
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/**
 * `get_active_project`: `read_project` through the ordinary path, reduced to what orients.
 *
 * Built on `read_project` rather than on a tool of its own, so the gateway adds nothing the app
 * has to implement, and the summary cannot disagree with the project it summarises.
 */
async function activeProject(runTool: RunTool): Promise<ToolOutcome> {
  const outcome = await runTool('read_project', {})
  if (!outcome.ok) {
    const reason = outcomeValue(outcome)
    return {
      ok: false,
      value: {
        bay: 'unreachable',
        reason: typeof reason === 'string' ? reason : JSON.stringify(reason),
        next:
          'Nothing can be edited until bay answers. Start bay, or fix what the reason names, ' +
          'then call get_active_project again.'
      }
    }
  }
  const read = asRecord(outcomeValue(outcome))
  const project = asRecord(read['project'])
  const timeline = asRecord(read['timeline'])
  const tracks = Array.isArray(read['tracks']) ? (read['tracks'] as unknown[]).map(asRecord) : []
  const itemCount = tracks.reduce(
    (sum, track) => sum + (Array.isArray(track['items']) ? (track['items'] as unknown[]).length : 0),
    0
  )
  return {
    ok: true,
    value: {
      bay: 'connected',
      project: project['name'] ?? null,
      savedTo: project['savedTo'] ?? null,
      timeline: timeline['name'] ?? null,
      canvas: { width: timeline['width'] ?? null, height: timeline['height'] ?? null },
      fps: timeline['fps'] ?? null,
      durationInFrames: timeline['durationInFrames'] ?? null,
      playhead: read['playhead'] ?? null,
      trackCount: tracks.length,
      itemCount,
      assetCount: read['assetCount'] ?? null,
      next:
        'Call get_guidelines once for the operations, then execute { tool: "read_project" } ' +
        'for ids and positions.'
    }
  }
}

function textContent(value: unknown): { type: 'text'; text: string }[] {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  return [{ type: 'text', text: text ?? '' }]
}

const DATA_URL = /^data:(image\/[a-z0-9.+-]+);base64,(.*)$/s

/**
 * A tool's value as MCP content, with any image lifted out into an image block.
 *
 * An image inside a JSON text block is not an image to a client — it is text, and a very large
 * amount of it. The agent in the panel said so plainly: *"both previews came back too large… I
 * haven't actually seen the picture."* So every top-level field holding a `data:image/…` URL is
 * moved into its own `image` block and replaced, in the JSON, with a pointer to it. Top-level
 * only, because that is where the one tool that returns a picture puts it; a deeper search
 * would be a guess about shapes nobody produces.
 */
export function toContent(value: unknown): McpContent[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return textContent(value)
  }
  const images: McpContent[] = []
  const rest: Record<string, unknown> = {}
  for (const [key, field] of Object.entries(value as Record<string, unknown>)) {
    const match = typeof field === 'string' ? DATA_URL.exec(field) : null
    if (match) {
      images.push({ type: 'image', mimeType: match[1]!, data: match[2]! })
      rest[key] = `(attached as image ${images.length})`
    } else {
      rest[key] = field
    }
  }
  return images.length === 0 ? textContent(value) : [...textContent(rest), ...images]
}

/**
 * Answers one request, or returns null when the request was a notification.
 *
 * A tool that fails answers with `isError: true` inside a *successful* JSON-RPC result rather
 * than a JSON-RPC error. That distinction is MCP's and it matters: a JSON-RPC error means the
 * call could not be made, and the client may retry or give up; `isError` means the call ran
 * and the model should read the message and choose differently. Collapsing them is how an
 * agent ends up retrying a call that will never work.
 */
/**
 * Reads one document's body, or null when this build does not carry it.
 *
 * Injected for the same reason `runTool` is: the bodies are inlined by Vite's `?raw`, which
 * only Vite resolves, so importing them here would make this module unloadable under plain
 * Node — and it took the 28 tests in this directory with it when tried. The protocol has no
 * business knowing where a document is stored anyway.
 */
export type ReadResource = (uri: string) => string | null

/** A tool outcome as an MCP `tools/call` result. */
function rendered(outcome: ToolOutcome): { content: McpContent[]; isError: boolean } {
  return { content: outcome.content ?? toContent(outcome.value), isError: !outcome.ok }
}

/**
 * One catalog tool, run. The single path both a direct `tools/call` and gateway `execute`
 * take, so the two cannot drift — `execute` is not a second dispatcher, it is a second way in.
 */
async function callTool(
  name: string,
  args: Record<string, unknown>,
  runTool: RunTool,
  mode: ToolMode,
  signal?: AbortSignal
): Promise<{ content: McpContent[]; isError: boolean }> {
  if (!findTool(name)) {
    // Not a JSON-RPC method error: the method exists, the tool does not. Naming the real
    // ones is the difference between an agent recovering and an agent guessing again.
    return {
      content: textContent(
        `No tool named "${name}". bay's tools are: ${TOOLS.map((t) => t.name).join(', ')}.` +
          (mode === 'gateway' ? ' Run them through execute { tool, args }.' : '')
      ),
      isError: true
    }
  }
  return rendered(await runTool(name, args, signal))
}

/** Gateway `execute`: unwrap `{ tool, args }` and take the ordinary path. */
async function execute(
  args: Record<string, unknown>,
  runTool: RunTool,
  signal?: AbortSignal
): Promise<{ content: McpContent[]; isError: boolean }> {
  const tool = args['tool']
  const inner = args['args'] ?? {}
  if (typeof tool !== 'string' || tool.length === 0) {
    return {
      content: textContent(
        'execute requires "tool": the name of an operation from get_guidelines, as a string — ' +
          'for example { "tool": "read_project" }.'
      ),
      isError: true
    }
  }
  if (typeof inner !== 'object' || inner === null || Array.isArray(inner)) {
    return {
      content: textContent(
        `execute's "args" must be an object of ${tool}'s arguments, but got ` +
          `${Array.isArray(inner) ? 'an array' : typeof inner}. Pass { "tool": "${tool}", ` +
          `"args": { ... } }, or leave args out for none.`
      ),
      isError: true
    }
  }
  return callTool(tool, inner as Record<string, unknown>, runTool, 'gateway', signal)
}

export async function handleRequest(
  request: JsonRpcRequest,
  runTool: RunTool,
  readResource: ReadResource = () => null,
  mode: ToolMode = 'full',
  signal?: AbortSignal
): Promise<JsonRpcResponse | null> {
  const id = request.id ?? null
  if (request.id === undefined) return null

  switch (request.method) {
    case 'initialize':
      return success(id, {
        protocolVersion: PROTOCOL_VERSION,
        // Resources are advertised here or they may as well not exist: a client that is not
        // told about the capability never calls resources/list, and the guides stay unread.
        capabilities: {
          tools: { listChanged: false },
          resources: { subscribe: false, listChanged: false }
        },
        serverInfo: SERVER_INFO
      })

    case 'ping':
      return success(id, {})

    case 'tools/list':
      return success(id, { tools: mode === 'gateway' ? [...GATEWAY_TOOLS] : toolManifest() })

    case 'tools/call': {
      const params = (request.params ?? {}) as { name?: unknown; arguments?: unknown }
      if (typeof params.name !== 'string') {
        return failure(id, RPC_INVALID_PARAMS, 'tools/call requires a string `name`.')
      }
      const args =
        typeof params.arguments === 'object' && params.arguments !== null
          ? (params.arguments as Record<string, unknown>)
          : {}

      if (mode === 'gateway') {
        if (params.name === 'get_guidelines') {
          return success(id, { content: textContent(guidelinesText()), isError: false })
        }
        if (params.name === 'get_active_project') {
          return success(id, rendered(await activeProject(runTool)))
        }
        if (params.name === 'execute') return success(id, await execute(args, runTool, signal))
      }
      // A catalog tool called by name still works in gateway mode. A client that learned a
      // name from get_guidelines and calls it directly is not wrong enough to refuse.
      return success(id, await callTool(params.name, args, runTool, mode, signal))
    }

    case 'resources/list':
      return success(id, {
        resources: ALL_RESOURCES.map((resource) => ({
          uri: resource.uri,
          name: resource.name,
          description: resource.description,
          mimeType: resource.mimeType
        }))
      })

    case 'resources/read': {
      const params = (request.params ?? {}) as { uri?: unknown }
      if (typeof params.uri !== 'string') {
        return failure(id, RPC_INVALID_PARAMS, 'resources/read requires a string `uri`.')
      }
      const spec = findResource(params.uri)
      const body = spec ? readResource(params.uri) : null
      if (!spec || body === null) {
        // Same reasoning as an unknown tool: the method exists, the document does not, and
        // naming the real ones is the difference between recovering and guessing again. A
        // listed uri with no body is a build fault, and says so rather than reading as empty.
        return failure(
          id,
          RPC_INVALID_PARAMS,
          spec
            ? `"${params.uri}" is listed but carries no content in this build. This is a fault ` +
                `in bay, not in your request.`
            : `No resource at "${params.uri}". bay serves: ${ALL_RESOURCES.map((r) => r.uri).join(', ')}.`
        )
      }
      return success(id, {
        contents: [{ uri: spec.uri, mimeType: spec.mimeType, text: body }]
      })
    }

    default:
      return failure(id, RPC_METHOD_NOT_FOUND, `Unknown method "${request.method}".`)
  }
}
