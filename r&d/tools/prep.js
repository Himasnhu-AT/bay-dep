(()=>{document.body.style.zoom=String(innerWidth/1920);
const st=document.getElementById('film-css')||document.head.appendChild(Object.assign(document.createElement('style'),{id:'film-css'}));
st.textContent='*{scrollbar-width:none!important}';
const bar=document.querySelector('[aria-label="Jump to stage"]');if(bar)bar.closest('header').style.visibility='hidden';
for(const el of document.querySelectorAll('aside *')){const t=(el.textContent||'').trim();
 if(el.children.length===0&&(/^demo$/i.test(t)||t.startsWith('Demo —')||t==='Keyboard shortcuts'||t==='?'))(el.closest('button')||el).style.visibility='hidden'}
return 'ok'})()
