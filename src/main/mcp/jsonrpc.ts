/**
 * Newline-delimited JSON-RPC 2.0 framing.
 *
 * The same framing carries MCP over the proxy's stdio and bay's calls over the unix socket,
 * which is why it is one module and not two: a mismatch between them would appear as an
 * agent's call silently doing nothing, at the one boundary where there is no UI to notice.
 *
 * It imports nothing — not Node, not Electron — so the framing can be tested against the byte
 * sequences a real client produces rather than against a mock. That seam is the same one
 * `serve.ts` uses, and it has paid for itself every time.
 *
 * The one rule the transport imposes: **a message may not contain a raw newline**, because
 * the newline is the delimiter. `JSON.stringify` escapes them inside strings, so this holds
 * for any value that survives a round trip — but it is the reason nothing here may pretty-print.
 */

export interface JsonRpcRequest {
  jsonrpc: '2.0'
  id?: string | number | null
  method: string
  params?: unknown
}

export interface JsonRpcSuccess {
  jsonrpc: '2.0'
  id: string | number | null
  result: unknown
}

export interface JsonRpcFailure {
  jsonrpc: '2.0'
  id: string | number | null
  error: { code: number; message: string; data?: unknown }
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure

/** The subset of JSON-RPC's codes this transport can actually produce. */
export const RPC_PARSE_ERROR = -32700
export const RPC_INVALID_REQUEST = -32600
export const RPC_METHOD_NOT_FOUND = -32601
export const RPC_INVALID_PARAMS = -32602
export const RPC_INTERNAL_ERROR = -32603

export function success(id: string | number | null, result: unknown): JsonRpcSuccess {
  return { jsonrpc: '2.0', id, result }
}

export function failure(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown
): JsonRpcFailure {
  return { jsonrpc: '2.0', id, error: data === undefined ? { code, message } : { code, message, data } }
}

/** One message, ready to write. The trailing newline is part of the frame, not decoration. */
export function encode(message: JsonRpcResponse | JsonRpcRequest): string {
  return `${JSON.stringify(message)}\n`
}

/**
 * A notification is a request with no `id`, and it must never be answered.
 *
 * Worth its own function because the distinction is easy to lose and the failure is
 * asymmetric: answering a notification puts an unexpected response into the client's stream,
 * and some clients treat that as a protocol violation and close the connection.
 */
export function isNotification(request: JsonRpcRequest): boolean {
  return request.id === undefined
}

export interface ParsedLine {
  request?: JsonRpcRequest
  /** Set when the line could not be understood; the caller answers with this. */
  error?: JsonRpcFailure
}

/**
 * Parses one line into a request, or into the failure to send back.
 *
 * Malformed input gets a response rather than a thrown exception because the peer is a
 * separate process: throwing would take down a transport that is still perfectly able to
 * serve the next line.
 */
export function parseLine(line: string): ParsedLine | null {
  const trimmed = line.trim()
  if (trimmed.length === 0) return null

  let value: unknown
  try {
    value = JSON.parse(trimmed)
  } catch {
    return { error: failure(null, RPC_PARSE_ERROR, 'Message is not valid JSON.') }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { error: failure(null, RPC_INVALID_REQUEST, 'Message must be a JSON object.') }
  }

  const candidate = value as Partial<JsonRpcRequest> & { id?: unknown }
  const id =
    typeof candidate.id === 'string' || typeof candidate.id === 'number' || candidate.id === null
      ? (candidate.id as string | number | null)
      : undefined

  if (typeof candidate.method !== 'string' || candidate.method.length === 0) {
    return { error: failure(id ?? null, RPC_INVALID_REQUEST, 'Message has no method.') }
  }

  const request: JsonRpcRequest = { jsonrpc: '2.0', method: candidate.method }
  if (id !== undefined) request.id = id
  if (candidate.params !== undefined) request.params = candidate.params
  return { request }
}

/**
 * Splits a stream of bytes into complete lines, keeping whatever is left over.
 *
 * A socket hands over arbitrary chunks: one write can arrive as three reads, and three writes
 * can arrive as one. Treating a chunk as a message is the bug this exists to prevent, and it
 * only shows up under load — small messages arrive whole in testing and split in production.
 */
export class LineBuffer {
  #pending = ''

  /** Adds a chunk and returns every complete line it completed. */
  push(chunk: string): string[] {
    this.#pending += chunk
    const lines: string[] = []
    let newline = this.#pending.indexOf('\n')
    while (newline !== -1) {
      lines.push(this.#pending.slice(0, newline))
      this.#pending = this.#pending.slice(newline + 1)
      newline = this.#pending.indexOf('\n')
    }
    return lines
  }

  /** What has arrived but has no newline yet. Non-empty at close means a truncated message. */
  get remainder(): string {
    return this.#pending
  }
}
