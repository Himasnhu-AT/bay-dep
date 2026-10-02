/**
 * The New Project choice and the Resolve connection panel, as far as they are decisions rather
 * than markup: which editor Enter creates in, where an arrow key goes, how often the connection
 * is asked about, and what is said when Resolve is chosen before it can be reached.
 *
 * Pure — no React, no store, no bridge — so `projectHost.test.ts` holds each rule.
 */

import { parseHost, PROJECT_HOSTS, type ProjectHost, type ResolveState, type ResolveStatus } from '@shared/host'

/**
 * Where the last New Project choice is kept. Read back by later builds, so the string is a
 * compatibility surface: rename it and everyone's remembered editor is forgotten.
 */
export const NEW_PROJECT_HOST_KEY = 'bay.newProject.host'

/** The editor the dialog opens on. Nothing stored, or anything this build does not know, is bay. */
export function rememberedHost(stored: string | null): ProjectHost {
  return parseHost(stored)
}

/** What to store for a choice. bay is the default and is stored as absence. */
export function hostToRemember(host: ProjectHost): string | null {
  return host === 'bay' ? null : host
}

/**
 * The card an arrow key moves to. The cards are a row that stops at its ends — Premiere Pro, the
 * third, cannot be chosen yet — and any other key leaves the choice where it is.
 */
export function hostAfterKey(current: ProjectHost, key: string): ProjectHost {
  const index = PROJECT_HOSTS.indexOf(current)
  const step = key === 'ArrowRight' || key === 'ArrowDown' ? 1 : key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 0
  return PROJECT_HOSTS[Math.min(PROJECT_HOSTS.length - 1, Math.max(0, index + step))] ?? current
}

/** While Resolve cannot be reached, ask again this often: the user is in the middle of fixing it. */
export const RESOLVE_POLL_MS = 5_000
/** Once connected, ask this often, so a Resolve that was closed is noticed. */
export const RESOLVE_READY_POLL_MS = 30_000

/** How long to wait before asking about the connection again, from the last answer. */
export function resolvePollMs(state: ResolveState | null): number {
  return state === 'ready' ? RESOLVE_READY_POLL_MS : RESOLVE_POLL_MS
}

/**
 * Said under the Resolve card when it is chosen and Resolve cannot be reached yet: the project
 * can be made now, and what will not work until the connection is fixed. Null when there is
 * nothing to warn about — connected, or not asked yet.
 */
export function resolveChoiceNote(status: ResolveStatus | null): string | null {
  if (!status || status.state === 'ready') return null
  return 'You can create the project now. The agent cannot change anything in Resolve until this is fixed.'
}

export type ResolveTone = 'success' | 'warning' | 'neutral'

/** The state dot: green connected, amber something to do, grey not asked yet. */
export function resolveTone(status: ResolveStatus | null): ResolveTone {
  if (!status) return 'neutral'
  return status.state === 'ready' ? 'success' : 'warning'
}

/** Open Resolve is offered only when being closed is the whole problem. */
export function canOpenResolve(status: ResolveStatus | null): boolean {
  return status?.state === 'not-running'
}
