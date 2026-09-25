import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Bookmark,
  Check,
  Film,
  LoaderCircle,
  MessageSquare,
  MonitorPlay,
  Plus,
  RotateCcw,
  ScanSearch,
  Scissors,
  Search,
  Settings2,
  Square,
  Trash2
} from 'lucide-react'
import { formatTimecode, type Marker, type ReviewComment } from '@shared/project'
import { describeJob, formatModelBytes, VISION_MODEL_BYTES, type VisionStatus } from '@shared/visual-search'
import { Button, IconButton, InlineAlert, ProgressBar, ScrollArea, SearchField, Tabs, ToolButton } from '@/components'
import { bay, formatSourceDuration } from '@/lib/bay'
import { cn } from '@/lib/cn'
import { junctionsForTrack, type Junction } from '@/lib/junctions'
import { revealItem } from '@/lib/revealItem'
import { indexFootage, searchFootage } from '@/mcp/footage'
import { selectTimeline, useEditor } from '@/store/editor'
import { CommentComposer } from '../TimelineComments'
import { TransitionDialog } from '../TransitionDialog'
import { editRows, type EditRow } from './indexLists'
import { LibraryHeader } from './LibraryHeader'
import { openInSource } from './librarySignals'
import { VIDEO_TRANSITIONS } from './transitions'

type IndexView = 'markers' | 'comments' | 'edits' | 'search'
const VIEW_KEY = 'bay.library.index'
const NO_MARKERS: readonly Marker[] = []
const NO_COMMENTS: readonly ReviewComment[] = []

function readView(): IndexView {
  try {
    const value = localStorage.getItem(VIEW_KEY)
    return value === 'comments' || value === 'edits' || value === 'search' ? value : 'markers'
  } catch {
    return 'markers'
  }
}

/**
 * The timeline as lists — Resolve's Edit Index: its markers, its review comments, every edit
 * point, and visual search over the footage. Every row moves the playhead to where it is; the
 * rows also carry what can be done there (delete a marker, resolve a comment, put a transition on
 * a cut, open a search hit in the source viewer).
 */
export function IndexPanel(): ReactNode {
  const [view, setViewState] = useState<IndexView>(readView)
  const setView = (next: IndexView): void => {
    setViewState(next)
    try {
      localStorage.setItem(VIEW_KEY, next)
    } catch {
      // Remembered for this session only.
    }
  }
  const markers = useEditor((state) => selectTimeline(state)?.markers ?? NO_MARKERS)
  const comments = useEditor((state) => selectTimeline(state)?.comments ?? NO_COMMENTS)
  const openComments = comments.filter((c) => !c.resolved).length

  return (
    <section aria-label="Index" className="flex h-full min-h-0 min-w-0 flex-col bg-surface-1">
      <LibraryHeader title="Index" />
      <div className="shrink-0 border-b border-line px-2 py-1.5">
        <Tabs<IndexView>
          label="Index lists"
          variant="pill"
          value={view}
          onChange={setView}
          className="w-full [&>button]:flex-1"
          items={[
            { value: 'markers', label: 'Markers', icon: <Bookmark aria-hidden="true" className="size-3" />, badge: markers.length },
            { value: 'comments', label: 'Notes', icon: <MessageSquare aria-hidden="true" className="size-3" />, badge: openComments },
            { value: 'edits', label: 'Edits', icon: <Scissors aria-hidden="true" className="size-3" /> },
            { value: 'search', label: 'Search', icon: <ScanSearch aria-hidden="true" className="size-3" /> }
          ]}
        />
      </div>
      {view === 'markers' && <MarkerList markers={markers} />}
      {view === 'comments' && <CommentList comments={comments} />}
      {view === 'edits' && <EditList />}
      {view === 'search' && <VisualSearch />}
    </section>
  )
}

/** A row's time, the whole row a button that moves the playhead there. */
function JumpRow({
  frame,
  fps,
  children,
  actions,
  dim
}: {
  frame: number
  fps: number
  children: ReactNode
  actions?: ReactNode
  dim?: boolean
}): ReactNode {
  return (
    <li className="group flex items-start gap-1 rounded-sm pr-1 hover:bg-surface-3">
      <button
        type="button"
        onClick={() => useEditor.getState().setPlayhead(frame)}
        className={cn(
          't-fast flex min-w-0 flex-1 items-start gap-2 rounded-sm px-2 py-1.5 text-left text-[12px] focus-visible:outline-2 focus-visible:outline-accent',
          dim ? 'text-ink-2' : 'text-ink-0'
        )}
      >
        <span className="mt-px shrink-0 text-[11px] text-ink-2 tabular-nums">{formatTimecode(frame, fps, true)}</span>
        <span className="min-w-0 flex-1">{children}</span>
      </button>
      {actions && <span className="flex shrink-0 items-center gap-0.5 pt-1">{actions}</span>}
    </li>
  )
}

function Empty({ children }: { children: ReactNode }): ReactNode {
  return <p className="px-3 py-4 text-[11px] leading-relaxed text-ink-2">{children}</p>
}

// -- markers -------------------------------------------------------------------------------------

function MarkerList({ markers }: { markers: readonly Marker[] }): ReactNode {
  const fps = useEditor((state) => selectTimeline(state)?.fps ?? 30)
  const sorted = useMemo(() => [...markers].sort((a, b) => a.frame - b.frame), [markers])
  return (
    <>
      <div className="flex shrink-0 items-center gap-0.5 border-b border-line px-1.5 py-1">
        <ToolButton
          label="Add Marker"
          shortcut="M"
          icon={<Plus className="size-3.5" />}
          onClick={() => {
            const state = useEditor.getState()
            state.addMarker(state.playhead)
          }}
        />
      </div>
      <ScrollArea className="min-h-0 flex-1 p-1.5">
        {sorted.length === 0 ? (
          <Empty>No markers yet. Add one at the playhead to note a moment; the ruler shows it as a flag.</Empty>
        ) : (
          <ul className="flex flex-col">
            {sorted.map((marker) => (
              <JumpRow
                key={marker.id}
                frame={marker.frame}
                fps={fps}
                actions={
                  <IconButton
                    size="xs"
                    variant="danger"
                    label={`Delete marker ${marker.label}`}
                    icon={<Trash2 className="size-3" />}
                    onClick={() => useEditor.getState().removeMarker(marker.id)}
                  />
                }
              >
                <span className="flex items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className="size-2 shrink-0 rounded-xs"
                    style={{ backgroundColor: marker.color ?? 'var(--color-accent)' }}
                  />
                  <span className="min-w-0 truncate">{marker.label}</span>
                </span>
              </JumpRow>
            ))}
          </ul>
        )}
      </ScrollArea>
    </>
  )
}

// -- comments ------------------------------------------------------------------------------------

function CommentList({ comments }: { comments: readonly ReviewComment[] }): ReactNode {
  const fps = useEditor((state) => selectTimeline(state)?.fps ?? 30)
  const [composing, setComposing] = useState(false)
  const [showResolved, setShowResolved] = useState(true)
  const sorted = useMemo(
    () => [...comments].filter((c) => showResolved || !c.resolved).sort((a, b) => a.frame - b.frame),
    [comments, showResolved]
  )
  const resolvedCount = comments.filter((c) => c.resolved).length
  return (
    <>
      <div className="flex shrink-0 flex-wrap items-center gap-0.5 border-b border-line px-1.5 py-1">
        <ToolButton label="Add Comment" icon={<Plus className="size-3.5" />} active={composing} onClick={() => setComposing(!composing)} />
        {resolvedCount > 0 && (
          <ToolButton
            label={showResolved ? `Hide Resolved (${resolvedCount})` : `Show Resolved (${resolvedCount})`}
            icon={<Check className="size-3.5" />}
            onClick={() => setShowResolved(!showResolved)}
          />
        )}
      </div>
      {composing && (
        <div className="shrink-0 border-b border-line px-3 py-2.5">
          <CommentComposer fps={fps} onAdded={() => setComposing(false)} />
        </div>
      )}
      <ScrollArea className="min-h-0 flex-1 p-1.5">
        {sorted.length === 0 ? (
          <Empty>
            {comments.length === 0
              ? 'No review comments yet. Leave notes where something should change, then ask the agent to address them.'
              : 'Every comment is resolved.'}
          </Empty>
        ) : (
          <ul className="flex flex-col">
            {sorted.map((comment) => (
              <JumpRow
                key={comment.id}
                frame={comment.frame}
                fps={fps}
                dim={comment.resolved}
                actions={
                  <>
                    <IconButton
                      size="xs"
                      label={comment.resolved ? 'Reopen comment' : 'Resolve comment'}
                      icon={comment.resolved ? <RotateCcw className="size-3" /> : <Check className="size-3" />}
                      onClick={() => {
                        const state = useEditor.getState()
                        if (comment.resolved) state.editComment(comment.id, { resolved: false })
                        else state.resolveComment(comment.id)
                      }}
                    />
                    <IconButton
                      size="xs"
                      variant="danger"
                      label="Delete comment"
                      icon={<Trash2 className="size-3" />}
                      onClick={() => useEditor.getState().removeComment(comment.id)}
                    />
                  </>
                }
              >
                <span className="flex items-start gap-1.5">
                  <span
                    aria-hidden="true"
                    className={cn('mt-1 size-2 shrink-0 rounded-full', comment.resolved ? 'bg-ink-3' : 'bg-warning')}
                  />
                  <span className={cn('line-clamp-3 min-w-0', comment.resolved && 'line-through')}>{comment.text}</span>
                </span>
                <span className="mt-0.5 block text-[10px] text-ink-2">{comment.author === 'agent' ? 'From the agent' : 'You'}</span>
              </JumpRow>
            ))}
          </ul>
        )}
      </ScrollArea>
    </>
  )
}

// -- edits ---------------------------------------------------------------------------------------

const TRANSITION_NAME = new Map(VIDEO_TRANSITIONS.map((t) => [t.kind, t.label]))

function EditList(): ReactNode {
  const timeline = useEditor(selectTimeline)
  const project = useEditor((state) => state.project)
  const [junctionKey, setJunctionKey] = useState<string | null>(null)
  const rows = useMemo(() => (timeline ? editRows(project, timeline) : []), [project, timeline])
  const fps = timeline?.fps ?? 30
  // Found fresh each render, so the dialog always describes the cut as it is now.
  const junction: Junction | null = useMemo(() => {
    if (!junctionKey || !timeline) return null
    for (const track of timeline.tracks) {
      const found = junctionsForTrack(project, timeline, track).find((j) => j.key === junctionKey)
      if (found) return found
    }
    return null
  }, [junctionKey, project, timeline])

  const describe = (row: EditRow): ReactNode => {
    if (row.kind === 'cut') {
      return (
        <>
          <span className="block truncate">
            {row.from?.name} <span className="text-ink-2">→</span> {row.to?.name}
          </span>
          {row.transition && (
            <span className="mt-0.5 inline-block rounded-xs bg-surface-4 px-1 text-[10px] text-ink-1">
              {TRANSITION_NAME.get(row.transition) ?? row.transition}
            </span>
          )}
        </>
      )
    }
    return (
      <span className="block truncate">
        <span className="text-ink-2">{row.kind === 'start' ? 'Start of ' : 'End of '}</span>
        {(row.kind === 'start' ? row.to : row.from)?.name}
      </span>
    )
  }

  return (
    <>
      <ScrollArea className="min-h-0 flex-1 p-1.5">
        {rows.length === 0 ? (
          <Empty>Nothing on the timeline yet. Every cut, and where each clip starts and ends, is listed here.</Empty>
        ) : (
          <ul className="flex flex-col">
            {rows.map((row) => (
              <JumpRow
                key={row.key}
                frame={row.frame}
                fps={fps}
                actions={
                  row.kind === 'cut' ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-1.5 text-[11px]"
                      onClick={() => setJunctionKey(`${row.from?.itemId}:${row.to?.itemId}`)}
                    >
                      {row.transition ? 'Edit' : 'Transition…'}
                    </Button>
                  ) : undefined
                }
              >
                <span className="flex items-start gap-1.5">
                  <span
                    className={cn(
                      'mt-px shrink-0 rounded-xs px-1 text-[9px] leading-4 font-semibold text-on-media',
                      row.trackKind === 'audio' ? 'bg-clip-audio' : 'bg-clip-video'
                    )}
                  >
                    {row.trackName}
                  </span>
                  <span className="min-w-0 flex-1">{describe(row)}</span>
                </span>
              </JumpRow>
            ))}
          </ul>
        )}
      </ScrollArea>
      <TransitionDialog junction={junction} fps={fps} onClose={() => setJunctionKey(null)} />
    </>
  )
}

// -- visual search -------------------------------------------------------------------------------

interface Hit {
  rank: number
  assetId: string
  asset: string
  us: number
  score: number
  onTimeline?: { itemId: string; frame: number }[]
}

/**
 * Find a shot by describing it. The index and the model are main's (`index_footage` and
 * `search_footage` run the same functions, so a person and the agent see the same hits); a hit on
 * the timeline moves the playhead to it, and any hit opens in the source viewer at that moment.
 * The model is fetched only as Preferences › Visual search allows — the "Download models when needed"
 * switch, or its Download button — never from here on its own.
 */
function VisualSearch(): ReactNode {
  const autoDownload = useEditor((state) => state.autoDownloadModels)
  const notify = useEditor((state) => state.notify)
  const [status, setStatus] = useState<VisionStatus | null>(null)
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [hits, setHits] = useState<Hit[] | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    const next = await bay()?.vision.status().catch(() => null)
    if (next) setStatus(next)
  }, [])
  useEffect(() => {
    void refresh()
    return bay()?.vision.onChange(setStatus)
  }, [refresh])

  const job = status?.index ?? null
  const running = job?.state === 'running'
  const download = status?.download ?? null
  const downloading = download?.state === 'downloading' || download?.state === 'verifying'

  const index = async (): Promise<void> => {
    setProblem(null)
    try {
      const answer = await indexFootage({})
      const said = [answer['next'], answer['indexed']].filter((s): s is string => typeof s === 'string')
      if (answer['done'] === true && said.length > 0) notify(said.join(' '))
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error))
    }
    void refresh()
  }

  const search = async (): Promise<void> => {
    const words = query.trim()
    if (!words) return
    setSearching(true)
    setProblem(null)
    try {
      const answer = await searchFootage({ query: words, limit: 12 })
      setHits((answer['hits'] as Hit[] | undefined) ?? [])
      const framesSearched = answer['framesSearched']
      setNote(framesSearched === 0 ? 'Nothing is indexed yet. Index the footage, then search again.' : null)
    } catch (error) {
      setHits(null)
      setProblem(error instanceof Error ? error.message : String(error))
    } finally {
      setSearching(false)
    }
  }

  return (
    <>
      <div className="flex shrink-0 flex-col gap-1.5 border-b border-line px-2 py-2">
        <div className="flex items-center gap-1">
          <SearchField
            label="Describe the shot"
            placeholder="a dog running on a beach…"
            value={query}
            onValueChange={setQuery}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void search()
              }
            }}
            className="min-w-0 flex-1"
          />
          <Button
            variant="primary"
            disabled={!query.trim() || searching}
            icon={searching ? <LoaderCircle className="size-3.5 animate-spin" /> : <Search className="size-3.5" />}
            onClick={() => void search()}
          >
            Search
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-0.5">
          {running ? (
            <ToolButton label="Stop Indexing" icon={<Square className="size-3" />} onClick={() => void bay()?.vision.cancelIndex()} />
          ) : (
            <ToolButton label="Index Footage" icon={<Film className="size-3.5" />} disabled={downloading} onClick={() => void index()} />
          )}
          <ToolButton
            label="Settings"
            icon={<Settings2 className="size-3.5" />}
            onClick={() => useEditor.getState().setSettingsOpen(true, 'visual-search')}
            title="Preferences › Visual search: the model and its download"
          />
        </div>
        {status && !status.installed && !downloading && (
          <p className="text-[11px] leading-relaxed text-pretty text-ink-2">
            {autoDownload
              ? `The visual search model (${formatModelBytes(VISION_MODEL_BYTES)}) is not on this Mac yet; Index Footage downloads it first.`
              : `The visual search model (${formatModelBytes(VISION_MODEL_BYTES)}) is not on this Mac. Download it in Preferences › Visual search, or turn on “Download models when needed” there.`}
          </p>
        )}
        {downloading && download && (
          <ProgressBar
            label="Downloading the visual search model"
            value={download.totalBytes > 0 ? download.receivedBytes / download.totalBytes : null}
          />
        )}
        {job && (running || job.state !== 'done' || job.failed.length > 0) && (
          <div>
            {running && (
              <ProgressBar
                label="Indexing footage"
                value={job.phase === 'indexing' && job.filesTotal > 0 ? job.filesDone / job.filesTotal : null}
              />
            )}
            <p className="mt-1 text-[11px] leading-snug text-pretty text-ink-2">{describeJob(job)}</p>
          </div>
        )}
        {problem && <InlineAlert tone="warning">{problem}</InlineAlert>}
      </div>
      <ScrollArea className="min-h-0 flex-1 p-2">
        {hits === null ? (
          <Empty>
            Describe a shot and search: frames sampled from the project’s videos and images are matched on this Mac. Your
            footage never leaves it.
          </Empty>
        ) : hits.length === 0 ? (
          <Empty>{note ?? 'No matches. Try a more concrete description.'}</Empty>
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2">
            {hits.map((hit) => (
              <HitCard key={`${hit.assetId}:${hit.us}`} hit={hit} />
            ))}
          </ul>
        )}
        {note && hits && hits.length > 0 && <p className="mt-2 text-[10px] text-ink-2">{note}</p>}
      </ScrollArea>
    </>
  )
}

function HitCard({ hit }: { hit: Hit }): ReactNode {
  const asset = useEditor((state) => state.project.assets.find((a) => a.id === hit.assetId))
  const fps = useEditor((state) => selectTimeline(state)?.fps ?? 30)
  const [thumb, setThumb] = useState<string | null>(null)
  useEffect(() => {
    if (!asset?.path) return
    let live = true
    void bay()
      ?.media.thumbnail({ assetId: asset.id, path: asset.path, atUs: hit.us, size: 240 })
      .then((url) => {
        if (live) setThumb(url)
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [asset?.id, asset?.path, hit.us])

  const placed = hit.onTimeline?.[0]
  const where = formatSourceDuration(hit.us)
  const openSource = (): void => {
    openInSource(hit.assetId, hit.us)
    // In the Edit page the source viewer lives in the Media Pool tab.
    useEditor.getState().setLibraryTab('media')
  }
  return (
    <li className="overflow-hidden rounded-sm border border-line bg-surface-2">
      <button
        type="button"
        onClick={() => {
          if (placed) {
            revealItem(placed.itemId)
            useEditor.getState().setPlayhead(placed.frame)
          } else openSource()
        }}
        aria-label={
          placed
            ? `Go to ${hit.asset} at ${formatTimecode(placed.frame, fps, true)} on the timeline`
            : `Open ${hit.asset} at ${where} in the source viewer`
        }
        className="t-fast block w-full text-left hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-accent"
      >
        <span className="relative block aspect-video w-full bg-surface-0">
          {thumb && <img src={thumb} alt="" draggable={false} className="size-full object-cover" />}
          <span className="absolute top-1 left-1 rounded-xs bg-black/70 px-1 text-[10px] leading-4 text-on-media tabular-nums">
            #{hit.rank}
          </span>
        </span>
        <span className="block px-1.5 pt-1 text-[11px] text-ink-0">
          <span className="block truncate">{hit.asset}</span>
          <span className="block text-[10px] text-ink-2 tabular-nums">
            {where} in the file{placed ? ` · ${formatTimecode(placed.frame, fps, true)} on timeline` : ''}
          </span>
        </span>
      </button>
      <div className="flex items-center gap-0.5 px-1 pb-1">
        <ToolButton label="Source" icon={<MonitorPlay className="size-3" />} className="h-6 text-[10px]" onClick={openSource} />
      </div>
    </li>
  )
}
