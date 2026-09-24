import { useState, type ReactNode } from 'react'
import { FolderOpen } from 'lucide-react'
import { allItems, type Asset, type Item } from '@shared/project'
import { Field, IconButton, Section, TextField } from '@/components'
import { call, formatSourceDuration } from '@/lib/bay'
import { selectTimeline, useEditor } from '@/store/editor'
import { editAssetFields } from './inspectorEdit'

/** Plain readout row: label left, value right. */
export function Readout({ label, value }: { label: string; value: ReactNode }): ReactNode {
  return (
    <div className="flex items-baseline justify-between gap-2 py-0.5">
      <span className="shrink-0 text-[11px] text-ink-2">{label}</span>
      <span className="truncate text-right text-[11px] text-ink-1 tabular-nums">{value}</span>
    </div>
  )
}

const KIND_LABEL: Record<Asset['kind'], string> = {
  video: 'Video',
  audio: 'Audio',
  image: 'Image',
  gif: 'GIF',
  text: 'Text',
  html: 'Composition',
  brf: 'Motion graphic',
  lut: 'LUT',
  font: 'Font'
}

/**
 * A text field that edits a committed value: typing is a draft, Enter or leaving the field
 * commits, Escape puts the stored value back. Remounted by `key` when the stored value changes
 * underneath (undo, the agent), so a stale draft never overwrites a newer value.
 */
function NameField({ asset }: { asset: Asset }): ReactNode {
  const [draft, setDraft] = useState(asset.name)
  const commit = (): void => {
    const next = draft.trim()
    if (next === asset.name) return
    if (next === '') {
      setDraft(asset.name)
      return
    }
    if (!editAssetFields(asset.id, { name: next })) setDraft(asset.name)
  }
  return (
    <TextField
      label="Clip name"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
        if (event.key === 'Escape') {
          setDraft(asset.name)
          // Blur after the reset lands, so the commit on blur sees the stored name.
          requestAnimationFrame(() => (event.target as HTMLInputElement).blur())
        }
      }}
    />
  )
}

/** The words of a text asset — `edit_asset`'s `text` — edited in place. */
function WordsField({ asset, placements }: { asset: Asset; placements: number }): ReactNode {
  const stored = asset.text ?? ''
  const [draft, setDraft] = useState(stored)
  const commit = (): void => {
    if (draft === stored) return
    if (draft.trim() === '') {
      setDraft(stored)
      useEditor.getState().notify('A title needs words. To hide it, delete the clip instead.', 'error')
      return
    }
    if (!editAssetFields(asset.id, { text: draft })) setDraft(stored)
  }
  return (
    <div className="mt-2">
      <label htmlFor={`words-${asset.id}`} className="mb-1 block text-[11px] text-ink-1">
        Words
      </label>
      <textarea
        id={`words-${asset.id}`}
        value={draft}
        rows={Math.min(6, Math.max(2, draft.split('\n').length))}
        spellCheck
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          // Enter is a line break (titles are often two lines); ⌘Enter commits.
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            event.currentTarget.blur()
          }
          if (event.key === 'Escape') {
            setDraft(stored)
            requestAnimationFrame(() => (event.target as HTMLTextAreaElement).blur())
          }
        }}
        className="t-fast w-full resize-y rounded-sm border border-line bg-surface-2 px-2 py-1.5 text-[12px] leading-snug text-ink-0 outline-none hover:border-line-strong focus:border-accent focus:ring-1 focus:ring-accent"
      />
      <p className="mt-1 text-[10px] leading-relaxed text-ink-2">
        {placements > 1
          ? `Changes every placement of this title — ${placements} clips. ⌘Enter to apply.`
          : '⌘Enter or click away to apply. Enter starts a new line.'}
      </p>
    </div>
  )
}

/**
 * What the selection is: the clip's name (the asset's — `edit_asset.name`, so it changes on
 * every placement and in the media pool), what kind of thing it is, and for a title its words.
 */
export function ClipSection({
  items,
  asset,
  visual
}: {
  items: Item[]
  asset: Asset | undefined
  visual: boolean
}): ReactNode {
  const timeline = useEditor(selectTimeline)
  const count = items.length
  const placements =
    asset && timeline ? allItems(timeline).filter((item) => item.assetId === asset.id).length : 0

  return (
    <Section
      id="inspector.clip"
      title={count > 1 ? `Clips · ${count} selected` : 'Clip'}
      collapsible
      actions={
        count === 1 && asset?.path ? (
          <IconButton
            size="xs"
            tooltipSide="left"
            label="Reveal in Finder"
            icon={<FolderOpen aria-hidden="true" className="size-3" />}
            onClick={() =>
              void call('Reveal in Finder', (api) => api.media.revealInFolder(asset.path as string))
            }
          />
        ) : undefined
      }
    >
      {count > 1 ? (
        <p className="text-[11px] leading-relaxed text-ink-2">
          Every field applies to all {count} clips as one undo step. Where they differ, the field
          reads “Mixed” until you set it.
        </p>
      ) : asset ? (
        <>
          <Field label="Name">
            <NameField key={`${asset.id}:${asset.name}`} asset={asset} />
          </Field>
          <div className="mt-1.5">
            <Readout label="Kind" value={KIND_LABEL[asset.kind]} />
            {visual && asset.kind !== 'text' && (
              <Readout
                label="Size"
                value={asset.width && asset.height ? `${asset.width} × ${asset.height}` : '—'}
              />
            )}
            {asset.durationUs > 0 && (
              <Readout label="Source length" value={formatSourceDuration(asset.durationUs)} />
            )}
          </div>
          {asset.kind === 'text' && (
            <WordsField key={`${asset.id}:${asset.text ?? ''}`} asset={asset} placements={placements} />
          )}
          {asset.error && <p className="mt-1 text-[11px] text-danger">{asset.error}</p>}
        </>
      ) : (
        <p className="text-[11px] text-danger">This clip’s media is missing from the project.</p>
      )}
    </Section>
  )
}
