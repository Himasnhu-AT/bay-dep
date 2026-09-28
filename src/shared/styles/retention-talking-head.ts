import type { EditingStyle } from './types'

/**
 * The retention talking-head short ("Hormozi" style). From r&d/research/editing-styles.md §1 with
 * r&d/research/audit.md applied: the OpusClip "deceptively simple" quote and Joyspace's "voice
 * carries the energy" are gone (Joyspace says the opposite — keep subtle sound design), the canvas
 * is the `vertical-1080` preset, the ease is `out`, and the duck sits on the music clip.
 */
export const style: EditingStyle = {
  id: 'retention-talking-head',
  preview: 'preview.webm',
  title: 'Retention talking-head short',
  summary:
    'One person to camera in a vertical short: every pause cut, bold word-by-word captions with a coloured spoken word, ' +
    'punch-ins on every jump cut and the odd text card. The "Hormozi" look.',
  tags: ['talking-head', 'short-form', 'vertical', 'captions', 'hormozi', 'retention', 'reels', 'tiktok', 'shorts'],
  formats: ['vertical-1080'],
  appliesTo: ['pacing', 'structure', 'captions', 'graphics', 'framing', 'audio'],
  footage:
    'One talking-head take, framed chest-up with headroom, clean close-mic audio. 4K (or any source larger than the ' +
    'canvas) gives room for punch-ins without softening. 16:9 works (cropped to 9:16) as long as the speaker stays near ' +
    'the centre — bay has no face tracking, so a crop is static. Not for multi-person footage.',
  body: [
    'Make a vertical retention short from a talking-head take. Numbers marked (rule of thumb) or (house) are conventions, not measurements.',
    '',
    '1. read_project and find the speech clip. transcribe it (itemId) and read what is said.',
    '2. Find the strongest one-sentence claim for the hook; it should be spoken in the first 3 seconds (rule of thumb). If setup or a greeting comes before it, remove_range that stretch so the clip opens on the claim. If the best claim is far into the take, say so and offer a cold open rather than rearranging unasked.',
    '3. Tighten: remove_range every silence longer than about 0.3 s (rule of thumb), every false start and every repeated take, leaving 2–4 frames of breath. Work from the last range to the first so earlier frames do not move. Report the total seconds removed.',
    '4. If the canvas is not vertical, call set_canvas { preset: "vertical-1080", fit: "cover" }. Then edit_item the clip\'s top-level scale, left and top so the face fills the upper middle, eyes near 40% of the frame height (rule of thumb). Check with preview_frame.',
    '5. At every jump cut, alternate the segments between scale 1.00 and 1.12 with edit_item (an extra 10–15% reads as a second camera — rule of thumb), adjusting left/top so the face stays in frame. No two neighbouring segments share a scale.',
    '6. Emphasis: at most one word per ~8 s (house). On it, keyframe a snap: edit_item keyframes { scale: [{ frame: k, value: s, ease: "out" }, { frame: k + 3, value: s × 1.2 }] }, where k is the word\'s frame inside the clip and s its current scale; it holds until the next cut.',
    '7. add_subtitles with style "punch" (or "spotlight" for mixed case), accent a yellow such as "#FFD400" (keywords go yellow or green in this look [opusclip]) and bottom 25–35 so the words clear the platform buttons (rule of thumb). The accent lights the spoken word — add_subtitles cannot colour a keyword you choose; say so if the user asks for that.',
    '8. Put the hook as at most 6 words in the top third for the first 2–3 s with write_brf: heavy uppercase sans (the look uses faces like TheBoldFont, Montserrat Bold or Anton [riverside] — use one from the media pool if present, otherwise the closest available, and never claim an exact match).',
    '9. For each number, tool or quote that is named, add one write_brf card (a stat or a tweet-style card) for 1.5–2.5 s, at most one per 10 s (house), timed to the word from the transcript.',
    '10. Sound: bay has no sound-effect library. If the user supplied pops or whooshes, place them on punchlines only and keep them subtle rather than on every move [joyspace]. For a music bed, set edit_item on the MUSIC clip: volume about 0.06 (≈ −24 dB, rule of thumb) and duck { keyTrackId: the voice track\'s id }.',
    '11. Check with frame_grid over the whole short: no stretch runs past about 4 s without a cut, zoom or card (a visual change every 2–4 s is the short-form convention — rule of thumb), captions never cover the mouth, cards never collide with captions. List any gaps and fix them.',
    '12. If asked to export: export_timeline mp4 with loudness "streaming" (−14 LUFS) — it returns when the export is finished; check `complete`.'
  ].join('\n'),
  params: {
    canvas: 'vertical-1080',
    palette: [
      { name: 'caption', hex: '#FFFFFF', role: 'caption and card text' },
      { name: 'keyword', hex: '#FFD400', role: 'spoken-word accent' },
      { name: 'keyword-alt', hex: '#2BD96B', role: 'second accent, used sparingly' },
      { name: 'outline', hex: '#000000', role: 'text outline and card shadow' }
    ],
    type: [
      { role: 'hook and cards', family: 'Montserrat', weight: 800, case: 'upper', note: 'TheBoldFont or Anton are the other named faces [riverside]; use what is imported.' },
      { role: 'captions', case: 'upper', note: 'Drawn by the add_subtitles design; 1–3 words at a time.' }
    ],
    motion: [
      { name: 'jump-cut punch-in', note: 'Static scale 1.00 ↔ 1.12 on alternate segments (rule of thumb).' },
      { name: 'emphasis snap', frames: 3, ease: 'out', note: '+20% scale, held to the next cut (rule of thumb).' },
      { name: 'card entrance', seconds: 0.2, note: 'Quick rise; nothing loops or wobbles (house).' }
    ],
    eases: { snap: 'out' },
    captions: { design: 'punch', accent: '#FFD400', bottom: 30, words: [1, 3] },
    timing: {
      hookSeconds: { value: [0, 3], unit: 's', basis: 'rule-of-thumb', note: 'The claim is spoken inside the first 3 s.' },
      visualChangeSeconds: { value: [2, 4], unit: 's', basis: 'rule-of-thumb' },
      silenceCutSeconds: { value: [0.3, 0.3], unit: 's', basis: 'rule-of-thumb' },
      emphasisEverySeconds: { value: [8, 8], unit: 's', basis: 'house' },
      cardSeconds: { value: [1.5, 2.5], unit: 's', basis: 'house' }
    },
    audio: { musicDb: -24, loudness: 'streaming', note: 'musicDb is a rule of thumb; duck on the music clip.' }
  },
  sources: [
    { id: 'riverside', label: 'Riverside — Hormozi-style videos (fonts named)', url: 'https://riverside.com/blog/hormozi-style-videos' },
    { id: 'opusclip', label: 'OpusClip — Hormozi style guide (yellow/green keywords)', url: 'https://www.opus.pro/blog/create-videos-in-alex-hormozi-style-the-ultimate-guide' },
    { id: 'joyspace', label: 'Joyspace — Hormozi editing style 2026 ("keep the subtle sound design")', url: 'https://joyspace.ai/hormozi-editing-style-2026-analysis' }
  ]
}
