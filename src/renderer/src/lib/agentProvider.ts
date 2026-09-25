/**
 * Which provider's model drives the in-app agent — Claude Code or Codex — chosen in Settings ›
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
