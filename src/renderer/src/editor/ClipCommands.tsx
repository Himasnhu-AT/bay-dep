/**
 * The clip menu's editing rows, and the two small editors clip commands open: Paste Attributes
 * (⌥⇧⌘V or the menu) and Speed… (the menu). Every row runs a registry command, so the menu, the
 * key and the menu bar cannot do three different things, and every row shows its key from
 * `shortcutOf`.
 */

import { useState, type ReactNode } from 'react'
import { PASTE_ATTRIBUTES, type PasteAttribute } from '@shared/clipboard'
import { allItems, findAsset, findItem, itemEnd, type Item } from '@shared/project'
import { CLIP_SPEED_RANGE, speedNote } from '@shared/speed'
import { formatTimecode } from '@shared/timecode'
import { Button, Checkbox, Modal, NumberField, Popover, type MenuEntry } from '@/components'
import { runCommand, shortcutOf, type CommandId } from '@/lib/commands'
import { selectTimeline, useEditor } from '@/store/editor'

/** Scrolls the media pool to an asset's card and focuses it. */
function revealAsset(assetId: string): void {
  const store = useEditor.getState()
  store.setPanel('media')
  store.setRegionHidden('side', false)
  // After the panel has rendered.
  requestAnimationFrame(() => {
    const card = document.querySelector<HTMLElement>(`[data-asset-id="${CSS.escape(assetId)}"]`)
    if (!card) {
      store.notify('That clip’s media is not in the media pool.')
      return
    }
    card.scrollIntoView({ block: 'nearest' })
    card.querySelector<HTMLElement>('button')?.focus()
  })
}

/** The clip menu's pages: the main list, and the rows each `›` row opens in its place. */
export type ClipMenuPage = 'main' | 'trim' | 'audio' | 'ripple'

/**
 * The main page of the clip menu for `item`, opened at `at`. It was one flat list of 22 rows,
 * taller than the window; now the rarer rows sit behind `›` rows (Trim, Audio, Ripple Delete)
 * that reopen the menu on their page at the same point. `Menu` has no nested submenus, and a
 * page in place keeps the keyboard contract a nested menu would need rebuilt. `openPage` is the
 * timeline's, which owns where the menu is.
 */
export function clipMenuEntries(
  item: Item,
  at: { x: number; y: number },
  openPage: (page: ClipMenuPage) => void
): MenuEntry[] {
  const state = useEditor.getState()
  const timeline = selectTimeline(state)
  const run = (id: CommandId) => () => void runCommand(id, 'ui')
  const row = (id: CommandId, label: string, extra: { disabled?: boolean; danger?: boolean } = {}): MenuEntry => ({
    label,
    onSelect: run(id),
    ...(shortcutOf(id) ? { shortcut: shortcutOf(id) } : {}),
    ...extra
  })
  const page = (label: string, to: ClipMenuPage, disabled = false): MenuEntry => ({
    label,
    submenu: true,
    disabled,
    onSelect: () => openPage(to)
  })
  const selected = timeline ? allItems(timeline).filter((i) => state.selection.includes(i.id)) : []
  const playheadInside = selected.some((i) => state.playhead > i.from && state.playhead < itemEnd(i))
  const locked = timeline ? findItem(timeline, item.id)?.track.locked === true : false
  const noClipboard = state.clipboard === null
  // Freeze Frame holds a frame of a video clip, from its first frame to its last.
  const asset = findAsset(state.project, item.assetId)
  const onVideoTrack = timeline ? findItem(timeline, item.id)?.track.kind === 'video' : false
  const freezable = asset?.kind === 'video' && asset.hasVideo && !asset.error && onVideoTrack
  const playheadOver = state.playhead >= item.from && state.playhead < itemEnd(item)
  return [
    row('edit.cut', 'Cut', { disabled: locked }),
    row('edit.copy', 'Copy'),
    row('edit.paste', noClipboard ? 'Paste at Playhead — nothing copied' : 'Paste at Playhead', { disabled: noClipboard }),
    row('edit.pasteAttributes', noClipboard ? 'Paste Attributes… — nothing copied' : 'Paste Attributes…', {
      disabled: noClipboard
    }),
    { kind: 'separator' },
    row(
      'clip.split',
      // A disabled row says why: a cut on a clip's edge would make a zero-length clip.
      locked
        ? 'Split at Playhead — track is locked'
        : playheadInside
          ? 'Split at Playhead'
          : selected.some((i) => state.playhead === i.from || state.playhead === itemEnd(i))
            ? 'Split at Playhead — playhead is on the clip’s edge'
            : 'Split at Playhead — playhead is not over the clip',
      { disabled: !playheadInside || locked }
    ),
    row('clip.duplicate', 'Duplicate', { disabled: locked }),
    row('clip.freezeFrame', 'Add Freeze Frame', { disabled: locked || !freezable || !playheadOver }),
    row('clip.toggleEnabled', item.disabled ? 'Enable Clip' : 'Disable Clip', { disabled: locked }),
    {
      label: 'Speed…',
      disabled: locked,
      onSelect: () => useEditor.getState().setClipDialog({ kind: 'speed', itemId: item.id, x: at.x, y: at.y })
    },
    row('clip.addTransition', 'Add Transition at Nearest Cut'),
    { kind: 'separator' },
    page('Trim', 'trim', locked),
    page('Audio', 'audio'),
    { label: 'Reveal in Media', onSelect: () => revealAsset(item.assetId) },
    { kind: 'separator' },
    row('clip.delete', 'Delete', { disabled: locked }),
    page('Ripple Delete', 'ripple', locked)
  ]
}

/** The ripple-delete page: across every track (⇧⌫), or closing only this track's gap. */
export function rippleDeleteEntries(locked: boolean, thisTrackOnly: () => void): MenuEntry[] {
  const shortcut = shortcutOf('clip.rippleDelete')
  return [
    {
      label: 'Ripple Delete',
      danger: true,
      disabled: locked,
      ...(shortcut ? { shortcut } : {}),
      onSelect: () => void runCommand('clip.rippleDelete', 'ui')
    },
    { label: 'Ripple Delete (This Track Only)', danger: true, disabled: locked, onSelect: thisTrackOnly }
  ]
}

/** Paste Attributes and Speed…, driven by `clipDialog` in the store. Mounted once, by the timeline. */
export function ClipDialogs(): ReactNode {
  const dialog = useEditor((state) => state.clipDialog)
  const close = (): void => useEditor.getState().setClipDialog(null)
  return (
    <>
      <PasteAttributesDialog open={dialog?.kind === 'pasteAttributes'} onClose={close} />
      {dialog?.kind === 'speed' && <SpeedPopover itemId={dialog.itemId} at={{ x: dialog.x, y: dialog.y }} onClose={close} />}
    </>
  )
}

/** Remembered for the session: the choice someone makes once is usually the one they want again. */
let lastChoice: ReadonlySet<PasteAttribute> = new Set<PasteAttribute>(['grade', 'adjustments'])

function PasteAttributesDialog({ open, onClose }: { open: boolean; onClose(): void }): ReactNode {
  const [chosen, setChosen] = useState<ReadonlySet<PasteAttribute>>(lastChoice)
  const count = useEditor((state) => state.selection.length)
  const source = useEditor((state) => state.clipboard?.items[0])
  const apply = (): void => {
    lastChoice = chosen
    const changed = useEditor.getState().pasteAttributes([...chosen])
    if (changed > 0) {
      useEditor.getState().notify(`Pasted ${[...chosen].length} attribute${chosen.size === 1 ? '' : 's'} onto ${changed} clip${changed === 1 ? '' : 's'}.`)
    }
    onClose()
  }
  return (
    <Modal
      open={open}
      title="Paste Attributes"
      onClose={onClose}
      width={360}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={chosen.size === 0 || !source || count === 0} onClick={apply}>
            Paste onto {count} clip{count === 1 ? '' : 's'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2 p-3">
        <p className="text-[11px] text-pretty text-ink-2">
          From the first copied clip. What you leave unticked stays as it is on each clip.
        </p>
        {PASTE_ATTRIBUTES.map((attribute) => (
          <div key={attribute.id} className="flex flex-col gap-0.5">
            <Checkbox
              checked={chosen.has(attribute.id)}
              label={attribute.label}
              onChange={(on) => {
                const next = new Set(chosen)
                if (on) next.add(attribute.id)
                else next.delete(attribute.id)
                setChosen(next)
              }}
            />
            <span className="pl-5.5 text-[10px] text-ink-2">{attribute.detail}</span>
          </div>
        ))}
      </div>
    </Modal>
  )
}

/** Remembered for the session, like Paste Attributes' choices. */
let lastRipple = false

function SpeedPopover({ itemId, at, onClose }: { itemId: string; at: { x: number; y: number }; onClose(): void }): ReactNode {
  const item = useEditor((state) => {
    const timeline = selectTimeline(state)
    return timeline ? findItem(timeline, itemId)?.item : undefined
  })
  const fps = useEditor((state) => selectTimeline(state)?.fps ?? 30)
  const [ripple, setRipple] = useState(lastRipple)
  // A stable anchor: a new object each render would re-place the popover every render.
  const [anchor] = useState(at)
  if (!item) return null
  const apply = (next: number): void => {
    const store = useEditor.getState()
    // The same plan `edit_item({ speed })` runs: the clip keeps its footage, so its length
    // changes; a linked sound follows.
    const plan = store.setClipSpeed(itemId, Math.max(CLIP_SPEED_RANGE.min, next), { ripple })
    const timeline = selectTimeline(useEditor.getState())
    if (!plan || !timeline) return
    const note = speedNote(store.project, timeline, plan, (frame) => formatTimecode(frame, timeline.fps))
    if (note) store.notify(note)
  }
  return (
    <Popover open anchor={anchor} onClose={onClose} label="Clip speed" width={220}>
      <div
        // Enter applies and closes: the field commits on its own Enter (it blurs), which runs
        // before this bubbles up.
        onKeyDown={(event) => {
          if (event.key === 'Enter') onClose()
        }}
      >
        <NumberField
          label="Speed"
          value={item.speed}
          step={0.05}
          min={CLIP_SPEED_RANGE.min}
          max={CLIP_SPEED_RANGE.max}
          defaultValue={1}
          precision={2}
          suffix="×"
          onCommit={apply}
        />
      </div>
      <div className="mt-2">
        <Checkbox
          label="Push later clips"
          checked={ripple}
          onChange={(on) => {
            lastRipple = on
            setRipple(on)
          }}
        />
      </div>
      <p className="mt-2 text-[10px] leading-relaxed text-pretty text-ink-2">
        The clip plays the same footage, so faster makes it shorter and slower makes it longer (now{' '}
        {formatTimecode(item.durationInFrames, fps)}). Without “Push later clips” it stops at the next clip.
      </p>
    </Popover>
  )
}
