/**
 * The two scripts injected into a composition window, as strings.
 *
 * Split out of `compositions.ts` for one reason: that file imports `electron`, so `pnpm test`
 * cannot load it, and these two builders are the only pure logic in the whole capture path.
 * A fault in the text they emit is a wrong *picture*, never an exception — which is the class
 * of bug this project keeps paying for, and the class a unit test can hold still.
 */

/**
 * Apply this clip's variable values to the page.
 *
 * Three bindings, matching the composition contract: every scalar becomes a `--{id}` custom
 * property on the root, `data-var-text` substitutes an element's own text, and `data-var-src`
 * substitutes a `src`. Text substitution deliberately writes only the element's **own** text
 * node, so a heading containing an animated `<span>` keeps its children.
 *
 * Applied before the seek and re-applied whenever the values differ from the last set, because
 * two clips of one composition share a window: rendering clip B after clip A without reapplying
 * would give B whichever text A had left behind.
 */
export function variablesScript(
  values: Record<string, string | number | boolean>,
  css: Record<string, string>
): string {
  return `(() => {
    const values = ${JSON.stringify(values)}
    const css = ${JSON.stringify(css)}
    const root = document.querySelector('[data-composition-id]')
    if (!root) return false
    // The CSS form, with units: --inset: 96px, not 96.
    for (const [id, value] of Object.entries(css)) {
      root.style.setProperty('--' + id, value)
    }
    for (const el of document.querySelectorAll('[data-var-text]')) {
      const id = el.getAttribute('data-var-text')
      if (!(id in values)) continue
      let wrote = false
      for (const node of el.childNodes) {
        if (node.nodeType === 3) {
          if (wrote) node.textContent = ''
          else { node.textContent = String(values[id]); wrote = true }
        }
      }
      if (!wrote) el.prepend(document.createTextNode(String(values[id])))
    }
    for (const el of document.querySelectorAll('[data-var-src]')) {
      const id = el.getAttribute('data-var-src')
      if (id in values && values[id]) el.setAttribute('src', String(values[id]))
    }
    return true
  })()`
}

/**
 * Seek the composition and wait for the paint that results.
 *
 * **`time` is called exactly once, and never without an argument.** It used to end with
 * `at: tl.time()` — GSAP's convention, where a bare `time()` is the getter. The composition
 * contract does not promise GSAP: it asks for an object with `time(seconds)` and `duration()`,
 * and bay's own generated compositions are hand-rolled ones. For those, `time()` is the setter
 * receiving `undefined`, so the read *reset the composition* microseconds after it had been
 * seeked and painted — and whether the capture beat the wipe was a race with the compositor.
 * Measured: the first seek into a fresh window captured correctly and every later one came back
 * fully blank with `held: true`, because a wiped page has nothing further to repaint. A
 * full-length caption track rendered its first frame and then nothing for forty seconds.
 *
 * The returned `at` is informational, so it echoes the number we asked for. Nothing needs to
 * interrogate the timeline, and interrogating it is what broke it.
 */
export function seekScript(compositionId: string, seconds: number): string {
  return `(async () => {
    const tl = window.__timelines && window.__timelines[${JSON.stringify(compositionId)}]
    if (!tl) return { ok: false, why: 'no timeline registered as ' + ${JSON.stringify(compositionId)} }
    tl.time(${seconds})
    // Two frames: the first lets the tween's style writes land, the second lets the
    // compositor paint them. Measured sufficient — seeking the same time from three
    // different directions produced byte-identical captures.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    return { ok: true, at: ${seconds} }
  })()`
}

/**
 * Read what the page declares in `window.__film`, as plain data (`DeclaredFilm` in
 * `@shared/film-oracle`). Nothing is judged here: the page is somebody else's code, so it is
 * asked for its values and `readFilmMeta` decides what they mean. `JSON` is the copy because a
 * `NaN` or a function in `beats` must arrive as "not a number", not fail the call.
 */
export function filmDeclaredScript(): string {
  return `(() => {
    const film = window.__film
    const kind = film === null ? 'null' : typeof film
    if (!film || kind !== 'object') return { present: false, kind }
    const plain = (value) => {
      try { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)) } catch { return 'unreadable' }
    }
    return {
      present: true,
      kind,
      beats: plain(film.beats),
      cuts: plain(film.cuts),
      inFrame: plain(film.inFrame),
      blur: plain(film.blur),
      track: typeof film.track
    }
  })()`
}

/**
 * Seek each time and read `__film.track(t)` there — no paint, no capture, so a whole film is
 * one call. Returns `RawTrackSample`s: a box is `[x, y, w, h, op]` with `null` for anything
 * that is not a finite number (`op` absent is 1), so a `NaN` reaches the oracle as a named
 * fault rather than as whatever the bridge makes of it.
 *
 * A throw from `time` or from `track` is caught per sample and reported with which call it
 * was: one bad second must cost one sample, not the film. `probes` are `[t, via]` pairs read
 * as t, via, t — the purity check — and come back as `{ first, again }`.
 */
export function filmTrackScript(compositionId: string, times: readonly number[], probes: readonly (readonly [number, number])[]): string {
  return `(() => {
    const tl = window.__timelines && window.__timelines[${JSON.stringify(compositionId)}]
    if (!tl) return { ok: false, why: 'no timeline registered as ' + ${JSON.stringify(compositionId)} }
    const film = window.__film
    const said = (error) => String((error && error.message) || error).slice(0, 200)
    const num = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null)
    const read = (t) => {
      try { tl.time(t) } catch (error) { return { t, threw: 'time', message: said(error) } }
      let raw
      try { raw = film.track(t) } catch (error) { return { t, threw: 'track', message: said(error) } }
      if (!raw || typeof raw !== 'object') return { t, shape: raw === null ? 'null' : typeof raw }
      const boxes = {}
      for (const id of Object.keys(raw)) {
        const box = raw[id]
        boxes[id] = box && typeof box === 'object'
          ? [num(box.x), num(box.y), num(box.w), num(box.h), box.op === undefined ? 1 : num(box.op)]
          : null
      }
      return { t, boxes }
    }
    const samples = ${JSON.stringify(times)}.map(read)
    const purity = ${JSON.stringify(probes)}.map(([t, via]) => {
      const first = read(t)
      read(via)
      return { t, via, first, again: read(t) }
    })
    return { ok: true, samples, purity }
  })()`
}
