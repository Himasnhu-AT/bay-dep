// Attest v4 takes: white, premium, straight. No tilt on any shot with text to read; depth comes
// from a frosted glass card (left, for the edit's text), soft shadows, focus blur and motion blur.
// Camera moves are flat pushes and slides on an iOS-like curve. Rendered frame by frame on a
// virtual clock by render-frames.mjs, so click times in the log are exact source seconds.
(() => {
  const F = window.__film
  const { sleep } = F
  const arrive = 'cubic-bezier(.32,.72,0,1)' // iOS sheet curve: fast out, long settle
  const soft = 'cubic-bezier(.45,0,.2,1)' // eases out of rest: for moves that start from still
  const drift = 'linear'
  const ring = '[role=img][aria-label^=Readiness]'
  const RIGHT = { dx: 420 }
  const setBias = (b) => Object.assign(F.bias, { dx: 0, dy: 0, rx: 0, ry: 0 }, b)
  // The glass slides in like a sheet. It exists at full strength from frame 0, off-screen: quick-liquid
// flashes for a frame whenever its material changes, so it is only ever moved, never faded.
const glassIn = (ms = 1000) => { const g = document.getElementById('film-glass') || F.glass(); g.animate([{ transform: 'translateX(-115%)' }, { transform: 'translateX(0)' }], { duration: ms, easing: arrive, fill: 'forwards' }); return g }

  const setups = {
    hookbg() { setBias(RIGHT); F.glass(); F.cut(document.body, { s: 0.74 }) },
    reveal() {
      setBias(RIGHT); F.cut(document.body, { s: 0.7, dy: 60 })
      // a veil over everything that clears: the product materializes out of the canvas colour
      const fog = document.createElement('div'); fog.id = 'film-fog'
      fog.style.cssText = 'position:fixed;inset:0;z-index:2147483643;pointer-events:none;background:rgba(245,245,247,1);-webkit-backdrop-filter:blur(40px);backdrop-filter:blur(40px)'
      document.documentElement.appendChild(fog)
      F.glass().style.transform = 'translateX(-115%)'
    },
    why() { setBias(RIGHT); F.glass(); F.cut('text=Why it isn', { s: 1.02 }) },
    cascade() { setBias(RIGHT); F.glass(); F.cut('text=Why it isn', { s: 0.98 }) },
    policies() { setBias({ dx: 360 }); F.glass(); const b = F.byText('Approve v1.0'); F.cut(b.closest('li, tr, [class*=border-b], [class*=grid]') || b, { s: 1.0 }) },
    people() { setBias({ dx: 400 }); F.glass(); F.cut('main', { s: 0.78, dy: -40 }) },
    risk() { setBias(RIGHT); F.glass(); F.cut('text=Residual risk', { s: 1.8, dy: -200 }) },
    climb() { setBias({ dx: 380 }); F.glass(); F.cut(ring, { s: 1.35 }) },
    endbg() { setBias({}); F.cut(document.body, { s: 0.58 }) }
  }

  const takes = {
    async hookbg() {
      F.start(); await sleep(100)
      await F.shot(document.body, { s: 0.79 }, 7800, drift)
    },
    // materialize (blur + scale + fade together), glass arrives, push to the reasons, click
    async reveal() {
      F.start(); await sleep(150)
      const fog = document.getElementById('film-fog')
      fog.animate([{ background: 'rgba(245,245,247,1)', backdropFilter: 'blur(40px)' }, { background: 'rgba(245,245,247,0)', backdropFilter: 'blur(0px)' }], { duration: 1200, easing: arrive, fill: 'forwards' }).finished.then(() => fog.remove())
      F.shot(document.body, { s: 0.8 }, 1400, arrive)
      await sleep(1300)
      glassIn()
      F.shot('text=Why it isn', { s: 1.0 }, 2800, soft)
      await sleep(900)
      await F.click('text=Add evidence', 1100)
      await sleep(400); F.hideCursor()
      await sleep(1700)
    },
    async why() {
      F.start(); await sleep(150)
      F.shot('text=Why it isn', { s: 1.1 }, 7000, drift)
      await sleep(400)
      F.focus('text=Security policies are approved')
      await sleep(900)
      await F.click('text=Approve', 950)
      await sleep(1500)
      F.unfocus(); F.hideCursor()
      await sleep(1400)
    },
    async cascade() {
      F.start(); await sleep(150)
      await F.click('text=Add evidence', 650, 110)
      await F.click('text=Add evidence', 480, 90)
      await F.click('text=Add evidence', 480, 90)
      F.hideCursor()
      await F.shot(ring, { s: 1.3 }, 1200, soft)
      F.shot(ring, { s: 1.4 }, 2600, drift)
      await sleep(2600)
    },
    async policies() {
      const b = F.byText('Approve v1.0')
      const row = b.closest('li, tr, [class*=border-b], [class*=grid]') || b
      F.start(); await sleep(150)
      F.shot(row, { s: 1.1 }, 7400, drift)
      await F.click('text=Approve v1.0', 950)
      await sleep(1200)
      await F.click('text=Publish v1.0', 750)
      await sleep(600); F.hideCursor()
      await sleep(1800)
    },
    async people() {
      F.start(); await sleep(150)
      F.shot('main', { s: 0.86, dy: 40 }, 8200, drift)
      await F.click('text=Simulate employee signing', 950)
      await sleep(1400)
      await F.click('text=Simulate employee signing', 380, 110)
      await sleep(1400)
      await F.click('text=Simulate employee signing', 380, 110)
      await sleep(500); F.hideCursor()
      await sleep(1400)
    },
    async risk() {
      F.start(); await sleep(150)
      await F.shot('text=Residual risk', { s: 1.05, dy: -90 }, 2400, soft)
      const marker = [...document.querySelectorAll('main button')].find((x) => /^\d+$/.test(x.textContent.trim()) && x.getBoundingClientRect().width < 200)
      if (marker) await F.click(marker, 850)
      await sleep(500); F.hideCursor()
      await sleep(1700)
    },
    async climb() {
      F.start(); await sleep(300)
      F.shot(ring, { s: 1.7 }, 6200, drift)
      const three = [...document.querySelectorAll('header button')].find((x) => x.textContent.trim() === '3')
      three.click()
      await sleep(5800)
    },
    async endbg() {
      F.start(); await sleep(100)
      await F.shot(document.body, { s: 0.63 }, 7800, drift)
    }
  }
  takes.setup = (n) => { setups[n](); return 'set' }
  window.__takes = takes
  return Object.keys(takes).join(',')
})()
