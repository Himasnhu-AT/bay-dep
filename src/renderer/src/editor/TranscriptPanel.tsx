import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Captions, LoaderCircle, ScrollText, Scissors } from 'lucide-react'
import { findAsset, type Item } from '@shared/project'
import { cutRanges, findWords, speechItems, timelineWords, wordAt } from '@shared/timeline-words'
import { defaultWhisperModel, downloadSentence, findWhisperModel, formatBytes, isCancelledDownloadError } from '@shared/whisper'
import type { WhisperStatus } from '@shared/whisper'
import { Button, EmptyState, InlineAlert, ProgressBar, ScrollArea, SearchField, Select, Tabs, ToolButton } from '@/components'
import { bay } from '@/lib/bay'
import { hasModelFor, SUBTITLE_LANGUAGES } from '@/lib/subtitleOptions'
import { cachedTranscript, onTranscript, transcribeSource } from '@/mcp/transcribe'
import { removeRange } from '@/mcp/write'
import { selectTimeline, useEditor } from '@/store/editor'
import { cn } from '@/lib/cn'
import { LibraryHeader } from './library/LibraryHeader'
import { onLibraryRequest, takeLibraryRequest } from './library/librarySignals'
import { SubtitlesSection } from './SubtitlesSection'

/**
 * The timeline as its words: the transcript of every clip with speech (or of the selected ones),
 * placed where the timeline plays them. The spoken word is lit during playback; clicking a word
 * moves the playhead to it; selecting words and pressing Delete cuts that time out of every
 * unlocked track — `remove_range`, the sync-safe cut — as one undo step.
 *
 * Transcription is `transcribeSource`, the path behind the agent's `transcribe` and
 * `add_subtitles`, so a clip transcribed by any of the three shows here without running whisper
 * again. Transcripts last for the session; they are not written into the project.
 */

const seconds = (frames: number, fps: number): string => {
  const total = Math.max(0, frames / fps)
  return `${Math.floor(total / 60)}:${String(Math.floor(total % 60)).padStart(2, '0')}`
}

type Problem =
  | { kind: 'engine' }
  | { kind: 'model'; modelId: string }
  | { kind: 'cancelled'; modelId: string }
  | { kind: 'error'; message: string }

export function TranscriptPanel(): ReactNode {
  const timeline = useEditor(selectTimeline)
  const assets = useEditor((state) => state.project.assets)
  const selection = useEditor((state) => state.selection)
  const autoDownload = useEditor((state) => state.autoDownloadModels)
  const download = useEditor((state) => state.whisperDownload)
  const settingsOpen = useEditor((state) => state.settingsOpen)
  const notify = useEditor((state) => state.notify)

  const [language, setLanguage] = useState('en')
  const [version, setVersion] = useState(0)
  const [progress, setProgress] = useState<{ done: number; total: number; name: string } | null>(null)
  const [problem, setProblem] = useState<Problem | null>(null)
  const [status, setStatus] = useState<WhisperStatus | null>(null)
  const [query, setQuery] = useState('')
  const [matchAt, setMatchAt] = useState(0)
  const [range, setRange] = useState<{ anchor: number; focus: number } | null>(null)
  const list = useRef<HTMLDivElement>(null)
  // Words, or the Subtitles made from them. Media › Subtitles asks for the second.
  const [view, setView] = useState<'words' | 'subtitles'>('words')
  useEffect(() => {
    if (takeLibraryRequest('subtitles')) setView('subtitles')
    return onLibraryRequest((request) => {
      if (request === 'subtitles' && takeLibraryRequest('subtitles')) setView('subtitles')
    })
  }, [])

  useEffect(() => onTranscript(() => setVersion((n) => n + 1)), [])
  // Whether whisper and a model are on this Mac. A model can arrive other ways than a download
  // started here — copied into the folder, downloaded or chosen in Settings, installed by another
  // app — so it is asked again when a download settles, when Settings closes, when the window
  // comes back to the front, and right before Transcribe decides anything.
  const live = useRef(true)
  useEffect(
    () => () => {
      live.current = false
    },
    []
  )
  const refreshStatus = useCallback(async (): Promise<WhisperStatus | null> => {
    const answer = await bay()
      ?.whisper.status(useEditor.getState().whisperModel)
      .catch(() => null)
    if (answer && live.current) setStatus(answer)
    return answer ?? null
  }, [])
  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus, download?.state, settingsOpen])
  useEffect(() => {
    const again = (): void => {
      if (document.visibilityState === 'visible') void refreshStatus()
    }
    window.addEventListener('focus', again)
    document.addEventListener('visibilitychange', again)
    return () => {
      window.removeEventListener('focus', again)
      document.removeEventListener('visibilitychange', again)
    }
  }, [refreshStatus])

  const fps = timeline?.fps ?? 30
  const project = useMemo(() => ({ assets }), [assets])
  const items = useMemo(() => (timeline ? speechItems(project, timeline, selection) : []), [project, timeline, selection])
  const pathOf = (item: Item): string | null => findAsset(project as never, item.assetId)?.path ?? null
  const { words, untranscribed } = useMemo(
    () =>
      timelineWords(
        items,
        (item) => {
          const path = pathOf(item)
          return path ? cachedTranscript(path, language)?.segments : undefined
        },
        fps
      ),
    // `version` is how a transcript arriving reaches this memo.
    [items, language, fps, version, project]
  )
  const scoped = items.some((item) => selection.includes(item.id))

  const active = useEditor((state) => wordAt(words, state.playhead))
  const playing = useEditor((state) => state.playing)
  const matches = useMemo(() => findWords(words, query), [words, query])
  const matched = useMemo(() => new Set(matches.flat()), [matches])
  const selected = useMemo(() => {
    const out = new Set<number>()
    if (!range) return out
    for (let i = Math.min(range.anchor, range.focus); i <= Math.max(range.anchor, range.focus); i += 1) out.add(i)
    return out
  }, [range])

  // Words move when the timeline is edited; a selection of indices would then name other words.
  useEffect(() => setRange(null), [words])

  // Follow the spoken word while playing, the way a teleprompter does.
  useEffect(() => {
    if (!playing || active < 0) return
    list.current?.querySelector(`[data-word="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active, playing])

  const seekTo = (index: number): void => {
    const word = words[index]
    if (word) useEditor.getState().setPlayhead(word.fromFrame)
  }

  const reveal = (index: number): void => {
    list.current?.querySelector(`[data-word="${index}"]`)?.scrollIntoView({ block: 'nearest' })
  }

  const transcribe = async (): Promise<void> => {
    const paths = [...new Set(untranscribed.map(pathOf).filter((path): path is string => path !== null))]
    if (paths.length === 0) return
    const current = (await refreshStatus()) ?? status
    const installed = current?.installed.map((model) => model.file) ?? []
    if (current && !current.engine) {
      setProblem({ kind: 'engine' })
      return
    }
    if (current && !autoDownload && !hasModelFor(installed, language)) {
      setProblem({ kind: 'model', modelId: defaultWhisperModel(language).id })
      return
    }
    setProblem(null)
    for (const [index, path] of paths.entries()) {
      const name = assets.find((asset) => asset.path === path)?.name ?? path
      setProgress({ done: index, total: paths.length, name })
      try {
        await transcribeSource(path, language)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        setProblem(
          isCancelledDownloadError(message)
            ? { kind: 'cancelled', modelId: useEditor.getState().whisperDownload?.modelId ?? defaultWhisperModel(language).id }
            : { kind: 'error', message }
        )
        break
      }
    }
    setProgress(null)
  }

  const downloadModel = async (modelId: string): Promise<void> => {
    setProblem(null)
    const result = await bay()?.whisper.download(modelId)
    if (result && !result.ok) {
      setProblem(isCancelledDownloadError(result.error) ? { kind: 'cancelled', modelId } : { kind: 'error', message: result.error })
    }
  }

  const cut = (): void => {
    const ranges = cutRanges(words, selected)
    if (ranges.length === 0) return
    const frames = ranges.reduce((sum, r) => sum + (r.toFrame - r.fromFrame), 0)
    const state = useEditor.getState()
    const failures: string[] = []
    // Last-first, so each cut leaves the frames of the ones still to go where they were; one
    // transaction, so the whole deletion is one undo step.
    state.transact(() => {
      for (const r of ranges) {
        try {
          removeRange({ fromFrame: r.fromFrame, toFrame: r.toFrame })
        } catch (error) {
          failures.push(error instanceof Error ? error.message : String(error))
        }
      }
    })
    setRange(null)
    if (failures.length === ranges.length) {
      notify(failures[0] ?? 'Nothing was cut.', 'error')
      return
    }
    notify(`Cut ${selected.size} word${selected.size === 1 ? '' : 's'} (${(frames / fps).toFixed(1)} s) from every unlocked track. ⌘Z to undo.`)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const handled = (() => {
      if ((event.key === 'Delete' || event.key === 'Backspace') && selected.size > 0) {
        cut()
        return true
      }
      if (event.key === 'Escape' && range) {
        setRange(null)
        return true
      }
      if ((event.key === 'ArrowRight' || event.key === 'ArrowLeft') && words.length > 0) {
        const from = range?.focus ?? (active >= 0 ? active : 0)
        const next = Math.min(words.length - 1, Math.max(0, from + (event.key === 'ArrowRight' ? 1 : -1)))
        setRange(event.shiftKey && range ? { anchor: range.anchor, focus: next } : { anchor: next, focus: next })
        seekTo(next)
        reveal(next)
        return true
      }
      return false
    })()
    // Delete here cuts words, not the selected clips; arrows move through words, not frames.
    if (handled) {
      event.preventDefault()
      event.stopPropagation()
    }
  }

  const jumpToMatch = (step: number): void => {
    if (matches.length === 0) return
    const next = (((matchAt + step) % matches.length) + matches.length) % matches.length
    setMatchAt(next)
    const run = matches[next]!
    setRange({ anchor: run[0]!, focus: run[run.length - 1]! })
    seekTo(run[0]!)
    reveal(run[0]!)
  }

  const languageSelect = (
    <Select
      label="Spoken language"
      value={language}
      onChange={(value) => {
        setLanguage(value)
        setProblem(null)
      }}
      options={SUBTITLE_LANGUAGES.map((option) => ({ value: option.value, label: option.label }))}
      className="min-w-0 flex-1"
    />
  )

  const transcribeBar = untranscribed.length > 0 && (
    <div className="flex flex-col gap-2 border-b border-line px-3 py-2.5">
      <p className="text-[11px] leading-snug text-pretty text-ink-2">
        {words.length === 0
          ? `${untranscribed.length === 1 ? 'This clip has' : `${untranscribed.length} clips have`} no transcript yet. It is made on this Mac; nothing is uploaded.`
          : `${untranscribed.length} more clip${untranscribed.length === 1 ? '' : 's'} not transcribed yet.`}
      </p>
      <div className="flex items-center gap-1.5">
        {languageSelect}
        <Button
          variant="primary"
          disabled={progress !== null}
          icon={progress ? <LoaderCircle className="size-3.5 animate-spin" /> : undefined}
          onClick={() => void transcribe()}
        >
          {progress ? 'Transcribing…' : 'Transcribe'}
        </Button>
      </div>
      {progress && (
        <p className="text-[11px] text-ink-2 tabular-nums">
          {progress.total > 1 ? `${progress.done + 1} of ${progress.total} — ` : ''}
          {progress.name}. Long clips take a while.
        </p>
      )}
      {download && (download.state === 'downloading' || download.state === 'verifying') && (
        <div>
          <ProgressBar
            label={downloadSentence(download)}
            value={download.totalBytes > 0 ? download.receivedBytes / download.totalBytes : null}
          />
          <div className="mt-1 flex items-center gap-2">
            <p className="min-w-0 flex-1 text-[11px] text-ink-2 tabular-nums">{downloadSentence(download)}</p>
            {download.state === 'downloading' && (
              <Button size="sm" variant="ghost" onClick={() => void bay()?.whisper.cancelDownload()}>
                Cancel
              </Button>
            )}
          </div>
        </div>
      )}
      {problem && <ProblemNote problem={problem} onDownload={(id) => void downloadModel(id)} busy={download?.state === 'downloading'} />}
    </div>
  )

  const words_ = (
    <>
      {!timeline || items.length === 0 ? (
        <EmptyState
          icon={<ScrollText aria-hidden="true" className="size-6" />}
          title="No speech to show"
          hint="Place a clip with sound on the timeline. Its words appear here, and deleting words cuts them from the edit."
        />
      ) : (
        <>
          <div className="flex flex-col gap-1.5 border-b border-line px-3 py-2">
            <p className="truncate text-[11px] text-ink-2">
              {scoped
                ? `Selected clip${items.length === 1 ? '' : 's'}: ${items.map((item) => findAsset(project as never, item.assetId)?.name ?? '').join(', ')}`
                : `Whole timeline · ${items.length} clip${items.length === 1 ? '' : 's'} with sound`}
            </p>
            {words.length > 0 && (
              <div className="flex items-center gap-1">
                <SearchField
                  label="Search transcript"
                  placeholder="Search words…"
                  value={query}
                  onValueChange={(value) => {
                    setQuery(value)
                    setMatchAt(0)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      jumpToMatch(event.shiftKey ? -1 : 1)
                    }
                  }}
                  className="min-w-0 flex-1"
                />
                {query.trim() !== '' && (
                  <span className="shrink-0 text-[10px] text-ink-2 tabular-nums">
                    {matches.length === 0 ? 'None' : `${Math.min(matchAt + 1, matches.length)}/${matches.length}`}
                  </span>
                )}
              </div>
            )}
          </div>

          {transcribeBar}

          {words.length > 0 && (
            <ScrollArea className="flex-1">
              <div
                ref={list}
                role="listbox"
                aria-label="Transcript words"
                aria-multiselectable="true"
                tabIndex={0}
                onKeyDown={onKeyDown}
                className="px-3 py-3 text-[13px] leading-[1.9] text-ink-1 outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
              >
                {words.map((word, index) => {
                  const newClip = index === 0 || words[index - 1]!.itemId !== word.itemId
                  return (
                    <span key={`${word.itemId}:${word.fromFrame}:${index}`}>
                      {newClip && (
                        <span className={cn('block text-[10px] leading-4 text-ink-2 tabular-nums', index > 0 && 'mt-3')}>
                          {seconds(word.fromFrame, fps)} · {findAsset(project as never, items.find((i) => i.id === word.itemId)?.assetId ?? '')?.name}
                        </span>
                      )}
                      <span
                        role="option"
                        aria-selected={selected.has(index)}
                        data-word={index}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={(event) => {
                          list.current?.focus()
                          setRange(event.shiftKey && range ? { anchor: range.anchor, focus: index } : { anchor: index, focus: index })
                          seekTo(index)
                        }}
                        className={cn(
                          't-fast cursor-pointer rounded-xs px-[2px] py-px',
                          selected.has(index)
                            ? 'bg-accent text-accent-ink'
                            : index === active
                              ? 'bg-accent/20 text-ink-0'
                              : matched.has(index)
                                ? 'bg-warning/20 text-ink-0'
                                : 'hover:bg-surface-3 hover:text-ink-0'
                        )}
                      >
                        {word.text}
                      </span>{' '}
                    </span>
                  )
                })}
              </div>
            </ScrollArea>
          )}

          {words.length > 0 && (
            <div className="flex items-center gap-2 border-t border-line px-3 py-2">
              <p className="min-w-0 flex-1 text-[10px] leading-snug text-ink-2">
                {selected.size > 0
                  ? `${selected.size} word${selected.size === 1 ? '' : 's'} selected — Delete cuts them from every unlocked track.`
                  : 'Click a word to jump to it. Shift-click to select a passage, then Delete to cut it.'}
              </p>
              <ToolButton
                label="Cut selected words"
                shortcut="Delete"
                icon={<Scissors className="size-3.5" />}
                disabled={selected.size === 0}
                onClick={cut}
                tooltipSide="top"
              />
            </div>
          )}
        </>
      )}
    </>
  )

  return (
    <section aria-label="Transcript" className="flex h-full min-h-0 min-w-0 flex-col bg-surface-1">
      <LibraryHeader
        title="Transcript"
        count={words.length > 0 ? `${words.length} words` : undefined}
        actions={
          <Tabs<'words' | 'subtitles'>
            label="Transcript view"
            variant="pill"
            value={view}
            onChange={setView}
            items={[
              { value: 'words', label: 'Words', icon: <ScrollText aria-hidden="true" className="size-3" /> },
              { value: 'subtitles', label: 'Subtitles', icon: <Captions aria-hidden="true" className="size-3" /> }
            ]}
          />
        }
        menu={[{ label: 'Transcription Settings…', onSelect: () => useEditor.getState().setSettingsOpen(true) }]}
        menuLabel="More transcript options"
      />
      {view === 'words' ? (
        words_
      ) : (
        <ScrollArea className="min-h-0 flex-1 p-3">
          <SubtitlesSection />
        </ScrollArea>
      )}
    </section>
  )
}

function ProblemNote({ problem, onDownload, busy }: { problem: Problem; onDownload(modelId: string): void; busy: boolean }): ReactNode {
  const openSettings = (): void => useEditor.getState().setSettingsOpen(true)
  if (problem.kind === 'engine') {
    return (
      <InlineAlert tone="warning">
        <span className="block">whisper.cpp, the transcriber, is not installed on this Mac.</span>
        <Button size="sm" variant="subtle" className="mt-1.5" onClick={openSettings}>
          Open Transcription settings
        </Button>
      </InlineAlert>
    )
  }
  if (problem.kind === 'cancelled') {
    // The user asked for this, so it is said plainly, with the way back — not as a failure.
    const model = findWhisperModel(problem.modelId) ?? defaultWhisperModel('en')
    return (
      <InlineAlert tone="notice">
        <span className="block">Download cancelled. Nothing was transcribed.</span>
        <span className="mt-1.5 flex flex-wrap gap-1.5">
          <Button size="sm" variant="subtle" disabled={busy} onClick={() => onDownload(problem.modelId)}>
            Download {model.label} ({formatBytes(model.bytes)})
          </Button>
          <Button size="sm" variant="ghost" onClick={openSettings}>
            Choose in Settings
          </Button>
        </span>
      </InlineAlert>
    )
  }
  if (problem.kind === 'model') {
    const model = findWhisperModel(problem.modelId) ?? defaultWhisperModel('en')
    return (
      <InlineAlert tone="warning">
        <span className="block">No speech model for this language is on this Mac yet.</span>
        <span className="mt-1.5 flex flex-wrap gap-1.5">
          <Button size="sm" variant="primary" disabled={busy} onClick={() => onDownload(problem.modelId)}>
            Download {model.label} ({formatBytes(model.bytes)})
          </Button>
          <Button size="sm" variant="ghost" onClick={openSettings}>
            Choose in Settings
          </Button>
        </span>
      </InlineAlert>
    )
  }
  return (
    <InlineAlert tone="danger">
      <span className="block">{problem.message}</span>
      <Button size="sm" variant="ghost" className="mt-1.5" onClick={openSettings}>
        Open Transcription settings
      </Button>
    </InlineAlert>
  )
}
