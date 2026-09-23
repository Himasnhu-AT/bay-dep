/**
 * The debug HUD's numbers, shaped from what Electron and macOS report. Pure, so it is tested;
 * `metrics.ts` only collects the raw inputs.
 *
 * Two sources, and they measure different things — the HUD says which:
 *
 * - `app.getAppMetrics()`: every process of *this* app (main, the editor window, the GPU process,
 *   composition render windows, utilities). Its `percentCPUUsage` is a share of the **whole
 *   machine** — measured: `ps` read 27.5% while it read 1.9% on this 15-core Mac (27.5 / 15 = 1.8).
 *   The HUD multiplies by the core count so the figure means what Activity Monitor and `ps` mean,
 *   percent of one core, which is also why a busy app can read over 100%.
 * - `ioreg -c IOAccelerator` on macOS: the GPU's utilisation for the **whole machine**. There is no
 *   per-app GPU figure without private APIs, so it is labelled "system" rather than passed off as
 *   bay's own.
 */

import type { AppMetrics, ProcessGroup } from '@shared/ipc'

/** The part of Electron's `ProcessMetric` this reads; the type is Electron's, the shape is stable. */
export interface RawProcess {
  type: string
  name?: string
  cpu: { percentCPUUsage: number }
  /** Kilobytes. */
  memory: { workingSetSize: number }
}

const GROUP: Record<string, ProcessGroup> = {
  Browser: 'main',
  Tab: 'renderer',
  GPU: 'gpu'
}

/**
 * Processes grouped the way someone reading a HUD thinks about them. The editor window and a
 * composition's hidden window are both Chromium "Tab" processes, told apart by which is which
 * elsewhere; here every renderer counts as renderer, and the count says how many there are.
 */
export function summariseProcesses(
  processes: readonly RawProcess[],
  /** Logical cores: Electron's machine-wide share times this is percent of one core. */
  cores = 1
): Pick<AppMetrics, 'groups' | 'totals'> {
  const groups: AppMetrics['groups'] = []
  const find = (group: ProcessGroup) => {
    let entry = groups.find((g) => g.group === group)
    if (!entry) {
      entry = { group, count: 0, cpu: 0, memoryMB: 0 }
      groups.push(entry)
    }
    return entry
  }
  let cpu = 0
  let memoryKB = 0
  for (const process of processes) {
    const share = Number.isFinite(process.cpu.percentCPUUsage) ? Math.max(0, process.cpu.percentCPUUsage) * Math.max(1, cores) : 0
    const kb = Number.isFinite(process.memory.workingSetSize) ? Math.max(0, process.memory.workingSetSize) : 0
    const entry = find(GROUP[process.type] ?? 'other')
    entry.count += 1
    entry.cpu += share
    entry.memoryMB += kb / 1024
    cpu += share
    memoryKB += kb
  }
  const order: ProcessGroup[] = ['renderer', 'gpu', 'main', 'other']
  groups.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group))
  for (const g of groups) {
    g.cpu = round1(g.cpu)
    g.memoryMB = Math.round(g.memoryMB)
  }
  return { groups, totals: { cpu: round1(cpu), memoryMB: Math.round(memoryKB / 1024) } }
}

const round1 = (value: number): number => Math.round(value * 10) / 10

/**
 * `ioreg -r -d 1 -c IOAccelerator` → the GPU's utilisation. Read off real output from this Mac:
 * a `"PerformanceStatistics" = {…,"Device Utilization %"=2,…}` dictionary per accelerator. Null
 * when there is no such line (another platform, or a driver that reports none) — the HUD then says
 * "not reported" rather than showing a zero it did not measure.
 */
export function parseIoregGpu(stdout: string): AppMetrics['gpu'] {
  const stats = /"PerformanceStatistics"\s*=\s*\{([^}]*)\}/.exec(stdout)?.[1]
  if (!stats) return null
  const field = (name: string): number | null => {
    const match = new RegExp(`"${name.replace(/[%]/g, '\\%')}"\\s*=\\s*(\\d+)`).exec(stats)
    return match ? Number(match[1]) : null
  }
  const device = field('Device Utilization %')
  if (device === null) return null
  const inUse = field('In use system memory')
  return {
    utilization: device,
    renderer: field('Renderer Utilization %'),
    tiler: field('Tiler Utilization %'),
    memoryMB: inUse === null ? null : Math.round(inUse / (1024 * 1024))
  }
}
