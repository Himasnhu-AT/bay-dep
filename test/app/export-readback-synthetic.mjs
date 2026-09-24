/**
 * The draw+readback cost of the export target, measured with a **synthetic** source.
 *
 * A deliberate second instrument beside `export-readback-cost.mjs`, which measures the same
 * question with a real decoded `<video>`. The two disagree, and the disagreement is the reason
 * both exist: a decoded frame is a GPU texture, so drawing one into a software-backed canvas
 * forces a readback of the *source* as well as the target. A synthetic canvas source is already
 * CPU-side and never pays that, so this file reports the **lower bound** of the penalty and the
 * video one reports what an export actually pays.
 *
 * Keeping the conservative instrument is worth more than it looks. It was the measurement that
 * first said `willReadFrequently` was costing the export rather than saving it, and it said so
 * while understating the effect by about half — a case where the cautious number was enough to
 * decide and the precise one only made it more certain.
 *
 * **It reports and does not assert.** There is no threshold here on purpose: the flag's premise
 * is that GPU-to-CPU transfer is expensive, which is false on this hardware and might be true
 * on other hardware. A pass/fail would turn "re-measure on that machine" into "argue with a
 * number someone chose", and this is exactly the measurement a future reader needs to repeat
 * rather than trust.
 *
 * **Report, no verdict.** Exits 0 whenever it could measure and 2 when it could not; nothing is
 * compared with an expectation, so a green exit says the numbers exist, not that they are good.
 */

import { attach, runProbe } from './cdp.mjs'

const { evaluate, close } = await attach()

await runProbe(async () => {

const result = await evaluate(`(() => {
  const make = (w, h, readFrequently) =>
    new OffscreenCanvas(w, h).getContext('2d', readFrequently ? { willReadFrequently: true } : undefined)

  const source = (w, h) => {
    const c = new OffscreenCanvas(w, h)
    const x = c.getContext('2d')
    for (let i = 0; i < 24; i++) {
      x.fillStyle = \`hsl(\${i * 15}, 80%, 50%)\`
      x.fillRect((i % 6) * (w / 6), Math.floor(i / 6) * (h / 4), w / 6, h / 4)
    }
    return c
  }

  // Draw AND read the whole frame: the export's real per-frame cycle. Timing drawImage alone
  // is what produced the first, wrong conclusion that blur is inherently expensive — the cost
  // was in the readback the flag was supposed to be making cheap.
  const cycle = (ctx, src, w, h, filter, iterations) => {
    for (let i = 0; i < 3; i++) { ctx.filter = filter; ctx.drawImage(src, 0, 0); ctx.getImageData(0, 0, w, h) }
    const t0 = performance.now()
    for (let i = 0; i < iterations; i++) {
      ctx.filter = filter
      ctx.drawImage(src, 0, 0)
      ctx.getImageData(0, 0, w, h)
    }
    const ms = (performance.now() - t0) / iterations
    ctx.filter = 'none'
    return Math.round(ms * 100) / 100
  }

  const out = {}
  for (const [label, w, h, iters] of [['1080p', 1920, 1080, 12], ['4K', 3840, 2160, 5]]) {
    const src = source(w, h)
    out[label] = {
      flagOn_none: cycle(make(w, h, true), src, w, h, 'none', iters),
      flagOn_blur: cycle(make(w, h, true), src, w, h, 'blur(8px)', iters),
      flagOff_none: cycle(make(w, h, false), src, w, h, 'none', iters),
      flagOff_blur: cycle(make(w, h, false), src, w, h, 'blur(8px)', iters)
    }
  }
  return JSON.stringify(out)
})()`)

const numbers = JSON.parse(result)

console.log('draw + full-frame readback, ms per frame, SYNTHETIC source (CPU-side)\n')
console.log('                        flag on    flag off   ratio')
for (const [size, n] of Object.entries(numbers)) {
  const row = (label, on, off) =>
    `  ${(size + ', ' + label).padEnd(20)} ${String(on).padStart(7)}   ${String(off).padStart(8)}   ${(on / off).toFixed(2)}x`
  console.log(row('no filter', n.flagOn_none, n.flagOff_none))
  console.log(row('blur(8px)', n.flagOn_blur, n.flagOff_blur))
}

const blurCost = (n) => Math.round((n.flagOff_blur - n.flagOff_none) * 100) / 100
console.log(
  `\nblur costs ${blurCost(numbers['1080p'])}ms at 1080p and ${blurCost(numbers['4K'])}ms at 4K ` +
    `on the GPU-backed target.`
)
console.log(
  '\nThis is the LOWER bound. `export-readback-cost.mjs` measures the same thing with a real\n' +
    'decoded video frame and finds roughly double the penalty, because a GPU texture drawn into\n' +
    'a software-backed canvas also forces a readback of the source. Neither is the whole story\n' +
    'about export wall time: a 1080p export frame costs ~75ms and only ~3.4ms of it is this\n' +
    'cycle, so the end-to-end saving from dropping the flag was 7.4% at 1080p / 16.3% at 4K.'
)
console.log('\nREPORTED (no assertion): re-measure before concluding anything about other hardware.')
close()
return true

})
