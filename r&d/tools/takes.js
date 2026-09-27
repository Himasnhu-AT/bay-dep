// Shot choreography for the RedAssay film. Each take: an opening camera, then cursor + camera
// moves on real UI. Returns the click log (seconds from take start) for sound placement.
(() => {
  const F = window.__film
  const { sleep } = F
  const expo = 'cubic-bezier(.16,1,.3,1)'
  const glide = 'cubic-bezier(.45,0,.55,1)'
  const ring = '[role=img][aria-label^=Readiness]'
  const setups = {
    reveal() {
      F.cut(document.body, { s: 0.6, rx: 42, rz: -14, dy: 160 })
    },
    why() {
      F.cut('text=Why it isn', { s: 1.55, ry: -9 })
    },
    cascade() {
      F.cut('text=Why it isn', { s: 1.4, ry: -6 })
    },
    policies() {
      const b = F.byText('Approve v1.0')
      const row = b.closest('li, tr, [class*=border-b], [class*=grid]') || b
      F.cut(row, { s: 1.35, ry: -10, rx: 4 })
    },
    people() {
      F.cut('main', { s: 1.05, rx: 20, rz: -6, dy: -40 })
    },
    risk() {
      F.cut('text=Residual risk', { s: 2.3, dy: -260 })
    },
    climb() {
      F.cut(ring, { s: 1.5 })
    },
    orbit() {
      F.cut(document.body, { s: 0.8, rx: 12, ry: -26 })
    }
  }
  const takes = {
    // 3D reveal: the app swings up from a steep tilt and settles flat; first click lands.
    async reveal() {
      F.start(); await sleep(400)
      F.shot(document.body, { s: 0.92 }, 3000, expo)
      await sleep(2300)
      F.shot('text=Why it isn', { s: 1.22, dx: -40 }, 3600, glide)
      await F.click('text=Add evidence', 1300)
      await sleep(2600)
    },
    // Depth of field: one reason lifts out of the list, the cursor approves it.
    async why() {
      F.start(); await sleep(300)
      F.shot('text=Why it isn', { s: 1.7, ry: -4 }, 7000, 'linear')
      await sleep(500)
      F.focus('text=Security policies are approved')
      await sleep(1100)
      await F.click('text=Approve', 950)
      await sleep(1700)
      F.unfocus()
      await sleep(1500)
    },
    // Time compression: three pieces of evidence in quick succession, then the camera pans
    // across to the ring as readiness climbs.
    async cascade() {
      F.start(); await sleep(300)
      await F.click('text=Add evidence', 700, 120)
      await F.click('text=Add evidence', 520, 100)
      await F.click('text=Add evidence', 520, 100)
      F.hideCursor()
      await F.shot(ring, { s: 1.75, ry: 6 }, 2300, glide)
      await sleep(2400)
    },
    // Policy lifecycle: approve, then publish, with a slow push toward the row.
    async policies() {
      const b = F.byText('Approve v1.0')
      const row = b.closest('li, tr, [class*=border-b], [class*=grid]') || b
      F.start(); await sleep(300)
      F.shot(row, { s: 1.55, ry: -4, rx: 2 }, 7500, 'linear')
      await F.click('text=Approve v1.0', 1000)
      await sleep(1300)
      await F.click('text=Publish v1.0', 800)
      await sleep(2600)
    },
    // People: tilted list; each signing updates a row as the camera slides down it.
    async people() {
      F.start(); await sleep(300)
      F.shot('main', { s: 1.2, rx: 12, rz: -3, dy: 60 }, 8500, 'linear')
      await F.click('text=Simulate employee signing', 1000)
      await sleep(1500)
      await F.click('text=Simulate employee signing', 400, 120)
      await sleep(1500)
      await F.click('text=Simulate employee signing', 400, 120)
      await sleep(2000)
    },
    // Risk: start tight on the matrix, pull out into a tilt, select a risk.
    async risk() {
      F.start(); await sleep(300)
      await F.shot('text=Residual risk', { s: 1.25, rx: 12, ry: -16, dy: -120 }, 2800, expo)
      const marker = [...document.querySelectorAll('main button')].find((b) => /^\d+$/.test(b.textContent.trim()) && b.getBoundingClientRect().width < 200)
      if (marker) await F.click(marker, 900)
      await sleep(2600)
    },
    // Payoff: the ring climbs from 75% to 95% under a slow push-in. No cursor.
    async climb() {
      F.start(); await sleep(500)
      F.shot(ring, { s: 2.0 }, 6000, 'linear')
      const three = [...document.querySelectorAll('header button')].find((b) => b.textContent.trim() === '3')
      three.click()
      await sleep(5600)
    },
    // Hero orbit: the finished dashboard at 95%, turning slowly in space.
    async orbit() {
      F.start(); await sleep(200)
      await F.shot(document.body, { s: 0.84, rx: 9, ry: 22 }, 7400, glide)
    }
  }
  takes.setup = (n) => { setups[n](); return 'set' }
  window.__takes = takes
  return Object.keys(takes).join(',')
})()
