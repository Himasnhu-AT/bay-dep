import type { EditingStyle } from './types'

/**
 * Product launch film. The procedure is the `launch-film` skill's; the tokens are the ones
 * r&d/research/perry-film-motion.md read out of a real launch film's source (perry.html), so
 * they are measured from code, not estimated from video. The golden-ratio proportions are
 * bay's house style (r&d/research/golden-ratio.md), not evidence.
 *
 * Three of that film's habits are NOT carried over, on purpose, because the film protocol
 * (`bay://guide/motion-design`, measured by `check_film`) says the opposite and one place has to
 * win: it cut hard on every bar line (here a boundary is carried, and a bare cut is for a burst
 * or the end card), it gave every idea one bar (equal beats are a metronome, which fails), and
 * it kept something moving in every frame (a rest here is dead still). Its curves, spring, type
 * and palette are kept as this look's tokens.
 */
export const style: EditingStyle = {
  id: 'product-launch-film',
  preview: 'preview.webm',
  title: 'Product launch film',
  summary:
    'A launch or feature film on the music\'s clock: beats that land on bar lines and carry into each other, headlines that ' +
    'rise word by word through a mask, pops that share one spring, a camera that chases and then holds still, and one accent ' +
    'colour on paper and ink.',
  tags: ['launch', 'product', 'promo', 'saas', 'trailer', 'kinetic-typography', 'motion-graphics', 'screen-recording', 'beat-sync', 'landscape'],
  formats: ['landscape-1080', 'vertical-1080', 'square-1080'],
  appliesTo: ['structure', 'pacing', 'graphics', 'transitions', 'framing', 'audio'],
  footage:
    'Screen recordings of the product at or above the output resolution, product shots or brand assets (logo, SVG marks), ' +
    'and a music track with a steady beat. Three to five features, not a tour of everything.',
  body: [
    'Make a launch film in this system. Load the launch-film skill too if you have not: it holds the full procedure; these steps are the style\'s rules on top. Timings come from a launch film\'s own source [perry]; proportions marked (house) are bay\'s.',
    '',
    '1. detect_beats on the music (itemId). Beat = 60 / BPM, bar = 4 beats. Make the film a whole number of bars; if the beat is not steady, choose a tempo and say so.',
    '2. Plan on the bar grid without a metronome: every boundary lands on a beat or a bar line, but the lengths differ — a hit takes a beat, an idea a bar, a story or a mood 2–3 bars — and the end card holds at least 2 bars [perry]. Show the beat sheet before building: each beat\'s bars, what moves, what is still, what carries into the next, the on-screen words, where they sit and how big.',
    '3. Carry every boundary inside the composition — the beat sheet names what survives it. A bare hard cut is only for a burst of three or more hits and into the end card, on a bar line, and listed in __film.cuts. Never add_transition: a dissolve is a fade. Every entrance starts within 0–0.1 s of its boundary [perry].',
    '4. Where a recorded clip is in the film, it moves: edit_item keyframes scale 1.00 → 1.06–1.10 across the shot with left/top keyed alongside so the push aims at the action (scale is about the clip\'s centre). Drifts use the ease [0.45, 0, 0.55, 1] (house).',
    '5. Headlines (in the composition with BM.lineReveal and its curve, dur and stagger options, or write_brf for one over footage): rise word by word through a mask one line tall (a clipping group), each word travelling 1.1× its size over 0.55 s on the rise curve [0.165, 0.84, 0.44, 1], words 0.035–0.06 s apart, no fade [perry]. They leave upward in 0.25 s on the whip curve [0.72, 0, 0.18, 1], at half the entrance stagger, finishing 0.08 s before the cut [perry]. Exits at least twice as fast as entrances.',
    '6. Cards, badges, logos and buttons pop with one spring, spring(t, { stiffness: 420, damping: 32 }): opacity min(1, 1.4·s), rising 14–16 px, scale 0.94 + 0.06·s [perry]. In a composition the same spring is BM.spring(t − t0, { damping: 0.78, frequency: 20.5 }). Type and pops keep to these two curves and this one spring; carries and the camera take their curves from the move, chosen by t80 (bay://guide/motion-design). Never an elastic or bounce preset.',
    '7. Secondary text fades up 8–12 px over 0.4–0.5 s, starting 0.3–0.45 s after its headline [perry]. Siblings are staggered 0.035–0.1 s; never two entrances on the same frame.',
    '8. Type: display weight 600 with tracking −0.04 em; taglines 500 at −0.01 em in the secondary ink; body 400 with line height 1.5 [perry]. One hero line and at most one supporting line per scene. Use Inter Tight if it is in the media pool; bay ships Inter, which runs slightly wider.',
    '9. Colour: paper, ink, three greys and one accent (the palette below). The accent goes on at most one element per scene — a kicker, one word, the CTA or a data mark — never a whole headline [perry]. No glows, decorative gradients, decorative grids, lens flares or 3D (a faint BM.farGrid behind a moving camera is not decoration: it is what the move reads against).',
    '10. Layout: text left from about 10% of the width with the product right, or a centred statement near 57% of the height, or a title in the top 15% with the product below [perry].',
    '11. Rests are dead still: once a beat has landed, nothing drifts, blinks or bobs until the next move, and one hold lasts at least a second — check_film fails a film that never stops. While a beat plays, one small motion may ride the music (a decay of exp(−10·(t mod beat))) [perry]; it ends with the beat.',
    '12. Sound: score_sfx from the film\'s __film.events() — fewer sounds than visible actions, the loudest on the biggest moment, one room — or the user\'s own effect files at the frames those events name. Effects sit 10–20 dB under the music (rule of thumb). The music ends on the last frame.',
    '13. Check with preview_frame at each boundary, mid-move, at rest and 0.1 s before the next boundary, then frame_grid over the whole film, then check_film until no leg fails. If asked to export: export_timeline mp4, quality "best", loudness "streaming" — it returns when the export is finished; check `complete`.'
  ].join('\n'),
  params: {
    canvas: 'landscape-1080',
    palette: [
      { name: 'paper', hex: '#FFFFFF', role: 'background' },
      { name: 'mist', hex: '#F5F5F7', role: 'alternate scene background' },
      { name: 'ink', hex: '#1D1D1F', role: 'display text' },
      { name: 'ink2', hex: '#424245', role: 'strong secondary' },
      { name: 'ink3', hex: '#6E6E73', role: 'secondary text' },
      { name: 'hairline', hex: '#00000017', role: 'card outlines' },
      { name: 'accent', hex: '#0C7A70', role: 'one element per scene' },
      { name: 'night', hex: '#0A0C0F', role: 'the one dark scene' }
    ],
    type: [
      { role: 'hero', family: 'Inter Tight', weight: 600, sizePx: 200, trackingEm: -0.04, case: 'sentence', note: '150 in the source\'s 1440-wide design, ×1.333 at 1920.' },
      { role: 'scene title', family: 'Inter Tight', weight: 600, sizePx: 96, trackingEm: -0.04, case: 'sentence' },
      { role: 'tagline', family: 'Inter Tight', weight: 500, sizePx: 53, trackingEm: -0.01, case: 'sentence' },
      { role: 'body', family: 'Inter', weight: 400, sizePx: 29, case: 'sentence', note: 'Line height 1.5.' }
    ],
    motion: [
      { name: 'headline rise', seconds: 0.55, ease: [0.165, 0.84, 0.44, 1], note: 'Masked, 1.1× size travel, 0.035–0.06 s stagger, no fade.' },
      { name: 'headline exit (whip)', seconds: 0.25, ease: [0.72, 0, 0.18, 1], note: 'Upward, half stagger, ends 0.08 s before the cut.' },
      { name: 'pop', spring: { stiffness: 420, damping: 32 }, note: 'opacity min(1, 1.4s), +14–16 px, scale 0.94 + 0.06s.' },
      { name: 'secondary fade-up', seconds: 0.45, ease: [0.165, 0.84, 0.44, 1], note: '8–12 px, 0.3–0.45 s after the headline.' },
      { name: 'camera drift', ease: [0.45, 0, 0.55, 1], note: 'Scale 1.00 → 1.06–1.10 per shot (house).' }
    ],
    eases: { rise: [0.165, 0.84, 0.44, 1], whip: [0.72, 0, 0.18, 1], drift: [0.45, 0, 0.55, 1] },
    timing: {
      barsPerIdea: { value: [1, 1], unit: 'bars', basis: 'measured', source: 'perry', note: 'A hit one beat, a story or mood 2–3 bars: the lengths must differ.' },
      endCardBars: { value: [2, 3], unit: 'bars', basis: 'measured', source: 'perry' },
      entranceAfterCutSeconds: { value: [0, 0.1], unit: 's', basis: 'measured', source: 'perry' },
      wordStaggerSeconds: { value: [0.035, 0.06], unit: 's', basis: 'measured', source: 'perry' },
      siblingStaggerSeconds: { value: [0.035, 0.1], unit: 's', basis: 'measured', source: 'perry' },
      features: { value: [3, 5], unit: 'features', basis: 'house' },
      effectsUnderMusicDb: { value: [10, 20], unit: 'dB', basis: 'rule-of-thumb' }
    },
    audio: { loudness: 'streaming' }
  },
  sources: [
    { id: 'perry', label: 'bay study of the Perry launch film\'s source (perry.html)', url: 'r&d/research/perry-film-motion.md' }
  ]
}
