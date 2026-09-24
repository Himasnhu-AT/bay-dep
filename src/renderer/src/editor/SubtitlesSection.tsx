import { useState, type CSSProperties, type ReactNode } from 'react'
import { Captions, LoaderCircle } from 'lucide-react'
import { allItems, findAsset } from '@shared/project'
import { SUBTITLE_STYLES, type SubtitleStyle, type SubtitleStyleId } from '@shared/subtitles'
import { Button } from '@/components'
import { cn } from '@/lib/cn'
import { executeToolCall } from '@/mcp'
import { selectTimeline, useEditor } from '@/store/editor'

/**
 * Word-by-word subtitles, chosen by eye. Each card is a small live picture of its design — the
 * sample phrase with its spoken word marked — because a list of names says nothing about how a
 * design reads. Applying runs `add_subtitles`, the same tool the agent uses, so the result is
 * the same composition, one undo step, and replaces earlier subtitles over that clip.
 */

const SAMPLE = ['you', 'are', 'an', 'overthinker']
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

function lineStyle(id: SubtitleStyleId): CSSProperties {
  switch (id) {
    case 'spotlight':
      return { fontWeight: 800, fontSize: 13, textShadow: '0 1px 6px rgba(0,0,0,.6)' }
    case 'punch':
      return {
        fontFamily: "'Arial Black', 'Helvetica Neue', Arial, sans-serif",
        fontWeight: 900,
        fontSize: 13,
        textTransform: 'uppercase',
        WebkitTextStroke: '3px #000',
        paintOrder: 'stroke fill'
      }
    case 'boxed':
      return { fontWeight: 700, fontSize: 12, background: 'rgba(12,12,14,.85)', borderRadius: 6, padding: '3px 5px' }
    case 'clean':
      return { fontWeight: 600, fontSize: 11.5, textShadow: '0 1px 4px rgba(0,0,0,.6)' }
    case 'reveal':
      return { fontWeight: 750, fontSize: 13, textShadow: '0 1px 6px rgba(0,0,0,.6)' }
  }
}

function StylePreview({ style }: { style: SubtitleStyle }): ReactNode {
  // Punch shows two words at a time, like the design; the rest show the phrase.
  const words = style.id === 'punch' ? SAMPLE.slice(2, 4) : SAMPLE
  const spoken = style.id === 'punch' ? 0 : SPOKEN
  return (
    <div
      aria-hidden="true"
      className="relative flex h-20 items-end justify-center overflow-hidden rounded-sm pb-2.5"
      // A stand-in for footage: a dim, warm gradient, so the text reads the way it will over video.
      style={{ background: 'linear-gradient(160deg, #5b4a42 0%, #2c2623 55%, #151312 100%)' }}
    >
      <span className="text-white" style={{ ...lineStyle(style.id), lineHeight: 1.2, letterSpacing: '-0.01em' }}>
        {words.map((word, i) => (
          <span key={word} style={{ ...wordStyle(style, i < spoken ? 'said' : i === spoken ? 'now' : 'later'), margin: '0 2px' }}>
            {word}
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

  // The selected clip if it has sound; otherwise the first clip on the timeline that does.
  const audible = timeline
    ? allItems(timeline).filter((item) => findAsset(project, item.assetId)?.hasAudio === true && findAsset(project, item.assetId)?.kind !== 'html')
    : []
  const target = audible.find((item) => selection.includes(item.id)) ?? audible[0]
  const targetName = target ? findAsset(project, target.assetId)?.name : null

  const apply = async (): Promise<void> => {
    if (!target) return
    setBusy(true)
    const result = await executeToolCall({ id: `ui-subtitles-${Date.now()}`, tool: 'add_subtitles', args: { itemId: target.id, style: chosen } })
    setBusy(false)
    if (result.ok) {
      const value = result.value as { words?: number; replaced?: string }
      notify(`Subtitles added${value.replaced ? ', replacing the earlier ones' : ''} — ${value.words ?? 0} words. ⌘Z to undo.`)
    } else {
      notify(result.error, 'error')
    }
  }

  return (
    <section aria-labelledby="subtitles-heading" className="mb-5">
      <div className="mb-2 flex items-center gap-1.5">
        <Captions aria-hidden="true" className="size-3.5 text-ink-2" />
        <h3 id="subtitles-heading" className="text-[12px] font-medium text-ink-0">
          Subtitles
        </h3>
      </div>
      <p className="mb-2.5 text-[11px] leading-relaxed text-pretty text-ink-2">
        Word by word, transcribed on this Mac. Pick a design; applying another one later swaps it.
      </p>
      <div role="radiogroup" aria-label="Subtitle design" className="grid grid-cols-2 gap-2">
        {SUBTITLE_STYLES.map((style) => (
          <button
            key={style.id}
            type="button"
            role="radio"
            aria-checked={chosen === style.id}
            title={style.description}
            onClick={() => setChosen(style.id)}
            className={cn(
              't-fast flex flex-col gap-1 rounded-md border p-1 text-left',
              chosen === style.id ? 'border-accent bg-accent/10' : 'border-line hover:border-line-strong'
            )}
          >
            <StylePreview style={style} />
            <span className="px-0.5 text-[11px] font-medium text-ink-0">{style.name}</span>
          </button>
        ))}
      </div>
      <p className="mt-2 min-h-8 text-[11px] leading-snug text-pretty text-ink-2">
        {SUBTITLE_STYLES.find((style) => style.id === chosen)?.description}
      </p>
      <Button
        variant="primary"
        className="mt-1 w-full"
        disabled={!target || busy}
        icon={busy ? <LoaderCircle className="size-3.5 animate-spin" /> : undefined}
        title={target ? undefined : 'Place a clip with sound first'}
        onClick={() => void apply()}
      >
        {busy ? 'Transcribing…' : targetName ? `Add to “${targetName}”` : 'No clip with sound'}
      </Button>
    </section>
  )
}
