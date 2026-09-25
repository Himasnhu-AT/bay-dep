/**
 * Which provider's model drives the in-app agent — Claude Code or Codex — chosen in Preferences ›
 * Agent and passed on every `agent.start`.
 *
 * Remembered per machine under `bay.agentProvider`, a compatibility surface like every
 * `localStorage` key (CLAUDE.md): rename it and every user who picked Codex is quietly back on
 * Claude after an upgrade. Anything but `'codex'` reads as Claude, the default.
 *
 * Its own small store rather than a field on the editor store: it is not the project, not undo,
 * and nothing that re-renders at the frame rate reads it.
 */

import { create } from 'zustand'
import type { AgentProvider } from '@shared/agent'
import { remember, remembered } from '@/store/prefs'
import { useEditor } from '@/store/editor'
import { bay } from './bridge'

export const AGENT_PROVIDER_KEY = 'bay.agentProvider'

export function parseAgentProvider(value: string | null): AgentProvider {
  return value === 'codex' ? 'codex' : 'claude'
}

interface AgentProviderState {
  provider: AgentProvider
  setProvider(provider: AgentProvider): void
}

export const useAgentProvider = create<AgentProviderState>((set) => ({
  provider: parseAgentProvider(remembered(AGENT_PROVIDER_KEY)),
  setProvider(provider) {
    remember(AGENT_PROVIDER_KEY, provider)
    set({ provider })
  }
}))

export const PROVIDER_LABELS: Record<AgentProvider, string> = { claude: 'Claude', codex: 'Codex' }

/**
 * Switching provider starts a new conversation: the other model has none of this one's context,
 * so carrying the session or the log over would show a history it never saw, and a session left
 * running would keep answering on the old model.
 *
 * Here, on the provider store itself, rather than in the agent panel: the panel is a dock that
 * can be closed, and an effect in it ran only while it was mounted — dock closed, provider
 * switched in Preferences, dock reopened, and the old session carried on. Every route to
 * `setProvider` loads this module, so the subscription exists whenever a switch can happen.
 */
export function endConversationForProviderChange(): void {
  const editor = useEditor.getState()
  if (!editor.agentSessionActive && editor.agentLog.length === 0) return
  void bay()?.agent.dispose()
  editor.endAgentSession()
  editor.clearAgentLog()
  editor.clearAgentPins()
}

useAgentProvider.subscribe((state, previous) => {
  if (state.provider !== previous.provider) endConversationForProviderChange()
})
