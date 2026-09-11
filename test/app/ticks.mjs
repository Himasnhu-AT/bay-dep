import { attach, CANVAS_PROFILE } from './cdp.mjs'
const CLIP = '/Users/himanshu/codes/synthai/vii/assets/podcast-cut/output/goodall-transcript-cut.mp4'

const { send: cdpSend, evaluate: ev, close: cdpClose } = await attach()

const asset = await ev(`(async()=>{const i=await window.bay.media.importPaths([${JSON.stringify(CLIP)}]);return i[0].asset})()`)
await ev(`(()=>{const{store}=window.bayEngine;const st=store.getState();const asset=${JSON.stringify(asset)};
 const tl=st.project.timelines[0];
 store.getState().setProject({...st.project,assets:[asset],timelines:[{...tl,tracks:tl.tracks.map(t=>
  t.kind==='video'?{...t,items:[{id:'itm_seed',assetId:asset.id,trackId:t.id,from:0,durationInFrames:150,
  sourceStartUs:20000000,layout:{left:0,top:0,width:tl.width,height:tl.height,opacity:1,rotation:0},
  volume:1,fadeInFrames:0,fadeOutFrames:0,speed:1}]}:t)}]});return true})()`)
await new Promise(r=>setTimeout(r,1500))

const play = async (label) => {
  const out = await ev(`(async () => {
    const { engine, store } = window.bayEngine
    engine.clock.resetStats()
    store.getState().setPlaying(true)
    const started = { visibility: document.visibilityState, clockRunning: engine.clock.running, playing: store.getState().playing }
    await new Promise(r => setTimeout(r, 2000))
    const s = engine.stats()
    const end = { visibility: document.visibilityState, clockRunning: engine.clock.running,
                  playing: store.getState().playing, ticks: s.ticks, pictures: s.pictures, playhead: store.getState().playhead }
    store.getState().setPlaying(false)
    return { started, end }
  })()`)
  console.log(label, JSON.stringify(out))
}

await play('WITHOUT bringToFront :')
await new Promise(r=>setTimeout(r,500))
await play('WITH    bringToFront :')
cdpClose()
