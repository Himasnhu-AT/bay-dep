import { useMemo, type ReactNode } from 'react'
import { ClipboardCopy, ClipboardPaste, FileUp, Palette, RotateCcw } from 'lucide-react'
import { findAsset, type Asset, type Item } from '@shared/project'
import { isGradeableKind } from '@shared/grade'
import { Button, EmptyState, ScrollArea, Section, SectionBars, ToolbarGroup, ToolButton } from '@/components'
import { cn } from '@/lib/cn'
import { runCommand } from '@/lib/commands'
import { useSelectedItems } from '@/lib/useSelectedItems'
import { selectTimeline, useEditor } from '@/store/editor'
import { AdjustmentsSection } from '../AdjustmentsSection'
import { GradeSection } from '../GradeSection'
import { hasLook } from './clips'
import { pasteGrade, resetGrade, useGradeClipboard } from './gradeClipboard'

/** Below a panel width of 28rem the grade buttons show icons only (their names stay as tooltips). */
const NARROW = '@max-md:w-7 @max-md:px-0 @max-md:[&>span]:hidden'

export interface ColorPanelProps {
  className?: string
}

/**
 * The Color page's grading panel: the selected clip's grade, large. A header with Copy / Paste /
 * Reset Grade, then three labelled cards side by side where there is room — Primaries (the
 * inspector's `GradeSection`), Adjustments (`AdjustmentsSection`), and the project's LUTs.
 *
 * The sections are the inspector's own components with the same props, so a value set here is
 * the value the inspector shows, stored through the same `patchItem` path, one undo step per
 * commit. Nothing here grades on its own.
 */
export function ColorPanel({ className }: ColorPanelProps): ReactNode {
  const selected = useSelectedItems()
  const timeline = useEditor(selectTimeline)
  const project = useEditor((state) => state.project)
  const copied = useGradeClipboard((state) => state.sourceName)
  const kindOf = (item: Item): string | undefined => findAsset(project, item.assetId)?.kind
  // Picture sources only: text draws its own glyphs and sound has no picture, so a grade there
  // would be stored and draw nothing — the same rule the inspector applies.
  const items = selected.filter((item) => {
    const track = timeline?.tracks.find((candidate) => candidate.id === item.trackId)
    return track?.kind === 'video' && isGradeableKind(kindOf(item))
  })
  const luts = useMemo(() => project.assets.filter((asset) => asset.kind === 'lut'), [project.assets])
  const usableLuts = luts.filter((asset) => !asset.error)
  const first = items[0]
  const notify = useEditor((state) => state.notify)

  const copy = (): void => {
    if (!first) return
    const name = findAsset(project, first.assetId)?.name ?? 'the clip'
    useGradeClipboard.getState().copy(first, name)
    notify(`Copied the grade of ${name}.`)
  }
  const paste = (): void => {
    const count = pasteGrade(items)
    if (count > 0) notify(`Pasted the grade onto ${count === 1 ? 'the clip' : `${count} clips`}. ⌘Z to undo.`)
  }

  const header = (
    <header className="flex h-9 shrink-0 items-center gap-2 border-b border-line bg-chrome-raised pr-1 pl-3">
      <h2 className="text-[11px] font-semibold tracking-[0.08em] text-ink-0 uppercase">Color</h2>
      <span className="min-w-0 flex-1 truncate text-[11px] text-ink-2">
        {first
          ? items.length === 1
            ? (findAsset(project, first.assetId)?.name ?? '')
            : `${items.length} clips`
          : ''}
      </span>
      <ToolbarGroup label="Grade">
        <ToolButton
          label="Copy Grade"
          className={NARROW}
          icon={<ClipboardCopy aria-hidden="true" className="size-3.5" />}
          disabled={items.length !== 1}
          title={items.length > 1 ? 'Select one clip to copy its grade' : undefined}
          onClick={copy}
        />
        <ToolButton
          label="Paste Grade"
          className={NARROW}
          icon={<ClipboardPaste aria-hidden="true" className="size-3.5" />}
          disabled={!copied || items.length === 0}
          onClick={paste}
        />
        <ToolButton
          label="Reset Grade"
          className={NARROW}
          icon={<RotateCcw aria-hidden="true" className="size-3.5" />}
          disabled={!items.some(hasLook)}
          onClick={() => resetGrade(items)}
        />
      </ToolbarGroup>
    </header>
  )

  if (!timeline || items.length === 0) {
    const unGradeable = selected.length > 0
    return (
      <section aria-label="Color" className={cn('@container flex h-full min-h-0 min-w-0 flex-col bg-surface-1', className)}>
        {header}
        <EmptyState
          icon={<Palette className="size-6" />}
          title={unGradeable ? 'This clip has no picture to grade' : 'Select a clip to grade'}
          hint={
            unGradeable
              ? 'Titles and sound are not graded. Choose a video or image clip in the strip or on the timeline.'
              : 'Choose a clip in the strip above or on the timeline. Its grade, adjustments and LUT appear here.'
          }
        />
      </section>
    )
  }

  return (
    <section aria-label="Color" className={cn('@container flex h-full min-h-0 min-w-0 flex-col bg-surface-1', className)}>
      {header}
      <ScrollArea className="flex-1">
        <div className="grid grid-cols-1 gap-2 p-2 @2xl:grid-cols-2 @5xl:grid-cols-3">
          <Card label="Primaries">
            <GradeSection items={items} luts={usableLuts} />
          </Card>
          <Card label="Adjustments and blend">
            <AdjustmentsSection items={items} timeline={timeline} />
          </Card>
          <Card label="LUTs">
            <Section id="color.luts" title={`LUTs · ${usableLuts.length}`} collapsible>
              <LutList items={items} luts={luts} />
            </Section>
          </Card>
        </div>
        {copied && <p className="px-3 pb-3 text-[11px] text-ink-2">Grade on the clipboard: {copied}.</p>}
      </ScrollArea>
    </section>
  )
}

/**
 * A column on the Color page. Its sections draw their own title bars (`SectionBars`, the
 * inspector's look), so the card adds a border and no second heading over "Grade".
 */
function Card({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <section aria-label={label} className="min-w-0 self-start overflow-hidden rounded-sm border border-line bg-surface-1">
      <SectionBars>{children}</SectionBars>
    </section>
  )
}

/**
 * Every LUT in the project with Apply / Remove for the selection, and Import LUT (the ordinary
 * import: a `.cube` becomes a `lut` asset). Applying keeps the intensity already set, or full.
 */
function LutList({ items, luts }: { items: Item[]; luts: Asset[] }): ReactNode {
  const transact = useEditor((state) => state.transact)
  const patchItem = useEditor((state) => state.patchItem)
  const applied = (lut: Asset): boolean => items.every((item) => item.grade?.lut?.assetId === lut.id)
  const apply = (lut: Asset): void =>
    transact(() => {
      for (const item of items) {
        patchItem(item.id, { grade: { ...item.grade, lut: { assetId: lut.id, intensity: item.grade?.lut?.intensity ?? 1 } } })
      }
    })
  const remove = (): void =>
    transact(() => {
      for (const item of items) {
        if (!item.grade?.lut) continue
        const { lut: _removed, ...rest } = item.grade
        patchItem(item.id, { grade: Object.keys(rest).length > 0 ? rest : undefined })
      }
    })

  return (
    <div>
      {luts.length === 0 ? (
        <p className="text-[11px] text-pretty text-ink-2">No LUTs in this project. Import a .cube file to add one.</p>
      ) : (
        <ul aria-label="LUTs" className="-mx-1 space-y-0.5">
          {luts.map((lut) => {
            const on = applied(lut)
            return (
              <li key={lut.id} className={cn('flex items-center gap-2 rounded-xs px-1 py-1', on && 'bg-accent/10')}>
                <span
                  aria-hidden="true"
                  className={cn('size-1.5 shrink-0 rounded-full', on ? 'bg-accent' : 'bg-transparent')}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11px] text-ink-0" title={lut.name}>
                    {lut.name}
                  </span>
                  {lut.error && <span className="block truncate text-[10px] text-danger">{lut.error}</span>}
                </span>
                {on ? (
                  <Button variant="ghost" onClick={remove} aria-label={`Remove ${lut.name}`}>
                    Remove
                  </Button>
                ) : (
                  <Button variant="subtle" onClick={() => apply(lut)} disabled={Boolean(lut.error)} aria-label={`Apply ${lut.name}`}>
                    Apply
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <Button variant="subtle" className="mt-3" icon={<FileUp className="size-3.5" />} onClick={() => runCommand('file.import')}>
        Import LUT…
      </Button>
      <p className="mt-1.5 text-[10px] text-pretty text-ink-2">Intensity is under Primaries, beside the LUT menu.</p>
    </div>
  )
}
