import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { AudioLines, Film, Scaling, SendHorizontal } from 'lucide-react'
import {
  CANVAS_MAX_SIDE,
  CANVAS_MIN_SIDE,
  CANVAS_PRESETS,
  FRAME_RATES,
  allItems,
  checkCanvasSize,
  formatFps,
  matchFrameRate,
  type CanvasFit
} from '@shared/project'
import {
  Button,
  ColorField,
  InlineAlert,
  Modal,
  NumberField,
  ScrollArea,
  SegmentedControl,
  Select,
  TextField
} from '@/components'
import { cn } from '@/lib/cn'
import { runCommand, shortcutOf, formatShortcut } from '@/lib/commands'
import { selectTimeline, useEditor } from '@/store/editor'
import { useEditingPrefs } from '@/store/editing-prefs'
import { useProjectSettingsDialog } from '@/store/project-settings-dialog'
import { applyProjectSettings } from './projectSettingsApply'
import { Group, LinkRow, Note, Row, Section } from './parts'
import { openPreferences } from './SettingsDialog'

/**
 * File › Project Settings…: what this project *is*, in Resolve's arrangement — a list of
 * categories on the left, the category on the right, one Apply for all of them.
 *
 * Master Settings holds the name and the active timeline's format (canvas, rate, background);
 * Image Scaling holds how clips are refitted when the canvas changes. Audio and Deliver name
 * where those choices are made today — per clip and per export — because the project stores
 * none of them, and this dialog shows only fields the `.bay` file really has.
 *
 * Nothing applies until Apply, and Apply is one undo step for all of it. The canvas goes through
 * `resizeCanvas`, the same action `set_canvas` calls, so a size chosen here refits clips exactly
 * as the agent's would; `fit` is that tool's `fit`.
 */
export function ProjectSettingsDialog(): ReactNode {
  const open = useProjectSettingsDialog((state) => state.open)
  const close = useProjectSettingsDialog((state) => state.close)
  // The body mounts per opening, so its drafts start from the project as it is now.
  return (
    <Modal open={open} title="Project Settings" onClose={close} width={720}>
      {open && <ProjectSettingsBody onDone={close} />}
    </Modal>
  )
}

const FIT_OPTIONS: { value: CanvasFit; label: string; detail: string }[] = [
  { value: 'auto', label: 'Auto', detail: 'Fill the frame, unless that would crop away too much of a clip; then fit it whole.' },
  { value: 'cover', label: 'Fill', detail: 'Every video and image fills the frame. Edges that do not fit are cropped.' },
  { value: 'contain', label: 'Fit', detail: 'Every video and image is shown whole, with bars where the shapes differ.' }
]

const FIT_NAMES: Record<CanvasFit, string> = { auto: 'Auto', cover: 'Fill', contain: 'Fit' }

type PaneId = 'master' | 'scaling' | 'audio' | 'deliver'

const PANES: { id: PaneId; label: string; icon: ReactNode }[] = [
  { id: 'master', label: 'Master Settings', icon: <Film aria-hidden="true" className="size-3.5 shrink-0" /> },
  { id: 'scaling', label: 'Image Scaling', icon: <Scaling aria-hidden="true" className="size-3.5 shrink-0" /> },
  { id: 'audio', label: 'Audio', icon: <AudioLines aria-hidden="true" className="size-3.5 shrink-0" /> },
  { id: 'deliver', label: 'Deliver', icon: <SendHorizontal aria-hidden="true" className="size-3.5 shrink-0" /> }
]

function ProjectSettingsBody({ onDone }: { onDone(): void }): ReactNode {
  const timeline = useEditor(selectTimeline)
  const name = useEditor((state) => state.project.name)
  const proposal = useProjectSettingsDialog((state) => state.proposal)
  const newClipFit = useEditingPrefs((state) => state.newClipFit)

  const [pane, setPane] = useState<PaneId>('master')
  const tabs = useRef(new Map<PaneId, HTMLButtonElement>())
  const [draftName, setDraftName] = useState(name)
  const [width, setWidth] = useState(proposal?.width ?? timeline?.width ?? 1920)
  const [height, setHeight] = useState(proposal?.height ?? timeline?.height ?? 1080)
  const [fit, setFit] = useState<CanvasFit>('auto')
  const [fps, setFps] = useState(timeline?.fps ?? 30)
  const [background, setBackground] = useState(timeline?.background ?? '#000000')
  const [applyError, setApplyError] = useState<string | null>(null)

  // A proposal arriving while the dialog is already open (a second "Change canvas" click).
  useEffect(() => {
    if (!proposal) return
    setWidth(proposal.width)
    setHeight(proposal.height)
    setPane('master')
  }, [proposal])

  if (!timeline) return <p className="p-4 text-[12px] text-ink-2">No timeline is open.</p>

  const preset = CANVAS_PRESETS.find((candidate) => candidate.width === width && candidate.height === height)
  const sizeProblem = checkCanvasSize(width, height)
  const sizeChanged = width !== timeline.width || height !== timeline.height
  const refittable = allItems(timeline).length
  const rate = matchFrameRate(fps)
  const hexBackground = /^#[0-9a-f]{6}$/i.test(background) ? background : '#000000'
  const trimmedName = draftName.trim()
  const audioTracks = timeline.tracks.filter((track) => track.kind === 'audio').length

  const masterChanged =
    (trimmedName !== '' && trimmedName !== name) ||
    sizeChanged ||
    Math.abs(fps - timeline.fps) > 1e-9 ||
    hexBackground.toLowerCase() !== timeline.background.toLowerCase()
  const changed = masterChanged
  // Refitting only happens with a size change, so the choice is a pending change only then.
  const scalingPending = sizeChanged && !sizeProblem && refittable > 0

  const apply = (): void => {
    const state = useEditor.getState()
    // One undo step for the whole dialog, or nothing at all (see `applyProjectSettings`).
    const outcome = applyProjectSettings(state, { name: draftName, width, height, fit, fps, background: hexBackground })
    if (!outcome.ok) {
      setApplyError(outcome.error)
      return
    }
    const { refitted, nudged } = outcome
    const parts: string[] = []
    if (sizeChanged) {
      parts.push(
        `Canvas is now ${width} × ${height}` +
          (refitted > 0 ? `; ${refitted} clip${refitted === 1 ? '' : 's'} refitted.` : '.')
      )
    }
    if (nudged > 0) parts.push(`${nudged} clip${nudged === 1 ? '' : 's'} moved a frame to stay in order at ${formatFps(fps)} fps.`)
    if (parts.length > 0) {
      state.notify(`${parts.join(' ')} ${formatShortcut(shortcutOf('edit.undo') ?? 'Mod+Z')} undoes it.`)
    }
    onDone()
  }

  /** Leaves this dialog for another place (Preferences, Export); drafts here are discarded. */
  const leaveFor = (go: () => void): void => {
    onDone()
    go()
  }

  const onNavKeyDown = (event: KeyboardEvent): void => {
    const index = PANES.findIndex((candidate) => candidate.id === pane)
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
    if (step === 0) return
    event.preventDefault()
    const target = PANES[(index + step + PANES.length) % PANES.length]
    if (!target) return
    setPane(target.id)
    tabs.current.get(target.id)?.focus()
  }

  const pending: Record<PaneId, boolean> = { master: masterChanged, scaling: scalingPending, audio: false, deliver: false }

  return (
    <form
      className="flex flex-col"
      onSubmit={(event) => {
        event.preventDefault()
        if (changed && !sizeProblem && trimmedName !== '') apply()
      }}
    >
      <div className="flex h-[min(480px,68vh)]">
        <nav
          role="tablist"
          aria-label="Project settings categories"
          aria-orientation="vertical"
          onKeyDown={onNavKeyDown}
          className="flex w-44 shrink-0 flex-col gap-px border-r border-line bg-surface-0/40 px-2 py-3"
        >
          {PANES.map((candidate) => {
            const selected = candidate.id === pane
            return (
              <button
                key={candidate.id}
                ref={(element) => {
                  if (element) tabs.current.set(candidate.id, element)
                  else tabs.current.delete(candidate.id)
                }}
                type="button"
                role="tab"
                id={`project-settings-tab-${candidate.id}`}
                aria-selected={selected}
                aria-controls="project-settings-pane"
                tabIndex={selected ? 0 : -1}
                onClick={() => setPane(candidate.id)}
                className={cn(
                  't-press flex h-7 items-center gap-2 rounded-sm px-2 text-left text-[12px] active:scale-[0.98]',
                  selected ? 'bg-surface-4 text-ink-0' : 'text-ink-1 hover:bg-surface-3 hover:text-ink-0'
                )}
              >
                <span className={selected ? 'text-accent' : 'text-ink-2'}>{candidate.icon}</span>
                <span className="min-w-0 flex-1 truncate">{candidate.label}</span>
                {pending[candidate.id] && (
                  <span aria-label="Changed, not yet applied" title="Changed, not yet applied" className="size-1.5 rounded-full bg-accent" />
                )}
              </button>
            )
          })}
        </nav>

        <ScrollArea className="min-w-0 flex-1">
          <div role="tabpanel" id="project-settings-pane" aria-labelledby={`project-settings-tab-${pane}`}>
            {pane === 'master' && (
              <Section title="Master Settings" description="The project’s name and the open timeline’s format.">
                {proposal && <InlineAlert tone="notice">{proposal.reason}</InlineAlert>}
                <Group title="Project">
                  <Row label="Name">
                    <TextField
                      label="Project name"
                      value={draftName}
                      onChange={(event) => setDraftName(event.target.value)}
                      invalid={trimmedName === ''}
                      className="w-60"
                    />
                  </Row>
                </Group>

                <Group title="Timeline format">
                  <Row label="Resolution" hint="The canvas every clip is drawn on, and the size an export defaults to.">
                    <div className="flex w-60 flex-col gap-1.5">
                      <Select
                        label="Canvas size"
                        value={preset?.id ?? 'custom'}
                        options={[
                          ...CANVAS_PRESETS.map((candidate) => ({ value: candidate.id, label: candidate.label })),
                          { value: 'custom', label: 'Custom size' }
                        ]}
                        onChange={(id) => {
                          const next = CANVAS_PRESETS.find((candidate) => candidate.id === id)
                          if (!next) return
                          setWidth(next.width)
                          setHeight(next.height)
                        }}
                      />
                      <div className="grid grid-cols-2 gap-1.5">
                        <NumberField label="W" value={width} step={2} min={CANVAS_MIN_SIDE} max={CANVAS_MAX_SIDE} precision={0} suffix="px" onCommit={setWidth} />
                        <NumberField label="H" value={height} step={2} min={CANVAS_MIN_SIDE} max={CANVAS_MAX_SIDE} precision={0} suffix="px" onCommit={setHeight} />
                      </div>
                    </div>
                  </Row>
                  {sizeProblem && (
                    <div className="px-3 py-2">
                      <InlineAlert tone="danger">{sizeProblem}</InlineAlert>
                    </div>
                  )}
                  {scalingPending && (
                    <LinkRow
                      label="Clips will be refitted"
                      hint={`${FIT_NAMES[fit]}: ${FIT_OPTIONS.find((option) => option.value === fit)?.detail ?? ''}`}
                      action="Image Scaling"
                      onClick={() => setPane('scaling')}
                    />
                  )}
                  <Row label="Frame rate" hint="Clips keep their place in time; an edit may move by a frame to stay in order.">
                    <Select
                      label="Frame rate"
                      value={rate?.id ?? 'custom'}
                      options={[
                        ...FRAME_RATES.map((candidate) => ({ value: candidate.id, label: candidate.label })),
                        ...(rate ? [] : [{ value: 'custom', label: `${formatFps(fps)} · custom`, disabled: true }])
                      ]}
                      onChange={(id) => {
                        const next = FRAME_RATES.find((candidate) => candidate.id === id)
                        if (next) setFps(next.fps)
                      }}
                      className="w-60"
                    />
                  </Row>
                  <Row label="Background" hint="Shows wherever no video covers the canvas.">
                    <div className="w-60">
                      <ColorField label="Background colour" value={hexBackground} onCommit={setBackground} />
                    </div>
                  </Row>
                </Group>
              </Section>
            )}

            {pane === 'scaling' && (
              <Section title="Image Scaling" description="How clips meet the canvas.">
                <Group title="When the canvas size changes">
                  <Row
                    label="Refit clips"
                    hint={
                      !sizeChanged
                        ? 'Used when you change the resolution in Master Settings. The size has not changed.'
                        : refittable === 0
                          ? 'Nothing is on the timeline yet, so there is nothing to refit.'
                          : `${FIT_OPTIONS.find((option) => option.value === fit)?.detail} Text keeps its place in proportion; compositions fill the new frame.`
                    }
                  >
                    <SegmentedControl<CanvasFit>
                      label="Refit clips to the new canvas"
                      value={fit}
                      options={FIT_OPTIONS.map(({ value, label }) => ({ value, label }))}
                      onChange={setFit}
                      disabled={!sizeChanged || sizeProblem !== null || refittable === 0}
                    />
                  </Row>
                </Group>
                <Group title="New clips">
                  <LinkRow
                    label="Framing for new clips"
                    hint={`${FIT_NAMES[newClipFit]}. A preference of yours rather than of this project, so it applies to every project on this Mac.`}
                    action="Preferences › Editing"
                    onClick={() => leaveFor(() => openPreferences('editing'))}
                  />
                </Group>
              </Section>
            )}

            {pane === 'audio' && (
              <Section
                title="Audio"
                description="This project stores no project-wide audio settings. Sound is set on each clip, and loudness on each export."
              >
                <Group title="Where it is set">
                  <Row
                    label="Level, fades and ducking"
                    hint="Per clip, in the Inspector. Ducking lowers a clip while another track is sounding."
                  >
                    <span className="text-[12px] text-ink-2 tabular-nums">
                      {audioTracks} audio track{audioTracks === 1 ? '' : 's'}
                    </span>
                  </Row>
                  <LinkRow
                    label="Loudness"
                    hint="Chosen when you export, as a loudness target and a peak ceiling."
                    action="Open Export"
                    onClick={() => leaveFor(() => runCommand('file.export'))}
                  />
                </Group>
              </Section>
            )}

            {pane === 'deliver' && (
              <Section
                title="Deliver"
                description="This project stores no export defaults. Preset, format, quality, size and range are chosen each time you export."
              >
                <Group title="Export">
                  <Row label="Timeline format" hint="Set in Master Settings.">
                    <span className="text-[12px] text-ink-1 tabular-nums">
                      {timeline.width} × {timeline.height} · {formatFps(timeline.fps)} fps
                    </span>
                  </Row>
                  <LinkRow
                    label="Export settings"
                    hint="Preset, container, quality, loudness and range."
                    action="Open Export"
                    onClick={() => leaveFor(() => runCommand('file.export'))}
                  />
                </Group>
              </Section>
            )}
          </div>
        </ScrollArea>
      </div>

      {applyError && (
        <div className="border-t border-line px-4 py-2.5">
          <InlineAlert tone="danger">Nothing was changed. {applyError}</InlineAlert>
        </div>
      )}

      <footer className="flex items-center justify-between gap-2 border-t border-line px-3 py-2.5">
        <Note>{changed ? 'Apply changes the project as one step; undo reverts all of it.' : 'No changes.'}</Note>
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" size="md" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" size="md" disabled={!changed || sizeProblem !== null || trimmedName === ''}>
            Apply
          </Button>
        </div>
      </footer>
    </form>
  )
}
