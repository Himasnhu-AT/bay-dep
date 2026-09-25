/**
 * The Generate tab's jobs, kept outside the tab.
 *
 * A job started from the tab imports itself when it lands. That promise used to live in the
 * component — the set of its own job ids in a `useRef`, the polling in an effect — and the
 * component unmounts whenever the dock switches to Chat or closes. A video takes minutes; the
 * user who clicked Generate and went back to the conversation paid for a result that then sat in
 * main's job list and never reached the media pool. Here the ids and the polling belong to the
 * module, so they last as long as the window, and the tab only reads the snapshot.
 *
 * A factory with its effects passed in (the bridge, the import, the timer), so the promise is
 * testable with no window and no React: `generationJobs.test.ts`.
 */

import { createStore, type StoreApi } from 'zustand/vanilla'
import type { GenerationJob, GenerationSpending, ProviderKeyStatus } from '@shared/generation'

export interface GenerationSnapshot {
  /** Null until the first read answers. */
  keys: ProviderKeyStatus[] | null
  spending: GenerationSpending | null
  jobs: GenerationJob[]
  /** When the snapshot was read, for "started 2 min ago". */
  now: number
  /** Why the last read failed, or null when it answered. */
  readError: string | null
}

export interface GenerationReader {
  keys(): Promise<ProviderKeyStatus[]>
  spending(): Promise<GenerationSpending>
  jobs(): Promise<GenerationJob[]>
}

export interface GenerationJobsDeps {
  /** Main's generation calls, or null when this window has no bridge. */
  api(): GenerationReader | null
  /** Import one landed job into the project, telling the user how it went. */
  importJob(job: GenerationJob): Promise<void>
  /** Whether a landed job's file is already an asset (imported by hand, or by the agent). */
  isImported(job: GenerationJob): boolean
  schedule(run: () => void, ms: number): unknown
  now(): number
  pollMs: number
}

export interface GenerationJobs {
  store: StoreApi<GenerationSnapshot>
  /** Read keys, spending and jobs now; keeps polling while any job is queued or running. */
  refresh(): Promise<void>
  /** A job this window started: import it when it lands, whether or not the tab is showing. */
  adopt(jobId: string): void
  /** Import a landed job, once at a time per job. */
  importJob(job: GenerationJob): Promise<void>
}

const isActive = (job: GenerationJob): boolean => job.status === 'queued' || job.status === 'running'

export function createGenerationJobs(deps: GenerationJobsDeps): GenerationJobs {
  const store = createStore<GenerationSnapshot>(() => ({
    keys: null,
    spending: null,
    jobs: [],
    now: deps.now(),
    readError: null
  }))
  const mine = new Set<string>()
  const importing = new Set<string>()
  let scheduled = false

  const importJob = async (job: GenerationJob): Promise<void> => {
    if (importing.has(job.id)) return
    importing.add(job.id)
    try {
      await deps.importJob(job)
    } finally {
      importing.delete(job.id)
    }
  }

  const land = (jobs: readonly GenerationJob[]): void => {
    for (const job of jobs) {
      if (!mine.has(job.id) || isActive(job)) continue
      // Done or failed, it is settled either way; only a done one has anything to import.
      mine.delete(job.id)
      if (job.status === 'done' && !deps.isImported(job)) void importJob(job)
    }
  }

  const poll = (): void => {
    if (scheduled || !store.getState().jobs.some(isActive)) return
    scheduled = true
    deps.schedule(() => {
      scheduled = false
      void refresh()
    }, deps.pollMs)
  }

  const refresh = async (): Promise<void> => {
    const api = deps.api()
    if (!api) return
    try {
      const [keys, spending, jobs] = await Promise.all([api.keys(), api.spending(), api.jobs()])
      store.setState({ keys, spending, jobs, now: deps.now(), readError: null })
      land(jobs)
    } catch (error) {
      // Kept, not thrown: a rejection here was unhandled every poll, and the form said
      // "Checking provider keys…" for good. The last good snapshot stays; the reason shows.
      store.setState({ readError: error instanceof Error && error.message ? error.message : String(error), now: deps.now() })
    }
    poll()
  }

  return {
    store,
    refresh,
    adopt(jobId) {
      mine.add(jobId)
    },
    importJob
  }
}
