/**
 * Preferences › Agent's knobs on a turn: Claude's reasoning effort, an optional Claude model
 * alias, and the longest a turn may run. Kept beside the provider choice (`./agentProvider`), in
 * the same kind of store, and passed on every `agent.start`; a change is sent to main at once and
 * applies from the next turn.
 *
 * Remembered per machine under `bay.agentEffort`, `bay.agentClaudeModel` and
 * `bay.agentTurnLimit` — compatibility surfaces like every `localStorage` key (CLAUDE.md). A
 * value that is not one of the choices reads as the default (`@shared/agent`'s parsers).
 */

import { create } from 'zustand'
import {
  parseAgentEffort,
  parseClaudeModel,
  parseTurnLimit,
  type AgentEffort,
  type AgentTuning,
  type ClaudeModelChoice,
  type TurnLimitMinutes
} from '@shared/agent'
import { remember, remembered } from '@/store/prefs'
import { bay } from './bridge'

export const AGENT_EFFORT_KEY = 'bay.agentEffort'
export const AGENT_CLAUDE_MODEL_KEY = 'bay.agentClaudeModel'
export const AGENT_TURN_LIMIT_KEY = 'bay.agentTurnLimit'

interface AgentTuningState extends AgentTuning {
  setEffort(effort: AgentEffort): void
  setModel(model: ClaudeModelChoice): void
  setTurnMinutes(minutes: TurnLimitMinutes): void
}

export const useAgentTuning = create<AgentTuningState>((set) => ({
  effort: parseAgentEffort(remembered(AGENT_EFFORT_KEY)),
  model: parseClaudeModel(remembered(AGENT_CLAUDE_MODEL_KEY)),
  turnMinutes: parseTurnLimit(remembered(AGENT_TURN_LIMIT_KEY)),
  setEffort(effort) {
    remember(AGENT_EFFORT_KEY, effort)
    set({ effort })
  },
  setModel(model) {
    remember(AGENT_CLAUDE_MODEL_KEY, model)
    set({ model })
  },
  setTurnMinutes(turnMinutes) {
    remember(AGENT_TURN_LIMIT_KEY, String(turnMinutes))
    set({ turnMinutes })
  }
}))

/** The tuning as main takes it — plain data, no setters. */
export function currentAgentTuning(): AgentTuning {
  const { effort, model, turnMinutes } = useAgentTuning.getState()
  return { effort, model, turnMinutes }
}

export const EFFORT_LABELS: Record<AgentEffort, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max'
}

export const CLAUDE_MODEL_LABELS: Record<ClaudeModelChoice, string> = {
  default: 'Default',
  fable: 'Fable',
  opus: 'Opus',
  sonnet: 'Sonnet'
}

export const TURN_LIMIT_LABELS: Record<TurnLimitMinutes, string> = { 40: '40 min', 90: '90 min', 180: '3 h' }

// On the store itself, like the provider's subscription: the dock that starts conversations can
// be closed while Preferences changes a knob, and a running conversation must still hear of it.
useAgentTuning.subscribe((state, previous) => {
  if (state.effort !== previous.effort || state.model !== previous.model || state.turnMinutes !== previous.turnMinutes) {
    void bay()?.agent.configure(currentAgentTuning())
  }
})
