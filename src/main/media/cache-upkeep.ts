/**
 * When the budget actually runs, and which entries are off limits while it does.
 *
 * Separated from `cache-budget.ts` so that file stays pure enough to test against a real
 * directory without an app. This one holds the two pieces of session state — what has been
 * used, and whether a pass is pending — and it is the only place that knows where the cache
 * directories are.
 */

import { peaksDir, thumbsDir } from '../paths'
import { CACHE_BUDGET_BYTES, enforceCacheBudget, touchEntry } from './cache-budget'

/**
 * Keys this session has read or written.
 *
 * Never cleared. Everything in it is something the user has looked at since launch — a clip
 * on the timeline, an asset in the media panel — and evicting those is what would make the
 * budget a treadmill rather than a bound. A long session can therefore end up permanently
 * over budget, and that is the correct outcome: the alternative is deleting the working set
 * of an editor that is still using it.
 */
const inUse = new Set<string>()

function markUsed(key: string): void {
  inUse.add(key)
}

/** Records the hit and refreshes the entry's position in the LRU order. */
export function noteCacheHit(key: string, firstPath: string): void {
  markUsed(key)
  void touchEntry(firstPath)
}

/**
 * Measuring the cache means a readdir plus a stat per file, so it must not run per write —
 * a single filmstrip is 24 writes. Passes are coalesced into one, a few seconds after
 * things go quiet.
 */
const QUIET_PERIOD_MS = 5_000

let pending: NodeJS.Timeout | null = null
let running = false

export function scheduleCacheUpkeep(): void {
  if (pending) clearTimeout(pending)
  pending = setTimeout(() => {
    pending = null
    void runCacheUpkeep()
  }, QUIET_PERIOD_MS)
  // Not `unref`'d: a pass that has been scheduled should finish, and 5s of held event loop at
  // quit is cheaper than a cache that only ever shrinks when the app happens to stay open.
}

export async function runCacheUpkeep(): Promise<void> {
  if (running) return
  running = true
  try {
    const result = await enforceCacheBudget([thumbsDir(), peaksDir()], CACHE_BUDGET_BYTES, inUse)
    if (result.entriesEvicted > 0) {
      const mb = (bytes: number): string => (bytes / (1024 * 1024)).toFixed(0)
      console.log(
        `[bay] Media cache: evicted ${result.entriesEvicted} entries ` +
          `(${result.filesRemoved} files), ${mb(result.bytesBefore)} MB → ${mb(result.bytesAfter)} MB.`
      )
    }
    if (!result.underBudget && result.bytesBefore > CACHE_BUDGET_BYTES) {
      // Said out loud rather than retried. Everything left is in use, so another pass would
      // evict nothing and a forced one would evict the working set and immediately re-derive
      // it. Over budget is the honest state; a loop would not be.
      console.log(
        `[bay] Media cache is over its budget and everything in it is in use this session. ` +
          `It will come back under budget on the next launch.`
      )
    }
  } finally {
    running = false
  }
}

/** For tests and for shutdown: drops a scheduled pass that has not run yet. */
export function cancelCacheUpkeep(): void {
  if (pending) clearTimeout(pending)
  pending = null
}
