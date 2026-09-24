/**
 * What is on screen at each cut while the preview PLAYS?
 *
 * The report: "when watching video, the frame shifts, screen goes black, coming from s3 to s4" —
 * a vertical 24 fps timeline of back-to-back clips, each trimmed at its in-point. Every other
 * probe of cuts measured a scrubbed frame or an export, which wait for their media; playback does
 * not wait, so it is the one path where a cut can show nothing.
 *
 * Measured per *displayed picture*: a rAF sampler reads the visible canvas every animation frame
 * (a picture drawn and overwritten inside one turn is never shown, so a rAF sample is what the
 * screen held), keeps the samples where the engine composited a new picture, and classifies each
 * one inside a window around every cut against an exact reference of that frame rendered by
 * `renderFrame` (the `preview_frame` path, which waits for every source):
 *
 *   black  — the picture is (near) black where the reference is not;
 *   held   — the outgoing clip's last picture still up after the cut;
 *   wrong  — it matches none of the reference frames the playhead could be showing.
 *
 * Judged at the four cuts between two takes (the reporter's case): no black, no wrong, nothing held,
 * the incoming clip up on the cut frame itself. A fifth, same-asset jump cut is reported and not
 * judged — how long it holds is how long one element takes to seek, which is the machine's state.
 *
 * The "frame shift" is measured separately, because a playing element drifts a frame or two by
 * design and the playthroughs cannot see one frame: paused on each cut, and on the first incoming
 * picture while playing, the picture is matched against that clip's source frames N-1…N+2 decoded
 * at mid-frame. N-1 is the frame the trim cut away. (Fixed by nudging seeks past the frame edge,
 * `FRAME_EDGE_SECONDS` in `sync.ts`; without it three of these in-points open one frame early.)
 *
 * Four playthroughs: cold (every element released first) and warm (straight after), each without
 * and with a grade on every clip, because the grade pass is a separate draw path.
 *
 * The classifier is proven before it is trusted: a black thumbnail must classify as black, the
 * outgoing clip's last frame shown five frames after the cut must classify as wrong, and the
 * exact reference must classify as ok — and in the playthroughs, mid-clip pictures must match
 * (a positive control that the sampler sees ordinary picture changes and tracks them).
 *
 * Media: TAKES=<folder> uses s1*…s5* .mp4 from it (the user's urban-shinobi takes); otherwise it
 * makes its own under ~/.bay-probe-media/cut-playback-v3 — 768x1344 24 fps H.264 with keyframes 5 s
 * apart and B-frames, so a seek to a trimmed in-point has to decode from a distant keyframe, as the
 * real takes do. Builds its timeline in the page; the harness restores the project. Nothing saves.
 *
 *     PORT=<port> node test/app/cut-playback.mjs
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { attach, runProbe, PreconditionError } from './cdp.mjs'

const run = promisify(execFile)
import { FFMPEG, H264 } from './ffmpeg.mjs'

async function media() {
  if (process.env.TAKES) {
    const names = (await readdir(process.env.TAKES)).sort()
    const clips = [1, 2, 3, 4, 5].map((n) => names.find((f) => f.startsWith(`s${n}`) && f.endsWith('.mp4')))
    if (clips.some((c) => !c)) throw new PreconditionError('TAKES needs s1*…s5* .mp4', process.env.TAKES)
    const score = names.find((f) => /\.(flac|wav|mp3|m4a)$/.test(f))
    return { clips: clips.map((c) => join(process.env.TAKES, c)), score: score ? join(process.env.TAKES, score) : null }
  }
  // Versioned by name: a changed recipe must not be satisfied by a specimen from the old one.
  const dir = join(homedir(), '.bay-probe-media', 'cut-playback-v3')
  await mkdir(dir, { recursive: true })
  const clips = []
  for (let n = 1; n <= 5; n++) {
    const out = join(dir, `s${n}.mp4`)
    clips.push(out)
    if (await readFile(out).then(() => true, () => false)) continue
    // Bands travelling down the frame, a different colour per clip: every cell of a 12x21 thumbnail
    // changes from one frame to the next (so N-1 and N are told apart), twelve frames on is nearly
    // the inverse (so a jump within one clip is told apart), and clips differ by colour.
    const cb = Math.round(128 + 70 * Math.cos(n * 1.3)), cr = Math.round(128 + 70 * Math.sin(n * 1.3))
    await run(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=768x1344:r=24:d=5.2',
      '-vf', `geq=lum='128+100*sin(2*PI*(3*Y/H-0.9*T))':cb=${cb}:cr=${cr}`,
      ...H264, '-g', '120', '-bf', '2',
      '-pix_fmt', 'yuv420p', out])
  }
  const score = join(dir, 'score.flac')
  if (!(await readFile(score).then(() => true, () => false))) {
    await run(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=f=220:d=12', score])
  }
  return { clips, score }
}

const { clips, score } = await media()
const L = Number(process.env.CLIP_FRAMES ?? 48)
// [clip, in-point in source frames at 24 fps]: trimmed like the user's (s4 from ~0.85 s), none on a
// keyframe, stored in µs the way a trim stores them (`framesToUs`). Three of them round *short*
// of their frame's timestamp (20/24 s is 833 333 µs) and two round long, so a seek that lands on
// the previous source frame shows up at some cuts and not others. The last is s5 again, twelve
// frames past where the one before it stops — a same-asset jump cut, the shape a transcript cut
// leaves, where one element has to move between two source times and nothing can be prerolled.
const PLACED = [[0, 7], [1, 12], [2, 10], [3, 20], [4, 14], [4, 14 + L + 12]]
const END = PLACED.length * L
const CUTS = PLACED.slice(1).map((_, n) => (n + 1) * L)
const JUMP = CUTS.at(-1)

const { send, evaluate, close } = await attach(Number(process.env.PORT ?? 9222))

await runProbe(async () => {
  const assets = await evaluate(`(async () => {
    const im = await window.bay.media.importPaths(${JSON.stringify(score ? [...clips, score] : clips)})
    return im.map((e) => e.asset)
  })()`, 120_000)
  if (assets.length < 5 || assets.slice(0, 5).some((a) => a.kind !== 'video' || a.error)) {
    throw new PreconditionError('five video clips did not import', JSON.stringify(assets.map((a) => [a.name, a.kind, a.error])))
  }

  // A click, so the AudioContext can leave `suspended` — the score plays as it does for the user.
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x: 5, y: 5, button: 'left', clickCount: 1 })
  }

  await evaluate(`(() => {
    const C = window.__cut = {}
    // A 12x21 thumbnail, box-averaged from 96x168. One drawImage straight to 12x21 samples a few
    // source pixels per cell, so the preview canvas and a reference of the same frame at another
    // size alias differently — measured at a distance of 11 between two correct pictures.
    const W = 12, H = 21, B = 8
    const mid = new OffscreenCanvas(W * B, H * B)
    const mx = mid.getContext('2d', { willReadFrequently: true })
    mx.imageSmoothingQuality = 'high'
    C.thumb = (source) => {
      mx.clearRect(0, 0, W * B, H * B)
      mx.drawImage(source, 0, 0, W * B, H * B)
      const d = mx.getImageData(0, 0, W * B, H * B).data
      const t = new Array(W * H * 3).fill(0)
      for (let y = 0; y < H * B; y++) for (let x = 0; x < W * B; x++) {
        const i = (y * W * B + x) * 4, j = (Math.floor(y / B) * W + Math.floor(x / B)) * 3
        t[j] += d[i]; t[j + 1] += d[i + 1]; t[j + 2] += d[i + 2]
      }
      return t.map((v) => v / (B * B))
    }
    C.mean = (t) => t.reduce((a, b) => a + b, 0) / t.length
    C.dist = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length }
    const assets = ${JSON.stringify(assets)}
    C.project = (graded) => {
      const st = window.bayEngine.store.getState()
      const base = st.project.timelines.find((t) => t.id === st.project.activeTimelineId)
      const grade = graded ? { gain: { r: 0.12, g: 0, b: -0.08 }, saturation: 1.2, vignette: { amount: 0.3 } } : null
      const items = ${JSON.stringify(PLACED)}.map(([clip, inFrame], n) => ({
        id: 'cut_i' + n, assetId: assets[clip].id, trackId: 'cut_v1', from: n * ${L}, durationInFrames: ${L},
        sourceStartUs: Math.round((inFrame / 24) * 1e6),
        layout: { left: 0, top: 0, width: 1080, height: 1920, opacity: 1, rotation: 0 },
        volume: 1, fadeInFrames: 0, fadeOutFrames: 0, speed: 1, ...(grade ? { grade } : {})
      }))
      const tracks = [{ id: 'cut_v1', kind: 'video', name: 'V1', locked: false, muted: false, hidden: false, items }]
      if (assets[5]) tracks.push({ id: 'cut_a1', kind: 'audio', name: 'A1', locked: false, muted: false, hidden: false,
        items: [{ id: 'cut_score', assetId: assets[5].id, trackId: 'cut_a1', from: 0, durationInFrames: ${END},
          sourceStartUs: 0, layout: { left: 0, top: 0, width: 1080, height: 1920, opacity: 1, rotation: 0 },
          volume: 0.5, fadeInFrames: 0, fadeOutFrames: 0, speed: 1 }] })
      const timeline = { ...base, width: 1080, height: 1920, fps: 24, background: '#000000', transitions: [], markers: [], tracks }
      return { ...st.project, assets, timelines: [timeline], activeTimelineId: timeline.id }
    }
    return true
  })()`)

  let failures = 0
  const verdict = (ok, label, detail = '') => {
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `  — ${detail}` : ''}`)
    if (!ok) failures += 1
  }

  // -- Which source frame is on screen at each cut --------------------------------------------
  //
  // The playthroughs below cannot see a one-frame shift: a playing element drifts by a frame or two
  // either way by design. The first picture of a clip can, because it is where a seek lands. So each
  // cut's incoming source frames N-1…N+2 are decoded here from a separate element at the *middle*
  // of each frame (unambiguous whatever the rounding), and the picture at the cut — paused, and
  // the first incoming picture while playing — is matched against them. N-1 is the previous source
  // frame: the trim asked for N and the viewer saw the frame it cut away.
  const sourceFrames = await evaluate(`(async () => {
    const C = window.__cut
    const pool = new window.bayEngine.MediaPool({ maxVideoElements: 8 })
    const assets = ${JSON.stringify(assets)}
    C.src = {}
    const spread = []
    try {
      for (const [n, [clip, inFrame]] of ${JSON.stringify(PLACED)}.entries()) {
        if (n === 0) continue
        const el = pool.acquire(assets[clip]).element
        if (el.readyState < 2) await new Promise((r) => el.addEventListener('loadeddata', r, { once: true }))
        C.src[n] = {}
        for (let f = inFrame - 1; f <= inFrame + 2; f++) {
          el.currentTime = (f + 0.5) / 24
          await new Promise((r) => el.addEventListener('seeked', r, { once: true }))
          // The decoded picture, not the one before it: wait for the frame to be presented.
          // A detached element may never present one, hence the bound.
          await new Promise((r) => { const t = setTimeout(r, 200); el.requestVideoFrameCallback?.(() => { clearTimeout(t); r() }) })
          C.src[n][f - inFrame] = C.thumb(el)
        }
        spread.push(+C.dist(C.src[n][-1], C.src[n][0]).toFixed(1))
      }
    } finally { pool.dispose() }
    // Which of N-1…N+2 a picture is, or null when the best match is not clearly the best.
    C.whichSource = (n, t) => {
      const d = [-1, 0, 1, 2].map((k) => [k, C.dist(t, C.src[n][k])]).sort((a, b) => a[1] - b[1])
      return d[0][1] < d[1][1] * 0.7 ? d[0][0] : null
    }
    return spread
  })()`, 120_000)
  console.log(`source frames decoded per cut; distance between frame N-1 and N: ${JSON.stringify(sourceFrames)}`)

  const paused = await evaluate(`(async () => {
    const C = window.__cut
    const { store } = window.bayEngine
    store.getState().setPlaying(false)
    store.getState().setProject(C.project(false))
    const canvas = document.querySelector('canvas')
    const out = []
    for (const [i, c] of ${JSON.stringify(CUTS)}.entries()) {
      store.getState().setPlayhead(c)
      // Settled when two samples 150 ms apart agree, after at least 400 ms.
      let prev = null, t = null
      const t0 = performance.now()
      for (;;) {
        await new Promise((r) => setTimeout(r, 150))
        t = C.thumb(canvas)
        if (prev && performance.now() - t0 > 400 && C.dist(prev, t) < 0.5) break
        if (performance.now() - t0 > 5000) break
        prev = t
      }
      out.push(C.whichSource(i + 1, t))
    }
    return out
  })()`, 120_000)
  console.log(`paused at each cut, the source frame shown (0 = the in-point): ${JSON.stringify(paused)}`)
  // The instrument can tell frames apart on this footage only if it named one at every cut.
  const pausedJudged = paused.every((k) => k !== null)
  if (pausedJudged) {
    verdict(paused.every((k) => k === 0), 'paused on a cut, the incoming clip shows its in-point frame',
      paused.map((k, i) => `@${CUTS[i]} ${k > 0 ? '+' : ''}${k}`).join(' '))
  } else {
    console.log('  --   this footage does not separate adjacent frames at every cut; the in-point frame is not judged')
  }

  for (const graded of [false, true]) {
    // The exact pictures: what every frame around every cut must look like.
    const refInfo = await evaluate(`(async () => {
      const C = window.__cut
      const project = C.project(${graded})
      C.refs = {}
      for (const c of ${JSON.stringify(CUTS)}) {
        // Further after the jump cut, whose one element may take most of a second to seek on a busy
        // machine: the window has to reach past the hold to see it land.
        for (let f = c - 8; f <= c + (c === ${JUMP} ? 30 : 14); f++) {
          const r = await window.bayEngine.renderFrame({ project, timelineId: project.activeTimelineId, frame: f, maxSize: 120 })
          if (r.pending) throw new Error('reference frame ' + f + ' incomplete: ' + r.unresolved.join(', '))
          const img = new Image(); img.src = r.dataUrl; await img.decode()
          C.refs[f] = C.thumb(img)
        }
      }
      // How far apart the two sides of each cut are, and how far one frame of motion moves.
      // One frame of motion, as the median over both sides of half the step across two frames. Not
      // one pair of neighbours: when a reference repeats a source frame (one frame in three rounds
      // short of its timestamp at 24 fps unless seeks are nudged past the edge) a neighbour pair
      // reads as no motion and the next as double, and either sets the threshold wrong.
      const within = (c) => {
        const steps = []
        for (let f = c - 8; f <= c - 3; f++) steps.push(C.dist(C.refs[f], C.refs[f + 2]) / 2)
        for (let f = c + 2; f <= c + 12; f++) steps.push(C.dist(C.refs[f], C.refs[f + 2]) / 2)
        steps.sort((a, b) => a - b)
        return steps[Math.floor(steps.length / 2)]
      }
      return ${JSON.stringify(CUTS)}.map((c) => ({ cut: c, across: C.dist(C.refs[c - 1], C.refs[c]),
        within: within(c),
        minMean: Math.min(...Object.values(C.refs).map(C.mean)) }))
    })()`, 180_000)

    // The threshold sits between one frame of motion and a change of clip; if the specimen does not
    // separate them, nothing below can tell a wrong picture from a right one.
    //
    // Per cut, because footage differs: a fast clip moves as much in one frame as a slow pair of
    // clips differs across a cut, so one global threshold either flags motion or passes a cut.
    const T = {}
    for (const r of refInfo) {
      T[r.cut] = Math.max(r.within * 2.5, 2)
      if (!(r.across > T[r.cut] * 1.4)) {
        throw new PreconditionError(`the specimen cannot tell the clips at frame ${r.cut} apart`,
          `one frame of motion moves ${r.within.toFixed(1)}, the cut ${r.across.toFixed(1)}`)
      }
    }

    // The classifier, proven on known answers before it judges anything.
    const control = await evaluate(`(() => {
      const C = window.__cut
      C.T = ${JSON.stringify(T)}
      C.cutOf = (ph) => ${JSON.stringify(CUTS)}.reduce((best, c) => Math.abs(c - ph) < Math.abs(best - ph) ? c : best)
      C.classify = (t, ph) => {
        const ref = C.refs[ph]
        if (!ref) return null
        if (C.mean(t) < 4 && C.mean(ref) > 10) return 'black'
        // The sampled playhead may lead the picture by a frame or two (the sample and the draw are
        // separate callbacks) and a repeated frame is a dropped frame, not a wrong one.
        let best = Infinity
        for (let k = -2; k <= 1; k++) if (C.refs[ph + k]) best = Math.min(best, C.dist(t, C.refs[ph + k]))
        return best <= C.T[C.cutOf(ph)] ? 'ok' : 'wrong'
      }
      const c = ${CUTS[2]}
      return {
        black: C.classify(new Array(C.refs[c].length).fill(0), c + 1),
        stale: C.classify(C.refs[c - 1], c + 5),
        exact: C.classify(C.refs[c + 3], c + 3)
      }
    })()`)
    const controlOk = control.black === 'black' && control.stale === 'wrong' && control.exact === 'ok'
    if (!controlOk) throw new PreconditionError('the classifier does not recognise its own controls', JSON.stringify(control))

    console.log('')
    console.log(`${graded ? 'GRADED' : 'UNGRADED'}  per cut: ` +
      refInfo.map((r) => `@${r.cut} threshold ${T[r.cut].toFixed(1)} (motion ${r.within.toFixed(1)}, cut ${r.across.toFixed(1)})`).join(', ') +
      `; classifier controls ${JSON.stringify(control)}`)

    for (const temperature of ['cold', 'warm']) {
      // A window hidden mid-run stops playback by design (`useEngine`'s visibility handler), which
      // says nothing about cuts. Such a playthrough is re-run rather than judged.
      let out
      for (let attempt = 1; attempt <= 3; attempt++) {
      out = await evaluate(`(async () => {
        const C = window.__cut
        const { store, engine } = window.bayEngine
        const project = C.project(${graded})
        store.getState().setPlaying(false)
        store.getState().setProject(project)
        if (${temperature === 'cold'}) {
          for (const a of project.assets) engine.pool.release(a.id)
          engine.compositor.reset()
        }
        store.getState().setPlayhead(0)
        // The first clip settles before play, so what is measured is the cuts, not the first load.
        await new Promise((r) => setTimeout(r, 900))
        const canvas = document.querySelector('canvas')
        const samples = []
        let live = true
        let hidden = 0
        const onVisibility = () => { if (document.visibilityState === 'hidden') hidden++ }
        document.addEventListener('visibilitychange', onVisibility)
        let lastPictures = engine.stats().pictures
        const tick = () => {
          if (!live) return
          const pictures = engine.stats().pictures
          if (pictures !== lastPictures) {
            lastPictures = pictures
            samples.push({ ph: store.getState().playhead, t: C.thumb(canvas) })
          }
          requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
        store.getState().setPlaying(true)
        const t0 = performance.now()
        while (store.getState().playhead < ${END - 3} && performance.now() - t0 < ${(END / 24) * 1000 + 6000}) {
          await new Promise((r) => setTimeout(r, 50))
        }
        live = false
        document.removeEventListener('visibilitychange', onVisibility)
        store.getState().setPlaying(false)
        const seconds = (performance.now() - t0) / 1000

        const cuts = ${JSON.stringify(CUTS)}.map((c) => {
          const tally = { cut: c, pictures: 0, black: [], wrong: [], held: [], firstIncomingAt: null, firstSource: undefined }
          for (const s of samples) {
            if (s.ph < c - 4 || s.ph > c + (c === ${JUMP} ? 28 : 12)) continue
            const kind = C.classify(s.t, s.ph)
            if (!kind) continue
            tally.pictures++
            // The outgoing clip's last picture still up after the cut: held, not black and not some
            // other wrong frame. Counted apart, because it is what the hold is for at a jump cut and
            // what must not happen at a prerolled one.
            const held = kind !== 'black' && s.ph >= c + 1 && C.dist(s.t, C.refs[c - 1]) <= C.T[c] &&
              C.dist(s.t, C.refs[c - 1]) < C.dist(s.t, C.refs[c])
            if (held) tally.held.push(s.ph - c)
            else if (kind === 'black') tally.black.push(s.ph - c)
            else if (kind === 'wrong') tally.wrong.push(s.ph - c)
            if (tally.firstIncomingAt === null && s.ph >= c && C.dist(s.t, C.refs[c]) <= C.T[c] * 2 &&
                C.dist(s.t, C.refs[c]) < C.dist(s.t, C.refs[c - 1])) {
              tally.firstIncomingAt = s.ph - c
              // Only ungraded: the source frames were decoded without the grade.
              if (!${graded}) tally.firstSource = C.whichSource(c / ${L}, s.t)
            }
          }
          return tally
        })
        // Mid-clip pictures, well away from any cut: the positive control that the sampler sees an
        // ordinary picture change and the classifier accepts it. Not after the jump cut, whose seek
        // may still be landing there on a busy machine — that is a result, not a broken instrument.
        let midOk = 0, midAll = 0
        for (const s of samples) {
          const c = ${JSON.stringify(CUTS.filter((c) => c !== JUMP))}.find((c) => s.ph >= c + 8 && s.ph <= c + 14)
          if (c === undefined) continue
          midAll++
          if (C.classify(s.t, s.ph) === 'ok') midOk++
        }
        const debug = ${!!process.env.DEBUG} ? samples.filter((s) => Math.abs(s.ph - C.cutOf(s.ph)) <= 12).map((s) => {
          let bestK = null, bestD = Infinity
          for (let k = -10; k <= 10; k++) { const r = C.refs[s.ph + k]; if (!r) continue; const d = C.dist(s.t, r); if (d < bestD) { bestD = d; bestK = k } }
          return [s.ph - C.cutOf(s.ph), bestK, +bestD.toFixed(1), +C.mean(s.t).toFixed(0)]
        }) : null
        const distinct = new Set(samples.map((s) => s.t.slice(0, 60).join(','))).size
        return { seconds: +seconds.toFixed(2), samples: samples.length, distinct, midOk, midAll, hidden,
                 lastPlayhead: samples.at(-1)?.ph ?? null, cuts, debug }
      })()`, 120_000)
      if (!(out.hidden > 0 && (out.lastPlayhead ?? 0) < END - 8)) break
      console.log(`  ${temperature}: the window was hidden mid-run and playback stopped at ${out.lastPlayhead}; re-running (${attempt}/3)`)
      }

      console.log(`  ${temperature}: ${out.samples} pictures in ${out.seconds}s (${out.distinct} distinct), ` +
        `mid-clip ${out.midOk}/${out.midAll} ok, last playhead ${out.lastPlayhead}`)
      if (out.debug) console.log(JSON.stringify(out.debug))
      for (const c of out.cuts) {
        console.log(`    ${c.cut === JUMP ? 'jump' : 'cut '} @${String(c.cut).padStart(3)}  pictures ${String(c.pictures).padStart(2)}  ` +
          `black ${c.black.length} ${c.black.length ? JSON.stringify(c.black) : ''}  ` +
          `wrong ${c.wrong.length} ${c.wrong.length ? JSON.stringify(c.wrong) : ''}  ` +
          `held ${c.held.length} ${c.held.length ? JSON.stringify(c.held) : ''}  ` +
          `incoming first seen at +${c.firstIncomingAt ?? '—'}` +
          (c.firstSource === undefined ? '' : `, source frame ${c.firstSource === null ? '?' : (c.firstSource > 0 ? '+' : '') + c.firstSource}`))
      }
      // Positive controls for this playthrough before any verdict about it.
      if (out.lastPlayhead === null || out.lastPlayhead < END - 8) {
        throw new PreconditionError(`${temperature} playthrough did not reach the last clip`, `last playhead ${out.lastPlayhead}`)
      }
      if (out.midAll < 8 || out.midOk < out.midAll * 0.9) {
        throw new PreconditionError('mid-clip pictures do not match their references',
          `${out.midOk}/${out.midAll} — the sampler or the references are wrong, so nothing at the cuts can be judged`)
      }
      const tag = `${graded ? 'graded' : 'ungraded'} ${temperature}`
      // Judged: the cuts between two takes — the reporter's case. The jump cut is reported and not
      // judged, because what it shows is how long one element takes to seek 74 frames past its
      // keyframe, and that is the machine's state rather than bay's: ~25 ms measured quiet, 0.5 s
      // to over a second with other processes holding the hardware decoder. What bay decides there
      // (hold rather than black, a seek left to land) is held by the unit tests.
      const judged = out.cuts.filter((c) => c.cut !== JUMP)
      const black = judged.reduce((n, c) => n + c.black.length, 0)
      const wrong = judged.reduce((n, c) => n + c.wrong.length, 0)
      verdict(black === 0, `${tag}: no black picture at any cut between two takes`, `${black} black`)
      verdict(wrong === 0, `${tag}: no wrong picture at any cut between two takes`, `${wrong} wrong`)
      // Between two assets the next clip is prerolled, so the cut is clean: the picture sampled at the
      // cut frame is already the incoming clip. Picture and playhead are read in one callback, so they
      // agree about which draw they describe; a repeated outgoing picture at the cut (the hold standing
      // in for a clip that was not ready) shows as +1 — measured +1 at every cut with the preroll
      // removed and the hold left in, +0 at every cut with it. A same-asset jump cannot be prerolled,
      // and holding the outgoing picture while its one element seeks is the intended behaviour there:
      // bounded, and never black.
      const clean = judged
      verdict(clean.every((c) => c.held.length === 0 && c.firstIncomingAt === 0),
        `${tag}: between two clips the incoming one is up on the cut frame, nothing held over`,
        clean.map((c) => `@${c.cut} +${c.firstIncomingAt ?? '—'} held ${c.held.length}`).join(' '))
      if (!graded && pausedJudged) {
        // The first picture of a clip is where its seek landed; the element may have moved on a
        // frame by the time it is sampled, but it can never legitimately be *before* the in-point.
        verdict(judged.every((c) => c.firstSource !== -1),
          `${tag}: no cut opens on the source frame before its in-point`,
          judged.map((c) => `@${c.cut} ${c.firstSource === null ? '?' : c.firstSource}`).join(' '))
      }
      const jump = out.cuts.find((c) => c.cut === JUMP)
      console.log(`  --   ${tag}: same-asset jump cut (reported, not judged): ` +
        `${jump.black.length} black, ${jump.held.length} held, landed at +${jump.firstIncomingAt ?? '— (not within 28 frames)'}`)
    }
  }

  console.log('')
  console.log(failures === 0 ? 'PASS  every cut plays straight from one clip to the next' : `FAIL  ${failures} check(s) failed`)
  close()
  return failures === 0
}, { timeoutMs: 900_000 })
