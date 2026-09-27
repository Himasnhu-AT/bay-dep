// Attest v3 takes: perry's "left text, right object" layout. Every take keeps the product in the
// right half (bias dx), turned toward the text column on the left (bias ry), so bay can compose
// headlines in the empty left third. setup(name) runs before recording; run(name) is the take.
(() => {
  const F = window.__film
  const { sleep } = F
  const rise = 'cubic-bezier(.165,.84,.44,1)' // perry EZ.rise
  const whip = 'cubic-bezier(.72,0,.18,1)' // perry EZ.whip
  const drift = 'linear'
  const ring = '[role=img][aria-label^=Readiness]'
  const RIGHT = { dx: 430, ry: -13 }
  const setBias = (b) => { Object.assign(F.bias, { dx: 0, dy: 0, rx: 0, ry: 0 }, b); F.scrim(Object.keys(b).length > 0) }

  const setups = {
    // background for the hook and logo bars: the dashboard drifting, tilted, on the right
    hookbg() { setBias(RIGHT); F.cut(document.body, { s: 0.6, rx: 16, rz: -4 }) },
    reveal() { setBias(RIGHT); F.cut(document.body, { s: 0.5, rx: 46, rz: -12, dy: 180 }) },
    why() { setBias(RIGHT); F.cut('text=Why it isn', { s: 1.0 }) },
    cascade() { setBias(RIGHT); F.cut('text=Why it isn', { s: 0.95 }) },
    policies() { setBias({ dx: 330, ry: -12 }); const b = F.byText('Approve v1.0'); F.cut(b.closest('li, tr, [class*=border-b], [class*=grid]') || b, { s: 0.95, rx: 4 }) },
    people() { setBias({ dx: 400, ry: -12 }); F.cut('main', { s: 0.72, rx: 14, rz: -3, dy: -30 }) },
    risk() { setBias(RIGHT); F.cut('text=Residual risk', { s: 1.9, dy: -220 }) },
    climb() { setBias({ dx: 380, ry: -8 }); F.cut(ring, { s: 1.35 }) },
    // end-card background: the finished dashboard turning slowly, centred, small
    orbit() { setBias({}); F.cut(document.body, { s: 0.62, rx: 12, ry: -24 }) }
  }

  const takes = {
    async hookbg() {
      F.start(); await sleep(200)
      await F.shot(document.body, { s: 0.66, rx: 12, rz: -2 }, 7600, drift)
    },
    // 3D swing up into the right-hand framing, then a push toward the reasons and a click
    async reveal() {
      F.start(); await sleep(300)
      F.shot(document.body, { s: 0.64 }, 2400, rise)
      await sleep(1900)
      F.shot('text=Why it isn', { s: 0.98 }, 3200, 'cubic-bezier(.45,0,.55,1)')
      await F.click('text=Add evidence', 1200)
      await sleep(350); F.hideCursor()
      await sleep(1850)
    },
    // focus pull: one reason lifts out, the cursor approves it
    async why() {
      F.start(); await sleep(250)
      F.shot('text=Why it isn', { s: 1.12, rx: 2 }, 6500, drift)
      await sleep(350)
      F.focus('text=Security policies are approved')
      await sleep(900)
      await F.click('text=Approve', 900)
      await sleep(1500)
      F.unfocus()
      await sleep(1200)
    },
    // time compression: three quick evidence clicks, then a whip pan to the ring climbing
    async cascade() {
      F.start(); await sleep(250)
      await F.click('text=Add evidence', 650, 110)
      await F.click('text=Add evidence', 480, 90)
      await F.click('text=Add evidence', 480, 90)
      F.hideCursor()
      await F.shot(ring, { s: 1.3, ry: 4 }, 900, whip)
      F.shot(ring, { s: 1.42, ry: 2 }, 2600, drift)
      await sleep(2600)
    },
    async policies() {
      const b = F.byText('Approve v1.0')
      const row = b.closest('li, tr, [class*=border-b], [class*=grid]') || b
      F.start(); await sleep(250)
      F.shot(row, { s: 1.12, rx: 2 }, 7200, drift)
      await F.click('text=Approve v1.0', 950)
      await sleep(1200)
      await F.click('text=Publish v1.0', 750)
      await sleep(2300)
    },
    async people() {
      F.start(); await sleep(250)
      F.shot('main', { s: 0.84, rx: 9, rz: -2, dy: 50 }, 8000, drift)
      await F.click('text=Simulate employee signing', 950)
      await sleep(1400)
      await F.click('text=Simulate employee signing', 380, 110)
      await sleep(1400)
      await F.click('text=Simulate employee signing', 380, 110)
      await sleep(1800)
    },
    // tight on the matrix, pull out on the rise curve, select a risk
    async risk() {
      F.start(); await sleep(250)
      await F.shot('text=Residual risk', { s: 1.05, rx: 10, dy: -100 }, 2400, rise)
      const marker = [...document.querySelectorAll('main button')].find((x) => /^\d+$/.test(x.textContent.trim()) && x.getBoundingClientRect().width < 200)
      if (marker) await F.click(marker, 850)
      await sleep(2200)
    },
    // payoff: 75% → 95% under a slow push, no cursor
    async climb() {
      F.start(); await sleep(400)
      F.shot(ring, { s: 1.75 }, 6000, drift)
      const three = [...document.querySelectorAll('header button')].find((x) => x.textContent.trim() === '3')
      three.click()
      await sleep(5600)
    },
    async orbit() {
      F.start(); await sleep(200)
      await F.shot(document.body, { s: 0.66, rx: 9, ry: 20 }, 7400, 'cubic-bezier(.45,0,.55,1)')
    }
  }
  takes.setup = (n) => { setups[n](); return 'set' }
  window.__takes = takes
  return Object.keys(takes).join(',')
})()
