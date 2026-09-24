/**
 * `transcribe` end to end: a real whisper.cpp run on the open project's clip, its cues checked
 * against the clip they claim to belong to, and `add_captions` placing exactly those cues.
 *
 * It must never download. `autoDownloadModels` is switched off for the run through `setState` —
 * not through the Settings setter, which would also rewrite `localStorage['bay.autoDownloadModels']`
 * — and put back afterwards. The precondition is an engine and a model an English transcription
 * would use (`status.activeForEnglish`); without one this exits 2, because a run that fetched a
 * 150 MB model would be measuring the network.
 *
 * The negative control is French with no multilingual model installed and downloads off: it must
 * fail, and the error must send the user to Settings. Its positive pair is the English run above
 * it, on the same clip, through the same tool — so "refused" cannot mean "the tool refuses
 * everything". When a multilingual model *is* installed the French call would succeed, so that
 * half is skipped and says so.
 */

import { attach, runProbe, check, PreconditionError } from './cdp.mjs'

const { evaluate } = await attach()

await runProbe(async () => {
  const S = 'window.bayEngine.store.getState()'
  let n = 0
  const call = (tool, args = {}, timeout = 60_000) =>
    evaluate(`window.bayMcp.execute(${JSON.stringify({ id: `tr${++n}`, tool, args })})`, timeout)
  const status = () => evaluate(`window.bay.whisper.status(${S}.whisperModel)`)

  const before = await status()
  if (!before.engine) throw new PreconditionError('whisper.cpp is not installed', 'Settings → Transcription → Install, or brew install whisper-cpp')
  if (!before.activeForEnglish) throw new PreconditionError('no whisper model an English transcription could use is installed', 'download one in Settings first; this probe never downloads')
  if (before.download && ['downloading', 'verifying'].includes(before.download.state)) {
    throw new PreconditionError('a model download is running', 'wait for it; the model list would change under this probe')
  }
  const multilingual = before.installed.filter((m) => /^ggml-.+\.bin$/.test(m.file) && !m.file.includes('.en.') && !m.file.includes('for-tests'))
  console.log(`     engine ${before.engine}; English would use ${before.activeForEnglish}; ` +
    `installed: ${before.installed.map((m) => m.file).join(', ')}`)

  const autoWas = await evaluate(`${S}.autoDownloadModels`)
  await evaluate(`(window.bayEngine.store.setState({ autoDownloadModels: false }), true)`)
  try {
    check('downloads are off for this run', await evaluate(`${S}.autoDownloadModels`), false)

    const read = await call('read_project')
    if (!read.ok) throw new PreconditionError('read_project failed', read.error)
    const clip = read.value.tracks.flatMap((t) => t.items).find((i) => read.value.assets[i.assetId]?.kind === 'video' || read.value.assets[i.assetId]?.kind === 'audio')
    if (!clip) throw new PreconditionError('the open project has no video or audio clip to transcribe')
    const hasAudio = await evaluate(`${S}.project.assets.find((a) => a.id === ${JSON.stringify(clip.assetId)})?.hasAudio === true`)
    if (!hasAudio) throw new PreconditionError('the clip\'s file has no audio track', 'nothing to transcribe')
    const end = clip.from + clip.durationInFrames
    console.log(`\n── transcribe ${clip.id} (frames ${clip.from}–${end})`)

    const result = await call('transcribe', { itemId: clip.id, language: 'en' }, 5 * 60_000)
    check('it answers ok', result.ok, true)
    const { model, cues } = result.value
    check('naming the model it used', model, (m) => typeof m === 'string' && m.length > 0)
    check('and returning cues', cues?.length, (c) => c > 0)
    console.log(`     ${cues.length} cue(s), model ${model}; first: ${JSON.stringify(cues[0])}`)
    check('every cue lies inside the clip', cues.every((c) => c.fromFrame >= clip.from && c.toFrame <= end), true)
    check('every cue has length and words', cues.every((c) => c.toFrame > c.fromFrame && String(c.text).trim().length > 0), true)
    check('the cues are in order and do not overlap', cues.every((c, i) => i === 0 || c.fromFrame >= cues[i - 1].toFrame), true)

    console.log('\n── add_captions with those cues')
    const tracksBefore = await evaluate(`(() => { const p = ${S}.project; return p.timelines.find((t) => t.id === p.activeTimelineId).tracks.map((t) => t.id) })()`)
    const added = await call('add_captions', { cues })
    check('add_captions answers ok', added.ok, true)
    const track = await evaluate(`(() => {
      const p = ${S}.project
      const t = p.timelines.find((x) => x.id === p.activeTimelineId).tracks.find((x) => !${JSON.stringify(tracksBefore)}.includes(x.id))
      return t ? { id: t.id, name: t.name, items: t.items.length, texts: t.items.map((i) => p.assets.find((a) => a.id === i.assetId)?.text) } : null
    })()`)
    check('a new track appeared', track !== null, true)
    check('named Captions', track?.name, (name) => /^Captions( \d+)?$/.test(name ?? ''))
    check('and it is the track the tool reported', track?.id, added.value.trackId)
    check(`holding ${cues.length} item(s), one per cue`, track?.items, cues.length)
    check('with the cues\' words, in order', JSON.stringify(track?.texts), JSON.stringify(cues.map((c) => c.text)))

    console.log('\n── French, with downloads off')
    if (multilingual.length > 0) {
      console.log(`     SKIPPED: a multilingual model is installed (${multilingual.map((m) => m.file).join(', ')}), so French would succeed — the refusal cannot be tested here`)
    } else {
      const fr = await call('transcribe', { itemId: clip.id, language: 'fr' }, 5 * 60_000)
      check('it is refused', fr.ok, false)
      check('and the error sends the user to Settings', fr.error, (e) => /Settings/.test(e ?? ''))
      const afterFr = await status()
      check('nothing was downloaded', JSON.stringify(afterFr.installed.map((m) => m.file).sort()), JSON.stringify(before.installed.map((m) => m.file).sort()))
      check('and no download was started', JSON.stringify(afterFr.download), JSON.stringify(before.download))
    }
    return true
  } finally {
    await evaluate(`(window.bayEngine.store.setState({ autoDownloadModels: ${autoWas} }), true)`).catch(() => {})
    console.log(`[transcribe] autoDownloadModels put back to ${await evaluate(`${S}.autoDownloadModels`).catch(() => '?')}`)
  }
}, { timeoutMs: 12 * 60_000 })
