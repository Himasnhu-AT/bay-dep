"""
Generate HyperFrames compositions from the video's own transcript.

Nothing here is hand-timed. Every animation start is a word's start time out of
audio.json, so the graphics cannot drift from what is actually said — and if the
video is recut, regenerating is the whole fix.

Palette is the argument, not decoration: the video's two poles are overthinking
(bad) and thinking (good), so ALARM is used only for overload and CALM only for
deliberate thought.
"""
import json, html, textwrap, pathlib

OUT = pathlib.Path('e2e/comp'); OUT.mkdir(parents=True, exist_ok=True)
d = json.load(open('e2e/audio.json'))
WORDS = [w for s in d['segments'] for w in s.get('words', [])]
SEGS = d['segments']

W, H = 1080, 1920
# The subject sits centre-frame from roughly y=450 to y=1500 — face, glasses, hand and mic.
# Everything drawn between those lines covers the person talking, which is the one thing a
# piece-to-camera cannot afford to hide. So graphics live in the band above the head and
# captions in the band below the chin, and nothing crosses the middle. Measured off the
# rendered frames rather than assumed: the first cut put TOO MUCH INPUT across his eyes.
BAND_TOP = 120      # graphics start here
BAND_LIMIT = 430    # and must end by here
SCRIM = (
    '<div class="scrim" style="position:absolute;left:0;right:0;top:0;height:620px;opacity:0;'
    'background:linear-gradient(180deg,rgba(8,8,10,.86) 0%,rgba(8,8,10,.66) 52%,rgba(8,8,10,0) 100%)">'
    '</div>'
)
ALARM, CALM, INK = '#FF4D3D', '#7DD3FC', '#FFFFFF'
FONT = "-apple-system, 'Helvetica Neue', Helvetica, Arial, sans-serif"

def word_at(text, nth=0):
    """Start time of the nth occurrence of a word. Fails loudly: a caption synced to a
    word that is not in the transcript is a caption synced to nothing."""
    key = text.strip().lower().strip('.,?!')
    hits = [w for w in WORDS if w['word'].strip().lower().strip('.,?!') == key]
    if len(hits) <= nth:
        raise SystemExit(f'"{text}" occurrence {nth} is not in the transcript')
    return hits[nth]['start']

def doc(cid, dur, body, script, variables=None):
    varattr = ''
    if variables:
        varattr = " data-composition-variables='" + json.dumps(variables) + "'"
    return f"""<!doctype html>
<html{varattr}>
<head><meta charset="utf-8"><title>{cid}</title>
<style>
  html,body{{margin:0;padding:0;background:transparent}}
  .root{{position:relative;overflow:hidden;font-family:{FONT};-webkit-font-smoothing:antialiased}}
</style></head>
<body>
<div class="root" data-composition-id="{cid}" data-duration="{dur}" style="width:{W}px;height:{H}px">
{body}
</div>
<script>
(function(){{
  var DUR = {dur};
  function clamp(v,a,b){{return v<a?a:v>b?b:v}}
  function ease(t){{return 1-Math.pow(1-clamp(t,0,1),3)}}
  function easeIO(t){{t=clamp(t,0,1);return t<0.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2}}
{textwrap.indent(script, '  ')}
  at(0);
  window.__timelines['{cid}'] = {{ time: at, duration: function(){{return DUR}} }};
}})();
</script>
</body></html>
"""

# ─────────────────────────────────────────────────────────────────────────────
# 1. CAPTIONS — the whole video, word-synced, three words at a time
# ─────────────────────────────────────────────────────────────────────────────
chunks = []
for seg in SEGS:
    ws = seg.get('words', [])
    for i in range(0, len(ws), 3):
        group = ws[i:i + 3]
        if group:
            chunks.append({
                'start': round(group[0]['start'], 3),
                'end': round(group[-1]['end'], 3),
                'words': [{'t': html.escape(w['word'].strip()),
                           's': round(w['start'], 3),
                           'e': round(w['end'], 3)} for w in group],
            })
CAP_DUR = round(max(c['end'] for c in chunks) + 0.4, 2)

captions = doc('captions', CAP_DUR, f"""
  <div id="cap" style="position:absolute;left:60px;right:60px;bottom:250px;text-align:center;
       font-size:82px;font-weight:800;letter-spacing:-0.02em;line-height:1.12;
       text-shadow:0 6px 30px rgba(0,0,0,.75), 0 2px 6px rgba(0,0,0,.6)"></div>
""", f"""
var CHUNKS = {json.dumps(chunks, separators=(',', ':'))};
var cap = document.getElementById('cap');
var shown = -1;
function at(time) {{
  var idx = -1;
  for (var i = 0; i < CHUNKS.length; i++) {{
    // Held until the next chunk starts, so a caption never blinks out between words.
    var until = (i + 1 < CHUNKS.length) ? CHUNKS[i+1].start : CHUNKS[i].end + 0.35;
    if (time >= CHUNKS[i].start && time < until) {{ idx = i; break }}
  }}
  if (idx === -1) {{ cap.style.opacity = 0; shown = -1; return 0 }}
  if (idx !== shown) {{
    var c = CHUNKS[idx], out = '';
    for (var j = 0; j < c.words.length; j++) {{
      out += '<span data-s="' + c.words[j].s + '" data-e="' + c.words[j].e + '">' + c.words[j].t + '</span> ';
    }}
    cap.innerHTML = out; shown = idx;
  }}
  var c = CHUNKS[idx];
  // A short rise on entry, then the active word lifts. Both are functions of `time`
  // only — no state, so any frame can be rendered in any order.
  var inP = ease((time - c.start) / 0.18);
  cap.style.opacity = inP;
  cap.style.transform = 'translateY(' + ((1 - inP) * 26).toFixed(2) + 'px)';
  var spans = cap.children;
  for (var k = 0; k < spans.length; k++) {{
    var s = parseFloat(spans[k].getAttribute('data-s'));
    var e = parseFloat(spans[k].getAttribute('data-e'));
    var live = time >= s && time < e + 0.06;
    spans[k].style.color = live ? '{CALM}' : '{INK}';
    spans[k].style.display = 'inline-block';
    spans[k].style.transform = 'scale(' + (live ? 1.06 : 1) + ')';
  }}
  return time / DUR;
}}
""")
(OUT / 'captions.html').write_text(captions)

# ─────────────────────────────────────────────────────────────────────────────
# 2. HOOK — "overthinker" struck through, replaced by "not thinking enough"
# ─────────────────────────────────────────────────────────────────────────────
t_over, t_or, t_enough = word_at('overthinker'), word_at('or'), word_at('enough')
hook_dur = round(t_enough + 0.9, 2)
hook = doc('hook', hook_dur, f"""
  {SCRIM}
  <div style="position:absolute;left:0;right:0;top:{BAND_TOP}px;text-align:center">
    <div id="h1" style="display:inline-block;position:relative;color:{ALARM};font-size:104px;
         font-weight:900;letter-spacing:-0.03em;text-shadow:0 6px 30px rgba(0,0,0,.7)">
      OVERTHINKER
      <div id="strike" style="position:absolute;left:-8px;right:-8px;top:52%;height:10px;
           background:{ALARM};transform-origin:left center;transform:scaleX(0);border-radius:6px"></div>
    </div>
    <div id="h2" style="margin-top:22px;color:{INK};font-size:58px;font-weight:700;opacity:0;
         letter-spacing:-0.01em;text-shadow:0 4px 22px rgba(0,0,0,.7)">or not thinking&nbsp;enough?</div>
  </div>
""", f"""
var h1 = document.getElementById('h1'), h2 = document.getElementById('h2'),
    strike = document.getElementById('strike'), scrim = document.querySelector('.scrim');
var T_OVER = {t_over:.3f}, T_OR = {t_or:.3f};
function at(time) {{
  var inP = ease((time - T_OVER + 0.25) / 0.45);
  h1.style.opacity = inP;
  h1.style.transform = 'translateY(' + ((1 - inP) * -30).toFixed(2) + 'px)';
  // The strike lands on the word "or" — the moment the sentence turns on itself.
  strike.style.transform = 'scaleX(' + easeIO((time - T_OR) / 0.32).toFixed(4) + ')';
  var p2 = ease((time - T_OR - 0.18) / 0.4);
  h2.style.opacity = p2;
  h2.style.transform = 'translateY(' + ((1 - p2) * 18).toFixed(2) + 'px)';
  var out = time > DUR - 0.45 ? 1 - clamp((time - (DUR - 0.45)) / 0.45, 0, 1) : 1;
  if (scrim) scrim.style.opacity = (ease(time / 0.3) * out).toFixed(4);
  h1.parentNode.style.opacity = out;
  return time / DUR;
}}
""")
(OUT / 'hook.html').write_text(hook)

# ─────────────────────────────────────────────────────────────────────────────
# 3. EVERYONE — one chip per named group, each on its own word
# ─────────────────────────────────────────────────────────────────────────────
chips = [('you', word_at('you', 2)), ('your friend', word_at('friend')),
         ('the top person in your list', word_at('top')), ('everyone', word_at('everyone'))]
ev_start = chips[0][1] - 0.3
ev_dur = round(word_at('overthinker', 1) + 1.2 - ev_start, 2)
rows = '\n'.join(
    f'''    <div class="chip" data-at="{t - ev_start:.3f}" style="opacity:0;margin:0 0 12px 0;display:inline-block;
         background:rgba(10,10,12,.72);border:2px solid {ALARM};color:{INK};font-size:{38 if i < 3 else 54}px;
         font-weight:{700 if i < 3 else 900};padding:9px 22px;border-radius:14px;
         box-shadow:0 8px 30px rgba(0,0,0,.5)">{html.escape(label)}</div><br/>'''
    for i, (label, t) in enumerate(chips))
everyone = doc('everyone', ev_dur, f"""
  {SCRIM}
  <div style="position:absolute;left:60px;right:60px;top:{BAND_TOP}px;text-align:left">
{rows}
  </div>
""", """
var chips = document.querySelectorAll('.chip');
var scrim = document.querySelector('.scrim');
function at(time) {
  var live = ease(time / 0.35) * (time > DUR - 0.5 ? 1 - clamp((time - (DUR - 0.5)) / 0.5, 0, 1) : 1);
  if (scrim) scrim.style.opacity = live.toFixed(4);
  for (var i = 0; i < chips.length; i++) {
    var t0 = parseFloat(chips[i].getAttribute('data-at'));
    var p = ease((time - t0) / 0.34);
    var out = time > DUR - 0.5 ? 1 - clamp((time - (DUR - 0.5)) / 0.5, 0, 1) : 1;
    chips[i].style.opacity = (p * out).toFixed(4);
    chips[i].style.transform = 'translateX(' + ((1 - p) * -40).toFixed(2) + 'px)';
  }
  return time / DUR;
}
""")
(OUT / 'everyone.html').write_text(everyone)

# ─────────────────────────────────────────────────────────────────────────────
# 4. INPUT — the diagnosis, with a flood that overwhelms the frame
# ─────────────────────────────────────────────────────────────────────────────
t_input = word_at('input')
t_fast = word_at('fast')
in_dur = round(t_fast + 1.0 - (t_input - 0.5), 2)
bars = '\n'.join(
    f'    <div class="bar" data-i="{i}" style="position:absolute;left:{(i*37)%1040}px;top:0;width:10px;'
    f'height:{60+((i*53)%150)}px;background:{ALARM};opacity:.5;border-radius:5px"></div>'
    for i in range(28))
inputc = doc('input', in_dur, f"""
  {SCRIM}
  <!-- The flood is clipped to the band. Falling the full height put red streaks across his
       face, which read as a rendering glitch rather than as "too much coming in". -->
  <div id="flood" style="position:absolute;left:0;right:0;top:0;height:{BAND_LIMIT}px;overflow:hidden">
{bars}
  </div>
  <div id="imsg" style="position:absolute;left:60px;right:60px;top:{BAND_TOP}px;text-align:center;opacity:0">
    <div style="color:{ALARM};font-size:30px;font-weight:800;letter-spacing:.28em;
         text-shadow:0 2px 10px rgba(0,0,0,.9)">THE ANSWER</div>
    <div style="color:{INK};font-size:92px;font-weight:900;letter-spacing:-0.03em;line-height:1.0;
         margin-top:6px;text-shadow:0 8px 34px rgba(0,0,0,.85)">TOO MUCH<br/>INPUT</div>
  </div>
""", f"""
var bars = document.querySelectorAll('.bar'), msg = document.getElementById('imsg');
var scrim = document.querySelector('.scrim');
var T_IN = {t_input - (t_input - 0.5):.3f};
function at(time) {{
  for (var i = 0; i < bars.length; i++) {{
    var idx = parseFloat(bars[i].getAttribute('data-i'));
    // Staggered fall, deterministic from the index — no clock, no randomness.
    var p = clamp((time - 0.15 - idx * 0.035) / 1.1, 0, 1);
    bars[i].style.transform = 'translateY(' + (-220 + p * ({BAND_LIMIT} + 220)).toFixed(1) + 'px)';
    bars[i].style.opacity = (0.5 * (1 - p) + 0.05).toFixed(3);
  }}
  var p = ease((time - T_IN - 0.2) / 0.4);
  var out = time > DUR - 0.5 ? 1 - clamp((time - (DUR - 0.5)) / 0.5, 0, 1) : 1;
  if (scrim) scrim.style.opacity = (ease(time / 0.35) * out).toFixed(4);
  msg.style.opacity = (p * out).toFixed(4);
  msg.style.transform = 'scale(' + (0.9 + 0.1 * p).toFixed(4) + ')';
  return time / DUR;
}}
""")
(OUT / 'input.html').write_text(inputc)

# ─────────────────────────────────────────────────────────────────────────────
# 5. MODES — what the brain was built for, two labels on their own words
# ─────────────────────────────────────────────────────────────────────────────
t_crit, t_crea = word_at('critical'), word_at('creative')
md_start = t_crit - 0.4
md_dur = round(t_crea + 1.6 - md_start, 2)
modes = doc('modes', md_dur, f"""
  {SCRIM}
  <div style="position:absolute;left:60px;right:60px;top:{BAND_TOP}px;text-align:center">
    <div id="m1" style="opacity:0;color:{CALM};font-size:66px;font-weight:900;letter-spacing:-0.02em;
         text-shadow:0 6px 28px rgba(0,0,0,.85)">CRITICAL thinking</div>
    <div id="m2" style="opacity:0;margin-top:12px;color:{CALM};font-size:66px;font-weight:900;
         letter-spacing:-0.02em;text-shadow:0 6px 28px rgba(0,0,0,.85)">CREATIVE thinking</div>
  </div>
""", f"""
var m1 = document.getElementById('m1'), m2 = document.getElementById('m2');
var scrim = document.querySelector('.scrim');
var T1 = {t_crit - md_start:.3f}, T2 = {t_crea - md_start:.3f};
function at(time) {{
  var out = time > DUR - 0.6 ? 1 - clamp((time - (DUR - 0.6)) / 0.6, 0, 1) : 1;
  if (scrim) scrim.style.opacity = (ease(time / 0.35) * out).toFixed(4);
  [[m1, T1], [m2, T2]].forEach(function (pair) {{
    var p = ease((time - pair[1]) / 0.32);
    pair[0].style.opacity = (p * out).toFixed(4);
    pair[0].style.transform = 'translateX(' + ((1 - p) * 34).toFixed(2) + 'px)';
  }});
  return time / DUR;
}}
""")
(OUT / 'modes.html').write_text(modes)

# ─────────────────────────────────────────────────────────────────────────────
# 6. TURN — the closing choice, each side lit on the word that names it
# ─────────────────────────────────────────────────────────────────────────────
t_cons, t_think = word_at('consuming'), word_at('thinking', 5)
tn_start = t_cons - 1.4
tn_dur = round(CAP_DUR - tn_start, 2)
turn = doc('turn', tn_dur, f"""
  {SCRIM}
  <div style="position:absolute;left:60px;right:60px;top:{BAND_TOP}px">
    <div id="t1" style="opacity:.3;background:rgba(10,10,12,.8);border-left:8px solid {ALARM};
         color:{INK};font-size:50px;font-weight:800;padding:18px 24px;border-radius:12px;margin-bottom:16px">
      consuming too much?</div>
    <div id="t2" style="opacity:.3;background:rgba(10,10,12,.8);border-left:8px solid {CALM};
         color:{INK};font-size:50px;font-weight:800;padding:18px 24px;border-radius:12px">
      or thinking too much?</div>
  </div>
""", f"""
var t1 = document.getElementById('t1'), t2 = document.getElementById('t2');
var scrim = document.querySelector('.scrim');
var T1 = {t_cons - tn_start:.3f}, T2 = {t_think - tn_start:.3f};
function at(time) {{
  if (scrim) scrim.style.opacity = ease(time / 0.35).toFixed(4);
  // Both sides are present from the start, dim. Each brightens exactly as it is named, so
  // the frame poses the choice before the voice resolves it.
  function lit(el, t0) {{
    var p = ease((time - t0) / 0.3);
    el.style.opacity = (0.28 + 0.72 * p).toFixed(4);
    el.style.transform = 'translateX(' + (p * 16).toFixed(2) + 'px)';
  }}
  lit(t1, T1); lit(t2, T2);
  return time / DUR;
}}
""")
(OUT / 'turn.html').write_text(turn)

plan = [
    ('captions', 0.0, CAP_DUR),
    ('hook', 0.0, hook_dur),
    ('everyone', ev_start, ev_dur),
    ('input', t_input - 0.5, in_dur),
    ('modes', md_start, md_dur),
    ('turn', tn_start, tn_dur),
]
json.dump([{'id': i, 'start': round(s, 3), 'dur': round(dd, 3)} for i, s, dd in plan],
          open('e2e/comp/plan.json', 'w'), indent=2)
print(f'{len(chunks)} caption chunks from {len(WORDS)} words\n')
for i, s, dd in plan:
    print(f'  {i:10} {s:6.2f}s  +{dd:5.2f}s  -> frames {round(s*30):4d}..{round((s+dd)*30):4d}')
