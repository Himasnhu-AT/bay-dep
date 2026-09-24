/**
 * The debug HUD's numbers. Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseIoregGpu, summariseProcesses } from './metrics-shape'

// Trimmed from real `ioreg -r -d 1 -c IOAccelerator` output on Apple silicon.
const IOREG = `+-o AGXAcceleratorG14X  <class AGXAcceleratorG14X, id 0x1000004a2, registered, matched, active, busy 0 (31 ms), retain 51>
    {
      "IOClass" = "AGXAcceleratorG14X"
      "PerformanceStatistics" = {"In use system memory (driver)"=0,"Alloc system memory"=4402184192,"Tiler Utilization %"=1,"Renderer Utilization %"=2,"Device Utilization %"=37,"Allocated PB Size"=90177536,"In use system memory"=623624192}
      "model" = "Apple M2 Pro"
    }`

test('the GPU line reads device, renderer and tiler utilisation and memory in use', () => {
  assert.deepEqual(parseIoregGpu(IOREG), { utilization: 37, renderer: 2, tiler: 1, memoryMB: 595 })
})

test('no statistics means not reported — never a zero that was not measured', () => {
  assert.equal(parseIoregGpu(''), null)
  assert.equal(parseIoregGpu('"PerformanceStatistics" = {"Alloc system memory"=1}'), null, 'no utilisation field')
})

test('processes group into renderer, gpu, main and other, with totals', () => {
  const summary = summariseProcesses([
    { type: 'Browser', cpu: { percentCPUUsage: 3.04 }, memory: { workingSetSize: 250_000 } },
    { type: 'Tab', cpu: { percentCPUUsage: 22.5 }, memory: { workingSetSize: 400_000 } },
    { type: 'Tab', cpu: { percentCPUUsage: 10 }, memory: { workingSetSize: 100_000 } }, // a composition window
    { type: 'GPU', cpu: { percentCPUUsage: 8 }, memory: { workingSetSize: 160_000 } },
    { type: 'Utility', cpu: { percentCPUUsage: 0.2 }, memory: { workingSetSize: 40_000 } }
  ])
  assert.deepEqual(summary.groups.map((g) => [g.group, g.count, g.cpu]), [
    ['renderer', 2, 32.5],
    ['gpu', 1, 8],
    ['main', 1, 3],
    ['other', 1, 0.2]
  ])
  assert.equal(summary.totals.cpu, 43.7)
  assert.equal(summary.totals.memoryMB, Math.round(950_000 / 1024))
})

test('a garbage reading counts as nothing rather than poisoning the total', () => {
  const summary = summariseProcesses([
    { type: 'Tab', cpu: { percentCPUUsage: Number.NaN }, memory: { workingSetSize: -5 } },
    { type: 'Tab', cpu: { percentCPUUsage: 12 }, memory: { workingSetSize: 1024 } }
  ])
  assert.deepEqual(summary.totals, { cpu: 12, memoryMB: 1 })
})

test('Electron’s machine-wide share becomes percent of one core, like Activity Monitor', () => {
  // Measured on a 15-core Mac: Electron said 1.9 while ps said 27.5.
  const summary = summariseProcesses([{ type: 'Tab', cpu: { percentCPUUsage: 1.8 }, memory: { workingSetSize: 0 } }], 15)
  assert.equal(summary.totals.cpu, 27)
  assert.equal(summariseProcesses([{ type: 'Tab', cpu: { percentCPUUsage: 1.8 }, memory: { workingSetSize: 0 } }]).totals.cpu, 1.8, 'control: one core, unscaled')
})
