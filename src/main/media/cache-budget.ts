/**
 * A byte budget over the whole derived-media cache.
 *
 * Recorded as E1 in `fixes.md`: nothing evicted, ever. Growth is not driven by browsing —
 * the renderer asks with fixed constants, so each asset has exactly one filmstrip key, one
 * poster key and one peaks key at a time, about 50 KB measured. What is unbounded is
 * *re-encoding*: keys include the source's mtime and size, so a user who re-exports over the
 * same filename fifty times leaves fifty complete sets that nothing collects.
 *
 * Two decisions are worth their reasons, because both have a plausible wrong answer.
 *
 * **The budget is a constant.** A fraction of free disk was the tempting one and is worse: it
 * makes the limit move underneath the cache, so the same entries are legal one day and evicted
 * the next for reasons the user cannot see, and it shrinks exactly when the disk is filling —
 * scheduling the heaviest eviction for the worst possible moment. A setting was worse still:
 * there is no settings surface in this tree, and a setting nobody can reach is a dead control.
 * A constant checked against a measured per-asset cost can be revised with a number.
 *
 * **The budget is a target, not a cap.** Eviction never touches an entry used this session,
 * and *stops* when it cannot get under budget without touching one, leaving the cache over
 * budget and saying so. That is the whole defence against the failure the budget invites: if
 * the working set alone exceeds the limit, a cap would evict it, the app would immediately
 * re-derive it, and the next pass would evict it again — a loop that burns CPU forever and
 * ends with the cache exactly as large as it started.
 */

import { readdir, stat, unlink, utimes } from 'node:fs/promises'
import { basename, join } from 'node:path'

/**
 * 512 MB.
 *
 * Derived data measured at ~50 KB per asset (24-frame filmstrip at height 100, a poster, and
 * 600 peaks), so this holds on the order of ten thousand assets — far past any real project,
 * which is deliberate. Eviction should never be what a working editor runs into; it exists to
 * bound the one axis that has no natural limit.
 */
export const CACHE_BUDGET_BYTES = 512 * 1024 * 1024

/** Cache keys are 24 hex characters — see `cacheKey`. Anything else is not ours to delete. */
const KEY_PATTERN = /^[0-9a-f]{24}$/

export interface CacheFile {
  path: string
  bytes: number
  mtimeMs: number
}

export interface CacheEntry {
  key: string
  bytes: number
  /** Newest mtime in the group; see `touchEntry` for why mtime is the clock. */
  lastUsedMs: number
  paths: string[]
}

export interface EvictionPlan {
  evict: CacheEntry[]
  bytesBefore: number
  bytesAfter: number
  /** False when the budget could not be met without evicting something in use. */
  underBudget: boolean
}

/**
 * The cache key a file belongs to, or null if the file is not ours.
 *
 * A filmstrip is N files sharing one key (`<key>_007.jpg`); a poster is `<key>.jpg`. Grouping
 * matters more than it looks: evicting individual files out of a filmstrip would leave a
 * partial strip that still answers as a cache hit, so a clip would draw with frames missing
 * and nothing would report it.
 */
export function entryKeyFor(filePath: string): string | null {
  const name = basename(filePath)
  const stem = name.slice(0, 24)
  return KEY_PATTERN.test(stem) ? stem : null
}

export function groupByKey(files: readonly CacheFile[]): CacheEntry[] {
  const byKey = new Map<string, CacheEntry>()
  for (const file of files) {
    const key = entryKeyFor(file.path)
    if (!key) continue
    const existing = byKey.get(key)
    if (existing) {
      existing.bytes += file.bytes
      existing.lastUsedMs = Math.max(existing.lastUsedMs, file.mtimeMs)
      existing.paths.push(file.path)
    } else {
      byKey.set(key, { key, bytes: file.bytes, lastUsedMs: file.mtimeMs, paths: [file.path] })
    }
  }
  return [...byKey.values()]
}

/**
 * Which entries to remove, oldest first, to get under `budgetBytes`.
 *
 * `inUse` is the set of keys this session has read or written. They are never candidates:
 * they are on screen right now, and evicting them is what turns a budget into a treadmill.
 */
export function planEviction(
  entries: readonly CacheEntry[],
  budgetBytes: number,
  inUse: ReadonlySet<string>
): EvictionPlan {
  const bytesBefore = entries.reduce((total, entry) => total + entry.bytes, 0)

  // No early return for the under-budget case. There was one, and it was an optimisation
  // rather than a guard: the loop below breaks on its first check, so the result was
  // identical either way and no input could distinguish them. Skipping a filter and a sort on
  // a pass that is already debounced by five seconds is not worth a branch nobody can test.
  const candidates = entries
    .filter((entry) => !inUse.has(entry.key))
    .sort((a, b) => a.lastUsedMs - b.lastUsedMs || a.key.localeCompare(b.key))

  const evict: CacheEntry[] = []
  let bytesAfter = bytesBefore
  for (const entry of candidates) {
    if (bytesAfter <= budgetBytes) break
    evict.push(entry)
    bytesAfter -= entry.bytes
  }
  return { evict, bytesBefore, bytesAfter, underBudget: bytesAfter <= budgetBytes }
}

async function filesIn(directory: string): Promise<CacheFile[]> {
  let names: string[]
  try {
    names = await readdir(directory)
  } catch {
    return []
  }
  const out: CacheFile[] = []
  for (const name of names) {
    const path = join(directory, name)
    try {
      const info = await stat(path)
      if (info.isFile()) out.push({ path, bytes: info.size, mtimeMs: info.mtimeMs })
    } catch {
      // Vanished between readdir and stat — another window's eviction, or the user.
    }
  }
  return out
}

export interface EnforcementResult {
  bytesBefore: number
  bytesAfter: number
  entriesEvicted: number
  filesRemoved: number
  underBudget: boolean
}

/**
 * Brings the cache under budget, as far as it can without evicting anything in use.
 *
 * Directories are passed in rather than resolved here so this needs no Electron and the
 * fill-past-the-budget test can drive it against a real directory.
 */
export async function enforceCacheBudget(
  directories: readonly string[],
  budgetBytes: number,
  inUse: ReadonlySet<string>
): Promise<EnforcementResult> {
  const files: CacheFile[] = []
  for (const directory of directories) files.push(...(await filesIn(directory)))

  const plan = planEviction(groupByKey(files), budgetBytes, inUse)
  let filesRemoved = 0
  for (const entry of plan.evict) {
    for (const path of entry.paths) {
      try {
        await unlink(path)
        filesRemoved += 1
      } catch {
        // Already gone, or not ours to remove. Either way the next pass will re-measure.
      }
    }
  }

  return {
    bytesBefore: plan.bytesBefore,
    bytesAfter: plan.bytesAfter,
    entriesEvicted: plan.evict.length,
    filesRemoved,
    underBudget: plan.underBudget
  }
}

/**
 * Marks an entry as just used, by setting its mtime to now.
 *
 * mtime is the clock rather than atime, and that is a measured choice: atime updates on this
 * machine's volume but its semantics vary with filesystem and mount options — `noatime` is
 * common and makes it constant — so an LRU built on it would silently degrade into
 * least-recently-*created* on some installs and nobody would be able to tell. An explicit
 * touch costs the same and cannot be wrong. Only the first file of a group is touched, so a
 * 24-frame filmstrip hit is one syscall rather than 24; `groupByKey` takes the newest mtime
 * in the group, so touching one is enough.
 */
export async function touchEntry(firstPath: string): Promise<void> {
  const now = new Date()
  try {
    await utimes(firstPath, now, now)
  } catch {
    // A cache entry that cannot be touched is one that is about to be regenerated anyway.
  }
}
