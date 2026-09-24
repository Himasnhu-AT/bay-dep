/**
 * The clip menu's editing rows, and the two small editors clip commands open: Paste Attributes
 * (⌥⇧⌘V or the menu) and Speed… (the menu). Every row runs a registry command, so the menu, the
 * key and the menu bar cannot do three different things, and every row shows its key from
 * `shortcutOf`.
 */

import { useState, type ReactNode } from 'react'
import { PASTE_ATTRIBUTES, type PasteAttribute } from '@shared/clipboard'
import { allItems, findAsset, findItem, itemEnd, type Item } from '@shared/project'
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

/**
 * The editing rows of the clip menu for `item`, opened at `at`. The caller appends its own rows
 * (detach, unlink) after these.
 */
export function clipMenuEntries(item: Item, at: { x: number; y: number }): MenuEntry[] {
  const state = useEditor.getState()
  const timeline = selectTimeline(state)
  const run = (id: CommandId) => () => void runCommand(id, 'ui')
  const row = (id: CommandId, label: string, extra: { disabled?: boolean; danger?: boolean } = {}): MenuEntry => ({
    label,
    onSelect: run(id),
    ...(shortcutOf(id) ? { shortcut: shortcutOf(id) } : {}),
    ...extra
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
    row('edit.paste', 'Paste at Playhead', { disabled: noClipboard }),
    row('edit.pasteAttributes', 'Paste Attributes…', { disabled: noClipboard }),
    { kind: 'separator' },
    row('clip.split', 'Split at Playhead', { disabled: !playheadInside || locked }),
    row('clip.duplicate', 'Duplicate', { disabled: locked }),
    row('clip.freezeFrame', 'Add Freeze Frame', { disabled: locked || !freezable || !playheadOver }),
    row('clip.toggleEnabled', item.disabled ? 'Enable Clip' : 'Disable Clip', { disabled: locked }),
    row('clip.addTransition', 'Add Transition at Nearest Cut'),
    {
      label: 'Speed…',
      disabled: locked,
      onSelect: () => useEditor.getState().setClipDialog({ kind: 'speed', itemId: item.id, x: at.x, y: at.y })
    },
    { label: 'Reveal in Media', onSelect: () => revealAsset(item.assetId) },
    { kind: 'separator' },
    row('clip.delete', 'Delete', { disabled: locked }),
    row('clip.rippleDelete', 'Ripple Delete', { disabled: locked, danger: true })
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

function SpeedPopover({ itemId, at, onClose }: { itemId: string; at: { x: number; y: number }; onClose(): void }): ReactNode {
  const item = useEditor((state) => {
    const timeline = selectTimeline(state)
    return timeline ? findItem(timeline, itemId)?.item : undefined
  })
  if (!item) return null
  return (
    <Popover open anchor={at} onClose={onClose} label="Clip speed" width={200}>
      <NumberField
        label="Speed"
        value={item.speed}
        step={0.05}
        min={0.1}
        max={16}
        precision={2}
        suffix="×"
        // `patchItem`, as the inspector's Speed field does: a linked sound follows the rate.
        onCommit={(next) => useEditor.getState().patchItem(itemId, { speed: Math.max(0.1, next) })}
      />
      <p className="mt-2 text-[10px] leading-relaxed text-pretty text-ink-2">
        The clip keeps its length on the timeline and plays more or less of its source.
      </p>
    </Popover>
  )
}
