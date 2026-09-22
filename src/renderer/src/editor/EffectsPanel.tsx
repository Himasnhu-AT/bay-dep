import type { ReactNode } from 'react'
import { Info, Maximize2, Minimize2, Move, RotateCcw } from 'lucide-react'
import {
  containLayout,
  coverLayout,
  defaultLayout,
  findAsset,
  type Item,
  type Layout
} from '@shared/project'
import { Button, EmptyState, Panel, ScrollArea, Section } from '@/components'
import { useSelectedItems } from '@/lib/useSelectedItems'
import { selectTimeline, useEditor } from '@/store/editor'

/**
 * Everything on this panel maps to a field the project format actually has. Filters and
 * colour grades are listed as disabled rather than omitted: the greyed-out rows are the
 * honest map of what the engine cannot do yet, and a tile that adds an effect nothing
 * renders is a dead control you only discover when the export comes back unchanged.
 *
 * The obligation runs both ways, which is easy to forget. Transitions sat in that disabled
 * list while the engine had no way to draw one; it draws seven kinds now, so leaving the row
 * greyed out would be the same lie pointing the other way — a working feature advertised as
 * absent, which nobody thinks to check.
 *
 * **Blur graduated the same way and the row outlived it by a day.** It sat here reading "nothing
 * reads a blur off an item yet" after `Adjustments.blur` had landed, `adjustmentFilter` was
 * emitting `blur(Npx)`, and the Adjustments section had shipped a 0-40px slider for it. Nobody
 * caught it because a greyed-out row is the one thing on a panel people trust without checking —
 * which is exactly what makes this direction the more expensive of the two. So: when a field
 * lands, grep this list in the same change.
 *
 * **`Crop` was the next one, and it lasted a single commit** — `Item.crop` landed with
 * `cropSourceRect`/`cropDestRect` and four edge fields in the inspector while this list still
 * called it absent and the paragraph below still said an item has nowhere to store a rectangle.
 * That is twice in two commits, which retires "remember to check" as a strategy: the list is now
 * one row long, and the rule is that a row here must name a field that does not exist in
 * `@shared/project`. `Colour wheels` is the honest remainder — there is no lift/gamma/gain
 * anywhere in the model for a tile to write to.
 */
export function EffectsPanel(): ReactNode {
  const selected = useSelectedItems()
  const timeline = useEditor(selectTimeline)
  const project = useEditor((state) => state.project)
  const patchLayout = useEditor((state) => state.patchLayout)
  const patchItem = useEditor((state) => state.patchItem)
  const transact = useEditor((state) => state.transact)

  /**
   * Every button on this panel acts on the whole selection, so each one is a loop of
   * single-item store calls — and each of those is its own `edit()`, hence its own undo
   * entry. Four clips selected, one click on `0.5s`, four presses of Cmd+Z to take it back,
   * with the middle two leaving a selection that is half faded. So all three loops below go
   * through `transact`: one click is one undo step, which is the same promise the MCP tools
   * make. The inspector already worked this way; this panel did not.
   */
  const applyLayout = (make: (item: Item) => Layout | null): void => {
    if (!timeline) return
    transact(() => {
      for (const item of selected) {
        const layout = make(item)
        if (layout) patchLayout(item.id, layout)
      }
    })
  }

  const fit = (mode: 'cover' | 'contain' | 'reset'): void =>
    applyLayout((item) => {
      if (!timeline) return null
      if (mode === 'reset') return defaultLayout(timeline)
      const asset = findAsset(project, item.assetId)
      if (!asset?.width || !asset.height) return defaultLayout(timeline)
      return mode === 'cover'
        ? coverLayout(timeline, asset.width, asset.height)
        : containLayout(timeline, asset.width, asset.height)
    })

  const centre = (): void =>
    applyLayout((item) => {
      if (!timeline) return null
      return {
        ...item.layout,
        left: Math.round((timeline.width - item.layout.width) / 2),
        top: Math.round((timeline.height - item.layout.height) / 2)
      }
    })

  const fade = (frames: number): void => {
    transact(() => {
      for (const item of selected) {
        const capped = Math.min(frames, Math.floor(item.durationInFrames / 2))
        patchItem(item.id, { fadeInFrames: capped, fadeOutFrames: capped })
      }
    })
  }

  const setSpeed = (speed: number): void => {
    transact(() => {
      for (const item of selected) patchItem(item.id, { speed })
    })
  }

  if (selected.length === 0) {
    return (
      <Panel title="Effects" className="h-full">
        <EmptyState
          icon={<Move aria-hidden="true" className="size-6" />}
          title="Nothing selected"
          hint="Select one or more clips on the timeline to frame them, fade them, or change their speed."
        />
      </Panel>
    )
  }

  const fps = timeline?.fps ?? 30

  return (
    <Panel title="Effects" className="h-full" bodyClassName="flex flex-col">
      <ScrollArea className="flex-1">
        <Section title={`Frame · ${selected.length} selected`}>
          <div className="grid grid-cols-2 gap-1.5">
            <Button
              variant="subtle"
              icon={<Maximize2 className="size-3.5" />}
              onClick={() => fit('cover')}
            >
              Fill
            </Button>
            <Button
              variant="subtle"
              icon={<Minimize2 className="size-3.5" />}
              onClick={() => fit('contain')}
            >
              Fit
            </Button>
            <Button variant="subtle" icon={<Move className="size-3.5" />} onClick={centre}>
              Centre
            </Button>
            <Button
              variant="subtle"
              icon={<RotateCcw className="size-3.5" />}
              onClick={() => fit('reset')}
            >
              Reset
            </Button>
          </div>
        </Section>

        <Section title="Fade">
          <div className="grid grid-cols-4 gap-1.5">
            {[0, 0.25, 0.5, 1].map((seconds) => (
              <Button key={seconds} variant="subtle" onClick={() => fade(Math.round(seconds * fps))}>
                {seconds === 0 ? 'None' : `${seconds}s`}
              </Button>
            ))}
          </div>
          <p className="mt-1.5 text-[10px] text-ink-2">
            Applied to both ends, capped at half the clip.
          </p>
        </Section>

        <Section title="Speed">
          <div className="grid grid-cols-4 gap-1.5">
            {[0.5, 1, 1.5, 2].map((speed) => (
              <Button key={speed} variant="subtle" onClick={() => setSpeed(speed)}>
                {speed}×
              </Button>
            ))}
          </div>
          <p className="mt-1.5 text-[10px] text-ink-2">
            Changes the read rate into the source. The clip keeps its length on the timeline.
          </p>
        </Section>

        <Section title="Not yet in the engine">
          <div className="grid grid-cols-2 gap-1.5">
            {['Colour wheels'].map((name) => (
              <Button key={name} variant="subtle" disabled>
                {name}
              </Button>
            ))}
          </div>
          <div className="mt-2 flex items-start gap-2 text-ink-2">
            <Info aria-hidden="true" className="mt-px size-3.5 shrink-0" />
            <p className="text-[10px] leading-relaxed">
              Drawn disabled rather than hidden because the project format has no field for it —
              there is nowhere on an item to store a lift/gamma/gain wheel, so a tile here would
              set nothing. It lights up when the model does.
            </p>
          </div>
        </Section>

        {/* Crop was in the list above until `Item.crop` landed. It is not a tile here because a
            crop is four numbers rather than a verb — there is no useful one-click crop, and a
            button that guessed at 10% would be a worse control than the fields. */}
        <Section title="Crop">
          <p className="text-[10px] leading-relaxed text-ink-2">
            Set per edge in the inspector, as a percentage of the source. Stored as fractions, so
            a crop survives replacing the footage with a different resolution.
          </p>
        </Section>

        {/* Transitions were in the list above until the engine could draw them. They are not
            here as a tile because a transition belongs to a cut rather than to the selected
            clip — there is no correct answer to "which edge did you mean" from a panel. */}
        <Section title="Transitions">
          <p className="text-[10px] leading-relaxed text-ink-2">
            Click the marker on any cut in the timeline. A transition lives on the junction
            between two touching clips, not on either one of them, so the timeline is where it
            is set — including the cuts that cannot take one, which say why.
          </p>
        </Section>
      </ScrollArea>
    </Panel>
  )
}
