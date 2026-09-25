/**
 * A map bounded by bytes, dropping the least recently used entry first. Visual search keeps two:
 * content keys by file stamp and loaded indexes by name. Unbounded, a session that searched
 * many projects' footage held every index it had ever read (≈3 KB a frame, so ~5 MB an hour of
 * footage) until quit.
 *
 * An entry larger than the whole budget is not kept at all — keeping it would evict everything
 * else and still be over.
 */

export class ByteLru<V> {
  readonly #entries = new Map<string, { value: V; bytes: number }>()
  readonly #budget: number
  readonly #sizeOf: (key: string, value: V) => number
  #bytes = 0

  constructor(budgetBytes: number, sizeOf: (key: string, value: V) => number) {
    this.#budget = budgetBytes
    this.#sizeOf = sizeOf
  }

  get bytes(): number {
    return this.#bytes
  }

  get size(): number {
    return this.#entries.size
  }

  get(key: string): V | undefined {
    const entry = this.#entries.get(key)
    if (!entry) return undefined
    // Re-inserting moves it to the end: Map iterates in insertion order, oldest first.
    this.#entries.delete(key)
    this.#entries.set(key, entry)
    return entry.value
  }

  set(key: string, value: V): void {
    this.delete(key)
    const bytes = this.#sizeOf(key, value)
    if (bytes > this.#budget) return
    this.#entries.set(key, { value, bytes })
    this.#bytes += bytes
    for (const [oldest, entry] of this.#entries) {
      if (this.#bytes <= this.#budget) break
      this.#entries.delete(oldest)
      this.#bytes -= entry.bytes
    }
  }

  delete(key: string): void {
    const entry = this.#entries.get(key)
    if (!entry) return
    this.#entries.delete(key)
    this.#bytes -= entry.bytes
  }

  clear(): void {
    this.#entries.clear()
    this.#bytes = 0
  }
}
