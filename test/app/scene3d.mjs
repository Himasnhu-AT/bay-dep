/**
 * `<scene3d>` in `.brf`, measured in pixels through `renderFrame` — what `preview_frame` returns.
 *
 * What it proves, each beside the control that shows the instrument could see it:
 *
 * 1. **3D draws, inside its box and only there.** A red extruded "SOC 2" in a `<scene3d>` that
 *    covers the middle quarter of the frame lights red pixels inside that rectangle and none
 *    outside it. Negative control: the same module with the text at opacity 0 lights none — so
 *    the count is the text, not the background or a placeholder card (grey, never red).
 * 2. **The camera flies.** With the camera moving from z 20 to z 4, the red ink at frame 30 is
 *    much wider than at frame 0. Control: the same module with the camera held still inks the same
 *    width at both frames — so the difference is the camera, not noise between renders.
 * 3. **Nothing is pending or placeheld** once `renderFrame` settles, including the first frame,
 *    which is drawn while the lazily loaded three.js chunk arrives.
 * 4. **A font 3D text cannot extrude is refused by `write_brf`**, naming the built-in face.
 *    Positive control: the same module in the default font is accepted (1).
 * 5. **A lost GPU context is never a silent gap.** After `scene3dRuntime.forceContextLoss()`, the
 *    next frame is either drawn (the renderer rebuilt itself) or a placeholder whose reason names
 *    the lost context — never an empty frame reported as clean. The frame after that is drawn.
 *
 * It clears the timeline to measure (so nothing occludes the box); `runProbe` puts the project,
 * its undo history and the dirty flag back as it found them. Build first: `electron .` runs `out/`.
 */

import { attach, check, PreconditionError, runProbe } from './cdp.mjs'

const { evaluate } = await attach()

await runProbe(async () => {
  let seq = 0
  const call = (tool, args = {}) => evaluate(`window.bayMcp.execute(${JSON.stringify({ id: `s3d${++seq}`, tool, args })})`, 90_000)
  const catalog = await evaluate(`window.bayMcp.tools.map((t) => t.name)`)
  if (!catalog.includes('write_brf')) throw new PreconditionError('write_brf is not in this build', 'run pnpm build and restart')
  if (!(await evaluate(`Boolean(window.bayEngine?.scene3dRuntime)`))) {
    throw new PreconditionError('this build has no scene3dRuntime', 'the app is running a build from before <scene3d>: pnpm build, then restart it')
  }

  const items = await evaluate(`(() => {
    const s = window.bayEngine.store.getState()
    const tl = s.project.timelines.find((t) => t.id === s.project.activeTimelineId)
    return tl.tracks.flatMap((t) => t.items.map((i) => i.id))
  })()`)
  if (items.length > 0) {
    const cleared = await call('delete_items', { itemIds: items })
    if (!cleared.ok) throw new PreconditionError('could not clear the timeline', cleared.error)
  }

  /** A module: red "SOC 2" in a scene3d over the middle quarter of the frame. */
  const module = ({ moving = true, opacity = 1, font } = {}) => `
    import { interpolate } from 'bay'
    export default ({ t }) => (
      <scene duration={2}>
        <scene3d x="50%" y="50%" w="50%" h="50%"
          camera={{ position: [0, 0, ${moving ? 'interpolate(t, [0, 1], [20, 4])' : '12'}], lookAt: [0, 0, 0], fov: 40 }}>
          <text3d size={1} depth={0.3} weight={900}${font ? ` font=${JSON.stringify(font)}` : ''}
            color="#FF2A55" emissive="#FF2A55" emissiveIntensity={0.6} metalness={0} roughness={0.6} opacity={${opacity}}>SOC 2</text3d>
        </scene3d>
      </scene>
    )`

  /** Red ink in and out of the scene3d's rectangle, and its width inside, from `renderFrame`. */
  const measure = (frame) =>
    evaluate(`(async () => {
      const st = window.bayEngine.store.getState()
      const r = await window.bayEngine.renderFrame({ project: st.project, timelineId: st.project.activeTimelineId, frame: ${frame} })
      const img = new Image(); img.src = r.dataUrl; await img.decode()
      const w = img.naturalWidth, h = img.naturalHeight
      const c = document.createElement('canvas'); c.width = w; c.height = h
      const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0)
      const d = x.getImageData(0, 0, w, h).data
      const box = { l: w / 4, t: h / 4, r: (3 * w) / 4, b: (3 * h) / 4 }
      let inside = 0, outside = 0, min = w, max = -1
      for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
        const i = (py * w + px) * 4
        const red = d[i] > 110 && d[i] - d[i + 1] > 60 && d[i] - d[i + 2] > 30
        if (!red) continue
        // One pixel of slack at the box edge for antialiasing across the boundary.
        if (px >= box.l - 1 && px <= box.r + 1 && py >= box.t - 1 && py <= box.b + 1) {
          inside++
          if (px < min) min = px
          if (px > max) max = px
        } else outside++
      }
      return { inside, outside, ink: max < 0 ? 0 : (max - min + 1) / w, width: w, pending: r.pending, placeholders: r.placeholders, unresolved: r.unresolved }
    })()`, 90_000)

  const place = async (code, name) => {
    const written = await call('write_brf', { code, atFrame: 0, name })
    if (!written.ok) throw new PreconditionError(`write_brf refused "${name}"`, written.error)
    return written.value.itemId
  }
  const remove = (itemId) => call('delete_items', { itemIds: [itemId] })
  const log = (label, r) =>
    console.log(`    ${label.padEnd(30)} red in ${String(r.inside).padStart(6)}  out ${r.outside}  ink ${(r.ink * 100).toFixed(1)}%  pending ${r.pending}  placeholders ${r.placeholders}${r.unresolved.length ? `  (${r.unresolved.join('; ')})` : ''}`)

  // -- 4: the refusal, beside its positive control (which is 1's module) ----------------------------
  const refused = await call('write_brf', { code: module({ font: 'No Such Font 3D' }) })
  check(
    'a font 3D text cannot extrude is refused, naming the built-in face',
    !refused.ok && /3D text cannot be drawn: font "No Such Font 3D" is not a font 3D text can extrude/.test(refused.error) && /"Inter" \(built in\)/.test(refused.error),
    true
  )

  // -- 1 and 3: drawn, inside its box, nothing pending ----------------------------------------------
  const flying = await place(module(), 'scene3d probe, flying')
  const at0 = await measure(0)
  log('flying camera, frame 0', at0)
  const at30 = await measure(30)
  log('flying camera, frame 30', at30)
  check('frame 0: nothing pending or placeheld (the three.js chunk loaded and was waited for)', at0.pending === 0 && at0.placeholders === 0, true)
  check('frame 30: nothing pending or placeheld', at30.pending === 0 && at30.placeholders === 0, true)
  check('the 3D text lights red pixels inside its box', at30.inside, (n) => n > 500)
  check('and none outside it', at30.outside, 0)

  // -- 2: the camera flies --------------------------------------------------------------------------
  check('the camera flies: the text inks at least twice as wide at frame 30 (z 4) as at frame 0 (z 20)', at0.ink > 0 ? at30.ink / at0.ink : 0, (r) => r > 2)
  await remove(flying)

  const still = await place(module({ moving: false }), 'scene3d probe, still')
  const still0 = await measure(0)
  const still30 = await measure(30)
  log('still camera, frame 0', still0)
  log('still camera, frame 30', still30)
  check('control: a still camera inks the same width at frames 0 and 30 (within 2px)', Math.abs(still30.ink - still0.ink) * still0.width, (px) => px <= 2)
  check('control: and it is drawn at all', still0.inside, (n) => n > 500)
  await remove(still)

  // -- 1's negative control: nothing to draw, nothing counted ---------------------------------------
  const hidden = await place(module({ opacity: 0 }), 'scene3d probe, hidden')
  const none = await measure(30)
  log('text at opacity 0', none)
  check('negative control: with the text at opacity 0 the instrument counts no red', none.inside + none.outside, 0)
  check('negative control: and that frame is clean, not a placeholder', none.pending === 0 && none.placeholders === 0, true)
  await remove(hidden)

  // -- 5: a lost context --------------------------------------------------------------------------
  const lossy = await place(module({ moving: false }), 'scene3d probe, context loss')
  const before = await measure(0)
  await evaluate(`(() => { window.bayEngine.scene3dRuntime.forceContextLoss(); return true })()`)
  const lost = await measure(0)
  log('after forceContextLoss', lost)
  const reported = lost.placeholders > 0 && lost.unresolved.some((u) => /3D drawing context was lost/.test(u))
  const redrawn = lost.inside > 500 && lost.placeholders === 0
  check('the frame after a lost context is drawn or reported — never an empty frame passed as clean', reported || redrawn, true)
  const after = await measure(0)
  log('the frame after that', after)
  check('and the next frame draws again, as before the loss (within 2px)', after.placeholders === 0 && Math.abs(after.ink - before.ink) * after.width <= 2 && after.inside > 500, true)
  await remove(lossy)

  return true
})
