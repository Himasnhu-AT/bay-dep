/**
 * Collects the debug HUD's raw numbers: Electron's per-process metrics and, on macOS, the GPU's
 * utilisation from `ioreg`. The shaping is `metrics-shape.ts`, tested; this is the thin part that
 * needs Electron and a shell.
 *
 * Only asked while debug mode is on, about once a second. `ioreg` costs a few milliseconds, so a
 * result is reused for 900 ms: two windows polling at once cost one call, not two.
 */

import { execFile } from 'node:child_process'
import { cpus } from 'node:os'
import { app } from 'electron'
import type { AppMetrics } from '@shared/ipc'
import { parseIoregGpu, summariseProcesses } from './metrics-shape'

let gpuCache: { at: number; value: AppMetrics['gpu'] } | null = null

function gpuUsage(): Promise<AppMetrics['gpu']> {
  if (process.platform !== 'darwin') return Promise.resolve(null)
  if (gpuCache && Date.now() - gpuCache.at < 900) return Promise.resolve(gpuCache.value)
  return new Promise((resolve) => {
    execFile('/usr/sbin/ioreg', ['-r', '-d', '1', '-c', 'IOAccelerator'], { timeout: 2000 }, (error, stdout) => {
      const value = error ? null : parseIoregGpu(stdout)
      gpuCache = { at: Date.now(), value }
      resolve(value)
    })
  })
}

export async function collectMetrics(): Promise<AppMetrics> {
  const { groups, totals } = summariseProcesses(app.getAppMetrics(), cpus().length)
  return { groups, totals, gpu: await gpuUsage(), at: Date.now() }
}
