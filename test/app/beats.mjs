/**
 * `detect_beats` end to end, and a real drag snapping to a beat.
 *
 *     BEATS_AUDIO=/path/to/music.wav BEATS_VIDEO=/path/to/shot.mp4 PORT=9222 node test/app/beats.mjs
 *
 * The music and the shot are named by the caller because no fixture in the repo carries music
 * with a beat; without them this exits 2. It imports both, places the music on A1 at frame 0 and
 * the shot on V1, runs `detect_beats` through the real executor (main decodes with ffmpeg and
 * analyses), places the downbeat markers it suggests with `add_marker`, and checks they reach the
 * ruler. Then it drags the shot by **dispatched PointerEvents** (agent-browser cannot drive this
 * drag) to 40% of the snap distance past a beat that is not a downbeat — so neither a marker nor a
 * clip edge is there to catch it — and checks it lands on the beat. The positive control for that
 * is the same drag with Cmd held, which suspends snapping: it must land where it was dropped,
 * a frame or more away. Everything is restored by `runProbe`; nothing is saved.
 */

import { attach, runProbe, check, PreconditionError } from './cdp.mjs'

const AUDIO = process.env.BEATS_AUDIO
const VIDEO = process.env.BEATS_VIDEO
if (!AUDIO || !VIDEO) {
  console.error('CANNOT MEASURE: set BEATS_AUDIO (music with a beat) and BEATS_VIDEO (any shot).')
  process.exit(2)
}

const { evaluate } = await attach()

await runProbe(async () => {
  const S = 'window.bayEngine.store.getState()'
  let n = 0
  const call = (tool, args = {}, timeout = 120_000) =>
    evaluate(`window.bayMcp.execute(${JSON.stringify({ id: `bt${++n}`, tool, args })})`, timeout)

  const imported = await call('import_media', { paths: [AUDIO, VIDEO] })
  if (!imported.ok) throw new PreconditionError('import_media failed', imported.error)
  const assets = await evaluate(`${S}.project.assets.map((a) => ({ id: a.id, path: a.path, kind: a.kind }))`)
  const song = assets.find((a) => a.path === AUDIO)
  const shot = assets.find((a) => a.path === VIDEO)
  if (!song || !shot) throw new PreconditionError('the imported assets are not in the project', JSON.stringify(assets))
  const tracks = await evaluate(`${S}.project.timelines[0].tracks.map((t) => ({ id: t.id, kind: t.kind }))`)
  const a1 = tracks.find((t) => t.kind === 'audio')?.id
  const v1 = tracks.find((t) => t.kind === 'video')?.id
  const placedSong = await call('place_asset', { assetId: song.id, atFrame: 0, trackId: a1 })
  const placedShot = await call('place_asset', { assetId: shot.id, atFrame: 30, trackId: v1 })
  if (!placedSong.ok || !placedShot.ok) throw new PreconditionError('place_asset failed', JSON.stringify([placedSong, placedShot]))
  const items = await evaluate(`${S}.project.timelines[0].tracks.flatMap((t) => t.items).map((i) => ({ id: i.id, assetId: i.assetId, from: i.from }))`)
  const songItem = items.find((i) => i.assetId === song.id)
  const shotItem = items.find((i) => i.assetId === shot.id)

  console.log('\n── detect_beats on the placed music')
  const started = Date.now()
  const detected = await call('detect_beats', { itemId: songItem.id, markers: 'downbeats' })
  check('it answers ok', detected.ok, true)
  const v = detected.value
  console.log(`     ${Date.now() - started} ms; bpm ${v.bpm}, confidence ${v.confidence}, ${v.beats.length} beats, ` +
    `${v.downbeats.length} downbeats (confidence ${v.downbeatConfidence}), dropouts ${JSON.stringify(v.dropouts)}`)
  console.log(`     first beats (frames): ${v.beats.slice(0, 8).join(', ')}`)
  check('a tempo', v.bpm, (b) => b > 40 && b < 250)
  check('beats in timeline frames, increasing', v.beats.every((f, i) => Number.isInteger(f) && (i === 0 || f > v.beats[i - 1])), true)
  check('the grid is kept on the asset', await evaluate(`${S}.project.assets.find((a) => a.id === ${JSON.stringify(song.id)}).beats?.bpm`), v.bpm)
  const again = Date.now()
  await call('detect_beats', { itemId: songItem.id })
  console.log(`     a second call took ${Date.now() - again} ms (the grid on the asset)`)

  console.log('\n── add_marker with the suggested markers')
  const past = await evaluate(`${S}.past.length`)
  // No downbeat was clear enough to suggest: the music given has no bar phase to find, which is
  // the caller's fixture, not a fault — there is nothing to place.
  if (!v.markers?.length) throw new PreconditionError('detect_beats suggested no downbeat markers for this music',
    `downbeat confidence ${v.downbeatConfidence}; set BEATS_AUDIO to music whose bar is clear`)
  const marked = await call('add_marker', { markers: v.markers })
  check('add_marker answers ok', marked.ok, true)
  check(`${v.markers.length} markers on the timeline`, await evaluate(`${S}.project.timelines[0].markers?.length ?? 0`), v.markers.length)
  check('in one undo step', await evaluate(`${S}.past.length`), past + 1)
  // Rendering: the ruler draws markers; wait a frame for React, then look for their labels.
  await evaluate('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))')
  const labelled = await evaluate(`(() => {
    const labels = ${JSON.stringify(v.markers.map((m) => m.label))}
    const text = document.body.innerHTML
    return labels.filter((l) => text.includes(l)).length
  })()`)
  console.log(`     ${labelled}/${v.markers.length} marker labels found in the page`)
  check('the markers reach the page', labelled, (c) => c > 0)

  console.log('\n── drag the shot near a beat (dispatched PointerEvents)')
  const ppfWas = await evaluate(`${S}.pixelsPerFrame`)
  await evaluate(`(${S}.setPixelsPerFrame(2), true)`)
  await evaluate('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))')
  try {
    const ppf = await evaluate(`${S}.pixelsPerFrame`)
    const downbeats = new Set(v.downbeats)
    const markerFrames = new Set(v.markers.map((m) => m.frame))
    const shotLength = await evaluate(`${S}.project.timelines[0].tracks.flatMap((t) => t.items).find((i) => i.id === ${JSON.stringify(shotItem.id)}).durationInFrames`)
    // A beat that is not a downbeat, clear of markers, with room, and whose own neighbourhood holds nothing else to snap to.
    const target = v.beats.find((f) => f > 60 && !downbeats.has(f) && [...markerFrames].every((m) => Math.abs(m - f) > 8) && f + shotLength < songItem.from + 5000)
    if (target === undefined) throw new PreconditionError('no beat clear of markers to drag to')
    const offset = (0.4 * 8) / ppf // 40% of the 8px snap distance, in frames
    console.log(`     pixelsPerFrame ${ppf}; target beat ${target}; drop at ${target + offset} (${offset.toFixed(2)} frames past it)`)

    const drag = (meta) => evaluate(`(async () => {
      const st = window.bayEngine.store
      const item = st.getState().project.timelines[0].tracks.flatMap((t) => t.items).find((i) => i.id === ${JSON.stringify(shotItem.id)})
      const el = [...document.querySelectorAll('[role=option]')].find((e) => e.getAttribute('aria-label') === ${JSON.stringify(shot.path.split('/').pop())})
      if (!el) return { error: 'no clip element' }
      const box = el.getBoundingClientRect()
      const x0 = box.left + 10, y = box.top + box.height / 2
      const dx = (${target + offset} - item.from) * st.getState().pixelsPerFrame
      const opts = (x, extra) => ({ bubbles: true, cancelable: true, composed: true, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1, clientX: x, clientY: y, metaKey: ${meta}, ...extra })
      // Cmd is pressed after the grab, as a person does it: held at pointerdown it is ⌘-click,
      // which toggles the clip in the selection and starts no drag (Timeline's clickMode).
      el.dispatchEvent(new PointerEvent('pointerdown', opts(x0, { metaKey: false })))
      for (let i = 1; i <= 10; i++) {
        el.dispatchEvent(new PointerEvent('pointermove', opts(x0 + (dx * i) / 10)))
        await new Promise((r) => requestAnimationFrame(r))
      }
      el.dispatchEvent(new PointerEvent('pointerup', opts(x0 + dx, { buttons: 0 })))
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      const after = st.getState().project.timelines[0].tracks.flatMap((t) => t.items).find((i) => i.id === ${JSON.stringify(shotItem.id)})
      return { from: after.from, past: st.getState().past.length }
    })()`)

    const snapped = await drag(false)
    console.log(`     dropped without Cmd: from = ${snapped.from}`)
    check('the drag moved the clip', snapped.from !== shotItem.from, true)
    check('and it snapped onto the beat', snapped.from, target)
    await evaluate(`(${S}.undo(), true)`)
    check('undo puts it back', await evaluate(`${S}.project.timelines[0].tracks.flatMap((t) => t.items).find((i) => i.id === ${JSON.stringify(shotItem.id)}).from`), shotItem.from)

    const free = await drag(true)
    console.log(`     dropped with Cmd (snapping off): from = ${free.from}`)
    check('with Cmd it lands where it was dropped, off the beat', free.from, Math.round(target + offset))
    check('which is not the beat — so the first drop was the snap, not the rounding', free.from !== target, true)
    await evaluate(`(${S}.undo(), true)`)
  } finally {
    await evaluate(`(${S}.setPixelsPerFrame(${ppfWas}), true)`)
  }
  return true
})
