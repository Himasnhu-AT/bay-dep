import type { EditingStyle } from './types'

/**
 * News package / explainer with lower-thirds. From r&d/research/editing-styles.md §13 with
 * r&d/research/audit.md applied: Netflix's adult English rate is 20 cps (17 is children's), the
 * caption limits are rules for building cues rather than add_captions parameters, J/L cuts use
 * audioLeadFrames/audioTrailFrames, and one safe area is chosen (10% title-safe).
 */
export const style: EditingStyle = {
  id: 'news-lower-thirds',
  preview: 'preview.webm',
  title: 'News package with lower-thirds',
  summary:
    'Authoritative and labelled: soundbites alternating with B-roll under voiceover, every speaker named by a lower third, ' +
    'numbers on stat cards, a neutral grade and broadcast-safe graphics.',
  tags: ['news', 'explainer', 'lower-third', 'interview', 'broadcast', 'documentary', 'journalism', 'landscape'],
  formats: ['landscape-1080', 'vertical-1080'],
  appliesTo: ['structure', 'pacing', 'graphics', 'captions', 'grade', 'audio'],
  footage:
    'Interview soundbites (tripod, clean audio), B-roll of what is talked about, and a voiceover or reporter stand-up. ' +
    'Speakers\' names and roles must come from the user — bay cannot identify who is speaking.',
  body: [
    'Build a news package. Numbers marked (rule of thumb) or (estimate) are conventions; those with a source id in brackets come from that source.',
    '',
    '1. read_project and browse_assets. transcribe every interview clip (itemId). Pick soundbites of about 6–15 s (rule of thumb) that each make one point, and ask the user for each speaker\'s name and role.',
    '2. Structure: a voiceover or stand-up intro of at most ~15 s, then alternate soundbite and B-roll-under-voiceover, ending on the strongest bite or a stand-up (rule of thumb). Trim bites with remove_range so every track stays in sync.',
    '3. Cover every voiceover span with B-roll that shows what is being said: search_footage (index_footage first if the pool is not indexed), check the hit with frame_grid, then place_asset it on a track above. Shots of about 3–6 s (estimate).',
    '4. Soften cuts into and out of bites with J and L cuts: edit_item audioLeadFrames 6–12 so the voice starts before its picture (with a few frames of fadeInFrames), or audioTrailFrames to carry it under the next shot.',
    '5. The first time each speaker appears, add_template { templateId: "lower-third", variables: { name, role } } about 0.5–1 s after they start speaking. Hold it 4–7 s; on a repeat appearance 2–3 s or none [anfx] — set the length with edit_item durationInFrames. The role line sits at 50–65% of the name\'s size in a lighter weight [anfx].',
    '6. If the user wants a broadcast bar instead (white text on a dark translucent bar with a coloured rule above), draw it with write_brf: in over 0.3–0.7 s, out over 0.3–0.5 s [anfx].',
    '7. Keep every graphic inside the title-safe area, 10% in from each edge — 192 px left and right, 108 px top and bottom on 1920×1080 (broadcast convention, rule of thumb). Check with preview_frame.',
    '8. Give every number a card: add_template { templateId: "stat" } for 3–5 s (rule of thumb). At each new location add a small top-left place-and-date locator with write_brf for about 3 s.',
    '9. Grade neutral: correct white balance only, with edit_item grade temperature/tint. No stylised LUT.',
    '10. Captions for accessibility: build cues from the transcript with at most 42 characters per line and at most 20 characters per second for adult English (17 for children\'s programmes) [netflix], then add_captions with those cues. These are rules for the cues you write, not parameters of the tool.',
    '11. Review with frame_grid over the whole package: every speaker named once, no graphic over a face, lower thirds never on top of captions.',
    '12. If asked to export: export_timeline with loudness "broadcast" (−23 LUFS) for TV or "streaming" (−14 LUFS) for the web — it returns when the export is finished; check `complete`.'
  ].join('\n'),
  params: {
    canvas: 'landscape-1080',
    palette: [
      { name: 'bar', hex: '#0B0F14CC', role: 'lower-third bar, translucent' },
      { name: 'text', hex: '#FFFFFF', role: 'name and headline text' },
      { name: 'rule', hex: '#D7263D', role: 'thin rule above the bar' },
      { name: 'secondary', hex: '#C9CED6', role: 'role line and locator' }
    ],
    type: [
      { role: 'lower-third name', weight: 700, sizePx: 44, case: 'title', note: 'Size is an estimate for 1080p.' },
      { role: 'lower-third role', weight: 400, sizePx: 26, case: 'sentence', note: '50–65% of the name [anfx].' },
      { role: 'stat number', weight: 800, sizePx: 120 }
    ],
    motion: [
      { name: 'lower-third in', seconds: 0.5, ease: 'out', note: '0.3–0.7 s [anfx].' },
      { name: 'lower-third out', seconds: 0.4, ease: 'in', note: '0.3–0.5 s [anfx].' }
    ],
    eases: { enter: 'out', exit: 'in' },
    captions: { design: 'clean', note: 'Or add_captions with cues built to the Netflix limits.' },
    timing: {
      lowerThirdHoldSeconds: { value: [4, 7], unit: 's', basis: 'rule-of-thumb', source: 'anfx' },
      lowerThirdRepeatSeconds: { value: [2, 3], unit: 's', basis: 'rule-of-thumb', source: 'anfx' },
      lowerThirdInSeconds: { value: [0.3, 0.7], unit: 's', basis: 'rule-of-thumb', source: 'anfx' },
      lowerThirdOutSeconds: { value: [0.3, 0.5], unit: 's', basis: 'rule-of-thumb', source: 'anfx' },
      secondaryLineScale: { value: [0.5, 0.65], unit: '× name size', basis: 'rule-of-thumb', source: 'anfx' },
      captionCharsPerSecond: { value: [20, 20], unit: 'chars/s', basis: 'platform', source: 'netflix', note: 'Adult English; 17 for children.' },
      captionCharsPerLine: { value: [42, 42], unit: 'chars', basis: 'platform', source: 'netflix' },
      soundbiteSeconds: { value: [6, 15], unit: 's', basis: 'rule-of-thumb' },
      shotSeconds: { value: [3, 6], unit: 's', basis: 'estimate' },
      titleSafePercent: { value: [10, 10], unit: '%', basis: 'rule-of-thumb' }
    },
    audio: { loudness: 'broadcast', note: '"streaming" for web delivery.' },
    grade: { note: 'Neutral: white balance only.' }
  },
  sources: [
    { id: 'anfx', label: 'ANFX — lower-thirds design rules', url: 'https://anfx.co/blog/lower-thirds-design-rules-free-templates/' },
    {
      id: 'netflix',
      label: 'Netflix — English (USA) Timed Text Style Guide',
      url: 'https://partnerhelp.netflixstudios.com/hc/en-us/articles/217350977-English-USA-Timed-Text-Style-Guide'
    }
  ]
}
