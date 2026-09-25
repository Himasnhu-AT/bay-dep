import { attach, CANVAS_PROFILE } from './cdp.mjs'
const CLIP = process.env.CLIP ?? `${process.cwd()}/assets/podcast-cut/output/goodall-transcript-cut.mp4`

const { send: cdpSend, evaluate: ev, close: cdpClose } = await attach()
const filePath = await ev(`window.bayEngine.store.getState().project.filePath`)

// bay reloads onto its projects screen, where there is no engine: reopen the project `attach()`
// had open (through `open_project`, as `attach()` does), then empty its timeline, so the engine is
// mounted and drawing an empty timeline before the clip arrives — the shape a late arrival needs.
const reopenAfterReload = async (ev, filePath) => ev(`(async()=>{
  for(let i=0;i<120&&!window.bayMcp&&!window.bayEngine;i++)await new Promise(r=>setTimeout(r,250))
  if(!window.bayEngine){
    const o=await window.bayMcp.execute({id:'reopen',tool:'open_project',args:{filePath:${JSON.stringify(filePath)}}})
    if(!o.ok)throw new Error(o.error)
    for(let i=0;i<120&&!window.bayEngine;i++)await new Promise(r=>setTimeout(r,250))
  }
  if(!window.bayEngine)throw new Error('no engine after reload')
  const{store}=window.bayEngine;const st=store.getState()
  store.getState().setProject({...st.project,timelines:st.project.timelines.map(t=>({...t,tracks:t.tracks.map(k=>({...k,items:[]}))}))})
  return true})()`, 45_000)

const asset = await ev(`(async()=>{const i=await window.bay.media.importPaths([${JSON.stringify(CLIP)}]);return i[0].asset})()`)
await cdpSend('Page.reload',{}); await new Promise(r=>setTimeout(r,2500))
await reopenAfterReload(ev, filePath)

// Late arrival, exactly as project.initial() does it.
await ev(`(()=>{const{store}=window.bayEngine;const st=store.getState();const asset=${JSON.stringify(asset)};
 const tl=st.project.timelines[0];
 store.getState().setProject({...st.project,assets:[asset],timelines:[{...tl,tracks:tl.tracks.map(t=>
  t.kind==='video'?{...t,items:[{id:'itm_seed',assetId:asset.id,trackId:t.id,from:0,durationInFrames:150,
  sourceStartUs:20000000,layout:{left:0,top:0,width:tl.width,height:tl.height,opacity:1,rotation:0},
  volume:1,fadeInFrames:0,fadeOutFrames:0,speed:1}]}:t)}]});return true})()`)
await new Promise(r=>setTimeout(r,2000))

// The lead's probe: paint every canvas green, force a redraw, see which stops being green.
const which = await ev(`(async () => {
  const { engine } = window.bayEngine
  const all = [...document.querySelectorAll('canvas')]
  const describe = (c, i) => {
    const r = c.getBoundingClientRect()
    return { i, w: c.width, h: c.height, cssW: Math.round(r.width), cssH: Math.round(r.height),
             connected: c.isConnected, cls: (c.className||'').slice(0,30), label: c.getAttribute('aria-label') }
  }
  const before = all.map(describe)
  for (const c of all) { const x = c.getContext('2d'); x.save(); x.setTransform(1,0,0,1,0,0); x.fillStyle='#00FF00'; x.fillRect(0,0,c.width,c.height); x.restore() }
  const greenAt = (c) => { const d = c.getContext('2d',{willReadFrequently:true}).getImageData(0,0,1,1).data; return d[0]===0 && d[1]===255 && d[2]===0 }
  const greenBefore = all.map(greenAt)
  engine.redraw()
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
  const greenAfter = all.map(greenAt)
  const changed = all.map((_, i) => greenBefore[i] && !greenAfter[i])

  // And ask the engine directly which element it holds.
  const engineCanvas = engine.__canvas ?? null
  return {
    canvasCount: all.length,
    canvases: before,
    stoppedBeingGreen: changed.map((v,i)=>v?i:null).filter(v=>v!==null),
    statsSamples: engine.stats().samples,
    ticks: engine.stats().ticks,
    clockDuration: engine.clock.duration,
    engineCanvasIsInDocument: engineCanvas ? engineCanvas.isConnected : 'not exposed'
  }
})()`)
console.log(JSON.stringify(which, null, 1))

// The lead's own probe: does a background change in the store reach the visible canvas?
const magenta = await ev(`(async () => {
  const { store } = window.bayEngine
  const st = store.getState()
  const tl = st.project.timelines[0]
  // A new project identity, which is what any real edit produces.
  store.getState().setProject({ ...st.project, timelines: [{ ...tl, background: '#FF00FF' }] })
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
  const c = document.querySelector('canvas')
  const x = c.getContext('2d', { willReadFrequently: true })
  const corner = [...x.getImageData(2, 2, 1, 1).data]
  const mid = [...x.getImageData(Math.floor(c.width/2), Math.floor(c.height/2), 1, 1).data]
  return { backgroundInStore: store.getState().project.timelines[0].background, cornerPixel: corner, centrePixel: mid }
})()`)
console.log('MAGENTA ' + JSON.stringify(magenta))

const forensics = await ev(`(async () => {
  const { engine, store } = window.bayEngine
  const c = document.querySelector('canvas')
  const x = c.getContext('2d', { willReadFrequently: true })
  const px = () => [...x.getImageData(2, 2, 1, 1).data]

  const st = store.getState()
  const tl = st.project.timelines.find(t => t.id === st.project.activeTimelineId)
  const samplesBefore = engine.stats().samples

  // Ask for a natural draw and see whether one actually runs.
  engine.redraw()
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
  const afterNatural = { pixel: px(), samples: engine.stats().samples }

  // Now the same frame, composited synchronously with no scheduling in the path.
  const stats = engine.compositor.drawFrame(x, st.project, tl, store.getState().playhead, { mode: 'scrub' })
  const afterForced = { pixel: px(), drawStats: stats }

  return {
    activeTimelineIdInStore: st.project.activeTimelineId,
    timelineFoundById: !!tl,
    timelineBackground: tl ? tl.background : null,
    timelineCount: st.project.timelines.length,
    timelineIds: st.project.timelines.map(t => t.id),
    canvasBacking: [c.width, c.height],
    samplesBefore,
    afterNatural,
    afterForced
  }
})()`)
console.log('FORENSICS ' + JSON.stringify(forensics, null, 1))
cdpClose()
