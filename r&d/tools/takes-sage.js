// Sage launch takes. Injected after timeline-sync.js and film.js into Sage's dev build
// (localhost:1420, the in-browser mock backend) and rendered by render-frames.mjs on a virtual
// clock, so every click time in the log is an exact source second.
//
// Everything here changes the page at runtime only; the Sage repo is never touched. What it does:
// - look: light appearance, dev bar hidden, a soft desktop wallpaper, a Mac menu bar, window chrome
// - data: no people's names, emails or addresses, nothing from Telegram or a terminal (the mock
//   seeds all of those); the Ask run is scripted to match the prompt typed on screen
// - camera: flat pushes only, never a tilt (the owner's feedback on the last film)
(() => {
  const F = window.__film
  const M = window.sageMock
  const { sleep } = F
  const arrive = 'cubic-bezier(.32,.72,0,1)' // iOS sheet curve: fast out, long settle
  const soft = 'cubic-bezier(.45,0,.2,1)' // eases out of rest: for moves that start from still
  const drift = 'linear'
  const $ = (s, root = document) => root.querySelector(s)
  const $$ = (s, root = document) => [...root.querySelectorAll(s)]
  const shown = (e) => e && e.getBoundingClientRect().width > 0 && getComputedStyle(e).visibility !== 'hidden'
  const button = (text, root = document) => $$('button, [role=tab], [role=button]', root).find((b) => b.textContent.trim() === text && shown(b))
  const zoomOf = () => parseFloat(getComputedStyle(document.body).zoom) || 1 // rects are in device px
  const need = (e, what) => { if (!e) throw new Error('sage take: no ' + what); return e }

  // A bright, soft desktop: sky blue into peach and lilac, like a macOS light wallpaper.
  const WALL =
    'radial-gradient(1100px 700px at 12% 105%, #9cc9f0 0%, rgba(156,201,240,0) 70%),' +
    'radial-gradient(900px 620px at 95% 95%, #d3c4f6 0%, rgba(211,196,246,0) 70%),' +
    'radial-gradient(800px 520px at 78% 18%, #fbe0bd 0%, rgba(251,224,189,0) 70%),' +
    'radial-gradient(700px 500px at 25% 20%, #e9f2fb 0%, rgba(233,242,251,0) 70%),' +
    'linear-gradient(160deg, #eef3f9 0%, #e6ecf6 45%, #ece6f4 100%)'

  // ---------- data: fake but neutral ----------
  function scrub() {
    const H = M.halo
    H.stopLive() // no random CPU jitter, charging flips or surprise alerts mid-take
    const ago = (min) => new Date(Date.now() - min * 60000).toISOString()
    H.cloud = { ...H.cloud, deviceName: 'MacBook Pro' }
    H.todos = H.todos.map((t) => (t.id === 'td1' ? { ...t, title: 'Send the Q3 roadmap to the team' } : t))
    H.notes = [
      { id: 'n1', title: 'Trip ideas', body: 'Lisbon in October; check flights on the 12th.', tags: ['travel'], pinned: true, updatedAt: ago(180) },
      { id: 'n2', title: 'Standup notes', body: 'Sync engine: tombstones done. Halo: tray drag-out next.', tags: ['work'], pinned: false, updatedAt: ago(20) },
      { id: 'n3', title: 'Gift ideas', body: 'Ceramic planter. The Murakami box set.', tags: [], pinned: false, updatedAt: ago(2880) }
    ]
    H.connectors = H.connectors.map((c) => ({ ...c, account: null }))
    H.clipboard = [
      { id: 'c1', kind: 'text', preview: "Let's move the launch review to Thursday at 3pm.", thumbnail: null, sourceApp: 'Slack', copiedAt: ago(2), pinned: false },
      { id: 'c2', kind: 'link', preview: 'https://github.com/sage/sage/pull/128', thumbnail: null, sourceApp: 'Safari', copiedAt: ago(9), pinned: true },
      { id: 'c3', kind: 'image', preview: 'Image 1200×800', thumbnail: H.tray[0]?.thumbnail ?? null, sourceApp: 'Preview', copiedAt: ago(25), pinned: false },
      { id: 'c4', kind: 'text', preview: 'Oat milk, lemons, basil, sourdough', thumbnail: null, sourceApp: 'Notes', copiedAt: ago(70), pinned: false }
    ]
    const invoke = H.invoke.bind(H)
    H.invoke = async (cmd, a, granted) => {
      if (cmd === 'cloud_account') return { chatgpt: { signedIn: true, email: null, plan: 'plus' }, model: 'gpt-5.1' }
      const r = await invoke(cmd, a, granted)
      if (cmd === 'cloud_connector_connect') H.connectors = H.connectors.map((c) => ({ ...c, account: null }))
      return r
    }
    M.chatgpt = { signedIn: true, expiresAt: new Date(Date.now() + 864e5).toISOString() } // "Signed in", no address
    M.emit('sage://cloud', { ...H.cloud })
    M.emit('sage://cloud-data', { notes: H.notes, todos: H.todos })
    M.emit('sage://clipboard', [...H.clipboard])
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
    /* a local run has no server: the approval card's "from your server · N min left" does not apply */
    .approval-card header .dim{display:none!important}
  `
  function lookCommon(layoutW) {
    M.setAppearance({ dark: false })
    F.theme('light')
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
    b.style.background = WALL
    b.style.borderRadius = '0'
    b.style.outline = 'none'
    b.style.boxShadow = 'none'
    document.documentElement.style.background = '#e9eef6'
    const bar = document.createElement('div')
    bar.id = 'film-menubar'
    bar.style.cssText = 'position:absolute;left:0;right:0;top:0;height:32px;display:flex;align-items:center;gap:20px;padding:0 18px;' +
      'font:500 13px -apple-system,BlinkMacSystemFont,sans-serif;color:rgba(0,0,0,.85);letter-spacing:-.01em;' +
      'background:rgba(246,247,250,.62);-webkit-backdrop-filter:blur(30px) saturate(1.6);backdrop-filter:blur(30px) saturate(1.6);' +
      'box-shadow:0 .5px 0 rgba(0,0,0,.08);z-index:0;pointer-events:none'
    bar.innerHTML = '<b style="font-weight:700">Finder</b><span>File</span><span>Edit</span><span>View</span><span>Go</span><span>Window</span><span>Help</span>' +
      '<span style="flex:1"></span><span>Mon Sep 28</span><span>9:41 AM</span>'
    b.insertBefore(bar, b.firstChild)
    const root = $('.halo-root'); if (root) root.style.zIndex = '10'
    haloCam(1.0, 0)
  }

  // Camera for the Halo: a flat zoom pinned to the top centre, so the Halo stays hanging from
  // the top edge at every scale. Same function list as film.js frameOn, so moves interpolate.
  const haloT = (s) => {
    const z = parseFloat(getComputedStyle(document.body).zoom) || 1
    const cx = innerWidth / 2 / z
    return `translate3d(${cx}px, 0px, 0) rotateX(0deg) rotateY(0deg) rotateZ(0deg) scale(${s}) translate3d(${-cx}px, 0px, 0)`
  }
  const haloCam = (s, ms = 1600, easing = soft) => (ms ? F.camera(haloT(s), ms, easing) : (F.setCamera(haloT(s)), Promise.resolve()))

  // A window on the desktop (Settings): the body is the window, the page behind it the wallpaper.
  function windowed(w, h, zoom) {
    lookCommon(innerWidth / zoom)
    const b = document.body
    b.style.setProperty('width', w + 'px', 'important')
    b.style.setProperty('height', h + 'px', 'important')
    b.style.borderRadius = '12px'
    b.style.outline = 'none'
    b.style.boxShadow = '0 30px 90px rgba(20,30,60,.22), 0 8px 24px rgba(20,30,60,.10), 0 0 0 .5px rgba(0,0,0,.18)'
    b.style.overflow = 'hidden'
    document.documentElement.style.background = WALL
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

  // Keep off screen what the brief rules out: the Fast actions pane and anything naming Telegram.
  function guard() {
    const sweep = () => {
      for (const b of $$('nav button')) if (b.textContent.trim() === 'Fast actions') b.style.display = 'none'
      for (const e of $$('p, .form-note, .callout, [role=note], section, [role=region]')) {
        if (!e.textContent.includes('Telegram')) continue
        if ($$('p, .form-note, .callout, [role=note], section, [role=region]', e).some((c) => c.textContent.includes('Telegram'))) continue
        e.style.display = 'none'
      }
    }
    sweep()
    new MutationObserver(sweep).observe(document.body, { childList: true, subtree: true })
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
  // Expand at setup with the spring switched off, so a take can open already expanded; the take
  // switches the spring back on at its first frame. React leaves the attribute alone until the
  // reduced-motion state itself changes.
  // A click, not a hover: hover waits 120 ms, and setup has only 100 ms before frame 0.
  function openInstantly(tabLabel) {
    $('.halo-root').dataset.motion = 'reduced'
    need($('.halo-collapsed'), 'collapsed halo').click()
    setTimeout(() => { if (tabLabel) tab(tabLabel).click() }, 0)
  }
  const springOn = () => { $('.halo-root').dataset.motion = 'spring' }

  // ---------- setups: run before frame 0 ----------
  const setups = {
    'halo-expand'() {
      scrub(); desktop()
      M.invoke('set_settings', { patch: { clipboardHistoryEnabled: true } })
    },
    'halo-tabs'() {
      scrub(); desktop(); haloCam(1.32, 0)
      M.invoke('set_settings', { patch: { clipboardHistoryEnabled: true } })
      openInstantly(null)
    },
    'halo-alert'() {
      scrub(); desktop(); haloCam(1.32, 0)
      M.invoke('set_settings', { patch: { clipboardHistoryEnabled: true } })
      openInstantly('Cloud')
    },
    'ask'() {
      scrub(); scriptAsk(); desktop(); haloCam(1.3, 0)
      M.invoke('set_settings', { patch: { clipboardHistoryEnabled: true } })
      openInstantly('Ask')
    },
    'settings-model'() {
      scrub()
      M.invoke('set_settings', { patch: { llmProvider: 'chatgpt', chatgptModel: 'gpt-5.1', chatgptEffort: null } })
      windowed(900, 580, 2.6)
      F.cut(document.body, { s: 0.94 })
    },
    'settings-access'() {
      scrub()
      M.delayMs = 230 // Grant everything asks for one permission at a time; slow enough to read
      windowed(900, 580, 2.6)
      navBtn('Cloud').click() // start one pane earlier, so the nav click to Permissions is a change
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
    // type a request; the agent's steps stream; an approval card; Allow once; done
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
      let allow
      for (let i = 0; i < 100 && !(allow = button('Allow once')); i++) await sleep(50)
      await sleep(700)
      await F.click(need(allow, 'Allow once'), 800)
      await sleep(600); F.hideCursor()
      await sleep(1900)
    },
    // sidebar → Model (model and effort pickers) → Cloud, with the subscription line lifted out
    async 'settings-model'() {
      F.start(); await sleep(150)
      F.shot(document.body, { s: 0.98 }, 8000, drift)
      await F.click(navBtn('Model'), 900)
      await sleep(700)
      const model = need($$('select').find((s) => [...s.options].some((o) => o.value === 'gpt-5.1-codex')), 'model select')
      await F.click(model, 750)
      await sleep(200); choose(model, 'gpt-5.1-codex')
      await sleep(600)
      const effort = need($$('select').find((s) => [...s.options].some((o) => o.value === 'xhigh')), 'effort select')
      await F.click(effort, 650)
      await sleep(200); choose(effort, 'high')
      await sleep(700)
      await F.click(navBtn('Cloud'), 850)
      await sleep(600)
      const row = need($$('.form-row, [class*=row]').find((r) => r.textContent.includes('Using your ChatGPT subscription') && r.getBoundingClientRect().height < 80 * zoomOf()), 'subscription row')
      F.hideCursor()
      F.focus(row)
      await F.shot(row, { s: 1.12 }, 1300, soft)
      F.shot(row, { s: 1.16 }, 1400, drift)
      await sleep(1100)
    },
    // Permissions → Grant everything (each one turns Allowed) → Connectors, connect GitHub
    async 'settings-access'() {
      F.start(); await sleep(150)
      F.shot(document.body, { s: 0.98 }, 8500, drift)
      await F.click(navBtn('Permissions'), 900)
      await sleep(600)
      await F.click(need(button('Grant everything'), 'Grant everything'), 800)
      await sleep(2200)
      await F.click(navBtn('Connectors'), 850)
      await sleep(600)
      const connect = $$('button').find((b) => {
        if (b.textContent.trim() !== 'Connect') return false
        let r = b.parentElement
        while (r && !r.textContent.includes('GitHub')) r = r.parentElement
        return r && r.getBoundingClientRect().height < 80 * zoomOf()
      })
      await F.click(need(connect, 'GitHub Connect'), 800)
      await sleep(900); F.hideCursor(); await sleep(900)
    }
  }
  takes.setup = (n) => { setups[n](); return 'set' }
  window.__takes = takes
  return Object.keys(takes).join(',')
})()
