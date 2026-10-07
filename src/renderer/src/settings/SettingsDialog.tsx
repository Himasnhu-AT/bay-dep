import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import {
  Bot,
  Captions,
  Clapperboard,
  HardDrive,
  Info,
  Keyboard,
  MonitorPlay,
  Play,
  RefreshCw,
  ScanSearch,
  ShieldCheck,
  Scissors,
  Sparkles,
  SunMoon,
  UserRound
} from 'lucide-react'
import { Modal, ScrollArea } from '@/components'
import { cn } from '@/lib/cn'
import { useEditor } from '@/store/editor'
import { useAccess } from '@/access/AccessGate'
import { AccountSection } from './AccountSection'
import { TranscriptionSection } from './TranscriptionSection'
import { VisualSearchSection } from './VisualSearchSection'
import { ProvidersSection } from './ProvidersSection'
import { PrivacySection } from './PrivacySection'
import {
  AboutSection,
  AgentSection,
  EditingSection,
  InterfaceSection,
  KeyboardSection,
  MediaToolsSection,
  PlaybackSection,
  StorageSection,
  UpdatesSection,
  ViewerSection
} from './sections'
import { PreferencesNavigation } from './parts'

/**
 * Preferences: how bay works on this Mac, split the way DaVinci Resolve splits it.
 *
 * **System** is what the machine has — the media tools, storage, models, provider keys, the
 * account, updates. **User** is how you like to work — the interface, editing defaults, playback,
 * the viewer, keys, the agent. What a *project* is (canvas, rate, name, background) is neither,
 * and lives in File › Project Settings…. Every setting has exactly one home across the two
 * dialogs; a page that mentions another's setting links to it rather than repeating the control.
 */
export function SettingsDialog(): ReactNode {
  const open = useEditor((state) => state.settingsOpen)
  const setOpen = useEditor((state) => state.setSettingsOpen)
  return (
    <Modal open={open} title="Preferences" onClose={() => setOpen(false)} width={800}>
      {open && <PreferencesBody />}
    </Modal>
  )
}

export type PreferencesPage =
  | 'media-tools'
  | 'storage'
  | 'transcription'
  | 'visual-search'
  | 'providers'
  | 'account'
  | 'privacy'
  | 'updates'
  | 'about'
  | 'interface'
  | 'editing'
  | 'playback'
  | 'viewer'
  | 'keyboard'
  | 'agent'

interface PageSpec {
  id: PreferencesPage
  label: string
  icon: ReactNode
  render(): ReactNode
}

const icon = (Icon: typeof Bot): ReactNode => <Icon aria-hidden="true" className="size-3.5 shrink-0" />

const GROUPS: { title: 'System' | 'User'; pages: PageSpec[] }[] = [
  {
    title: 'System',
    pages: [
      { id: 'media-tools', label: 'Media tools', icon: icon(Clapperboard), render: () => <MediaToolsSection /> },
      { id: 'storage', label: 'Storage', icon: icon(HardDrive), render: () => <StorageSection /> },
      { id: 'transcription', label: 'Transcription', icon: icon(Captions), render: () => <TranscriptionSection /> },
      { id: 'visual-search', label: 'Visual search', icon: icon(ScanSearch), render: () => <VisualSearchSection /> },
      { id: 'providers', label: 'AI providers', icon: icon(Sparkles), render: () => <ProvidersSection /> },
      { id: 'account', label: 'Account', icon: icon(UserRound), render: () => <AccountSection /> },
      { id: 'privacy', label: 'Privacy', icon: icon(ShieldCheck), render: () => <PrivacySection /> },
      { id: 'updates', label: 'Updates', icon: icon(RefreshCw), render: () => <UpdatesSection /> },
      { id: 'about', label: 'About', icon: icon(Info), render: () => <AboutSection /> }
    ]
  },
  {
    title: 'User',
    pages: [
      { id: 'interface', label: 'Interface', icon: icon(SunMoon), render: () => <InterfaceSection /> },
      { id: 'editing', label: 'Editing', icon: icon(Scissors), render: () => <EditingSection /> },
      { id: 'playback', label: 'Playback', icon: icon(Play), render: () => <PlaybackSection /> },
      { id: 'viewer', label: 'Viewer', icon: icon(MonitorPlay), render: () => <ViewerSection /> },
      { id: 'keyboard', label: 'Keyboard', icon: icon(Keyboard), render: () => <KeyboardSection /> },
      { id: 'agent', label: 'Agent', icon: icon(Bot), render: () => <AgentSection /> }
    ]
  }
]

const DEFAULT_PAGE: PreferencesPage = 'interface'

/** The page shown when Preferences opens: the last one used this session, or one asked for. */
let lastPage: PreferencesPage = DEFAULT_PAGE

/**
 * Opens Preferences at a page — for a status line or an error that knows which page answers it
 * ("the model is missing" → Transcription) rather than leaving the user at the last page used.
 */
export function openPreferences(page?: PreferencesPage): void {
  useEditor.getState().setSettingsOpen(true, page)
}

function isPage(id: string | null): id is PreferencesPage {
  return id !== null && GROUPS.some((group) => group.pages.some((page) => page.id === id))
}

function PreferencesBody(): ReactNode {
  const access = useAccess()
  // Account only has something to show for a signed-in (or dev-bypassed) Mac.
  const groups = GROUPS.map((group) => ({
    ...group,
    pages: group.pages.filter((page) => page.id !== 'account' || access?.state === 'entitled')
  }))
  const pages = groups.flatMap((group) => group.pages)
  // A page asked for by the opener (`setSettingsOpen(true, 'providers')`) wins over the last one
  // used; read once, when the body mounts for this opening.
  const asked = useEditor((state) => state.settingsPage)
  const [current, setCurrent] = useState<PreferencesPage>(() => {
    const start = isPage(asked) ? asked : lastPage
    return pages.some((page) => page.id === start) ? start : DEFAULT_PAGE
  })
  // Asked for another page while already open (a second link clicked behind the dialog). The ask
  // is taken, not just read: left in the store, asking again for the same page after moving to
  // another would set an equal value, change nothing, and not navigate.
  useEffect(() => {
    if (asked === null) return
    if (isPage(asked) && pages.some((page) => page.id === asked)) {
      lastPage = asked
      setCurrent(asked)
    }
    // Still open, with no page asked for: what `setSettingsOpen(true)` means.
    useEditor.getState().setSettingsOpen(true)
    // `pages` is derived each render; the ask is what matters.
  }, [asked])
  const tabs = useRef(new Map<PreferencesPage, HTMLButtonElement>())
  const focusedOnce = useRef(false)
  const page = pages.find((candidate) => candidate.id === current) ?? pages[0]!
  // Focus starts on the selected page's tab. The dialog's own rule takes its first button,
  // which here is always Media tools — so opened on Agent, a focus ring sat on Media tools
  // beside the real selection, two things that both looked chosen. Whichever of this and the
  // dialog's effect runs first, this one leaves focus on the selection; and when a link moves
  // the page while focus is in the list, focus follows it.
  useEffect(() => {
    const tab = tabs.current.get(page.id)
    const active = document.activeElement
    const inList = active instanceof HTMLButtonElement && [...tabs.current.values()].includes(active)
    const fresh = !focusedOnce.current
    focusedOnce.current = true
    if (tab && (fresh || inList)) tab.focus()
  }, [page.id])

  const choose = (id: PreferencesPage): void => {
    lastPage = id
    setCurrent(id)
  }

  const navigate = (id: string): void => {
    const target = pages.find((candidate) => candidate.id === id)
    if (target) choose(target.id)
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    const index = pages.findIndex((candidate) => candidate.id === current)
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
    const jump = event.key === 'Home' ? 0 : event.key === 'End' ? pages.length - 1 : null
    if (step === 0 && jump === null) return
    event.preventDefault()
    const target = pages[jump ?? (index + step + pages.length) % pages.length]
    if (!target) return
    choose(target.id)
    tabs.current.get(target.id)?.focus()
  }

  return (
    <div className="flex h-[min(620px,76vh)]">
      <nav
        role="tablist"
        aria-label="Preferences pages"
        aria-orientation="vertical"
        onKeyDown={onKeyDown}
        className="flex w-48 shrink-0 flex-col gap-3 overflow-y-auto border-r border-line bg-surface-0/40 px-2 py-3"
      >
        {groups.map((group) => (
          <div key={group.title} role="group" aria-label={group.title} className="flex flex-col gap-px">
            <div aria-hidden="true" className="px-2 pb-1 text-[10px] font-semibold tracking-wider text-ink-2 uppercase">
              {group.title}
            </div>
            {group.pages.map((candidate) => {
              const selected = candidate.id === page.id
              return (
                <button
                  key={candidate.id}
                  ref={(element) => {
                    if (element) tabs.current.set(candidate.id, element)
                    else tabs.current.delete(candidate.id)
                  }}
                  type="button"
                  role="tab"
                  id={`settings-tab-${candidate.id}`}
                  aria-selected={selected}
                  aria-controls="settings-page"
                  tabIndex={selected ? 0 : -1}
                  onClick={() => choose(candidate.id)}
                  className={cn(
                    't-press flex h-7 items-center gap-2 rounded-sm px-2 text-left text-[12px] active:scale-[0.98]',
                    selected ? 'bg-surface-4 text-ink-0' : 'text-ink-1 hover:bg-surface-3 hover:text-ink-0'
                  )}
                >
                  <span className={selected ? 'text-accent' : 'text-ink-2'}>{candidate.icon}</span>
                  {candidate.label}
                </button>
              )
            })}
          </div>
        ))}
      </nav>
      <ScrollArea className="min-w-0 flex-1">
        <div role="tabpanel" id="settings-page" aria-labelledby={`settings-tab-${page.id}`}>
          <PreferencesNavigation.Provider value={navigate}>{page.render()}</PreferencesNavigation.Provider>
        </div>
      </ScrollArea>
    </div>
  )
}
