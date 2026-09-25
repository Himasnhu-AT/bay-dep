/**
 * Dubs in flight, kept by main beside the job table (`<userData>/generation-dubs.json`).
 *
 * A dub is many speech jobs plus what the renderer knows about them: which job is which cue, the
 * lines not started yet because the jobs-at-once limit was full, the plan they were checked
 * against, and what was placed. That used to live only in the renderer, so a reload forgot it —
 * lines never started, landed lines never placed, and the only way back was placing jobs one by
 * one. Main keeps it now and hands it back; the renderer resumes from it (`mcp/dub.ts`).
 *
 * Main does not interpret a record — the renderer owns the shape (`DubRecordData` in
 * `@shared/dub`) — but it does bound what it keeps: an id, a size, a count. The renderer is not
 * what enforces a limit.
 *
 * Electron-free: the file is injected, so `dub-records.test.ts` runs it in a temp folder.
 */

import { readFile, rename, writeFile } from 'node:fs/promises'

/** Records kept, newest first. A dub older than the last fifty is long placed or long abandoned. */
export const KEEP_DUBS = 50
/** One record's JSON, at most: a few hundred lines with their text and assets. */
export const MAX_DUB_RECORD_BYTES = 512 * 1024

export interface StoredDub {
  id: string
  createdAt: number
  [key: string]: unknown
}

interface FileShape {
  version: 1
  dubs: StoredDub[]
}

export class DubRecords {
  readonly #file: string
  readonly #dubs = new Map<string, StoredDub>()
  #loading: Promise<void> | null = null
  #writing: Promise<void> = Promise.resolve()

  constructor(file: string) {
    this.#file = file
  }

  load(): Promise<void> {
    this.#loading ??= (async () => {
      let parsed: Partial<FileShape> | null = null
      try {
        parsed = JSON.parse(await readFile(this.#file, 'utf8')) as Partial<FileShape>
      } catch {
        parsed = null
      }
      for (const dub of Array.isArray(parsed?.dubs) ? parsed.dubs : []) {
        if (checkDub(dub) === null) this.#dubs.set(dub.id, dub)
      }
    })()
    return this.#loading
  }

  /** Every record, newest first. */
  async list(): Promise<StoredDub[]> {
    await this.load()
    return [...this.#dubs.values()].sort((a, b) => b.createdAt - a.createdAt).map((dub) => structuredClone(dub))
  }

  /** Writes one record, replacing the one with its id. Refused, with the reason, when it is not a record. */
  async save(input: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
    await this.load()
    const problem = checkDub(input)
    if (problem) return { ok: false, error: problem }
    const dub = structuredClone(input as StoredDub)
    this.#dubs.set(dub.id, dub)
    const newest = [...this.#dubs.values()].sort((a, b) => b.createdAt - a.createdAt)
    for (const old of newest.slice(KEEP_DUBS)) this.#dubs.delete(old.id)
    try {
      await this.#write()
      return { ok: true }
    } catch (error) {
      return { ok: false, error: `The dub could not be saved: ${error instanceof Error ? error.message : String(error)}` }
    }
  }

  /** Waits for every pending write. For tests and quit. */
  async flush(): Promise<void> {
    await this.#writing
  }

  #write(): Promise<void> {
    const bytes = JSON.stringify({ version: 1, dubs: [...this.#dubs.values()] } satisfies FileShape)
    const next = this.#writing.then(async () => {
      const temp = `${this.#file}.tmp`
      await writeFile(temp, bytes, { mode: 0o600 })
      await rename(temp, this.#file)
    })
    this.#writing = next.catch(() => undefined)
    return next
  }
}

/** Why `value` is not a record main will keep, or null when it is. */
export function checkDub(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'A dub record must be an object.'
  const record = value as Record<string, unknown>
  if (typeof record.id !== 'string' || !/^dub-[A-Za-z0-9_-]{1,60}$/.test(record.id)) return 'A dub record needs an id like "dub-…".'
  if (typeof record.createdAt !== 'number' || !Number.isFinite(record.createdAt)) return 'A dub record needs a createdAt time.'
  let size: number
  try {
    size = JSON.stringify(record).length
  } catch {
    return 'A dub record must be plain data.'
  }
  if (size > MAX_DUB_RECORD_BYTES) return `A dub record is ${Math.round(size / 1024)} KB; the limit is ${MAX_DUB_RECORD_BYTES / 1024} KB.`
  return null
}
