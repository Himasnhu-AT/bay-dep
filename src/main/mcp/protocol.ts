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

import { TOOLS, findTool, type ToolSpec } from '@shared/mcp'
import { ALL_RESOURCES, findResource } from '@shared/resources'
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

export const SERVER_INFO = { name: 'bay', version: '0.1.0' } as const

export interface ToolOutcome {
  ok: boolean
  /** Rendered into MCP's content array. A string for text, anything else is JSON-stringified. */
  value: unknown
}

export type RunTool = (name: string, args: Record<string, unknown>) => Promise<ToolOutcome>

/** What MCP puts on the wire for a tool, which is a subset of what `ToolSpec` carries. */
function publicTool(spec: ToolSpec): Record<string, unknown> {
  // `readOnlyHint` is MCP's name for the catalog's own `readOnly`. It lets a client that
  // decides permissions per call wave reads through without asking.
  return {
    name: spec.name,
    description: spec.description,
    inputSchema: spec.inputSchema,
    annotations: { readOnlyHint: spec.readOnly }
  }
}

export function toolManifest(): Record<string, unknown>[] {
  return TOOLS.map(publicTool)
}

function textContent(value: unknown): { type: 'text'; text: string }[] {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  return [{ type: 'text', text: text ?? '' }]
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

export async function handleRequest(
  request: JsonRpcRequest,
  runTool: RunTool,
  readResource: ReadResource = () => null
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
      return success(id, { tools: toolManifest() })

    case 'tools/call': {
      const params = (request.params ?? {}) as { name?: unknown; arguments?: unknown }
      if (typeof params.name !== 'string') {
        return failure(id, RPC_INVALID_PARAMS, 'tools/call requires a string `name`.')
      }
      if (!findTool(params.name)) {
        // Not a JSON-RPC method error: the method exists, the tool does not. Naming the real
        // ones is the difference between an agent recovering and an agent guessing again.
        return success(id, {
          content: textContent(
            `No tool named "${params.name}". bay's tools are: ${TOOLS.map((t) => t.name).join(', ')}.`
          ),
          isError: true
        })
      }
      const args =
        typeof params.arguments === 'object' && params.arguments !== null
          ? (params.arguments as Record<string, unknown>)
          : {}

      const outcome = await runTool(params.name, args)
      return success(id, { content: textContent(outcome.value), isError: !outcome.ok })
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
