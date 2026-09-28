import type { EditingStyle } from './types'

/**
 * UGC ad / testimonial. From r&d/research/editing-styles.md §16 with r&d/research/audit.md
 * applied: the timed structure and "15–30 s sweet spot" were not in Stackmatix (which says 9–15 s
 * tends to outperform for direct response), the 3×3×3 matrix, the "signals ad" quote and the "93%
 * use sound" figure are gone, and there is no duplicate-project tool, so variants are built one at
 * a time.
 */
export const style: EditingStyle = {
  id: 'ugc-ad',
  preview: 'preview.webm',
  title: 'UGC ad / testimonial',
  summary:
    'Looks like a creator\'s post, sells like an ad: a phone-shot selfie hook in the first seconds, a quick problem–demo–proof ' +
    'body with product inserts, native-looking captions and a clear call to action.',
  tags: ['ugc', 'ad', 'testimonial', 'direct-response', 'tiktok', 'reels', 'vertical', 'selfie', 'product', 'short-form'],
  formats: ['vertical-1080', 'portrait-1080'],
  appliesTo: ['structure', 'pacing', 'captions', 'graphics', 'framing', 'audio'],
  footage:
    'Phone-shot 9:16 selfie takes to camera (several hook takes is ideal), product close-ups and a hands-on demo. ' +
    'Polished studio footage works against this look.',
  body: [
    'Cut a UGC-style ad. Numbers marked (rule of thumb) or (house) are conventions; those with a source id in brackets come from that source.',
    '',
    '1. transcribe every take (itemId). Label candidate hooks: sentences of 3 s or less that make a claim, ask a question or show the product working.',
    '2. If the canvas is not vertical, set_canvas { preset: "vertical-1080", fit: "cover" }. Keep faces and text clear of the bottom quarter and the right edge, where the platform draws its buttons (rule of thumb); check with preview_frame.',
    '3. Open on the strongest hook. The first seconds carry most of the weight: TikTok\'s research credits the first 6 s with 90% of ad-recall impact [tiktok-6s].',
    '4. Assemble the body: the problem, the product in use, the result or proof, then the call to action. Aim short — for direct response, 9–15 s tends to outperform longer cuts [stackmatix] — and go longer only if the user asks.',
    '5. remove_range every pause over about 0.25 s (rule of thumb) so it plays as one breath, last range first.',
    '6. Cover each product mention with a close-up or demo insert for 1–2 s (house): place_asset on a track above at the word\'s frame from the transcript.',
    '7. add_subtitles style "boxed" (reads native) or "spotlight", bottom about 30.',
    '8. Put the hook as at most 7 words in the top third for the first 0–3 s with write_brf (house).',
    '9. Keep the brand out of the first 3 s; it appears in the demo and the call to action (house).',
    '10. Call to action: spoken, plus add_template { templateId: "end-card" } with the offer and the action, for at least 2 s.',
    '11. Hook variants: bay has no tool to duplicate a project, so build them one at a time — export the cut with hook A, replace the hook segment with hook B\'s take (remove_range the old hook, place_asset the new one at frame 0), export again, and so on. Keep everything after the hook identical and name the files "hook A", "hook B"… Tell the user each variant\'s length.',
    '12. Music, if any: a light bed on its own track, edit_item on the MUSIC clip volume about 0.05 (≈ −26 dB, rule of thumb) with duck { keyTrackId: the voice track\'s id }.',
    '13. Review with frame_grid, then if asked export_timeline mp4 with loudness "streaming" (−14 LUFS) and track_export until complete.'
  ].join('\n'),
  params: {
    canvas: 'vertical-1080',
    palette: [
      { name: 'caption-box', hex: '#000000CC', role: 'boxed caption card' },
      { name: 'caption', hex: '#FFFFFF', role: 'caption text' },
      { name: 'cta', hex: '#FF2D55', role: 'call-to-action accent' }
    ],
    type: [{ role: 'hook line', weight: 700, case: 'sentence', note: 'Platform-native look: plain bold sans, no display flourish.' }],
    motion: [{ name: 'insert cut', note: 'Hard cuts only; no transitions.' }],
    captions: { design: 'boxed', bottom: 30 },
    timing: {
      hookSeconds: { value: [0, 3], unit: 's', basis: 'rule-of-thumb' },
      adRecallWindowSeconds: { value: [0, 6], unit: 's', basis: 'platform', source: 'tiktok-6s', note: '90% of ad-recall impact.' },
      directResponseSeconds: { value: [9, 15], unit: 's', basis: 'rule-of-thumb', source: 'stackmatix' },
      pauseCutSeconds: { value: [0.25, 0.25], unit: 's', basis: 'rule-of-thumb' },
      insertSeconds: { value: [1, 2], unit: 's', basis: 'house' },
      ctaSeconds: { value: [2, 5], unit: 's', basis: 'house' }
    },
    audio: { musicDb: -26, loudness: 'streaming', note: 'musicDb is a rule of thumb; duck on the music clip.' }
  },
  sources: [
    {
      id: 'tiktok-6s',
      label: 'TikTok Marketing Science via Social Media Today — first 6 s and ad recall',
      url: 'https://www.socialmediatoday.com/news/tiktok-shares-new-notes-maximize-ad-effectiveness/694989/'
    },
    { id: 'stackmatix', label: 'Stackmatix — TikTok creative best practices (9–15 s for direct response)', url: 'https://www.stackmatix.com/blog/tiktok-creative-best-practices-startups' }
  ]
}
