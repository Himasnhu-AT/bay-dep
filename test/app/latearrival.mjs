import { attach, CANVAS_PROFILE } from './cdp.mjs'
const CLIP = '/Users/himanshu/codes/synthai/vii/assets/podcast-cut/output/goodall-transcript-cut.mp4'

const { send: cdpSend, evaluate: ev, close: cdpClose } = await attach()

// Import once, before the reload, so the asset and its allowlist entry already exist.
const asset = await ev(`(async()=>{const i=await window.bay.media.importPaths([${JSON.stringify(CLIP)}]);return i[0].asset})()`)

// Reload: the engine now mounts against the empty placeholder project, exactly as it does
// at launch before project.initial() resolves.
await cdpSend('Page.reload', {})
await new Promise(r=>setTimeout(r,2500))
await ev(`(async()=>{for(let i=0;i<120;i++){if(window.bayEngine)return true;await new Promise(r=>setTimeout(r,250))}throw new Error('no engine after reload')})()`)

const beforeLoad = await ev(`(()=>{const{engine,store}=window.bayEngine;const st=store.getState();
 return{clockDurationType:typeof engine.clock.duration, clockDuration:engine.clock.duration,
  storeItems:st.project.timelines.flatMap(t=>t.tracks).flatMap(t=>t.items).length}})()`)
console.log('BEFORE project arrives:', JSON.stringify(beforeLoad))

// The late arrival: setProject, which is what project.initial() ultimately calls.
await ev(`(()=>{const{store}=window.bayEngine;const st=store.getState();
 const asset=${JSON.stringify(asset)};
 const tl=st.project.timelines[0];
 const project={...st.project, assets:[asset], timelines:[{...tl, tracks: tl.tracks.map(t=>
   t.kind==='video' ? {...t, items:[{id:'itm_seed',assetId:asset.id,trackId:t.id,from:0,durationInFrames:150,
     sourceStartUs:20000000,layout:{left:0,top:0,width:tl.width,height:tl.height,opacity:1,rotation:0},
     volume:1,fadeInFrames:0,fadeOutFrames:0,speed:1}]} : t)}]};
 store.getState().setProject(project);return true})()`)

// No forcing. Whatever happens naturally is the answer.
await new Promise(r=>setTimeout(r,2000))

const afterLoad = await ev(`(()=>{const{engine,store}=window.bayEngine;const st=store.getState();
 const canvas=document.querySelector('canvas');const ctx=canvas.getContext('2d',{willReadFrequently:true});
 const d=ctx.getImageData(0,0,canvas.width,canvas.height).data;let min=255,max=0;const seen=new Set();
 for(let i=0;i<d.length;i+=4*97){const y=(d[i]*299+d[i+1]*587+d[i+2]*114)/1000;if(y<min)min=y;if(y>max)max=y;seen.add(d[i]+','+d[i+1]+','+d[i+2])}
 return{visibility:document.visibilityState, clockDuration:engine.clock.duration,
  storeItems:st.project.timelines.flatMap(t=>t.tracks).flatMap(t=>t.items).length,
  domVideos:document.querySelectorAll('video').length,
  poolHasElement: !!(engine.pool.peek('${asset.id}')||{}).element,
  poolStatus:(engine.pool.peek('${asset.id}')||{}).status ?? 'no entry',
  luma:{min:Math.round(min),max:Math.round(max),distinct:seen.size},
  cornerPixel:[...ctx.getImageData(2,2,1,1).data],
  grid:[0.25,0.5,0.75].map(fy=>[0.25,0.5,0.75].map(fx=>{
    const d=ctx.getImageData(Math.floor(canvas.width*fx),Math.floor(canvas.height*fy),1,1).data;
    return d[0]+','+d[1]+','+d[2]}))}})()`)
console.log('AFTER  project arrives:', JSON.stringify(afterLoad))
cdpClose()
