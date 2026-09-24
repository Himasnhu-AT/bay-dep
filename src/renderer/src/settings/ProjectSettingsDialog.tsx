import { useEffect, useState, type ReactNode } from 'react'
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
  Field,
  InlineAlert,
  Modal,
  NumberField,
  SegmentedControl,
  Select,
  TextField
} from '@/components'
import { shortcutOf, formatShortcut } from '@/lib/commands'
import { selectTimeline, useEditor } from '@/store/editor'
import { useProjectSettingsDialog } from '@/store/project-settings-dialog'
import { applyProjectSettings } from './projectSettingsApply'

/**
 * File › Project Settings…: the project's name and the active timeline's canvas, rate and
 * background. Nothing applies until Apply, and Apply is one undo step for all of it.
 *
 * The canvas goes through `resizeCanvas`, the same action `set_canvas` calls, so a size chosen
 * here refits clips exactly as the agent's would; `fit` is that tool's `fit`.
 */
export function ProjectSettingsDialog(): ReactNode {
  const open = useProjectSettingsDialog((state) => state.open)
  const close = useProjectSettingsDialog((state) => state.close)
  // The body mounts per opening, so its drafts start from the project as it is now.
  return (
    <Modal open={open} title="Project Settings" onClose={close} width={460}>
      {open && <ProjectSettingsBody onDone={close} />}
    </Modal>
  )
}

const FIT_OPTIONS: { value: CanvasFit; label: string; detail: string }[] = [
  { value: 'auto', label: 'Auto', detail: 'Fill the frame, unless that would crop away too much of a clip; then fit it whole.' },
  { value: 'cover', label: 'Fill', detail: 'Every video and image fills the frame. Edges that do not fit are cropped.' },
  { value: 'contain', label: 'Fit', detail: 'Every video and image is shown whole, with bars where the shapes differ.' }
]

function ProjectSettingsBody({ onDone }: { onDone(): void }): ReactNode {
  const timeline = useEditor(selectTimeline)
  const name = useEditor((state) => state.project.name)
  const proposal = useProjectSettingsDialog((state) => state.proposal)

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
  }, [proposal])

  if (!timeline) return <p className="p-4 text-[12px] text-ink-2">No timeline is open.</p>

  const preset = CANVAS_PRESETS.find((candidate) => candidate.width === width && candidate.height === height)
  const sizeProblem = checkCanvasSize(width, height)
  const sizeChanged = width !== timeline.width || height !== timeline.height
  const refittable = allItems(timeline).length
  const rate = matchFrameRate(fps)
  const hexBackground = /^#[0-9a-f]{6}$/i.test(background) ? background : '#000000'
  const trimmedName = draftName.trim()

  const changed =
    (trimmedName !== '' && trimmedName !== name) ||
    sizeChanged ||
    Math.abs(fps - timeline.fps) > 1e-9 ||
    hexBackground.toLowerCase() !== timeline.background.toLowerCase()

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

  return (
    <form
      className="flex flex-col"
      onSubmit={(event) => {
        event.preventDefault()
        if (changed && !sizeProblem) apply()
      }}
    >
      <div className="flex flex-col gap-4 px-4 py-4">
        {proposal && <InlineAlert tone="notice">{proposal.reason}</InlineAlert>}

        <Field label="Name">
          <TextField
            label="Project name"
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            invalid={trimmedName === ''}
          />
        </Field>

        <div className="flex flex-col gap-1.5">
          <h3 className="text-[13px] font-semibold text-ink-0">Canvas</h3>
          <Field label="Size">
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
          </Field>
          <div className="grid grid-cols-[64px_1fr] items-center gap-2">
            <span aria-hidden="true" />
            <div className="grid grid-cols-2 gap-1.5">
              <NumberField label="W" value={width} step={2} min={CANVAS_MIN_SIDE} max={CANVAS_MAX_SIDE} precision={0} suffix="px" onCommit={setWidth} />
              <NumberField label="H" value={height} step={2} min={CANVAS_MIN_SIDE} max={CANVAS_MAX_SIDE} precision={0} suffix="px" onCommit={setHeight} />
            </div>
          </div>
          {sizeProblem && <InlineAlert tone="danger">{sizeProblem}</InlineAlert>}

          {sizeChanged && !sizeProblem && (
            <div className="mt-1 flex flex-col gap-1.5">
              <Field label="Clips">
                <SegmentedControl<CanvasFit>
                  label="Refit clips to the new canvas"
                  value={fit}
                  options={FIT_OPTIONS.map(({ value, label }) => ({ value, label }))}
                  onChange={setFit}
                  disabled={refittable === 0}
                />
              </Field>
              <p className="pl-[72px] text-[11px] text-pretty text-ink-2">
                {refittable === 0
                  ? 'Nothing is on the timeline yet, so there is nothing to refit.'
                  : `${FIT_OPTIONS.find((option) => option.value === fit)?.detail} Text keeps its place in proportion; compositions fill the new frame.`}
              </p>
            </div>
          )}
        </div>

        <Field label="Frame rate">
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
          />
        </Field>

        <Field label="Background">
          <ColorField label="Background colour" value={hexBackground} onCommit={setBackground} />
        </Field>
        <p className="-mt-3 pl-[72px] text-[11px] text-pretty text-ink-2">
          Shows wherever no video covers the canvas.
        </p>
      </div>

      {applyError && (
        <div className="px-4 pb-3">
          <InlineAlert tone="danger">Nothing was changed. {applyError}</InlineAlert>
        </div>
      )}

      <footer className="flex items-center justify-end gap-2 border-t border-line px-3 py-2.5">
        <Button type="button" variant="ghost" size="md" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" size="md" disabled={!changed || sizeProblem !== null || trimmedName === ''}>
          Apply
        </Button>
      </footer>
    </form>
  )
}
