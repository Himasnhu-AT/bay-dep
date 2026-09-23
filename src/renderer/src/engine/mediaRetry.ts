/**
 * What a media element does when its first load fails.
 *
 * It used to retry once *without* `crossOrigin`. The `bay://` handler always sends
 * `Access-Control-Allow-Origin`, so a failed CORS load is transient — measured: code 4 for a path
 * the protocol had not allowlisted yet — and dropping CORS did not fix anything: a non-CORS
 * element plays silence through a `MediaElementAudioSourceNode` (the score measured peak 0
 * without CORS, 0.69 with it) and taints every canvas it is drawn into, so the preview went mute
 * and export readback failed for the rest of the session, with the context `running` and the
 * playhead moving — a silence nothing reported. Now it retries the same CORS load after a short,
 * growing delay, and after the last one reports the error.
 */
export const LOAD_RETRY_DELAYS_MS: readonly number[] = [200, 800, 2500]

/** How long to wait before retry number `attempt` (0-based), or null when it is time to give up. */
export function loadRetryDelay(attempt: number): number | null {
  return LOAD_RETRY_DELAYS_MS[attempt] ?? null
}

/** The crossOrigin a retry loads with: always the CORS one. Never null — see above. */
export const RETRY_CROSS_ORIGIN = 'anonymous' as const
