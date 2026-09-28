import type { EditingStyle } from './types'

/**
 * Kinetic typography / lyric video. From r&d/research/editing-styles.md §9 with
 * r&d/research/audit.md applied: the reading-rate figure is Netflix's adult 20 cps, and `.brf`
 * does have keyable blur and masked (`wipe`) entrances — the gap is audio-reactive values and
 * text-behind-subject, not those.
 */
export const style: EditingStyle = {
  id: 'kinetic-typography',
  preview: 'preview.webm',
  title: 'Kinetic typography / lyric video',
  summary:
    'The words are the picture: each word snaps in on its own sung or spoken onset, one hero word per line, a distinct ' +
    'chorus treatment and beat bumps on the downbeats. For lyric videos and voiceover type pieces.',
  tags: ['kinetic-typography', 'lyric-video', 'typography', 'music', 'text-animation', 'motion-graphics', 'beat-sync'],
  formats: ['landscape-1080', 'vertical-1080', 'square-1080'],
  appliesTo: ['graphics', 'pacing', 'structure', 'audio'],
  footage:
    'A song or voiceover track plus the exact lyrics or script as text. No picture is needed; album art or a quiet ' +
    'background loop is optional. Sung vocals transcribe less reliably than speech, so the supplied words matter.',
  body: [
    'Build a kinetic-type piece. Numbers marked (rule of thumb) or (house) are conventions; those with a source id in brackets come from that source.',
    '',
    '1. Get the track and the exact words from the user. transcribe the track (itemId) for word times. Where the transcript disagrees with the supplied words, keep the supplied words and the transcript\'s timings, and list the low-confidence lines for the user.',
    '2. detect_beats on the track (itemId, markers: "downbeats"). If it reports steady: false, time everything to the words alone. Mark each chorus start with add_marker.',
    '3. Choose one heavy display face and at most one light companion, and at most three colours (rule of thumb). Use fonts from the media pool (browse_assets) when there are any. For reference, the "22 (Taylor\'s Version)" lyric video pairs Montserrat with the script face Mr Sheffield [fontsinuse].',
    '4. Write the type with write_brf — one module over the whole track, or one per section. Each word enters on its own onset (±2 frames, house): a spring scale 0.6 → 1 (spring stiffness 420, damping 32) or a 20 px rise with a fade. Words and lines come from an array in code with their times in seconds.',
    '5. One hero word per line (the stressed or rhymed word) gets 1.5–2× the size or the accent colour; the rest stay neutral (rule of thumb).',
    '6. A line leaves on the next line\'s first onset, or on a downbeat when the gap is longer than a beat. A masked exit reads well: .brf has a wipe entrance and clipping groups.',
    '7. Give the chorus one distinct treatment (inverted colours, a heavier weight through a variable axis, a larger size) and reuse it every time the chorus returns.',
    '8. Keep at most about 8 words on screen at once (rule of thumb) and never show a word before it is sung. Where a line stands alone for reading, hold it long enough for about 20 characters per second [netflix].',
    '9. Background: a solid colour, or album art placed with place_asset and blurred and darkened (edit_item adjustments blur and brightness, or a keyed blur inside the .brf). Change it only at section boundaries.',
    '10. On big downbeats, bump the whole text group 1.00 → 1.04 → 1.00 over 6 frames (house).',
    '11. preview_frame a sample of lines: text at least 5% of the frame height (rule of thumb), nothing clipped. Then frame_grid over the whole piece.',
    '12. If asked to export: export_timeline with loudness "off" so the song keeps its own master, then track_export until complete.'
  ].join('\n'),
  params: {
    canvas: 'landscape-1080',
    palette: [
      { name: 'paper', hex: '#F4F1EA', role: 'background' },
      { name: 'ink', hex: '#111111', role: 'words' },
      { name: 'accent', hex: '#FF3B30', role: 'hero word, chorus inversion' }
    ],
    type: [
      { role: 'display', weight: 800, case: 'upper', note: 'Variable fonts let the chorus push weight or width.' },
      { role: 'companion', weight: 300, case: 'lower' }
    ],
    motion: [
      { name: 'word entrance (spring)', spring: { stiffness: 420, damping: 32 }, note: 'Scale 0.6 → 1.' },
      { name: 'word entrance (rise)', frames: 8, ease: 'out', note: '20 px rise with a fade.' },
      { name: 'downbeat bump', frames: 6, ease: 'inOut', note: '1.00 → 1.04 → 1.00.' }
    ],
    eases: { enter: 'out', bump: 'inOut' },
    timing: {
      onsetToleranceFrames: { value: [-2, 2], unit: 'frames', basis: 'house' },
      wordsOnScreen: { value: [1, 8], unit: 'words', basis: 'rule-of-thumb' },
      heroScale: { value: [1.5, 2], unit: '× base size', basis: 'rule-of-thumb' },
      readingCharsPerSecond: { value: [20, 20], unit: 'chars/s', basis: 'platform', source: 'netflix', note: 'Subtitle rate, used as a floor for held lines.' },
      minTextHeightPercent: { value: [5, 5], unit: '% of frame height', basis: 'rule-of-thumb' }
    },
    audio: { loudness: 'off', note: 'Keep the song\'s own master.' }
  },
  sources: [
    { id: 'fontsinuse', label: 'Fonts In Use — 22 (Taylor\'s Version) lyric video', url: 'https://fontsinuse.com/uses/43958/22-taylor-s-version-lyric-video' },
    {
      id: 'netflix',
      label: 'Netflix — English (USA) Timed Text Style Guide',
      url: 'https://partnerhelp.netflixstudios.com/hc/en-us/articles/217350977-English-USA-Timed-Text-Style-Guide'
    }
  ]
}
