import type { EditingStyle } from './types'

/**
 * Luxury / minimal brand film. From r&d/research/editing-styles.md §11 with
 * r&d/research/audit.md applied: no tool reports a source's frame rate, so slow motion waits on
 * the user confirming a high-frame-rate source; the unverified Luxury Society and Beast Agency
 * lines are dropped; every timing is labelled an estimate.
 */
export const style: EditingStyle = {
  id: 'luxury-minimal',
  title: 'Luxury / minimal brand film',
  summary:
    'Restraint: few, long, beautifully composed shots, slow dissolves between moods, a muted or black-and-white grade, ' +
    'sparse widely spaced type and near silence. Mood over explanation.',
  tags: ['luxury', 'minimal', 'brand-film', 'fashion', 'cinematic', 'slow', 'black-and-white', 'perfume', 'landscape'],
  formats: ['landscape-1080', 'vertical-1080', 'portrait-1080'],
  appliesTo: ['pacing', 'structure', 'grade', 'transitions', 'graphics', 'audio'],
  footage:
    'Well-lit, well-composed footage of a product, model or place, ideally with some high-frame-rate (50/60 fps or more) ' +
    'shots for slow motion. This style cannot rescue shaky, cluttered or badly lit footage — say so rather than forcing it.',
  body: [
    'Cut a luxury brand film. Every timing here is an estimate or rule of thumb, not a measurement; the look\'s description comes from [captions-ai].',
    '',
    '1. browse_assets, then frame_grid each candidate clip (assetId). Choose at most 10 shots with the cleanest composition; drop anything shaky or cluttered.',
    '2. Order them for mood: an establishing wide, a texture macro, a gesture, the hero object, a close.',
    '3. Lay them out with place_asset and trim_item: 4–8 s a shot and none shorter than 3 s (estimate). The pace is "understated and unhurried" [captions-ai].',
    '4. Slow motion only where the user confirms the clip was shot at 50 fps or more — bay cannot read a file\'s frame rate for you, and slowing 24/30 fps footage stutters. Then edit_item speed 0.5 (0.4 for hands and fabric) with ripple: true, since the clip gets longer.',
    '5. At most one slow move per shot: keyframes { scale: [{ frame: 0, value: 1, ease: "inOut" }, { frame: end, value: 1.04 }] }, or none.',
    '6. add_transition kind "cross-dissolve", 18–30 frames, between moods; hard cuts within a mood (estimate). Never wipe, push, slide or iris. A dissolve needs footage beyond each cut; add_transition says when it shortened one.',
    '7. Grade every shot the same with edit_item grade: saturation 0.7–0.8, a soft S in curves.master (for example [[0, 0.03], [0.25, 0.22], [0.75, 0.78], [1, 0.97]], which also lifts the blacks), grain { amount: 0.06 } (estimate). Optionally saturation 0 on one or two shots — occasional black and white belongs to the look [captions-ai].',
    '8. Type: at most three moments (brand, one line, end) with write_brf. A thin serif or a light, widely spaced sans (tracking +0.1 to +0.2 em), at most 5% of the frame height, fading in over about 24 frames and holding at least 3 s (estimate). A flowing script with small sans labels is the other pairing described [captions-ai].',
    '9. Audio: one sparse music track at about −18 dB (edit_item volume ≈ 0.13, estimate), or natural sound alone. No sound-effect hits.',
    '10. Start and end on black: fadeInFrames on the first shot and fadeOutFrames on the last, about 1 s each.',
    '11. Check with frame_grid over the whole film: average shot at least 4 s, and no transition besides the cut and the dissolve. Fix, then look again.',
    '12. If asked to export: export_timeline mp4, quality "best", loudness "streaming" (or "off" to keep the music\'s own level), then track_export until complete.'
  ].join('\n'),
  params: {
    canvas: 'landscape-1080',
    palette: [
      { name: 'black', hex: '#0A0A0A', role: 'fades and type ground' },
      { name: 'ivory', hex: '#F2EEE6', role: 'type' },
      { name: 'stone', hex: '#8C857B', role: 'secondary labels' }
    ],
    type: [
      { role: 'brand line', weight: 300, trackingEm: 0.15, case: 'upper', note: 'Thin serif or light sans, ≤5% of frame height (estimate).' },
      { role: 'script accent', note: 'A flowing script, used once if at all [captions-ai].' }
    ],
    motion: [
      { name: 'slow push', ease: 'inOut', note: 'Scale 1.00 → 1.04 across the whole shot.' },
      { name: 'type fade-in', frames: 24, ease: 'out' },
      { name: 'mood dissolve', frames: 24, note: '18–30 frames (estimate).' }
    ],
    eases: { drift: 'inOut', fade: 'out' },
    timing: {
      shotSeconds: { value: [4, 8], unit: 's', basis: 'estimate' },
      minShotSeconds: { value: [3, 3], unit: 's', basis: 'estimate' },
      dissolveFrames: { value: [18, 30], unit: 'frames', basis: 'estimate' },
      typeHoldSeconds: { value: [3, 3], unit: 's', basis: 'estimate', note: 'At least.' }
    },
    audio: { musicDb: -18, loudness: 'streaming', note: 'musicDb is an estimate.' },
    grade: { saturation: 0.75, curves: { master: [[0, 0.03], [0.25, 0.22], [0.75, 0.78], [1, 0.97]] }, grain: { amount: 0.06 } }
  },
  sources: [{ id: 'captions-ai', label: 'Captions.ai — "Byline" style (understated, script + sans, black and white)', url: 'https://captions.ai/styles/byline' }]
}
