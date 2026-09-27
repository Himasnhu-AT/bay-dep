// Injected into the recorded page. window.__film drives a visible cursor, real clicks,
// 3D "camera" moves over the whole UI and a depth-of-field focus pull. All motion runs on
// rAF / Web Animations, so the screencast captures it as it plays.
(() => {
  if (window.__film) return 'already'
  const html = document.documentElement
  html.style.background = '#000'
  html.style.perspective = '2600px'
  html.style.perspectiveOrigin = '50% 40%'
  html.style.overflow = 'hidden'
  const body = document.body
  body.style.transformOrigin = '50% 40%'
  body.style.transformStyle = 'preserve-3d'
  body.style.willChange = 'transform'

  const css = document.createElement('style')
  css.textContent = `
    .film-dim { transition: filter .7s cubic-bezier(.16,1,.3,1), opacity .7s cubic-bezier(.16,1,.3,1); filter: blur(5px) brightness(.38) saturate(.6) !important; }
    .film-lift { transition: transform .7s cubic-bezier(.16,1,.3,1), box-shadow .7s; transform: scale(1.035); box-shadow: 0 30px 80px rgba(0,0,0,.65), 0 0 0 1px rgba(255,255,255,.08); position: relative; z-index: 5; border-radius: 10px; }
    #film-cursor { position: fixed; left: 0; top: 0; width: 144px; height: 144px; z-index: 2147483647; pointer-events: none; transform-origin: 18px 9px; filter: drop-shadow(0 12px 18px rgba(0,0,0,.6)); transition: opacity .3s; }
    .film-ring { position: fixed; z-index: 2147483646; pointer-events: none; width: 64px; height: 64px; margin: -32px 0 0 -32px; border-radius: 50%; border: 4px solid rgba(255,255,255,.9); }
  `
  document.head.appendChild(css)

  const cur = document.createElement('div')
  cur.id = 'film-cursor'
  cur.innerHTML = '<svg viewBox="0 0 30 30" width="144" height="144"><path d="M4 2 L4 24 L9.5 18.8 L13.2 27.2 L17 25.6 L13.4 17.4 L21 17.4 Z" fill="#fff" stroke="#000" stroke-width="1.6" stroke-linejoin="round"/></svg>'
  cur.style.opacity = '0'
  html.appendChild(cur)
  let pos = { x: innerWidth * 0.62, y: innerHeight * 1.05 }
  const place = () => { cur.style.transform = `translate(${pos.x}px, ${pos.y}px)` }
  place()

  const log = []
  const t0 = { v: performance.now() }
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const el = (s) => (typeof s === 'string' ? document.querySelector(s) : s)
  const visible = (b) => { const r = b.getBoundingClientRect(); return r.width > 0 && getComputedStyle(b).visibility !== 'hidden' && !b.closest('header') }
  const byText = (text, root = document.querySelector('main') || document) => [...root.querySelectorAll('button, a, [role=button]')].find((b) => b.textContent.trim() === text && !b.disabled && visible(b))
  const centre = (e) => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } }

  // Curved path: a quadratic bezier whose control point sits off the straight line,
  // so the cursor arcs like a hand rather than sliding on a rail.
  function moveTo(x, y, ms = 900) {
    cur.style.opacity = '1'
    const a = { ...pos }
    const dx = x - a.x, dy = y - a.y
    const c = { x: a.x + dx * 0.5 - dy * 0.18, y: a.y + dy * 0.5 + dx * 0.12 }
    const t0 = performance.now()
    return new Promise((done) => {
      const step = (now) => {
        const t = Math.min(1, (now - t0) / ms)
        const k = easeInOut(t)
        pos = {
          x: (1 - k) * (1 - k) * a.x + 2 * (1 - k) * k * c.x + k * k * x,
          y: (1 - k) * (1 - k) * a.y + 2 * (1 - k) * k * c.y + k * k * y
        }
        place()
        t < 1 ? requestAnimationFrame(step) : done()
      }
      requestAnimationFrame(step)
    })
  }

  async function press() {
    cur.animate([{ transform: `translate(${pos.x}px,${pos.y}px) scale(1)` }, { transform: `translate(${pos.x}px,${pos.y}px) scale(.82)` }, { transform: `translate(${pos.x}px,${pos.y}px) scale(1)` }], { duration: 260, easing: 'cubic-bezier(.3,0,.2,1)' })
    const ring = document.createElement('div')
    ring.className = 'film-ring'
    ring.style.left = pos.x + 18 + 'px'
    ring.style.top = pos.y + 9 + 'px'
    html.appendChild(ring)
    ring.animate([{ transform: 'scale(.4)', opacity: 1 }, { transform: 'scale(3.2)', opacity: 0 }], { duration: 520, easing: 'cubic-bezier(.16,1,.3,1)' }).finished.then(() => ring.remove())
    await sleep(110)
  }

  async function click(target, ms = 900, hold = 220) {
    const e = typeof target !== 'string' ? target : !target.startsWith('text=') ? el(target) : byText(target.slice(5))
    if (!e) throw new Error('film: no target ' + target)
    e.scrollIntoView({ block: 'nearest' })
    const c = centre(e)
    await moveTo(c.x - 24, c.y - 14, ms)
    await sleep(hold)
    e.animate([{ transform: 'scale(1)' }, { transform: 'scale(.95)' }, { transform: 'scale(1)' }], { duration: 240, easing: 'cubic-bezier(.3,0,.2,1)' })
    await press()
    log.push({ t: +((performance.now() - t0.v) / 1000).toFixed(2), what: (e.textContent || '').trim().slice(0, 30) })
    e.click()
    return true
  }

  function camera(transform, ms = 1600, easing = 'cubic-bezier(.65,0,.35,1)') {
    const from = getComputedStyle(body).transform
    const a = body.animate([{ transform: from === 'none' ? 'none' : from }, { transform }], { duration: ms, easing, fill: 'forwards' })
    return a.finished.then(() => { body.style.transform = transform; a.cancel() })
  }
  function setCamera(transform) { body.style.transform = transform }

  let dimmed = []
  function focus(target) {
    unfocus()
    const e = typeof target === 'string' ? ((!target.startsWith('text=') && el(target)) || [...document.querySelectorAll('main *')].find((n) => n.children.length < 40 && n.textContent.includes(target.replace(/^text=/, '')) && n.getBoundingClientRect().height < 140 && n.getBoundingClientRect().height > 30)) : target
    if (!e) throw new Error('film: no focus ' + target)
    let n = e
    while (n && n !== body) {
      const p = n.parentElement
      if (!p) break
      for (const s of p.children) if (s !== n && s.id !== 'film-cursor' && !s.classList.contains('film-ring')) { s.classList.add('film-dim'); dimmed.push(s) }
      n = p
    }
    e.classList.add('film-lift')
    dimmed.push(e)
    return true
  }
  function unfocus() { for (const d of dimmed) d.classList.remove('film-dim', 'film-lift'); dimmed = [] }
  function hideCursor() { cur.style.opacity = '0' }

  // Camera aimed at an element: its centre lands mid-frame, then scale and tilt apply about
  // it. Built as translate(viewCentre) R S translate(-elementCentre) with origin 0 0, so every
  // shot uses the same function list and any two interpolate smoothly.
  body.style.transformOrigin = '0 0'
  html.style.perspectiveOrigin = '50% 50%'
  css.textContent += ' .demo-root,.min-h-dvh{min-height:0!important} body{min-height:0!important;height:auto!important;overflow:hidden}'
  body.style.borderRadius = '28px'
  body.style.outline = '2px solid rgba(255,255,255,.07)'
  body.style.boxShadow = '0 80px 200px rgba(0,0,0,.9)'
  const zoom = () => parseFloat(getComputedStyle(body).zoom) || 1
  // A standing offset for every shot in a take, e.g. { dx: 420, ry: -12 } keeps the product in the
  // right half, turned toward text composed on the left.
  const bias = { dx: 0, dy: 0, rx: 0, ry: 0 }
  function frameOn(target, opts = {}) {
    const { s = 1, rx = 0, ry = 0, rz = 0, dx = 0, dy = 0 } = { ...opts, dx: (opts.dx || 0) + bias.dx, dy: (opts.dy || 0) + bias.dy, rx: (opts.rx || 0) + bias.rx, ry: (opts.ry || 0) + bias.ry }
    const e = typeof target === 'string' ? (target.startsWith('text=') ? [...document.querySelectorAll('main *')].find((n) => n.textContent.trim().startsWith(target.slice(5)) && n.children.length < 30) : el(target)) : target
    const saved = body.style.transform
    const anims = body.getAnimations(); anims.forEach((a) => a.pause())
    body.style.transform = 'none'
    const r = (e || body).getBoundingClientRect()
    body.style.transform = saved; anims.forEach((a) => a.play())
    const z = zoom()
    const ex = (r.left + r.width / 2) / z, ey = (r.top + r.height / 2) / z
    const vx = innerWidth / 2 / z + dx, vy = innerHeight / 2 / z + dy
    return `translate3d(${vx}px, ${vy}px, 0) rotateX(${rx}deg) rotateY(${ry}deg) rotateZ(${rz}deg) scale(${s}) translate3d(${-ex}px, ${-ey}px, 0)`
  }
  function shot(target, opts = {}, ms = 1600, easing = 'cubic-bezier(.65,0,.35,1)') { return camera(frameOn(target, opts), ms, easing) }
  function cut(target, opts = {}) { body.getAnimations().forEach((a) => a.cancel()); body.style.transform = frameOn(target, opts) }

  // Size the app to its content so a tilted "window" has no empty tail.
  function fit(pad = 48) {
    const root = document.querySelector('.demo-root') || body.firstElementChild
    const z = zoom()
    let bottom = 0
    for (const n of document.querySelectorAll('main > * , main > * > *')) bottom = Math.max(bottom, n.getBoundingClientRect().bottom)
    const h = Math.max(bottom / z + pad, innerHeight / z)
    root.style.height = h + 'px'; root.style.overflow = 'hidden'
    for (const a of document.querySelectorAll('aside')) { a.style.height = h + 'px'; a.style.minHeight = '0' }
    return h
  }
  // A fixed fade over the left of the frame, so text composed there in the edit sits on clean
  // black whatever the camera is doing. Above the UI, below the cursor.
  function scrim(on = true) {
    let s = document.getElementById('film-scrim')
    if (!on) { s?.remove(); return 'off' }
    if (!s) {
      s = document.createElement('div')
      s.id = 'film-scrim'
      s.style.cssText = 'position:fixed;inset:0;z-index:2147483645;pointer-events:none;background:linear-gradient(90deg,rgba(0,0,0,.97) 0%,rgba(0,0,0,.93) 30%,rgba(0,0,0,.55) 44%,rgba(0,0,0,0) 56%)'
      html.appendChild(s)
    }
    return 'on'
  }
  function start() { t0.v = performance.now(); log.length = 0 }
  window.__film = { scrim, bias, log, start, fit, frameOn, shot, cut, moveTo, click, press, camera, setCamera, focus, unfocus, hideCursor, sleep, byText }
  return 'ready'
})()
