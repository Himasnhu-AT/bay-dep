# Motion design: a film as a program

Read this before a launch film, a promo, a title sequence or any piece that must feel designed
rather than edited. It is how the good ones are built: the launch spot this project keeps pointing
at, and two reels a model wrote from a one-line prompt. Every frame is **drawn by code as a
function of time**. None of them is screen recordings with captions laid on top.

## The rules that make it look designed

1. **One program, one canvas.** Write one composition whose `time(t)` redraws a single
   `<canvas>`. Scenes are pure functions of time (`scene(c, t, local)`): no state, no timers,
   no `Math.random()` (use `hash(i)`). So any frame renders on its own, which is what export
   needs.
2. **A protagonist.** Pick one element the eye follows through the whole film, such as a dot, a
   capsule or the product's own shape. Every scene is born from the last one's protagonist and
   hands it on: the dot becomes the "i"'s dot, the dot becomes a toggle knob, the toggle becomes a
   progress pill, the pill collapses to a line, the line becomes a chart's baseline. Start from
   it and end on it.
3. **Morph or match-cut; never fade.** A line thickens into a pill that grows to fill the frame
   with the next scene's colour. A "1" becomes an I-bar. The "O" of a word becomes a disc that
   holds the next scene. A word squashes to a line, then a dash, then a dot. A whip-pan (fast
   slide plus motion blur) lands on the next scene. Cuts on bar lines are fine when both sides
   are in motion.
4. **Redraw the product's UI in code**, simplified but exact in proportion, from screenshots or
   recordings you have looked at with frame_grid. Only drawn UI can be choreographed: cards spring
   in one after another, the cursor whips to a control and presses it (a ring pulses), and
   *because of that press* a number counts up (`tnum`, so digits don't jitter), a gauge fills,
   bars grow, "Rendering" becomes "Done ✓". **Every state change has an on-screen cause.**
5. **At least one transition carries meaning:** before becoming after, a count, cause and effect
   (bars labelled *velocity* re-flow into the S-curve of *position*).
6. **Type is an actor.**
   - Techniques: masked word rise; `scramble` decode; letters flying in along an arc; a word
     rolling up into the next through a mask; hard entrances with motion-blur echoes; an
     underline that draws under the landed word.
   - Sizes: extreme contrast, from full-frame statements down to tiny mono labels.
   - Two voices: a heavy sans for statements, a serif italic for the human line.
7. **Colour discipline.** One accent colour. Either a new flat background per beat (one ink on
   each) or one base with the accent. Never gradients for their own sake.
8. **Depth once or twice,** in code: a particle sphere that becomes a word, bars that extrude
   into a field of boxes as the camera tilts, cards that tilt apart in 3D on exit.
9. **Rhythm.**
   - Pace: a technique per beat or bar, a faster montage near the end, and a hook that lands
     inside the first second.
   - End: a clean end frame (name, one sans line, one serif-italic line) that holds 2–3 s.
   - Sound: place the sound effects on the timeline at the frames your code says things happen.
10. **Chrome (optional) ties it together:** corner brackets, tiny mono metadata, a timecode, a
    section label ("03 / THE HALO"), and a tick ruler that fills as the film plays.
11. **Motion blur.** Render each frame as 4 sub-frames across a half-frame shutter and average
    them (the kit does it). Fast moves then smear the way a camera sees them.
12. **Iterate.** Write it, `preview_frame` five or six moments, `frame_grid` the whole piece,
    look hard, and fix. Do several passes before you export. List what each pass changed.

## The kit

Paste it into the composition's `<script>` and build scenes from it. Curves and the spring are
the ones this project uses everywhere:
- `rise`: masked reveals.
- `whip`: exits and slides.
- `blur`: focus-in.
- `SPRING`: stiffness 420, damping 32, for anything that pops.

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <title>Motion kit</title>
    <style>
      body { margin: 0; background: #f5f5f7; }
      #root { position: relative; width: 1920px; height: 1080px; overflow: hidden; }
      .clip { position: absolute; inset: 0; }
      canvas { width: 1920px; height: 1080px; display: block; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-width="1920" data-height="1080" data-duration="6">
      <section id="stage" class="clip" data-start="0" data-duration="6">
        <canvas id="c" width="1920" height="1080"></canvas>
      </section>
    </div>
    <script>
      // ---- clock and tokens --------------------------------------------------------------
      const W = 1920, H = 1080, DUR = 6, BPM = 120, BT = 60 / BPM, BAR = 4 * BT;
      const T = { paper: '#ffffff', mist: '#f5f5f7', ink: '#1d1d1f', ink3: '#6e6e73', hair: 'rgba(0,0,0,.09)', accent: '#007aff' };
      const SANS = 'Inter, system-ui, sans-serif', SERIF = 'Georgia, serif', MONO = 'ui-monospace, Menlo, monospace';

      // ---- maths ---------------------------------------------------------------------------
      const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
      const lerp = (a, b, t) => a + (b - a) * t;
      const P = (t, a, b) => clamp((t - a) / (b - a)); // 0 before a, 1 after b
      const hash = (i) => { const s = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return s - Math.floor(s); };
      function bezier(x1, y1, x2, y2) {
        const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx, cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
        const sx = (t) => ((ax * t + bx) * t + cx) * t, sy = (t) => ((ay * t + by) * t + cy) * t, dx = (t) => (3 * ax * t + 2 * bx) * t + cx;
        return (x) => { if (x <= 0) return 0; if (x >= 1) return 1; let t = x; for (let i = 0; i < 8; i++) { const d = sx(t) - x, dd = dx(t); if (Math.abs(d) < 1e-6 || !dd) break; t -= d / dd; } return sy(clamp(t)); };
      }
      const EZ = { rise: bezier(0.165, 0.84, 0.44, 1), whip: bezier(0.72, 0, 0.18, 1), blur: bezier(0.25, 0.46, 0.45, 0.94) };
      const SPRING = (() => { const w = Math.sqrt(420), z = 32 / (2 * w), wd = w * Math.sqrt(1 - z * z);
        return (t) => (t <= 0 ? 0 : 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + ((z * w) / wd) * Math.sin(wd * t))); })();
      const beatK = (t) => (t < 0 ? 0 : Math.exp(-(t % BT) * 10)); // a pulse on every beat

      // ---- drawing helpers -----------------------------------------------------------------
      const rr = (c, x, y, w, h, r) => { c.beginPath(); c.roundRect(x, y, w, h, r); };
      function text(c, s, x, y, font, col, o = {}) {
        c.font = font; c.fillStyle = col; c.textAlign = o.align || 'left'; c.textBaseline = 'alphabetic';
        c.letterSpacing = o.ls || '0px'; c.fillText(s, x, y); c.letterSpacing = '0px';
      }
      // Masked word-by-word rise, optional whip exit at `out`. Returns the line width.
      function words(c, str, x, y, size, t, t0, o = {}) {
        const font = `${o.w || 600} ${size}px ${o.family || SANS}`, ls = `${-(o.track ?? 0.04) * size}px`, st = o.st ?? 0.05;
        c.font = font; c.letterSpacing = ls;
        const ws = str.split(' '), sp = c.measureText(' ').width, wl = ws.map((w) => c.measureText(w).width);
        const tot = wl.reduce((a, b) => a + b, 0) + sp * (ws.length - 1);
        let cx = o.align === 'center' ? x - tot / 2 : o.align === 'right' ? x - tot : x;
        ws.forEach((w, i) => {
          const p = EZ.rise(P(t, t0 + i * st, t0 + i * st + (o.d || 0.55)));
          const q = o.out != null ? EZ.whip(P(t, o.out + i * st * 0.5, o.out + i * st * 0.5 + 0.25)) : 0;
          if (p > 0 && q < 1) {
            c.save(); c.beginPath(); c.rect(cx - size, y - size * 1.05, wl[i] + size * 2, size * 1.32); c.clip();
            c.font = font; c.letterSpacing = ls; c.fillStyle = (o.colors && o.colors[i]) || o.color || T.ink; c.textAlign = 'left';
            c.fillText(w, cx, y + (1 - p) * size * 1.1 - q * size * 1.2); c.restore();
          }
          cx += wl[i] + sp;
        });
        c.letterSpacing = '0px'; return tot;
      }
      // Scramble decode: random glyphs settle left to right into `str` between t0 and t0 + d.
      function scramble(c, str, x, y, font, col, t, t0, d = 0.6, o = {}) {
        const G = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#%&*', n = str.length, step = Math.floor(t * 30);
        let s = '';
        for (let i = 0; i < n; i++) {
          const settle = t0 + (i / n) * d;
          s += t >= settle || str[i] === ' ' ? str[i] : t < t0 - 0.05 ? ' ' : G[Math.floor(hash(i * 31 + step) * G.length)];
        }
        text(c, s, x, y, font, col, o);
      }
      // Pop in with the one spring, scaling from 0.94 about (ox, oy).
      function springIn(c, t, t0, ox, oy, draw) {
        if (t <= t0) return; const s = SPRING(t - t0);
        c.save(); c.globalAlpha *= clamp(s * 1.4); c.translate(ox, oy + (1 - clamp(s)) * 16);
        c.scale(0.94 + 0.06 * s, 0.94 + 0.06 * s); c.translate(-ox, -oy); draw(); c.restore();
      }
      // Tabular numbers: every digit gets the widest digit's cell, so a count-up does not jitter.
      function tnum(c, s, x, y, font, col, o = {}) {
        c.font = font; c.fillStyle = col; c.textBaseline = 'alphabetic';
        const cell = Math.max(...'0123456789'.split('').map((d) => c.measureText(d).width));
        const adv = (ch) => (/\d/.test(ch) ? cell : c.measureText(ch).width), total = [...s].reduce((a, ch) => a + adv(ch), 0);
        let cx = o.align === 'right' ? x - total : o.align === 'center' ? x - total / 2 : x;
        for (const ch of s) { const a = adv(ch); c.textAlign = /\d/.test(ch) ? 'center' : 'left'; c.fillText(ch, /\d/.test(ch) ? cx + a / 2 : cx, y); cx += a; }
        c.textAlign = 'left';
      }
      // A morphing rounded rect: dot → capsule → panel. Interpolate every field of two boxes.
      const morphBox = (a, b, p) => ({ x: lerp(a.x, b.x, p), y: lerp(a.y, b.y, p), w: lerp(a.w, b.w, p), h: lerp(a.h, b.h, p), r: lerp(a.r, b.r, p) });
      // A cursor that presses (press 0..1) and the ring a press leaves behind.
      function cursor(c, x, y, press = 0) {
        c.save(); c.translate(x, y); c.scale(1 - press * 0.12, 1 - press * 0.12);
        c.fillStyle = '#fff'; c.strokeStyle = T.ink; c.lineWidth = 2; c.lineJoin = 'round';
        c.beginPath(); c.moveTo(0, 0); c.lineTo(0, 32); c.lineTo(8, 24); c.lineTo(14, 37); c.lineTo(20, 34); c.lineTo(14, 21); c.lineTo(25, 21); c.closePath(); c.fill(); c.stroke(); c.restore();
      }
      function tap(c, x, y, t, t0) {
        const d = t - t0; if (d < 0 || d > 0.5) return; const p = d / 0.5;
        c.save(); c.strokeStyle = T.accent; c.globalAlpha = 0.6 * (1 - p); c.lineWidth = 3;
        c.beginPath(); c.arc(x, y, 12 + p * 40, 0, Math.PI * 2); c.stroke(); c.restore();
      }

      // ---- scenes: pure functions of time -------------------------------------------------
      // A protagonist dot is born, stretches into a capsule, then words rise beside it.
      function sHook(c, t, lt) {
        c.fillStyle = T.mist; c.fillRect(0, 0, W, H);
        const grow = SPRING(lt - 0.1), stretch = EZ.whip(P(lt, 0.8, 1.4));
        const dot = { x: 960 - 12, y: 520 - 12, w: 24, h: 24, r: 12 }, cap = { x: 760, y: 500, w: 400, h: 64, r: 32 };
        const b = morphBox(dot, cap, stretch), s = clamp(grow);
        c.save(); c.translate(960, 532); c.scale(s, s); c.translate(-960, -532);
        c.fillStyle = T.ink; rr(c, b.x, b.y, b.w, b.h, b.r); c.fill(); c.restore();
        words(c, 'Designed, not edited.', 960, 700, 96, lt, 1.5, { align: 'center' });
        scramble(c, '01 / THE HOOK', 96, 80, `500 18px ${MONO}`, T.ink3, lt, 0.3);
      }
      const SCENES = [[0, sHook]];
      const sceneAt = (t) => { let i = SCENES.length - 1; while (i > 0 && t < SCENES[i][0]) i--; return i; };
      function drawScene(c, t) {
        const [s0, f] = SCENES[sceneAt(t)];
        c.save(); c.globalAlpha = 1; c.filter = 'none'; f(c, t, t - s0); c.restore();
      }

      // ---- frame: 4 sub-frames over a half-frame shutter, averaged (motion blur) ----------
      const view = document.getElementById('c'), out = view.getContext('2d');
      const scratch = document.createElement('canvas'); scratch.width = W; scratch.height = H;
      const sc = scratch.getContext('2d');
      const FPS = 30, SUB = 4;
      function time(t) {
        const shutter = 0.5 / FPS;
        for (let s = 0; s < SUB; s++) {
          let ts = t + shutter * (s / SUB - 0.5); if (sceneAt(ts) !== sceneAt(t)) ts = t;
          drawScene(sc, Math.max(0, ts)); out.globalAlpha = 1 / (s + 1); out.drawImage(scratch, 0, 0);
        }
        out.globalAlpha = 1;
      }
      time(0);
      window.__timelines['main'] = { time, duration: () => DUR };
    </script>
  </body>
</html>
```

## Checklist before export

- **Continuity:** is there one protagonist, and does every scene start from the last one's end
  state?
- **Transitions:** any fade is a failure. Replace it with a morph, a match cut, a whip or a cut
  on the beat with motion on both sides.
- **Cause and effect:** does every number, state and colour change have a visible cause?
- **Type:** one accent, two voices, and no text over busy picture.
- **Motion:** is something moving in every frame? Does the end frame hold still and clean for
  2–3 s?
- **Sound:** sound effects placed on the timeline at the frames the code names (presses, pops,
  landings), under the music.
- **Look:** preview_frame at every scene boundary and mid-transition; frame_grid of the whole
  piece. Name what you fixed in each pass.
