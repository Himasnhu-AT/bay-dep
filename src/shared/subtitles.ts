/**
 * Word-by-word subtitles as one HTML composition per clip, in a choice of designs.
 *
 * A caption track of text items can show a line; it cannot light up the word being spoken, which
 * is what short-form subtitles are. So a clip's subtitles are a composition: its words and their
 * times are baked into the document, and the page draws whichever group of words is on screen at
 * the moment it is seeked to, with the spoken word marked. One composition spans the clip, so
 * moving the clip moves its subtitles, and choosing another design replaces one file.
 *
 * Pure: the grouping and the document are built here and tested; main only writes the file.
 * The document follows bay's composition contract (`bay://guide/composition/contract`): a sized
 * root with `data-composition-id` and `data-duration`, deterministic, nothing from the network,
 * and a `window.__timelines[id]` whose `time(t)` draws moment `t`.
 */

/** A word, in seconds from the start of the clip the subtitles belong to. */
export interface SubtitleWord {
  start: number
  end: number
  text: string
}

/** Words shown together, and when. */
export interface SubtitleGroup {
  start: number
  /** When the group leaves: its last word's end, held briefly unless the next group starts. */
  end: number
  words: SubtitleWord[]
}

export type SubtitleStyleId = 'spotlight' | 'punch' | 'boxed' | 'clean' | 'reveal'

export interface SubtitleStyle {
  id: SubtitleStyleId
  name: string
  /** One line, for the picker and the tool description. */
  description: string
  /** How many words at most are on screen at once. */
  maxWords: number
  /** And how many characters, so long words make shorter groups. */
  maxChars: number
  /** The accent used for the spoken word (or the box), unless the caller picks another. */
  accent: string
  /** Distance of the text's baseline block from the bottom of the frame, in percent. */
  bottom: number
}

export const SUBTITLE_STYLES: readonly SubtitleStyle[] = [
  {
    id: 'spotlight',
    name: 'Spotlight',
    description: 'Bold white, three words at a time, the spoken word lit in sky blue. The short-form default.',
    maxWords: 3,
    maxChars: 22,
    accent: '#8EC8FF',
    bottom: 15
  },
  {
    id: 'punch',
    name: 'Punch',
    description: 'Heavy uppercase with an outline, one or two words, the spoken word yellow and popping.',
    maxWords: 2,
    maxChars: 14,
    accent: '#FFE14D',
    bottom: 26
  },
  {
    id: 'boxed',
    name: 'Boxed',
    description: 'Words on a dark card, the spoken word on a coloured chip. Readable over busy footage.',
    maxWords: 4,
    maxChars: 26,
    accent: '#FF4D3D',
    bottom: 13
  },
  {
    id: 'clean',
    name: 'Clean',
    description: 'Whole phrases in a calm sentence case, no highlight. For interviews and longer talks.',
    maxWords: 8,
    maxChars: 42,
    accent: '#FFFFFF',
    bottom: 8
  },
  {
    id: 'reveal',
    name: 'Reveal',
    description: 'Words appear as they are spoken, the newest underlined. Pulls the eye along the sentence.',
    maxWords: 6,
    maxChars: 34,
    accent: '#7CF5C4',
    bottom: 15
  }
]

export function findSubtitleStyle(id: string): SubtitleStyle | undefined {
  return SUBTITLE_STYLES.find((style) => style.id === id)
}

/** A pause longer than this starts a new group even when there is room: it is a new thought. */
const PAUSE_SECONDS = 0.45
/** How long a group stays after its last word when nothing follows straight away. */
const LINGER_SECONDS = 0.35

/**
 * Words into on-screen groups: at most `maxWords` and `maxChars`, and a group ends at a sentence
 * end or comma-free pause — never mid-thought when it can help it. Groups do not overlap, and a
 * group holds until the next begins if the gap is short, so the screen does not flash empty
 * between two quick phrases.
 */
export function groupWords(
  words: readonly SubtitleWord[],
  limits: { maxWords: number; maxChars: number }
): SubtitleGroup[] {
  const groups: SubtitleGroup[] = []
  let current: SubtitleWord[] = []
  const flush = (): void => {
    if (current.length === 0) return
    groups.push({ start: current[0]!.start, end: current[current.length - 1]!.end, words: current })
    current = []
  }
  for (const word of words) {
    const text = word.text.trim()
    if (!text) continue
    const clean = { ...word, text }
    const last = current[current.length - 1]
    const chars = current.reduce((n, w) => n + w.text.length + 1, 0) + text.length
    if (last && (current.length >= limits.maxWords || chars > limits.maxChars || clean.start - last.end > PAUSE_SECONDS)) flush()
    current.push(clean)
    // A sentence's end closes its group, so the next sentence starts fresh.
    if (/[.!?…]["”’)]?$/.test(text)) flush()
  }
  flush()
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i]!
    const next = groups[i + 1]
    const linger = group.end + LINGER_SECONDS
    group.end = next ? Math.min(Math.max(linger, group.end), next.start) : linger
    if (next && next.start - group.end < 0.25) group.end = next.start
  }
  return groups
}

export interface SubtitleOptions {
  width: number
  height: number
  /** The clip's length: the composition's duration. */
  durationSeconds: number
  /** Overrides the style's accent. */
  accent?: string
  /** Multiplies the style's text size, 0.5–2. */
  scale?: number
  /** Overrides the style's distance from the bottom, in percent. */
  bottom?: number
}

const COLOR = /^#[0-9a-fA-F]{3,8}$/

/** Per style: the CSS, and how a word is drawn in each of its states. */
const STYLE_CSS: Record<SubtitleStyleId, string> = {
  spotlight: `
    .line{font-weight:800;font-size:calc(84*var(--s)*var(--u));letter-spacing:-0.02em;line-height:1.12;color:#fff;
      text-shadow:0 calc(4*var(--u)) calc(22*var(--u)) rgba(0,0,0,.55),0 0 calc(2*var(--u)) rgba(0,0,0,.35)}
    .w{margin:0 calc(8*var(--u))}
    .w.now{color:var(--accent)}`,
  punch: `
    .line{font-family:'Arial Black','Helvetica Neue',Arial,sans-serif;font-weight:900;text-transform:uppercase;
      font-size:calc(96*var(--s)*var(--u));line-height:1.02;color:#fff;letter-spacing:0.01em;
      -webkit-text-stroke:calc(7*var(--u)) #000;paint-order:stroke fill;text-shadow:0 calc(8*var(--u)) calc(18*var(--u)) rgba(0,0,0,.45)}
    .w{margin:0 calc(10*var(--u));display:inline-block;transform-origin:50% 70%}
    .w.now{color:var(--accent)}`,
  boxed: `
    .line{display:inline-block;font-weight:700;font-size:calc(58*var(--s)*var(--u));line-height:1.25;color:#fff;
      background:rgba(12,12,14,.82);border-radius:calc(18*var(--u));padding:calc(12*var(--u)) calc(18*var(--u))}
    .w{padding:calc(2*var(--u)) calc(10*var(--u));border-radius:calc(10*var(--u));margin:0 calc(2*var(--u))}
    .w.now{background:var(--accent)}`,
  clean: `
    .line{font-weight:600;font-size:calc(54*var(--s)*var(--u));line-height:1.25;color:#fff;letter-spacing:-0.005em;
      text-shadow:0 calc(3*var(--u)) calc(14*var(--u)) rgba(0,0,0,.6)}
    .w{margin:0 calc(6*var(--u))}`,
  reveal: `
    .line{font-weight:750;font-size:calc(64*var(--s)*var(--u));line-height:1.18;color:#fff;
      text-shadow:0 calc(4*var(--u)) calc(20*var(--u)) rgba(0,0,0,.55)}
    .w{margin:0 calc(7*var(--u));display:inline-block;padding-bottom:calc(6*var(--u));
      background:linear-gradient(var(--accent),var(--accent)) 50% 100%/0% calc(6*var(--u)) no-repeat}
    .w.later{visibility:hidden}
    .w.now{background-size:100% calc(6*var(--u))}`
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * The composition document for a clip's subtitles in one style. Throws on a style that does not
 * exist or a canvas that is not a real size — both are faults in the caller, and a document
 * built from them would place without complaint and draw nothing.
 */
export function subtitleComposition(styleId: string, words: readonly SubtitleWord[], options: SubtitleOptions): string {
  const style = findSubtitleStyle(styleId)
  if (!style) throw new Error(`There is no subtitle style "${styleId}". Styles: ${SUBTITLE_STYLES.map((s) => s.id).join(', ')}.`)
  const { width, height } = options
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RangeError(`A subtitle composition needs a whole-pixel canvas; got ${width}×${height}.`)
  }
  const duration = Math.max(0.1, options.durationSeconds)
  const accent = options.accent && COLOR.test(options.accent) ? options.accent : style.accent
  const scale = Math.min(2, Math.max(0.5, options.scale ?? 1))
  const bottom = Math.min(90, Math.max(0, options.bottom ?? style.bottom))
  const groups = groupWords(words, style).map((group) => ({
    s: +group.start.toFixed(3),
    e: +group.end.toFixed(3),
    w: group.words.map((word) => [+word.start.toFixed(3), +word.end.toFixed(3), word.text] as const)
  }))
  const id = `subtitles-${style.id}`
  // The data is JSON inside a script: `</` would end the script early, so it is escaped.
  const data = JSON.stringify(groups).replace(/</g, '\\u003c')

  return `<!doctype html>
<html>
<head><meta charset="utf-8"><title>${escapeHtml(style.name)} subtitles</title>
<style>
  html,body{margin:0;padding:0;background:transparent}
  .root{position:relative;overflow:hidden;container-type:size;--u:calc(100cqmin / 1080);--s:${scale};--accent:${accent};
    font-family:-apple-system,'SF Pro Display','Helvetica Neue',Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
  .band{position:absolute;left:calc(70*var(--u));right:calc(70*var(--u));bottom:${bottom}%;text-align:center}
  .line{display:inline-block;max-width:100%}
  .w{display:inline-block;white-space:pre}
${STYLE_CSS[style.id]}
</style></head>
<body>
<div class="root" data-composition-id="${id}" data-duration="${duration.toFixed(3)}" style="width:${width}px;height:${height}px">
  <div class="band" id="band"><span class="line" id="line"></span></div>
</div>
<script>
(function () {
  var STYLE = ${JSON.stringify(style.id)}, DUR = ${duration.toFixed(3)}, GROUPS = ${data};
  var band = document.getElementById('band'), line = document.getElementById('line');
  var U = Math.min(band.parentNode.offsetWidth, band.parentNode.offsetHeight) / 1080;
  var shown = -1;
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v }
  function ease(t) { return 1 - Math.pow(1 - clamp(t, 0, 1), 3) }
  function groupAt(t) {
    for (var i = 0; i < GROUPS.length; i++) if (t >= GROUPS[i].s && t < GROUPS[i].e) return i;
    return -1;
  }
  function build(i) {
    line.textContent = '';
    if (i < 0) return;
    GROUPS[i].w.forEach(function (w) {
      var span = document.createElement('span');
      span.className = 'w';
      span.textContent = w[2];
      line.appendChild(span);
    });
  }
  function at(t) {
    var i = groupAt(t);
    if (i !== shown) { build(i); shown = i; }
    if (i < 0) { band.style.opacity = 0; return t / DUR }
    var g = GROUPS[i], spans = line.children, current = -1;
    for (var k = 0; k < g.w.length; k++) if (t >= g.w[k][0]) current = k;
    for (var k = 0; k < spans.length; k++) {
      var state = k === current ? 'now' : k < current ? 'said' : 'later';
      spans[k].className = 'w ' + state;
      if (STYLE === 'punch') {
        var pop = k === current ? 1 + 0.14 * (1 - ease((t - g.w[k][0]) / 0.12)) : 1;
        spans[k].style.transform = 'scale(' + (k === current ? pop.toFixed(3) : 1) + ')';
      }
    }
    // Each group arrives: a short rise and fade, the same for every design.
    var v = ease((t - g.s) / 0.12);
    band.style.opacity = v;
    band.style.transform = 'translateY(' + ((1 - v) * 14 * U).toFixed(2) + 'px)';
    return t / DUR;
  }
  at(0);
  // bay's composition preload makes the registry; making it here too lets the file preview in a browser.
  window.__timelines = window.__timelines || {};
  window.__timelines[${JSON.stringify(id)}] = { time: at, duration: function () { return DUR } };
})();
</script>
</body>
</html>
`
}
