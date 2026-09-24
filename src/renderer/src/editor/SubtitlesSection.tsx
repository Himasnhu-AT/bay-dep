import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Captions, LoaderCircle } from 'lucide-react'
import { allItems, findAsset, findTrack, formatTimecode } from '@shared/project'
import { SUBTITLE_STYLES, type SubtitleStyle, type SubtitleStyleId } from '@shared/subtitles'
import { Button, ColorField, Field, Section, SectionReset, Select, SliderField } from '@/components'
import { bay } from '@/lib/bay'
import { cn } from '@/lib/cn'
import { FOCUS_REQUEST_EVENT, takeFocusRequest } from '@/lib/focusRequest'
import { describeSubtitleStyle, hasModelFor, previewFitRatio, SUBTITLE_LANGUAGES, subtitleArgs } from '@/lib/subtitleOptions'
import { addSubtitles } from '@/mcp/subtitles'
import { runUserTool } from '@/lib/userTool'
import { selectTimeline, useEditor } from '@/store/editor'

/**
 * Word-by-word subtitles, chosen by eye. Each card is a small live picture of its design — the
 * sample phrase with its spoken word marked — because a list of names says nothing about how a
 * design reads. Applying runs `add_subtitles`, the same tool the agent uses, so the result is
 * the same composition, one undo step, and replaces earlier subtitles over that clip.
 */

const SAMPLE = ['this', 'is', 'your', 'subtitle']
const SPOKEN = 2

function wordStyle(style: SubtitleStyle, state: 'said' | 'now' | 'later'): CSSProperties {
  const now = state === 'now'
  switch (style.id) {
    case 'spotlight':
      return { color: now ? style.accent : '#fff' }
    case 'punch':
      return {
        color: now ? style.accent : '#fff',
        display: 'inline-block',
        transform: now ? 'scale(1.12)' : undefined
      }
    case 'boxed':
      return { background: now ? style.accent : 'transparent', borderRadius: 4, padding: '0 3px' }
    case 'clean':
      return { color: '#fff' }
    case 'reveal':
      return {
        visibility: state === 'later' ? 'hidden' : 'visible',
        boxShadow: now ? `inset 0 -3px 0 ${style.accent}` : undefined
      }
  }
}

/** The design's line at `size` × its base size — font size, not `zoom`, so the line still wraps inside the card. */
function lineStyle(id: SubtitleStyleId, size: number): CSSProperties {
  switch (id) {
    case 'spotlight':
      return { fontWeight: 800, fontSize: 13 * size, textShadow: '0 1px 6px rgba(0,0,0,.6)' }
    case 'punch':
      return {
        fontFamily: "'Arial Black', 'Helvetica Neue', Arial, sans-serif",
        fontWeight: 900,
        fontSize: 13 * size,
        textTransform: 'uppercase',
        WebkitTextStroke: '3px #000',
        paintOrder: 'stroke fill'
      }
    case 'boxed':
      return { fontWeight: 700, fontSize: 12 * size, background: 'rgba(12,12,14,.85)', borderRadius: 6, padding: '3px 5px' }
    case 'clean':
      return { fontWeight: 600, fontSize: 11.5 * size, textShadow: '0 1px 4px rgba(0,0,0,.6)' }
    case 'reveal':
      return { fontWeight: 750, fontSize: 13 * size, textShadow: '0 1px 6px rgba(0,0,0,.6)' }
  }
}

function StylePreview({ style, scale = 1, bottom }: { style: SubtitleStyle; scale?: number; bottom: number }): ReactNode {
  // Punch shows two words at a time, like the design; the rest show the phrase.
  const words = style.id === 'punch' ? SAMPLE.slice(2, 4) : SAMPLE
  const spoken = style.id === 'punch' ? 0 : SPOKEN
  // Roughly the size the design will draw at; the card is too small to show 2× honestly.
  const size = Math.min(1.4, Math.max(0.6, scale))
  // What the line is shrunk by so it fits its card: a word wider than the card cannot wrap, and
  // was cut at the right edge ("this is your subtit"), worse at 125% UI zoom. Measured after
  // layout and re-measured whenever the design, size or card width changes.
  const [fit, setFit] = useState(1)
  const cardRef = useRef<HTMLDivElement>(null)
  const lineRef = useRef<HTMLSpanElement>(null)
  const [cardWidth, setCardWidth] = useState(0)
  useEffect(() => {
    const card = cardRef.current
    if (!card) return
    const observer = new ResizeObserver(() => setCardWidth(card.clientWidth))
    observer.observe(card)
    return () => observer.disconnect()
  }, [])
  useLayoutEffect(() => setFit(1), [style.id, size, cardWidth])
  useLayoutEffect(() => {
    const card = cardRef.current
    const line = lineRef.current
    if (!card || !line || line.clientWidth === 0) return
    const ratio = previewFitRatio(
      { width: line.scrollWidth, height: line.offsetHeight },
      { width: line.clientWidth, height: card.clientHeight - 8 }
    )
    if (ratio < 1) setFit((current) => Math.max(0.4, current * ratio))
  })
  return (
    <div
      ref={cardRef}
      aria-hidden="true"
      className="relative h-20 overflow-hidden rounded-sm"
      // A stand-in for footage: a dim, warm gradient, so the text reads the way it will over video.
      style={{ background: 'linear-gradient(160deg, #5b4a42 0%, #2c2623 55%, #151312 100%)' }}
    >
      {/* Placed as the design places its band: `bottom` percent up the frame, inset from the
          sides, wrapping rather than running off the card. Held inside the card at the top, so a
          high setting still shows the line rather than cropping it away. */}
      <span
        ref={lineRef}
        className="absolute inset-x-1.5 block text-center text-balance text-white"
        style={{
          ...lineStyle(style.id, size * fit),
          bottom: `clamp(4px, ${bottom}%, calc(100% - 2.8em))`,
          lineHeight: 1.2,
          letterSpacing: '-0.01em'
        }}
      >
        {/* Real spaces between the words: with margins alone the phrase had no break
            opportunity, so it could never wrap and ran off the card instead. */}
        {words.map((word, i) => (
          <span key={word}>
            {i > 0 && ' '}
            <span style={wordStyle(style, i < spoken ? 'said' : i === spoken ? 'now' : 'later')}>{word}</span>
          </span>
        ))}
      </span>
    </div>
  )
}

export function SubtitlesSection(): ReactNode {
  const timeline = useEditor(selectTimeline)
  const project = useEditor((state) => state.project)
  const selection = useEditor((state) => state.selection)
  const notify = useEditor((state) => state.notify)
  const [chosen, setChosen] = useState<SubtitleStyleId>('spotlight')
  const [busy, setBusy] = useState(false)
  // Null until the user picks one: until then the target follows the selection.
  const [picked, setPicked] = useState<string | null>(null)
  const [language, setLanguage] = useState('en')
  const [accent, setAccent] = useState<string | null>(null)
  const [scale, setScale] = useState(1)
  const [bottom, setBottom] = useState<number | null>(null)
  const [modelFiles, setModelFiles] = useState<string[] | null>(null)
  const sectionRef = useRef<HTMLElement>(null)

  // Media › Add Subtitles… opens this panel from a menu over a tile the switch unmounts: focus
  // comes here, to the first control, rather than falling to the page body.
  useEffect(() => {
    const focusIfAsked = (): void => {
      if (!takeFocusRequest('subtitles')) return
      requestAnimationFrame(() => {
        const first = sectionRef.current?.querySelector<HTMLElement>(
          'button:not([disabled]), select:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
        ;(first ?? sectionRef.current)?.focus()
      })
    }
    focusIfAsked()
    window.addEventListener(FOCUS_REQUEST_EVENT, focusIfAsked)
    return () => window.removeEventListener(FOCUS_REQUEST_EVENT, focusIfAsked)
  }, [])

  // Clips with sound, in timeline order. A composition's sound is not speech to transcribe.
  const audible = timeline
    ? allItems(timeline)
        .filter((item) => {
          const asset = findAsset(project, item.assetId)
          return asset?.hasAudio === true && asset.kind !== 'html'
        })
        .sort((a, b) => a.from - b.from)
    : []
  // The picked clip; else the selected clip with sound; else the first clip that has sound.
  const target =
    audible.find((item) => item.id === picked) ??
    audible.find((item) => selection.includes(item.id)) ??
    audible[0]
  const style = SUBTITLE_STYLES.find((s) => s.id === chosen) ?? SUBTITLE_STYLES[0]!

  // Which models are on this Mac, so a non-English choice can say it needs a multilingual one.
  // Asked only once a language other than English is chosen: English is always served.
  useEffect(() => {
    if (language === 'en' || modelFiles !== null) return
    let live = true
    bay()
      ?.whisper.status()
      .then((status) => {
        if (live) setModelFiles(status.installed.map((model) => model.file))
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [language, modelFiles])

  const clipLabel = (itemId: string): string => {
    const item = audible.find((i) => i.id === itemId)
    if (!item || !timeline) return itemId
    const name = findAsset(project, item.assetId)?.name ?? 'Clip'
    const track = findTrack(timeline, item.trackId)?.name
    return `${name}${track ? ` · ${track}` : ''} · ${formatTimecode(item.from, timeline.fps)}`
  }

  const designEdited = accent !== null || scale !== 1 || bottom !== null
  const needsModel = language !== 'en' && modelFiles !== null && !hasModelFor(modelFiles, language)

  const apply = async (): Promise<void> => {
    if (!target) return
    setBusy(true)
    const args = subtitleArgs({ itemId: target.id, style, language, accent, scale, bottom })
    const result = await runUserTool('add_subtitles', addSubtitles, args)
    setBusy(false)
    if (result.ok) {
      const value = result.value as { words?: number; replaced?: string }
      notify(`Subtitles added${value.replaced ? ', replacing the earlier ones' : ''} — ${value.words ?? 0} words. ⌘Z to undo.`)
    } else {
      notify(result.error, 'error')
    }
  }

  return (
    <section ref={sectionRef} tabIndex={-1} aria-labelledby="subtitles-heading" className="mb-5 outline-none">
      <div className="mb-2 flex items-center gap-1.5">
        <Captions aria-hidden="true" className="size-3.5 text-ink-2" />
        <h3 id="subtitles-heading" className="text-[12px] font-medium text-ink-0">
          Subtitles
        </h3>
      </div>
      <p className="mb-2.5 text-[11px] leading-relaxed text-pretty text-ink-2">
        Word by word, transcribed on this Mac. Pick a design; applying another one later swaps it.
      </p>
      <div className="mb-2.5 grid gap-1.5">
        <Field label="Clip">
          {target ? (
            <Select
              label="Clip to subtitle"
              value={target.id}
              options={audible.map((item) => ({ value: item.id, label: clipLabel(item.id) }))}
              onChange={setPicked}
            />
          ) : (
            <p className="text-[11px] text-ink-2">No clip with sound on the timeline.</p>
          )}
        </Field>
        <Field label="Language">
          <Select label="Spoken language" value={language} options={[...SUBTITLE_LANGUAGES]} onChange={setLanguage} />
        </Field>
        {language !== 'en' && (
          <p className="text-[10px] leading-relaxed text-pretty text-ink-2">
            {needsModel
              ? 'Only English models are on this Mac. A multilingual one downloads on first use if Settings › Transcription allows it; otherwise download one there.'
              : 'Other languages use a multilingual model — the ones not marked “English” in Settings › Transcription.'}
          </p>
        )}
      </div>
      <div role="radiogroup" aria-label="Subtitle design" className="grid grid-cols-2 gap-2">
        {SUBTITLE_STYLES.map((option) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={chosen === option.id}
            title={describeSubtitleStyle(option, accent)}
            onClick={() => setChosen(option.id)}
            className={cn(
              't-press flex flex-col gap-1 rounded-md border p-1 text-left active:scale-[0.96]',
              chosen === option.id ? 'border-accent bg-accent/10' : 'border-line hover:border-line-strong'
            )}
          >
            <StylePreview style={accent ? { ...option, accent } : option} scale={scale} bottom={bottom ?? option.bottom} />
            <span className="px-0.5 text-[11px] font-medium text-ink-0">{option.name}</span>
          </button>
        ))}
      </div>
      <p className="mt-2 min-h-8 text-[11px] leading-snug text-pretty text-ink-2">{describeSubtitleStyle(style, accent)}</p>
      <Section
        title="Design options"
        collapsible
        defaultOpen={false}
        id="text.subtitles.design"
        className="-mx-3"
        actions={
          <SectionReset
            show={designEdited}
            label="Reset design options"
            onReset={() => {
              setAccent(null)
              setScale(1)
              setBottom(null)
            }}
          />
        }
      >
        <div className="grid gap-1.5">
          <Field label="Highlight">
            <ColorField label="Highlight colour" value={accent ?? style.accent} onCommit={setAccent} />
          </Field>
          <SliderField
            label="Size"
            ariaLabel="Text size, relative to the design"
            value={scale}
            min={0.5}
            max={2}
            step={0.05}
            format={(v) => `${Math.round(v * 100)}%`}
            onCommit={setScale}
          />
          <SliderField
            label="Bottom"
            ariaLabel="Distance from the bottom of the frame, in percent"
            value={bottom ?? style.bottom}
            min={0}
            max={90}
            step={1}
            format={(v) => `${Math.round(v)}%`}
            onCommit={setBottom}
          />
        </div>
      </Section>
      <Button
        variant="primary"
        className="mt-2 w-full"
        disabled={!target || busy}
        icon={busy ? <LoaderCircle className="size-3.5 animate-spin" /> : undefined}
        title={target ? undefined : 'Place a clip with sound first'}
        onClick={() => void apply()}
      >
        {busy ? 'Transcribing…' : target ? 'Add subtitles' : 'No clip with sound'}
      </Button>
    </section>
  )
}
