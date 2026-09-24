import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Modal, ScrollArea } from '@/components'
import { cn } from '@/lib/cn'
import { useEditor } from '@/store/editor'
import { useAccess } from '@/access/AccessGate'
import { AccountSection } from './AccountSection'
import { TranscriptionSection } from './TranscriptionSection'
import { AboutSection, AgentSection, EditingSection, GeneralSection, PlaybackSection, UpdatesSection } from './sections'

/**
 * Settings: what bay does on this Mac, one page at a time.
 *
 * It was one long scroll — account, transcription, agent, appearance, advanced, about — with no
 * way to see what was further down. Now a list of pages on the left, the page on the right.
 * Project-specific settings (canvas, rate, name) are not here: they belong to a project, and
 * are in File › Project Settings…
 */
export function SettingsDialog(): ReactNode {
  const open = useEditor((state) => state.settingsOpen)
  const setOpen = useEditor((state) => state.setSettingsOpen)
  return (
    <Modal open={open} title="Settings" onClose={() => setOpen(false)} width={720}>
      {open && <SettingsBody />}
    </Modal>
  )
}

type PageId = 'account' | 'general' | 'editing' | 'playback' | 'transcription' | 'agent' | 'updates' | 'about'

const PAGES: { id: PageId; label: string; render(): ReactNode }[] = [
  { id: 'general', label: 'General', render: () => <GeneralSection /> },
  { id: 'editing', label: 'Editing', render: () => <EditingSection /> },
  { id: 'playback', label: 'Playback', render: () => <PlaybackSection /> },
  { id: 'transcription', label: 'Transcription', render: () => <TranscriptionSection /> },
  { id: 'agent', label: 'Agent', render: () => <AgentSection /> },
  { id: 'account', label: 'Account', render: () => <AccountSection /> },
  { id: 'updates', label: 'Updates', render: () => <UpdatesSection /> },
  { id: 'about', label: 'About', render: () => <AboutSection /> }
]

/** The page shown when Settings opens: the last one used this session. */
let lastPage: PageId = 'general'

function SettingsBody(): ReactNode {
  const access = useAccess()
  // Account only has something to show for a signed-in (or dev-bypassed) Mac.
  const pages = PAGES.filter((page) => page.id !== 'account' || access?.state === 'entitled')
  const [current, setCurrent] = useState<PageId>(() => (pages.some((page) => page.id === lastPage) ? lastPage : 'general'))
  const tabs = useRef<(HTMLButtonElement | null)[]>([])
  const page = pages.find((candidate) => candidate.id === current) ?? pages[0]!

  const choose = (id: PageId): void => {
    lastPage = id
    setCurrent(id)
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    const index = pages.findIndex((candidate) => candidate.id === current)
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
    const jump = event.key === 'Home' ? 0 : event.key === 'End' ? pages.length - 1 : null
    if (step === 0 && jump === null) return
    event.preventDefault()
    const next = jump ?? (index + step + pages.length) % pages.length
    const target = pages[next]
    if (!target) return
    choose(target.id)
    tabs.current[next]?.focus()
  }

  return (
    <div className="flex h-[min(560px,70vh)]">
      <nav
        role="tablist"
        aria-label="Settings pages"
        aria-orientation="vertical"
        onKeyDown={onKeyDown}
        className="flex w-40 shrink-0 flex-col gap-0.5 border-r border-line p-2"
      >
        {pages.map((candidate, index) => {
          const selected = candidate.id === page.id
          return (
            <button
              key={candidate.id}
              ref={(element) => {
                tabs.current[index] = element
              }}
              type="button"
              role="tab"
              id={`settings-tab-${candidate.id}`}
              aria-selected={selected}
              aria-controls="settings-page"
              tabIndex={selected ? 0 : -1}
              onClick={() => choose(candidate.id)}
              className={cn(
                't-press h-7 rounded-sm px-2 text-left text-[12px] active:scale-[0.96]',
                selected ? 'bg-surface-4 text-ink-0' : 'text-ink-1 hover:bg-surface-3 hover:text-ink-0'
              )}
            >
              {candidate.label}
            </button>
          )
        })}
      </nav>
      <ScrollArea className="min-w-0 flex-1">
        <div role="tabpanel" id="settings-page" aria-labelledby={`settings-tab-${page.id}`}>
          {page.render()}
        </div>
      </ScrollArea>
    </div>
  )
}
