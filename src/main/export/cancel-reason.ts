/**
 * Whether an export's cancel is a failure the usage events should count — out of `encode.ts`
 * (which imports Electron) so it is unit-tested.
 *
 * The renderer cancels a job in two situations that look the same to the encoder: the user
 * pressed Cancel, and the renderer's own export loop threw (a frame it could not draw or push).
 * Only the second is an `export_failed`, and the renderer says so (`ExportCancelReason`). A job
 * main had already failed was counted when it failed, so its cancel is not counted again.
 */

import { EXPORT_FAIL_STAGES, type ExportFailStage } from '@shared/telemetry'

/** The stage to count as `export_failed`, or null when this cancel is not a new failure. */
export function cancelFailureStage(reason: unknown, job: { stage: ExportFailStage; failed: boolean }): ExportFailStage | null {
  if (job.failed) return null
  if (!reason || typeof reason !== 'object' || (reason as { failed?: unknown }).failed !== true) return null
  const stage = (reason as { stage?: unknown }).stage
  return (EXPORT_FAIL_STAGES as readonly unknown[]).includes(stage) ? (stage as ExportFailStage) : job.stage
}
