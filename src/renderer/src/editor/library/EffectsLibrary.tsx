import { useMemo, useState, type ReactNode } from 'react'
import {
  AudioLines,
  Blend,
  Captions,
  Check,
  Clapperboard,
  FolderOpen,
  Palette,
  Plus,
  Sparkles,
  Type as TypeIcon,
  X,
  type LucideIcon
} from 'lucide-react'
import { findAsset, formatTimecode, type Item, type TransitionKind } from '@shared/project'
import { isGradeableKind } from '@shared/grade'
import { TEMPLATES } from '@shared/templates'
import { Button, ScrollArea, Select, ToolButton } from '@/components'
import { cn } from '@/lib/cn'
import { encodeTransitionDrag, TRANSITION_DRAG_TYPE } from '@/lib/transitionDrag'
import { whyNoRoom } from '@/lib/junctions'
import { importMediaDialog } from '@/lib/mediaActions'
import { useSelectedItems } from '@/lib/useSelectedItems'
import { selectTimeline, useEditor } from '@/store/editor'
import { CodeEditorModal, createMotionGraphic } from '../CodeEditorModal'
import { ClipPresets } from '../EffectsPanel'
import { TemplateList } from '../TemplatesPanel'
import { QuickTitle } from '../TextPanel'
import { LibraryHeader } from './LibraryHeader'
import { requestLibrary, useMediaSelection } from './librarySignals'
import {
  applyTransition,
  AUDIO_TRANSITIONS,
  currentTarget,
  memoJunctionCandidates,
  nearestCandidate,
  VIDEO_TRANSITIONS,
  type CutTrackKind
} from './transitions'

export type EffectsCategory = 'video-transitions' | 'audio-transitions' | 'titles' | 'generators' | 'effects' | 'luts'

const CATEGORIES: { id: EffectsCategory; label: string; icon: LucideIcon; group: 'Toolbox' | 'Colour' }[] = [
  { id: 'video-transitions', label: 'Video Transitions', icon: Blend, group: 'Toolbox' },
  { id: 'audio-transitions', label: 'Audio Transitions', icon: AudioLines, group: 'Toolbox' },
  { id: 'titles', label: 'Titles', icon: TypeIcon, group: 'Toolbox' },
  { id: 'generators', label: 'Generators', icon: Clapperboard, group: 'Toolbox' },
  { id: 'effects', label: 'Effects', icon: Sparkles, group: 'Toolbox' },
  { id: 'luts', label: 'LUTs', icon: Palette, group: 'Colour' }
]

const CATEGORY_KEY = 'bay.library.effects.category'
const TREE_KEY = 'bay.library.effects.tree'

function readKey(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeKey(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Remembered for this session only.
  }
}

/** Title-like templates go under Titles; the rest (callouts, counters, bars) under Generators. */
const TITLE_TEMPLATES = TEMPLATES.filter((spec) => spec.category === 'caption' || spec.category === 'identity')
const GENERATOR_TEMPLATES = TEMPLATES.filter((spec) => spec.category !== 'caption' && spec.category !== 'identity')

/**
 * The Effects Library, after Resolve's Toolbox: a category tree on the left and that category's
 * items on the right. Transitions go on a cut with one click (no ⌘T, no hunting for the junction
 * marker); titles, templates and motion graphics are added at the playhead; looks, framing, fades,
 * speed and LUTs act on the clips selected on the timeline.
 */
export function EffectsLibrary(): ReactNode {
  const [category, setCategory] = useState<EffectsCategory>(() => {
    const stored = readKey(CATEGORY_KEY)
    return CATEGORIES.some((c) => c.id === stored) ? (stored as EffectsCategory) : 'video-transitions'
  })
  const [tree, setTree] = useState(() => readKey(TREE_KEY) !== '0')
  const choose = (next: EffectsCategory): void => {
    setCategory(next)
    writeKey(CATEGORY_KEY, next)
  }
  const current = CATEGORIES.find((c) => c.id === category) ?? CATEGORIES[0]!

  return (
    <section aria-label="Effects Library" className="flex h-full min-h-0 min-w-0 flex-col bg-surface-1">
      <LibraryHeader
        title="Effects"
        count={tree ? undefined : current.label}
        menu={[
          {
            label: tree ? 'Hide Category List' : 'Show Category List',
            checked: tree,
            onSelect: () => {
              setTree(!tree)
              writeKey(TREE_KEY, tree ? '0' : '1')
            }
          }
        ]}
        menuLabel="More effects options"
      />
      <div className="flex min-h-0 flex-1">
        {tree && (
          <nav aria-label="Effect categories" className="flex w-[7.75rem] shrink-0 flex-col border-r border-line bg-chrome py-1.5">
            {(['Toolbox', 'Colour'] as const).map((group) => (
              <div key={group} className="mb-1.5">
                <p className="px-2.5 pb-0.5 text-[9px] font-semibold tracking-[0.08em] text-ink-2 uppercase">{group}</p>
                {CATEGORIES.filter((c) => c.group === group).map((c) => {
                  const Icon = c.icon
                  const active = c.id === category
                  return (
                    <button
                      key={c.id}
                      type="button"
                      aria-current={active ? 'true' : undefined}
                      onClick={() => choose(c.id)}
                      className={cn(
                        't-fast relative flex w-full items-center gap-1.5 px-2.5 py-1 text-left text-[11px] leading-tight',
                        active ? 'bg-surface-3 text-ink-0' : 'text-ink-1 hover:bg-surface-2 hover:text-ink-0'
                      )}
                    >
                      {active && <span aria-hidden="true" className="absolute inset-y-1 left-0 w-[2px] rounded-r-full bg-accent" />}
                      <Icon aria-hidden="true" className={cn('size-3.5 shrink-0', active ? 'text-accent' : 'text-ink-2')} />
                      <span className="min-w-0">{c.label}</span>
                    </button>
                  )
                })}
              </div>
            ))}
          </nav>
        )}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {!tree && (
            <div className="border-b border-line px-2 py-1.5">
              <Select
                label="Effect category"
                value={category}
                onChange={(value) => choose(value as EffectsCategory)}
                options={CATEGORIES.map((c) => ({ value: c.id, label: c.label }))}
              />
            </div>
          )}
          <ScrollArea className="min-h-0 flex-1">
            {category === 'video-transitions' && <TransitionList trackKind="video" />}
            {category === 'audio-transitions' && <TransitionList trackKind="audio" />}
            {category === 'titles' && <Titles />}
            {category === 'generators' && <Generators />}
            {category === 'effects' && <ClipPresets />}
            {category === 'luts' && <Luts />}
          </ScrollArea>
        </div>
      </div>
    </section>
  )
}

// -- transitions ---------------------------------------------------------------------------------

/** A still of what a transition does, drawn from outgoing (A) to incoming (B). */
function TransitionGlyph({ kind }: { kind: TransitionKind }): ReactNode {
  const a = 'var(--color-clip-video)'
  const b = 'var(--color-accent)'
  const body = (() => {
    switch (kind) {
      case 'cross-dissolve':
        return (
          <>
            <defs>
              <linearGradient id="g-dissolve" x1="0" x2="1">
                <stop offset="0.15" stopColor={a} />
                <stop offset="0.85" stopColor={b} />
              </linearGradient>
            </defs>
            <rect width="48" height="28" fill="url(#g-dissolve)" />
          </>
        )
      case 'dip-to-black':
      case 'dip-to-white': {
        const dip = kind === 'dip-to-black' ? '#000' : '#fff'
        return (
          <>
            <rect width="16" height="28" fill={a} />
            <rect x="16" width="16" height="28" fill={dip} />
            <rect x="32" width="16" height="28" fill={b} />
          </>
        )
      }
      case 'wipe':
        return (
          <>
            <rect width="48" height="28" fill={a} />
            <rect width="22" height="28" fill={b} />
            <line x1="22" x2="22" y1="0" y2="28" stroke="#fff" strokeWidth="1" />
          </>
        )
      case 'push':
        return (
          <>
            <rect width="48" height="28" fill={a} />
            <rect width="24" height="28" fill={b} />
            <path d="M28 14h12m-4 -4 4 4 -4 4" stroke="#fff" strokeWidth="1.5" fill="none" />
          </>
        )
      case 'slide':
        return (
          <>
            <rect width="48" height="28" fill={a} />
            <rect x="-2" y="3" width="26" height="22" fill={b} stroke="#fff" strokeWidth="1" />
          </>
        )
      case 'iris':
        return (
          <>
            <rect width="48" height="28" fill={a} />
            <circle cx="24" cy="14" r="10" fill={b} />
          </>
        )
    }
  })()
  return (
    <svg aria-hidden="true" viewBox="0 0 48 28" className="h-7 w-12 shrink-0 overflow-hidden rounded-xs">
      {body}
    </svg>
  )
}

function AudioGlyph({ kind }: { kind: TransitionKind }): ReactNode {
  // Two gain curves: the outgoing falling, the incoming rising — through silence for a dip.
  const out = kind === 'cross-dissolve' ? 'M2 6 C 20 6, 28 22, 46 22' : 'M2 6 C 12 6, 20 24, 24 24'
  const inn = kind === 'cross-dissolve' ? 'M2 22 C 20 22, 28 6, 46 6' : 'M24 24 C 28 24, 36 6, 46 6'
  return (
    <svg aria-hidden="true" viewBox="0 0 48 28" className="h-7 w-12 shrink-0 rounded-xs bg-surface-0">
      <path d={out} stroke="var(--color-clip-audio)" strokeWidth="2" fill="none" />
      <path d={inn} stroke="var(--color-accent)" strokeWidth="2" fill="none" />
    </svg>
  )
}

/**
 * The transitions for one kind of track, each applied with a click to the cut the header names:
 * the cut between two selected clips, else the one nearest the playhead. A cut that already has
 * a transition has it changed to the one clicked, keeping its length.
 */
function TransitionList({ trackKind }: { trackKind: CutTrackKind }): ReactNode {
  // A string, so the list re-renders when the target cut changes — not on every playhead frame.
  // The cuts themselves are found once per edit or selection (`memoJunctionCandidates`); the
  // selector runs on every store change, playhead frames included, and only picks the nearest.
  const [candidatesFor] = useState(memoJunctionCandidates)
  const key = useEditor((state) => {
    const timeline = selectTimeline(state)
    if (!timeline) return ''
    const junction = nearestCandidate(candidatesFor(state.project, timeline, trackKind, state.selection), state.playhead)
    return junction ? `${junction.key}|${junction.transition?.kind ?? ''}|${junction.capacityInFrames}` : ''
  })
  const timeline = useEditor(selectTimeline)
  const fps = timeline?.fps ?? 30
  const target = key ? currentTarget(trackKind) : null
  const trackName = target ? (timeline?.tracks.find((t) => t.id === target.trackId)?.name ?? 'its track') : ''
  const reason = target ? whyNoRoom(target) : null
  const list = trackKind === 'video' ? VIDEO_TRANSITIONS : AUDIO_TRANSITIONS

  return (
    <div>
      <div className="border-b border-line px-3 py-2 text-[11px] leading-snug text-pretty">
        {target ? (
          <>
            <span className="text-ink-2">Applies to the cut at </span>
            <span className="text-ink-0 tabular-nums">{formatTimecode(target.cutFrame, fps, true)}</span>
            <span className="text-ink-2"> on {trackName}</span>
            {reason && <span className="mt-1 block text-warning">This cut has no footage to spare: trim a clip first.</span>}
          </>
        ) : (
          <span className="text-ink-2">
            {trackKind === 'video'
              ? 'No cut yet: place two clips so they touch on one video track.'
              : 'No cut on an audio track. A video clip’s own sound follows its picture’s transition.'}
          </span>
        )}
        <span className="mt-1 block text-[10px] text-ink-2">Select two touching clips to choose a cut; otherwise the one nearest the playhead.</span>
      </div>
      <ul className="flex flex-col p-1.5">
        {list.map((option) => {
          const on = target?.transition?.kind === option.kind
          return (
            <li key={option.kind}>
              <button
                type="button"
                // Not disabled when there is no target here: a row still drags onto any cut on the
                // timeline, and a click says why nothing happened (`applyTransition`).
                aria-label={`Apply ${option.label}${target ? ` to the cut at ${formatTimecode(target.cutFrame, fps, true)}` : ''}, or drag it onto a cut`}
                title="Click to apply to the cut named above, or drag onto any cut on the timeline"
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.setData(TRANSITION_DRAG_TYPE, encodeTransitionDrag({ kind: option.kind, trackKind, label: option.label }))
                  event.dataTransfer.effectAllowed = 'copy'
                }}
                onClick={() => applyTransition(option.kind, trackKind, option.label)}
                className={cn(
                  't-press flex w-full cursor-grab items-center gap-2 rounded-sm px-1.5 py-1.5 text-left active:scale-[0.98]',
                  (!target || reason !== null) && 'opacity-60',
                  on ? 'bg-accent/14' : 'hover:bg-surface-3'
                )}
              >
                {trackKind === 'video' ? <TransitionGlyph kind={option.kind} /> : <AudioGlyph kind={option.kind} />}
                <span className="min-w-0 flex-1">
                  <span className={cn('block text-[12px]', on ? 'text-accent' : 'text-ink-0')}>{option.label}</span>
                  <span className="block truncate text-[11px] text-ink-2">{option.description}</span>
                </span>
                {on ? <Check aria-hidden="true" className="size-3.5 text-accent" /> : <Plus aria-hidden="true" className="size-3.5 text-ink-2" />}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// -- titles and generators -----------------------------------------------------------------------

function Heading({ children }: { children: ReactNode }): ReactNode {
  return <h3 className="px-3 pt-3 pb-1.5 text-[10px] font-semibold tracking-[0.08em] text-ink-1 uppercase">{children}</h3>
}

function Titles(): ReactNode {
  return (
    <div>
      <Heading>Text</Heading>
      <div className="px-3 pb-3">
        <QuickTitle />
      </div>
      <Heading>Title templates</Heading>
      <TemplateList specs={TITLE_TEMPLATES} />
      <div className="m-3 flex items-start gap-2 rounded-sm border border-line bg-surface-2 p-2.5">
        <Captions aria-hidden="true" className="mt-px size-3.5 shrink-0 text-ink-2" />
        <div className="min-w-0 text-[11px] leading-relaxed text-ink-2">
          Word-by-word subtitles are made from the transcript.
          <Button
            size="sm"
            variant="subtle"
            className="mt-1.5"
            onClick={() => {
              useEditor.getState().setPanel('transcript')
              requestLibrary('subtitles')
            }}
          >
            Open Subtitles
          </Button>
        </div>
      </div>
    </div>
  )
}

function Generators(): ReactNode {
  const [editing, setEditing] = useState<string | null>(null)
  const select = useMediaSelection((state) => state.select)
  return (
    <div>
      <Heading>Motion graphic</Heading>
      <div className="px-3 pb-3">
        <Button
          variant="subtle"
          className="w-full"
          icon={<Sparkles className="size-3.5" />}
          onClick={() =>
            void createMotionGraphic().then((assetId) => {
              if (!assetId) return
              select(assetId)
              setEditing(assetId)
            })
          }
        >
          New Motion Graphic…
        </Button>
        <p className="mt-1.5 text-[11px] leading-relaxed text-ink-2">A code-drawn animation, added to the media pool and opened in the code editor.</p>
      </div>
      <Heading>Templates</Heading>
      <TemplateList specs={GENERATOR_TEMPLATES} />
      <CodeEditorModal assetId={editing} open={editing !== null} onClose={() => setEditing(null)} />
    </div>
  )
}

// -- LUTs ----------------------------------------------------------------------------------------

/**
 * The project's `.cube` LUTs, applied to the selected clips' grade at full strength (the Grade
 * section in the inspector sets the strength). Importing one is the pool's import; a LUT is an
 * asset like any other, never placed.
 */
function Luts(): ReactNode {
  const assets = useEditor((state) => state.project.assets)
  const luts = useMemo(() => assets.filter((asset) => asset.kind === 'lut'), [assets])
  const selected = useSelectedItems()
  const project = useEditor((state) => state.project)
  const timeline = useEditor(selectTimeline)
  const patchItem = useEditor((state) => state.patchItem)
  const transact = useEditor((state) => state.transact)
  const notify = useEditor((state) => state.notify)

  const kindOf = (item: Item) => findAsset(project, item.assetId)?.kind
  const trackKindOf = (item: Item) => timeline?.tracks.find((track) => track.id === item.trackId)?.kind
  // What a grade draws on: a picture on a video track, as the Color page's LUT list decides it
  // (`isGradeableKind`), not every visual item: a title has no pixels for a LUT to map.
  const visual = selected.filter((item) => trackKindOf(item) === 'video' && isGradeableKind(kindOf(item)))
  const anyLut = visual.some((item) => item.grade?.lut)

  const apply = (assetId: string | null): void => {
    transact(() => {
      for (const item of visual) {
        const { lut: _removed, ...rest } = item.grade ?? {}
        const next = assetId ? { ...rest, lut: { assetId, intensity: item.grade?.lut?.intensity ?? 1 } } : rest
        patchItem(item.id, { grade: Object.keys(next).length > 0 ? next : undefined })
      }
    })
    const name = assetId ? luts.find((l) => l.id === assetId)?.name : null
    notify(
      `${name ? `${name} applied to` : 'LUT removed from'} ${visual.length === 1 ? '1 clip' : `${visual.length} clips`}. ⌘Z to undo.`
    )
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-0.5 border-b border-line px-1.5 py-1">
        <ToolButton label="Import LUT" icon={<FolderOpen className="size-3.5" />} onClick={() => void importMediaDialog()} />
        {anyLut && <ToolButton label="Remove LUT" icon={<X className="size-3.5" />} onClick={() => apply(null)} />}
      </div>
      <p className="px-3 pt-2.5 text-[11px] text-ink-2">
        {visual.length === 0 ? 'Select clips on the timeline to apply a LUT.' : `Applies to ${visual.length === 1 ? '1 clip' : `${visual.length} clips`}.`}
      </p>
      {luts.length === 0 ? (
        <p className="px-3 py-3 text-[11px] leading-relaxed text-ink-2">
          No LUTs in this project yet. Import a .cube file to grade with it.
        </p>
      ) : (
        <ul className="flex flex-col p-1.5">
          {luts.map((lut) => {
            const on = visual.length > 0 && visual.every((item) => item.grade?.lut?.assetId === lut.id)
            return (
              <li key={lut.id}>
                <button
                  type="button"
                  // A LUT that could not be read maps nothing, so it cannot be applied, as on the Color page.
                  disabled={visual.length === 0 || Boolean(lut.error)}
                  aria-pressed={on}
                  title={lut.error ?? undefined}
                  onClick={() => apply(lut.id)}
                  className={cn(
                    't-press flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left active:scale-[0.98]',
                    'disabled:pointer-events-none disabled:opacity-45',
                    on ? 'bg-accent/14' : 'hover:bg-surface-3'
                  )}
                >
                  <Palette aria-hidden="true" className="size-3.5 shrink-0 text-ink-2" />
                  <span className="min-w-0 flex-1">
                    <span className={cn('block truncate text-[12px]', on ? 'text-accent' : 'text-ink-0')}>{lut.name}</span>
                    {lut.error && <span className="block truncate text-[10px] text-danger">{lut.error}</span>}
                  </span>
                  {on && <Check aria-hidden="true" className="size-3.5 text-accent" />}
                </button>
              </li>
            )
          })}
        </ul>
      )}
      <p className="px-3 pb-3 text-[10px] leading-relaxed text-ink-2">Set the LUT’s strength in the inspector’s Grade section.</p>
    </div>
  )
}
