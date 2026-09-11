import { attach, CANVAS_PROFILE } from './cdp.mjs'
const CLIP = '/Users/himanshu/codes/synthai/vii/assets/podcast-cut/output/goodall-transcript-cut.mp4'

const { send: cdpSend, evaluate: ev, close: cdpClose } = await attach()

const setup = await ev(`(async()=>{const{store}=window.bayEngine;
 const im=await window.bay.media.importPaths([${JSON.stringify(CLIP)}]);const a=im[0].asset;
 store.getState().addAssets([a]);const id=store.getState().placeAsset(a.id,0);
 return {assetId:a.id,itemId:id,w:a.width,h:a.height}})()`)
await new Promise(r=>setTimeout(r,2500))
const afterPlace = await ev(`(()=>{const{store}=window.bayEngine;const st=store.getState();
 const it=st.project.timelines[0].tracks.flatMap(t=>t.items)[0];
 return {layout:it?{L:it.layout.left,T:it.layout.top,W:it.layout.width,H:it.layout.height}:null, profile:${PROFILE}}})()`)
console.log('AFTER PLACE   ', JSON.stringify(afterPlace))

// (a) Layout change while VISIBLE must redraw.
await ev(`(()=>{const{store}=window.bayEngine;const st=store.getState();
 const it=st.project.timelines[0].tracks.flatMap(t=>t.items)[0];
 store.getState().patchLayout(it.id,{left:656,top:0,width:608,height:1080});return true})()`)
await new Promise(r=>setTimeout(r,1200))
const afterFitVisible = await ev(`(()=>({profile:${PROFILE}}))()`)
console.log('FIT (visible) ', JSON.stringify(afterFitVisible))

// (b) Layout change while HIDDEN must be caught up on restore.
await ev(`(()=>{const{store}=window.bayEngine;const st=store.getState();
 const it=st.project.timelines[0].tracks.flatMap(t=>t.items)[0];
 store.getState().patchLayout(it.id,{left:0,top:-1166,width:1920,height:3413});return true})()`)
await new Promise(r=>setTimeout(r,800))
await ev(`window.bay.window.minimise()`)
await new Promise(r=>setTimeout(r,1500))
const hidden = await ev(`(()=>({visibility:document.visibilityState}))()`)
await ev(`(()=>{const{store}=window.bayEngine;const st=store.getState();
 const it=st.project.timelines[0].tracks.flatMap(t=>t.items)[0];
 store.getState().patchLayout(it.id,{left:656,top:0,width:608,height:1080});return true})()`)
await new Promise(r=>setTimeout(r,1200))
console.log('WHILE HIDDEN  ', JSON.stringify(hidden))

await new Promise(r=>setTimeout(r,1800))
const afterRestore = await ev(`(()=>{const{store}=window.bayEngine;const st=store.getState();
 const it=st.project.timelines[0].tracks.flatMap(t=>t.items)[0];
 return {visibility:document.visibilityState, layout:{L:it.layout.left,W:it.layout.width,H:it.layout.height}, profile:${PROFILE}}})()`)
console.log('AFTER RESTORE ', JSON.stringify(afterRestore))
cdpClose()
