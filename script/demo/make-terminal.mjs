/**
 * The Claude Code panel, generated from the real call log.
 *
 * Every line here is something that actually ran, at the second it ran — the log is written by
 * the driver, not typed afterwards. A terminal mocked up in After Effects would look the same
 * and mean nothing, so this is generated instead.
 *
 * Transparent, so it composites over the bay footage as a real overlay rather than a plate.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const log = JSON.parse(readFileSync('/tmp/calls.json', 'utf8'))
const OFFSET = 1.5 // the recorder started this far before the driver
const DURATION = 42

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const lines = log.map((e, i) => {
  const at = (e.at + OFFSET).toFixed(2)
  if (e.kind === 'head') {
    return { i, at, html: `<div class="l head" id="l${i}">${esc(e.text)}</div>` }
  }
  if (e.kind === 'result') {
    return { i, at, html: `<div class="l res" id="l${i}">${esc(e.text)}</div>` }
  }
  const [name, ...rest] = e.text.split(/\s{2,}/)
  return {
    i,
    at,
    html:
      `<div class="l" id="l${i}"><span class="dot">⏺</span>` +
      `<span class="fn">${esc(name)}</span>` +
      (rest.length ? `<span class="arg">${esc(rest.join(' '))}</span>` : '') +
      `</div>`
  }
})

const html = `<!doctype html>
<html><head><style>
  body { margin: 0 }
  #panel {
    position: absolute; left: 0; top: 0; width: 560px; height: 1080px;
    background: rgba(8,8,11,.94);
    border-right: 1px solid rgba(255,176,32,.28);
    padding: 34px 26px; box-sizing: border-box;
    font: 400 17px/1.62 ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
    color: #cfcfd6;
  }
  #hdr { display:flex; align-items:center; gap:10px; margin-bottom: 26px;
         font-size: 15px; color:#6f6f7d; letter-spacing:.06em; text-transform:uppercase }
  #hdr b { color:#ffb020; font-weight:600 }
  .l { opacity: 0; margin-bottom: 9px; white-space: nowrap;
       overflow: hidden; text-overflow: ellipsis }
  .dot { color:#ffb020; margin-right:10px }
  .fn { color:#f4f2ec }
  .arg { color:#74747f; margin-left:10px }
  .head { color:#ffb020; margin: 18px 0 13px; font-size: 16px;
          border-top:1px solid rgba(255,255,255,.08); padding-top: 20px }
  .res { color:#6fcf8e; margin-left: 22px; font-size: 15px }
  #cursor { display:inline-block; width:8px; height:17px; background:#ffb020;
            vertical-align:-3px; margin-left:4px }
</style></head><body>
<div data-composition-id="terminal" data-duration="${DURATION}"
     style="width:1920px;height:1080px;position:relative;background:transparent;overflow:hidden">
  <div id="panel">
    <div id="hdr"><b>claude code</b> → bay · mcp</div>
    ${lines.map((l) => l.html).join('\n    ')}
    <div class="l" id="cur" style="opacity:1"><span id="cursor"></span></div>
  </div>
</div>
<script>
  // No GSAP: the reveals are a plain function of time, which is all a seekable timeline needs
  // and one less thing to vendor.
  var STEPS = ${JSON.stringify(lines.map((l) => ({ id: `l${l.i}`, at: Number(l.at) })))};
  var reg = { time: 0 }
  function apply(t) {
    for (var i = 0; i < STEPS.length; i++) {
      var el = document.getElementById(STEPS[i].id)
      if (!el) continue
      var d = t - STEPS[i].at
      // A short fade-and-rise as each line lands, then it stays.
      if (d < 0) { el.style.opacity = 0; el.style.transform = 'translateY(6px)' }
      else {
        var k = Math.min(1, d / 0.28)
        el.style.opacity = String(k)
        el.style.transform = 'translateY(' + (6 - 6 * k) + 'px)'
      }
    }
    var cur = document.getElementById('cur')
    if (cur) cur.style.opacity = (Math.floor(t * 1.6) % 2) ? '0.25' : '1'
  }
  // The shape bay seeks: something with .time(seconds) that repaints.
  window.__timelines['terminal'] = {
    time: function (t) { if (t === undefined) return reg.time; reg.time = t; apply(t); return this },
    duration: function () { return ${DURATION} }
  }
  apply(0)
</script></body></html>`

writeFileSync('/tmp/bay-launch/terminal.html', html)
console.log(`terminal composition written: ${lines.length} lines, ${DURATION}s`)
