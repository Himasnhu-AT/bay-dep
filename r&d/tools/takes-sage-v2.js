// Sage launch takes, v2: the build with Liquid Glass, live moments, the model chip and the new
// Settings. Injected after timeline-sync.js and film.js into Sage's dev build (localhost:1420,
// in-browser mock) and rendered by render-frames.mjs on a virtual clock. Run with
// `TAKES=takes-sage-v2.js take-sage.sh <take> <window> <seconds> <file>`; a take name ending in
// `-dark` is the same take in the dark appearance.
//
// Everything here changes the page at runtime only; the Sage repo is never touched.
// - look: light or dark appearance, dev bar hidden, a soft desktop wallpaper, a Mac menu bar
// - data: no people's names, emails or addresses, no GitHub, nothing from Telegram or a terminal;
//   the backend's host names a person, so it is blurred where Settings shows it
// - UI: nothing is hidden or edited beyond those rules; the approval card renders exactly as Sage
//   draws it
// - camera: flat pushes only, never a tilt
(() => {
  const F = window.__film
  const M = window.sageMock
  const { sleep } = F
  const soft = 'cubic-bezier(.45,0,.2,1)' // eases out of rest: for moves that start from still
  const drift = 'linear'
  const $ = (s, root = document) => root.querySelector(s)
  const $$ = (s, root = document) => [...root.querySelectorAll(s)]
  const shown = (e) => e && e.getBoundingClientRect().width > 0 && getComputedStyle(e).visibility !== 'hidden'
  const button = (text, root = document) => $$('button, [role=tab], [role=button], [role=option]', root).find((b) => b.textContent.trim() === text && shown(b))
  const zoomOf = () => parseFloat(getComputedStyle(document.body).zoom) || 1 // rects are in device px
  const need = (e, what) => { if (!e) throw new Error('sage take: no ' + what); return e }
  let dark = false

  const WALL_LIGHT =
    'radial-gradient(1100px 700px at 12% 105%, #9cc9f0 0%, rgba(156,201,240,0) 70%),' +
    'radial-gradient(900px 620px at 95% 95%, #d3c4f6 0%, rgba(211,196,246,0) 70%),' +
    'radial-gradient(800px 520px at 78% 18%, #fbe0bd 0%, rgba(251,224,189,0) 70%),' +
    'radial-gradient(700px 500px at 25% 20%, #e9f2fb 0%, rgba(233,242,251,0) 70%),' +
    'linear-gradient(160deg, #eef3f9 0%, #e6ecf6 45%, #ece6f4 100%)'
  const WALL_DARK =
    'radial-gradient(1100px 700px at 12% 105%, #1f4d78 0%, rgba(31,77,120,0) 70%),' +
    'radial-gradient(900px 620px at 95% 95%, #4a3378 0%, rgba(74,51,120,0) 70%),' +
    'radial-gradient(800px 520px at 75% 20%, #6b4a26 0%, rgba(107,74,38,0) 70%),' +
    'linear-gradient(160deg, #0f1824 0%, #111a2a 45%, #17142a 100%)'
  const wall = () => (dark ? WALL_DARK : WALL_LIGHT)

  // ---------- data: fake but neutral ----------
  function scrub() {
    const H = M.halo
    H.stopLive() // no random CPU jitter, power flips or surprise alerts mid-take
    const ago = (min) => new Date(Date.now() - min * 60000).toISOString()
    H.cloud = { ...H.cloud, deviceName: 'MacBook Pro' }
    H.todos = H.todos.map((t) =>
      t.id === 'td1' ? { ...t, title: 'Send the Q3 roadmap to the team' } : t.id === 'td3' ? { ...t, title: 'Review the launch deck', notes: '' } : t)
    H.notes = [
      { id: 'n1', title: 'Trip ideas', body: 'Lisbon in October; check flights on the 12th.', tags: ['travel'], pinned: true, updatedAt: ago(180) },
      { id: 'n2', title: 'Standup notes', body: 'Sync engine: tombstones done. Halo: tray drag-out next.', tags: ['work'], pinned: false, updatedAt: ago(20) },
      { id: 'n3', title: 'Gift ideas', body: 'Ceramic planter. The Murakami box set.', tags: [], pinned: false, updatedAt: ago(2880) }
    ]
    H.connectors = H.connectors.filter((c) => !/github/i.test(c.id + c.name)).map((c) => ({ ...c, account: null }))
    H.clipboard = [
      { id: 'c1', kind: 'text', preview: "Let's move the launch review to Thursday at 3pm.", thumbnail: null, sourceApp: 'Slack', copiedAt: ago(2), pinned: false },
      { id: 'c2', kind: 'link', preview: 'https://en.wikipedia.org/wiki/Lisbon', thumbnail: null, sourceApp: 'Safari', copiedAt: ago(9), pinned: true },
      { id: 'c3', kind: 'image', preview: 'Image 1200×800', thumbnail: H.tray[0]?.thumbnail ?? null, sourceApp: 'Preview', copiedAt: ago(25), pinned: false },
      { id: 'c4', kind: 'text', preview: 'Oat milk, lemons, basil, sourdough', thumbnail: null, sourceApp: 'Notes', copiedAt: ago(70), pinned: false }
    ]
    const invoke = H.invoke.bind(H)
    H.invoke = async (cmd, a, granted) => {
      const r = await invoke(cmd, a, granted)
      if (r && r.chatgpt?.email) return { ...r, chatgpt: { ...r.chatgpt, email: null } } // cloud_account and the server login
      if (cmd === 'cloud_connectors') return r.filter((c) => !/github/i.test(c.id + c.name)).map((c) => ({ ...c, account: null }))
      return r
    }
    M.emit('sage://cloud', { ...H.cloud })
    M.emit('sage://cloud-data', { notes: H.notes, todos: H.todos })
    M.emit('sage://clipboard', [...H.clipboard])
  }
  const signInChatgpt = () => { M.chatgpt = { signedIn: true, expiresAt: new Date(Date.now() + 864e5).toISOString() } } // no address
  // The collapsed Halo shows the meeting countdown over everything but alerts; move the meeting out
  // of its 10-minute window where a take is about the other moments.
  function meetingLater() {
    const H = M.halo
    H.calendar = { ...H.calendar, start: new Date(Date.now() + 30 * 60000).toISOString(), end: new Date(Date.now() + 45 * 60000).toISOString() }
    M.emit('sage://calendar', H.calendar)
  }

  // The Ask run, scripted to answer the prompt typed on screen (the mock's own agent run talks
  // about Safari URLs). One approval card asks before the volume changes.
  function scriptAsk() {
    let n = 0
    M.submit = async (args, emit) => {
      const token = ++M.runToken
      const step = (type, content, toolName = null) => ({ id: `film-${++n}`, type, content, toolName, timestamp: new Date().toISOString(), durationMs: null, isComplete: false })
      const run = async (s, ms) => { emit({ kind: 'step', step: s }); await sleep(ms); emit({ kind: 'step', step: { ...s, isComplete: true, durationMs: Math.round(ms * 0.9) } }) }
      ;(async () => {
        emit({ kind: 'mode', mode: 'agent' })
        await run(step('thinking', 'Check the battery, then set the output volume to 30%.'), 800)
        await run(step('tool_call', 'get_battery', 'get_battery'), 420)
        await run(step('tool_result', '82%, on battery, 5h 12m left', 'get_battery'), 320)
        const call = step('tool_call', 'set_volume(30)', 'set_volume')
        emit({ kind: 'step', step: call })
        await sleep(350)
        const expiresAt = new Date(Date.now() + 10 * 60000).toISOString()
        M.halo.approvals = [{ id: 'ap-film', conversationId: 'local', channel: 'mac', tool: 'set_volume', summary: 'Set the output volume to 30%.', createdAt: new Date().toISOString(), expiresAt }]
        M.halo.emitApprovals()
        while (M.halo.approvals.length && token === M.runToken) await sleep(50)
        emit({ kind: 'step', step: { ...call, isComplete: true, durationMs: 61 } })
        await run(step('tool_result', 'Output volume is 30%.', 'set_volume'), 300)
        emit({ kind: 'step', step: { ...step('done', 'Battery is at **82%**, about 5 hours left. Volume is now **30%**.'), isComplete: true, durationMs: 0 } })
        emit({ kind: 'done' })
      })()
    }
  }

  // ---------- look ----------
  const css = document.getElementById('film-css') || document.head.appendChild(Object.assign(document.createElement('style'), { id: 'film-css' }))
  css.textContent += `
    *{scrollbar-width:none!important}
    .dev-links{display:none!important}
    #film-cursor{width:104px!important;height:104px!important;transform-origin:13px 6.5px!important}
    #film-cursor svg{width:104px;height:104px}
    .film-private{filter:blur(6px)!important}
  `
  function lookCommon(layoutW) {
    M.setAppearance({ dark })
    F.theme('light') // the dark-arrow cursor: macOS draws it the same in both appearances
    document.body.style.zoom = String(innerWidth / layoutW)
    document.body.style.willChange = 'auto' // let Chrome re-raster text at each camera scale
  }

  // The desktop: wallpaper plus a menu bar; the Halo hangs from the top centre.
  function desktop() {
    const W = 1440, Hh = 810
    lookCommon(W)
    const b = document.body
    b.style.setProperty('width', W + 'px', 'important')
    b.style.setProperty('height', Hh + 'px', 'important')
    b.style.background = wall()
    b.style.borderRadius = '0'
    b.style.outline = 'none'
    b.style.boxShadow = 'none'
    document.documentElement.style.background = dark ? '#101722' : '#e9eef6'
    const bar = document.createElement('div')
    bar.id = 'film-menubar'
    bar.style.cssText = 'position:absolute;left:0;right:0;top:0;height:32px;display:flex;align-items:center;gap:20px;padding:0 18px;' +
      `font:500 13px -apple-system,BlinkMacSystemFont,sans-serif;color:${dark ? 'rgba(255,255,255,.9)' : 'rgba(0,0,0,.85)'};letter-spacing:-.01em;` +
      `background:${dark ? 'rgba(28,30,36,.55)' : 'rgba(246,247,250,.62)'};-webkit-backdrop-filter:blur(30px) saturate(1.6);backdrop-filter:blur(30px) saturate(1.6);` +
      `box-shadow:0 .5px 0 ${dark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.08)'};z-index:0;pointer-events:none`
    bar.innerHTML = '<b style="font-weight:700">Finder</b><span>File</span><span>Edit</span><span>View</span><span>Go</span><span>Window</span><span>Help</span>' +
      '<span style="flex:1"></span><span>Mon Sep 28</span><span>9:41 AM</span>'
    b.insertBefore(bar, b.firstChild)
    const root = $('.halo-root'); if (root) root.style.zIndex = '10'
    haloCam(1.0, 0)
  }

  // Camera for the Halo: a flat zoom pinned to the top centre, so the Halo stays hanging from
  // the top edge at every scale. Same function list as film.js frameOn, so moves interpolate.
  const haloT = (s) => {
    const cx = innerWidth / 2 / zoomOf()
    return `translate3d(${cx}px, 0px, 0) rotateX(0deg) rotateY(0deg) rotateZ(0deg) scale(${s}) translate3d(${-cx}px, 0px, 0)`
  }
  const haloCam = (s, ms = 1600, easing = soft) => (ms ? F.camera(haloT(s), ms, easing) : (F.setCamera(haloT(s)), Promise.resolve()))

  // A window on the desktop (Settings): the body is the window, the page behind it the wallpaper.
  // zoom is for a 2880-wide frame; other frame sizes scale with it
  function windowed(w, h, zoom) {
    lookCommon(2880 / zoom)
    const b = document.body
    b.style.setProperty('width', w + 'px', 'important')
    b.style.setProperty('height', h + 'px', 'important')
    b.style.borderRadius = '12px'
    b.style.outline = 'none'
    b.style.boxShadow = '0 30px 90px rgba(20,30,60,.22), 0 8px 24px rgba(20,30,60,.10), 0 0 0 .5px rgba(0,0,0,.18)'
    b.style.overflow = 'hidden'
    document.documentElement.style.background = wall()
    // the shell floats the traffic lights over the sidebar's top-left; the browser has none
    const side = $('.sidebar')
    if (side && !$('#film-lights')) {
      const l = document.createElement('div')
      l.id = 'film-lights'
      l.style.cssText = 'position:absolute;left:18px;top:18px;display:flex;gap:8px;z-index:5;pointer-events:none'
      l.innerHTML = ['#ff5f57', '#febc2e', '#28c840'].map((c) => `<i style="width:12px;height:12px;border-radius:50%;background:${c};box-shadow:inset 0 0 0 .5px rgba(0,0,0,.18)"></i>`).join('')
      side.style.position = 'relative'
      side.appendChild(l)
    }
    guard()
  }

  // Keep off screen what the brief rules out: the Fast actions pane, anything naming Telegram or
  // GitHub, and the backend host (it carries a person's name), which is blurred rather than hidden.
  function guard() {
    const blocks = 'p, .form-note, .callout, [role=note], section, [role=region]'
    const sweep = () => {
      for (const b of $$('nav button')) if (b.textContent.trim() === 'Fast actions') b.style.display = 'none'
      for (const e of $$(blocks)) {
        if (!/Telegram|GitHub/.test(e.textContent)) continue
        if ($$(blocks, e).some((c) => /Telegram|GitHub/.test(c.textContent))) continue
        e.style.display = 'none'
      }
      for (const e of $$('span, div, p')) if (e.children.length === 0 && e.textContent.includes('himanshuat')) e.classList.add('film-private')
    }
    sweep()
    new MutationObserver(sweep).observe(document.body, { childList: true, subtree: true, characterData: true })
  }

  // ---------- input ----------
  const PO = { bubbles: true, cancelable: true, composed: true, pointerType: 'mouse', isPrimary: true }
  function hover(el, on = true) {
    const t = on ? 'over' : 'out'
    el.dispatchEvent(new PointerEvent('pointer' + t, { ...PO, relatedTarget: document.body }))
    el.dispatchEvent(new MouseEvent('mouse' + t, { ...PO, relatedTarget: document.body }))
  }
  // the cursor glides onto an element and rests there (live-tracked, like click); at: 'edge' puts
  // the tip near the right edge so the arrow does not cover the label
  function point(el, ms = 900, at = 'centre') {
    return F.moveTo(() => {
      const r = el.getBoundingClientRect()
      return at === 'edge' ? { x: r.right - r.width * 0.22 - 13, y: r.top + r.height * 0.62 - 6 } : { x: r.left + r.width / 2 - 13, y: r.top + r.height / 2 - 6 }
    }, ms)
  }
  let seed = 7
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  async function type(input, text, cps = 19) {
    const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    const set = Object.getOwnPropertyDescriptor(proto, 'value').set
    input.focus()
    for (const ch of text) {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true }))
      set.call(input, input.value + ch)
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new KeyboardEvent('keyup', { key: ch, bubbles: true }))
      await sleep((1000 / cps) * (0.6 + rand() * 0.8) + (ch === ' ' ? 30 : 0))
    }
  }
  const enter = (input) => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true }))
  function choose(select, value) {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, value)
    select.dispatchEvent(new Event('change', { bubbles: true }))
  }
  const shape = () => need($('[data-testid=halo-shape]'), 'halo shape')
  const tab = (label) => need($(`[role=tab][aria-label^="${label}"]`), 'tab ' + label)
  const navBtn = (label) => need(button(label, need($('nav[aria-label="Settings sections"]'), 'settings nav')), 'nav ' + label)
  const until = async (fn, what, ms = 5000) => { for (let t = 0; t < ms; t += 50) { const v = fn(); if (v) return v; await sleep(50) } throw new Error('sage take: timed out on ' + what) }
  // Expand at setup with the spring switched off, so a take can open already expanded; the take
  // switches the spring back on at its first frame. A click, not a hover: hover waits 120 ms, and
  // setup has only 100 ms before frame 0.
  function openInstantly(tabLabel) {
    $('.halo-root').dataset.motion = 'reduced'
    need($('.halo-collapsed'), 'collapsed halo').click()
    setTimeout(() => { if (tabLabel) tab(tabLabel).click() }, 0)
  }
  const springOn = () => { $('.halo-root').dataset.motion = 'spring' }
  const withClipboard = () => M.invoke('set_settings', { patch: { clipboardHistoryEnabled: true } })

  // ---------- setups: run before frame 0 ----------
  const setups = {
    'halo-expand'() { scrub(); desktop(); withClipboard() },
    'halo-tabs'() { scrub(); desktop(); haloCam(1.32, 0); withClipboard(); openInstantly(null) },
    'halo-moments'() { scrub(); meetingLater(); desktop(); haloCam(1.9, 0) },
    'halo-alert'() { scrub(); desktop(); haloCam(1.32, 0); withClipboard(); openInstantly('Cloud') },
    'ask-model'() {
      scrub(); signInChatgpt(); desktop(); haloCam(1.45, 0); withClipboard()
      openInstantly('Ask')
    },
    'ask'() {
      scrub(); signInChatgpt(); scriptAsk(); desktop(); haloCam(1.3, 0); withClipboard()
      M.invoke('switch_model', { provider: 'chatgpt', model: 'gpt-5.1' })
      openInstantly('Ask')
    },
    'settings-model'() {
      scrub()
      windowed(900, 580, 2.6)
      F.cut(document.body, { s: 0.94 })
    },
    'settings-cloud'() {
      scrub(); M.halo.serverChatgpt = false // the server is not signed in: "Sign in to ChatGPT on your server"
      windowed(900, 580, 2.6)
      navBtn('Model').click() // start one pane earlier, so the nav click to Cloud is a change
      F.cut(document.body, { s: 0.94 })
    },
    'settings-access'() {
      scrub()
      M.delayMs = 230 // Grant everything asks for one permission at a time; slow enough to read
      windowed(900, 580, 2.6)
      navBtn('Agent').click()
      F.cut(document.body, { s: 0.94 })
    }
  }

  // ---------- takes ----------
  const takes = {
    // hover top-centre, the Halo springs open on Home (Now Playing playing), Keep Awake on, hover Join
    async 'halo-expand'() {
      F.start(); await sleep(150)
      haloCam(1.32, 2600, soft)
      await point(shape(), 1100)
      hover(shape(), true)
      await sleep(1100)
      await F.click(need($('input[aria-label="Keep Awake"]'), 'Keep Awake'), 850)
      await sleep(900)
      const join = need($('[aria-label^="Join"]'), 'Join')
      await point(join, 750, 'edge')
      join.style.background = 'var(--n-fill-2)' // the :hover fill; a synthetic pointer cannot set :hover
      await sleep(1100)
      haloCam(1.38, 1800, drift)
      await sleep(700); F.hideCursor(); await sleep(900)
    },
    // the tab bar: Tray, Clipboard, Cloud, and a to-do ticked
    async 'halo-tabs'() {
      F.start(); springOn(); await sleep(250)
      haloCam(1.4, 7600, drift)
      await F.click(tab('Tray'), 850)
      await sleep(1250)
      await F.click(tab('Clipboard'), 600)
      await sleep(1300)
      await F.click(tab('Cloud'), 600)
      await sleep(900)
      // a to-do due today: ticked, it stays in the list struck through (an undated one leaves it)
      const todo = need($$('.todo').find((t) => t.textContent.includes('Q3 roadmap'))?.querySelector('.todo-check'), 'Q3 todo')
      await F.click(todo, 700)
      await sleep(900); F.hideCursor(); await sleep(700)
    },
    // collapsed live moments: the song (art + bars), plugging in (bolt + battery fill), a new track
    // ("Title — Artist" banner), then back to the bars
    async 'halo-moments'() {
      F.start(); await sleep(150)
      haloCam(2.0, 9500, drift)
      await sleep(1300)
      M.halo.power(true, true, 64)
      await sleep(4600) // PLUG_MS is 4 s
      const now = M.halo.mediaNow()
      M.halo.play({ ...now, title: 'Low Tide', artist: 'Harbor Lights', album: 'Blue Hours', duration: 187, position: 0 })
      await sleep(3600)
    },
    // collapse, then an alert live activity slides out of the Halo
    async 'halo-alert'() {
      F.start(); springOn(); await sleep(250)
      await sleep(500)
      // Close straight to black: the dev stand-in glass fades to black over 0.25 s, which passes
      // through a flat grey slab mid-morph (the real shell draws native glass instead).
      shape().style.transition = 'width var(--spring-ms) var(--spring), height var(--spring-ms) var(--spring), border-radius var(--spring-ms) var(--spring)'
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })) // close
      haloCam(1.9, 1600, soft)
      await sleep(1700)
      M.halo.alert('Send the Q3 roadmap', 'Due at 5:00 PM', 'todo')
      await sleep(2200)
      haloCam(1.96, 1500, drift)
      await sleep(1500)
    },
    // the model chip: open it, switch provider and model in one pick (the Halo grows to hold the
    // menu since Sage ea1505a; before it, the menu was clipped)
    async 'ask-model'() {
      F.start(); springOn(); await sleep(250)
      const chip = need($('.model-chip'), 'model chip')
      await F.click(chip, 950)
      const option = await until(() => $$('.model-option').find((o) => o.textContent.includes('gpt-5.1') && !o.textContent.includes('codex')), 'gpt-5.1 option')
      await sleep(700)
      await F.click(option, 700)
      await sleep(600)
      await point(chip, 600, 'edge')
      await sleep(900); F.hideCursor(); await sleep(900)
    },
    // type a request; the agent's steps stream; the approval card; Allow once; done
    async 'ask'() {
      F.start(); springOn(); await sleep(250)
      const input = need($('.halo-ask input, .halo-ask textarea'), 'ask input')
      await F.click(input, 800)
      await sleep(150)
      await type(input, 'check my battery and set volume to 30')
      await sleep(250)
      enter(input)
      haloCam(1.22, 2400, soft)
      F.moveTo(innerWidth * 0.74, innerHeight * 0.62, 900)
      const allow = await until(() => button('Allow once'), 'Allow once')
      await sleep(700)
      await F.click(allow, 800)
      await sleep(600); F.hideCursor()
      await sleep(1900)
    },
    // Model: the live model list (Ollama), then ChatGPT with its sign-in call to action
    async 'settings-model'() {
      F.start(); await sleep(150)
      F.shot(document.body, { s: 0.98 }, 9000, drift)
      await F.click(navBtn('Model'), 900)
      await sleep(700)
      const model = need($$('select').find((s) => [...s.options].some((o) => o.value === 'mistral:7b')), 'model list')
      await F.click(model, 750)
      await sleep(250); choose(model, 'mistral:7b')
      await sleep(700)
      const provider = need($$('select').find((s) => [...s.options].some((o) => o.value === 'chatgpt')), 'provider select')
      await F.click(provider, 750)
      await sleep(250); choose(provider, 'chatgpt')
      const cta = await until(() => button('Sign in with ChatGPT'), 'Sign in with ChatGPT')
      await sleep(500)
      await point(cta, 800, 'edge')
      await sleep(1300); F.hideCursor(); await sleep(900)
    },
    // Cloud: the fixed server and "Sign in to ChatGPT on your server", then About's Resource usage
    async 'settings-cloud'() {
      F.start(); await sleep(150)
      F.shot(document.body, { s: 0.98 }, 9000, drift)
      await F.click(navBtn('Cloud'), 900)
      await sleep(700)
      const cta = await until(() => button('Sign in to ChatGPT on your server'), 'server sign-in')
      await point(cta, 800, 'edge')
      await sleep(1500)
      await F.click(navBtn('About'), 900)
      await sleep(700)
      const usage = $$('h2, h3, .section-title, [class*=title]').find((h) => h.textContent.trim() === 'Resource usage')
      F.hideCursor()
      if (usage) await F.shot(usage.parentElement, { s: 1.08 }, 1500, soft)
      await sleep(1500)
    },
    // Permissions → Grant everything (each one turns Allowed)
    async 'settings-access'() {
      F.start(); await sleep(150)
      F.shot(document.body, { s: 0.98 }, 7000, drift)
      await F.click(navBtn('Permissions'), 900)
      await sleep(700)
      await F.click(need(button('Grant everything'), 'Grant everything'), 800)
      await sleep(2400); F.hideCursor(); await sleep(1200)
    }
  }
  for (const k of Object.keys(takes)) takes[k + '-dark'] = takes[k]
  takes.setup = (n) => { dark = n.endsWith('-dark'); setups[n.replace(/-dark$/, '')](); return 'set' }
  window.__takes = takes
  return Object.keys(takes).join(',')
})()
