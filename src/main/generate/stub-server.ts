/**
 * A local HTTP server standing in for the providers, for the generation tests only. Nothing in
 * the app imports it: the tests never reach a live API and never hold a real key.
 *
 * It listens on every interface, so `127.0.0.1` and `localhost` are two *hosts* for the host
 * allowlist while being one server — which is how the tests tell an API host (credentials go)
 * from a download host (they must not).
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { HostPolicy } from './http'

export interface Recorded {
  method: string
  url: string
  host: string
  headers: IncomingMessage['headers']
  body: Buffer
}

export type Route = (request: Recorded, response: ServerResponse) => void | Promise<void>

export interface Stub {
  /** `http://127.0.0.1:<port>` — the API host. */
  api: string
  /** `http://localhost:<port>` — the download host. */
  cdn: string
  requests: Recorded[]
  route: Route
  close(): Promise<void>
}

export const STUB_POLICY: HostPolicy = {
  apiHosts: ['127.0.0.1'],
  downloadHosts: ['localhost'],
  insecureHosts: ['127.0.0.1', 'localhost']
}

export async function startStub(route: Route): Promise<Stub> {
  const stub: Stub = {
    api: '',
    cdn: '',
    requests: [],
    route,
    close: async () => undefined
  }
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      const recorded: Recorded = {
        method: request.method ?? 'GET',
        url: request.url ?? '/',
        host: (request.headers.host ?? '').split(':')[0] ?? '',
        headers: request.headers,
        body: Buffer.concat(chunks)
      }
      stub.requests.push(recorded)
      Promise.resolve(stub.route(recorded, response)).catch((error: unknown) => {
        response.statusCode = 500
        response.end(String(error))
      })
    })
  })
  await new Promise<void>((resolve) => server.listen(0, resolve))
  const { port } = server.address() as AddressInfo
  stub.api = `http://127.0.0.1:${port}`
  stub.cdn = `http://localhost:${port}`
  stub.close = () =>
    new Promise<void>((resolve) => {
      server.closeAllConnections()
      server.close(() => resolve())
    })
  return stub
}

export function json(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status
  response.setHeader('content-type', 'application/json')
  response.end(JSON.stringify(body))
}
