import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, Code2, LoaderCircle, Sparkles } from 'lucide-react'
import { findAsset, type Asset } from '@shared/project'
import { BRF_STARTER } from '@shared/brf-starter'
import { Button, InlineAlert, Modal } from '@/components'
import { brfRuntime } from '@/engine/brfCode'
import { importedFonts } from '@/engine/importedFonts'
import { bay } from '@/lib/bay'
import { cn } from '@/lib/cn'
import { writeBrf } from '@/mcp/brf'
import { writeComposition } from '@/mcp/compositions'
import { runUserTool } from '@/lib/userTool'
import { selectTimeline, useEditor } from '@/store/editor'

/**
 * The source behind a motion graphic or a composition, editable by hand.
 *
 * Nothing here is a second implementation of writing one. Apply is `write_brf` or
 * `write_composition`, the tools the agent uses, through the same executor — so a person gets
 * the agent's guarantees: a `.brf` module is run across its whole duration before anything
 * changes and lands as one undo step; a composition is written, read back by bay's own reader,
 * and its problems are reported with their lines. Check (for `.brf`) is the exact verification
 * `write_brf` runs, without the write.
 */

type Kind = 'brf' | 'html'

interface Problem {
  tone: 'danger' | 'warning'
  text: string
}

/** The 1-based line a message names — "(line 12:5)" or "(line 12)" — for the gutter. */
function lineOf(message: string): number | null {
  const match = /\bline (\d+)/.exec(message)
  return match ? Number(match[1]) : null
}

/**
 * What the rewritten file now declares — duration, size, id, variables — copied onto the asset
 * every placement already names. Silent (`patchAsset`), like a poster arriving: the file changed
 * on disk, which no undo can take back, and the asset is a description of that file.
 */
async function refreshComposition(asset: Asset): Promise<void> {
  const api = bay()
  if (!api || !asset.path) return
  const fresh = (await api.media.importPaths([asset.path]).catch(() => []))[0]?.asset
  if (!fresh || fresh.error) return
  useEditor.getState().patchAsset(asset.id, {
    durationUs: fresh.durationUs,
    width: fresh.width,
    height: fresh.height,
    ...(fresh.compositionId !== undefined ? { compositionId: fresh.compositionId } : {}),
    ...(fresh.compositionVariables !== undefined ? { compositionVariables: fresh.compositionVariables } : {})
  })
}

function kindOf(asset: Asset | undefined): Kind | null {
  if (!asset) return null
  if (asset.kind === 'brf' && typeof asset.brfCode === 'string') return 'brf'
  if (asset.kind === 'html' && asset.path) return 'html'
  return null
}

export interface CodeEditorModalProps {
  assetId: string | null
  open: boolean
  onClose(): void
}

export function CodeEditorModal({ assetId, open, onClose }: CodeEditorModalProps): ReactNode {
  const asset = useEditor((state) => (assetId ? findAsset(state.project, assetId) : undefined))
  const notify = useEditor((state) => state.notify)
  const kind = kindOf(asset)

  const [source, setSource] = useState('')
  const [original, setOriginal] = useState('')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<'check' | 'apply' | null>(null)
  const [problems, setProblems] = useState<Problem[]>([])
  const [checked, setChecked] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const gutterRef = useRef<HTMLDivElement>(null)

  // Load the source each time the dialog opens on an asset. Not on every project change: an
  // undo while the dialog is open must not overwrite what the user is typing.
  useEffect(() => {
    if (!open || !assetId) return
    const current = findAsset(useEditor.getState().project, assetId)
    setProblems([])
    setChecked(false)
    setConfirmDiscard(false)
    if (current?.kind === 'brf' && typeof current.brfCode === 'string') {
      setSource(current.brfCode)
      setOriginal(current.brfCode)
    } else if (current?.kind === 'html' && current.path) {
      const path = current.path
      setLoading(true)
      setSource('')
      setOriginal('')
      let live = true
      const api = bay()
      void (api ? api.composition.inspect(path, true) : Promise.reject(new Error('no bridge to the app')))
        .then((result) => {
          if (!live) return
          const html = result.html ?? ''
          setSource(html)
          setOriginal(html)
          if (!result.html) setProblems([{ tone: 'danger', text: `${path} could not be read.` }])
        })
        .catch((error: unknown) => {
          if (live) setProblems([{ tone: 'danger', text: error instanceof Error ? error.message : String(error) }])
        })
        .finally(() => {
          if (live) setLoading(false)
        })
      return () => {
        live = false
      }
    }
    return undefined
  }, [open, assetId])

  // The Modal focuses its first control (Close); the editor is what the user came for.
  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => textRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [open, loading])

  const dirty = source !== original

  // Escape or Close with unsaved edits asks once rather than throwing the code away.
  const requestClose = (): void => {
    if (dirty && !confirmDiscard && busy === null) {
      setConfirmDiscard(true)
      return
    }
    onClose()
  }

  const check = async (): Promise<void> => {
    const tl = selectTimeline(useEditor.getState())
    if (!tl) return
    setBusy('check')
    importedFonts.sync(useEditor.getState().project.assets)
    const result = await brfRuntime.verify(source, tl.fps, tl.width, tl.height)
    setBusy(null)
    setChecked(result.ok)
    setProblems(result.ok ? [] : [{ tone: 'danger', text: result.error }])
  }

  const apply = async (): Promise<void> => {
    if (!asset || !kind) return
    setBusy('apply')
    setChecked(false)
    const result =
      kind === 'brf'
        ? await runUserTool('write_brf', writeBrf, { assetId: asset.id, code: source })
        : // `import: false`: the tool would import the rewritten file as a *new* asset (main mints
          // a fresh id once the path is forgotten), leaving a duplicate in the pool while every
          // placed clip still names this one. This asset is refreshed in place below instead.
          await runUserTool('write_composition', writeComposition, { path: asset.path, html: source, import: false })
    if (result.ok && kind === 'html' && (result.value as { usable?: boolean }).usable !== false && asset.path) {
      await refreshComposition(asset)
    }
    setBusy(null)
    if (!result.ok) {
      setProblems([{ tone: 'danger', text: result.error }])
      return
    }
    if (kind === 'html') {
      const value = result.value as { usable?: boolean; problems?: string[] }
      const found = (value.problems ?? []).map<Problem>((text) => ({ tone: text.startsWith('FATAL') ? 'danger' : 'warning', text }))
      setOriginal(source)
      if (value.usable === false) {
        // Written, but bay will not draw it until the fatal problems are fixed.
        setProblems(found)
        return
      }
      if (found.length > 0) {
        setProblems(found)
        notify(`${asset.name} saved, with ${found.length} warning${found.length === 1 ? '' : 's'}.`)
        return
      }
      notify(`${asset.name} saved.`)
      onClose()
      return
    }
    notify(`${asset.name} updated. ⌘Z to undo.`)
    onClose()
  }

  const lines = Math.max(1, source.split('\n').length)
  const flagged = new Set(problems.map((p) => lineOf(p.text)).filter((n): n is number => n !== null))

  const footer =
    kind === null ? (
      <Button variant="subtle" onClick={onClose}>
        Close
      </Button>
    ) : (
      <>
        <p className="mr-auto text-[11px] text-ink-2">
          {kind === 'brf'
            ? 'Apply replaces the module on every placement, as one undo step.'
            : 'Apply writes the file. A composition is a file, so this cannot be undone.'}
        </p>
        {kind === 'brf' && (
          <Button
            variant="subtle"
            disabled={busy !== null || loading}
            icon={busy === 'check' ? <LoaderCircle className="size-3.5 animate-spin" /> : checked ? <Check className="size-3.5" /> : undefined}
            onClick={() => void check()}
          >
            {checked ? 'Runs cleanly' : 'Check'}
          </Button>
        )}
        <Button
          variant="primary"
          disabled={busy !== null || loading || !dirty}
          icon={busy === 'apply' ? <LoaderCircle className="size-3.5 animate-spin" /> : undefined}
          title={dirty ? undefined : 'Nothing has changed yet'}
          onClick={() => void apply()}
        >
          {busy === 'apply' ? 'Applying…' : 'Apply'}
        </Button>
      </>
    )

  return (
    <Modal open={open} title={asset ? `Edit code · ${asset.name}` : 'Edit code'} onClose={requestClose} width={760} footer={footer}>
      {kind === null ? (
        <div className="p-3">
          <InlineAlert tone="notice">
            {asset
              ? asset.kind === 'brf'
                ? `${asset.name} is a scene document rather than code, so it has no source to edit here.`
                : `${asset.name} is not a motion graphic or composition, so it has no code.`
              : 'This asset is no longer in the project.'}
          </InlineAlert>
        </div>
      ) : (
        <div className="flex flex-col gap-2 p-3">
          <div className="flex h-[min(56vh,520px)] overflow-hidden rounded-sm border border-line bg-surface-0 focus-within:border-accent">
            <div
              ref={gutterRef}
              aria-hidden="true"
              className="shrink-0 overflow-hidden border-r border-line py-2 pr-2 pl-3 text-right font-mono text-[12px] leading-[18px] text-ink-2 tabular-nums select-none"
            >
              {Array.from({ length: lines }, (_, i) => (
                <div key={i} className={cn(flagged.has(i + 1) && 'font-semibold text-danger')}>
                  {i + 1}
                </div>
              ))}
            </div>
            <textarea
              ref={textRef}
              aria-label={kind === 'brf' ? 'Module source' : 'Composition HTML'}
              value={loading ? 'Loading…' : source}
              readOnly={loading}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              wrap="off"
              onChange={(event) => {
                setSource(event.target.value)
                setChecked(false)
                setConfirmDiscard(false)
              }}
              onScroll={(event) => {
                if (gutterRef.current) gutterRef.current.scrollTop = event.currentTarget.scrollTop
              }}
              onKeyDown={(event) => {
                // Tab indents rather than leaving the editor; Shift+Tab still moves focus back.
                if (event.key === 'Tab' && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
                  event.preventDefault()
                  event.currentTarget.setRangeText('  ', event.currentTarget.selectionStart, event.currentTarget.selectionEnd, 'end')
                  setSource(event.currentTarget.value)
                  setChecked(false)
                }
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                  event.preventDefault()
                  if (dirty && busy === null) void apply()
                }
              }}
              className="min-w-0 flex-1 resize-none bg-transparent py-2 pr-3 pl-2 font-mono text-[12px] leading-[18px] text-ink-0 outline-none"
            />
          </div>
          {confirmDiscard && (
            <InlineAlert tone="warning">Your changes are not applied. Close again to discard them.</InlineAlert>
          )}
          {problems.map((problem, i) => (
            <InlineAlert key={i} tone={problem.tone}>
              <span className="font-mono whitespace-pre-wrap">{problem.text}</span>
            </InlineAlert>
          ))}
          {problems.length === 0 && !confirmDiscard && (
            <p className="text-[10px] leading-relaxed text-ink-2">
              {kind === 'brf' ? (
                <>
                  Import only from <code className="font-mono">'bay'</code> or <code className="font-mono">'remotion'</code>. Check runs the
                  module across its duration the way Apply will. ⌘↵ applies.
                </>
              ) : (
                'bay reads the file back after writing it and lists anything that stops it drawing. ⌘↵ applies.'
              )}
            </p>
          )}
        </div>
      )}
    </Modal>
  )
}

/**
 * A new `.brf` asset from the starter module, through `write_brf` — added to the media pool, not
 * placed. Resolves to its asset id, or null (already reported) when it could not be made.
 */
export async function createMotionGraphic(): Promise<string | null> {
  const result = await runUserTool('write_brf', writeBrf, { code: BRF_STARTER, name: 'Motion graphic' })
  if (!result.ok) {
    useEditor.getState().notify(result.error, 'error')
    return null
  }
  const assetId = (result.value as { assetId?: unknown }).assetId
  return typeof assetId === 'string' ? assetId : null
}

/** "New motion graphic": makes one from the starter and opens it in the code editor. */
export function NewMotionGraphicButton({ className }: { className?: string }): ReactNode {
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  return (
    <>
      <Button
        variant="subtle"
        className={className}
        disabled={busy}
        icon={busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <Sparkles aria-hidden="true" className="size-3.5" />}
        onClick={() => {
          setBusy(true)
          void createMotionGraphic().then((assetId) => {
            setBusy(false)
            if (assetId) setEditing(assetId)
          })
        }}
      >
        New motion graphic
      </Button>
      <CodeEditorModal assetId={editing} open={editing !== null} onClose={() => setEditing(null)} />
    </>
  )
}

/** The icon the Media panel can use for "Edit code…". */
export const EditCodeIcon = Code2
