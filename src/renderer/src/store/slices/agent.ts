/**
 * The in-app agent's side of the store: its session, its log, the per-turn change cards and
 * their reverts, the approval gate, and the pins the user attaches to a message.
 */

import type { AgentEntry } from '@shared/agent'
import { pinKey } from '@shared/pins'
import { describeChanges } from '@shared/diff'
import { newId } from '../factory'
import { MAX_AGENT_CHECKPOINTS } from '../agent-turns'
import type { EditorActions, EditorState } from '../types'
import type { StoreKit } from '../kit'
import { HISTORY_LIMIT } from '../kit'

/**
 * The log line for a think that just ended — "Thought for 2m 24s" — or null when it was too short
 * to be worth a line (under a second) or nothing was thinking.
 */
function thinkingEntry(state: EditorState): AgentEntry | null {
  if (state.agentThinkingSince === null) return null
  const seconds = (Date.now() - state.agentThinkingSince) / 1000
  return seconds >= 1 ? { kind: 'thinking', id: newId('thk'), seconds } : null
}

function closeThinking(state: EditorState): Partial<EditorState> {
  const entry = thinkingEntry(state)
  return { agentThinkingSince: null, ...(entry ? { agentLog: [...state.agentLog, entry] } : {}) }
}

type Actions = Pick<
  EditorActions,
  | 'startAgentSession'
  | 'setAgentApproval'
  | 'revertAgentChange'
  | 'recordAgentFileWrite'
  | 'markCompositionChanged'
  | 'logUserMessage'
  | 'applyAgentEvent'
  | 'clearAgentLog'
  | 'endAgentSession'
  | 'approveProposal'
  | 'addAgentPin'
  | 'removeAgentPin'
  | 'clearAgentPins'
  | 'declineProposal'
  | 'revokeApproval'
  | 'consumeApproval'
>

export function agentSlice({ set, get, restoreFiles }: StoreKit): Actions {
  return {
    startAgentSession() {
      // Gated only when the user asked to approve edits; otherwise the agent edits directly and
      // the diffs are the review.
      set({ agentSessionActive: true, agentGate: get().agentApproval ? { approved: null } : null })
    },

    setAgentApproval(on) {
      try {
        globalThis.localStorage?.setItem('bay.agentApproval', on ? '1' : '0')
      } catch {
        // Applies for this session even when it cannot be remembered.
      }
      const active = get().agentSessionActive
      set({ agentApproval: on, ...(active ? { agentGate: on ? { approved: null } : null } : {}) })
    },

    revertAgentChange(id) {
      const state = get()
      const checkpoint = state.agentCheckpoints[id]
      const index = state.agentLog.findIndex((e) => e.kind === 'changes' && e.id === id)
      const entry = state.agentLog[index]
      if (!checkpoint || !entry || entry.kind !== 'changes' || entry.state !== 'applied') return
      // Mid-turn, the revert would become part of the running turn's own diff, and the agent
      // would carry on editing a project it no longer has.
      if (state.agentRunning) {
        state.notify('Wait for the agent to finish, or stop it, before reverting.', 'error')
        return
      }
      // This turn and every later applied one: they were built on what this one did.
      const ids = state.agentLog
        .filter((e, i) => i >= index && e.kind === 'changes' && e.state === 'applied')
        .map((e) => e.id)
      // A fresh object, stamped like any edit — and the identity undo/redo recognise it by.
      const restored = { ...checkpoint.before, updatedAt: Date.now() }
      set((current) => {
        const past = [...current.past, current.project]
        if (past.length > HISTORY_LIMIT) past.shift()
        return {
          project: restored,
          past,
          future: [],
          selection: [],
          dirty: true,
          agentReverts: [...current.agentReverts, { restored, replaced: current.project, ids }],
          agentLog: current.agentLog.map((e) =>
            e.kind === 'changes' && ids.includes(e.id) ? { ...e, state: 'reverted' as const } : e
          )
        }
      })
      restoreFiles(ids, 'before')
    },

    recordAgentFileWrite(path, before, after) {
      set((state) => {
        if (!state.agentRunning) return {}
        const first = state.agentTurnFiles[path]
        return { agentTurnFiles: { ...state.agentTurnFiles, [path]: { before: first ? first.before : before, after } } }
      })
    },

    markCompositionChanged(path) {
      set((state) => ({ compositionEpochs: { ...state.compositionEpochs, [path]: (state.compositionEpochs[path] ?? 0) + 1 } }))
    },

    logUserMessage(text, pins, attachments) {
      set((state) => ({
        agentLog: [
          ...state.agentLog,
          {
            kind: 'user',
            id: newId('msg'),
            text,
            ...(pins && pins.length > 0 ? { pins } : {}),
            ...(attachments && attachments.length > 0 ? { attachments } : {})
          }
        ]
      }))
    },

    applyAgentEvent(event) {
      set((state) => {
        const log = state.agentLog
        switch (event.type) {
          case 'started':
            return state.agentRunning
              ? {}
              : {
                  agentRunning: true,
                  agentTurnBase: state.project,
                  agentTurnFiles: {},
                  agentTurnEdited: false,
                  agentTurnUserEdited: false,
                  agentTurnClientEdited: false
                }

          case 'thinking-start':
            return state.agentThinkingSince === null ? { agentThinkingSince: Date.now() } : {}

          case 'thinking-end':
            return closeThinking(state)

          case 'text':
          case 'thinking': {
            // Appended to the open block of the same kind rather than pushed as its own entry:
            // a delta is a fragment of a sentence, and one entry per fragment would render as
            // one paragraph per token.
            const last = log[log.length - 1]
            const kind = event.type === 'text' ? 'assistant' : 'thought'
            if (last && last.kind === kind) {
              const merged = { ...last, text: last.text + event.delta }
              return { agentLog: [...log.slice(0, -1), merged] }
            }
            return { agentLog: [...log, { kind, id: newId('msg'), text: event.delta }] }
          }

          case 'tool': {
            // The same call arrives twice: when the model starts writing it (no arguments yet)
            // and when its arguments settle. The second fills in the first's card.
            const index = log.findIndex((e) => e.kind === 'tool' && e.id === event.callId)
            if (index >= 0) {
              const entry = log[index] as Extract<AgentEntry, { kind: 'tool' }>
              if (Object.keys(event.args).length === 0) return {}
              const { input: _streamed, ...settled } = entry
              const updated: AgentEntry = { ...settled, tool: event.tool, args: event.args }
              return { agentLog: [...log.slice(0, index), updated, ...log.slice(index + 1)] }
            }
            return {
              agentLog: [
                ...log,
                {
                  kind: 'tool',
                  id: event.callId,
                  tool: event.tool,
                  args: event.args,
                  state: 'running'
                }
              ]
            }
          }

          case 'tool-input': {
            const index = log.findIndex((e) => e.kind === 'tool' && e.id === event.callId)
            if (index < 0) return {}
            const entry = log[index] as Extract<AgentEntry, { kind: 'tool' }>
            // Kept whole while it streams — the card shows its tail — and dropped once the
            // arguments settle, since then the arguments say the same thing parsed.
            const updated: AgentEntry = { ...entry, input: (entry.input ?? '') + event.delta }
            return { agentLog: [...log.slice(0, index), updated, ...log.slice(index + 1)] }
          }

          case 'tool-result': {
            // Patched in place, so a call becomes its own result rather than spawning a second
            // card the reader has to pair up by eye.
            const index = log.findIndex((e) => e.kind === 'tool' && e.id === event.callId)
            if (index < 0) return {}
            const entry = log[index] as Extract<AgentEntry, { kind: 'tool' }>
            const updated: AgentEntry = {
              ...entry,
              state: event.ok ? 'done' : 'failed',
              result: event.summary
            }
            return { agentLog: [...log.slice(0, index), updated, ...log.slice(index + 1)] }
          }

          case 'proposal':
            return {
              agentProposal: event.proposal,
              agentLog: [...log, { kind: 'proposal', id: event.proposal.id, proposal: event.proposal }]
            }

          case 'done': {
            // A turn stopped mid-think still says how long it thought.
            const thought = thinkingEntry(state)
            const log = thought ? [...state.agentLog, thought] : state.agentLog
            // A turn that changed something leaves a diff behind, with what a revert needs. Keyed
            // on whether a real edit happened (not on the project's identity, which a poster
            // arriving also changes), and on the files it rewrote, which the project does not show.
            const base = state.agentTurnBase
            const files = Object.entries(state.agentTurnFiles).map(([path, file]) => ({ path, ...file }))
            const edited = base !== null && state.agentTurnEdited && base !== state.project
            const lines = edited ? describeChanges(base, state.project) : []
            if (edited && lines.length === 0) {
              lines.push({ kind: 'changed', text: 'Changed settings this summary does not list' })
            }
            for (const file of files) {
              const name = file.path.split(/[\\/]/).pop() ?? file.path
              lines.push(file.before === null ? { kind: 'added', text: `Created “${name}”` } : { kind: 'changed', text: `Rewrote “${name}”` })
            }
            const changeId = newId('chg')
            // Who else changed the project during the turn: the user, and an MCP client on bay's
            // socket, each said separately — the revert takes theirs too (it restores one whole
            // project), so the card must not pass them off as the agent's.
            const others = [
              state.agentTurnUserEdited ? 'edits you made' : null,
              state.agentTurnClientEdited ? 'edits an MCP client made through bay\'s socket' : null
            ].filter((part): part is string => part !== null)
            const note =
              others.length > 0
                ? `Includes ${others.join(' and ')} while the agent was working — reverting takes those too.`
                : undefined
            let checkpoints = state.agentCheckpoints
            let entries: AgentEntry[] = log
            if (lines.length > 0 && base) {
              checkpoints = { ...checkpoints, [changeId]: { before: base, after: state.project, files } }
              entries = [...log, { kind: 'changes', id: changeId, lines, state: 'applied', ...(note ? { note } : {}) }]
              // Oldest first out: its card stays, readable, but can no longer be reverted.
              const ids = Object.keys(checkpoints)
              const expired = new Set(ids.slice(0, Math.max(0, ids.length - MAX_AGENT_CHECKPOINTS)))
              if (expired.size > 0) {
                checkpoints = Object.fromEntries(Object.entries(checkpoints).filter(([id]) => !expired.has(id)))
                entries = entries.map((e) =>
                  e.kind === 'changes' && expired.has(e.id) ? { ...e, state: 'expired' as const } : e
                )
              }
            }
            return {
              agentRunning: false,
              agentThinkingSince: null,
              agentTurnBase: null,
              agentTurnFiles: {},
              agentTurnEdited: false,
              agentTurnUserEdited: false,
              agentTurnClientEdited: false,
              agentCheckpoints: checkpoints,
              agentLog:
                event.reason === 'complete'
                  ? entries
                  : [...entries, { kind: 'error', id: newId('msg'), text: event.message ?? 'The run stopped.' }]
            }
          }
        }
      })
    },

    clearAgentLog() {
      set({ agentLog: [], agentProposal: null, agentCheckpoints: {}, agentReverts: [] })
    },

    endAgentSession() {
      set({ agentGate: null, agentSessionActive: false, agentTurnBase: null })
    },

    approveProposal(proposal, optionId) {
      set({ agentProposal: null })
      const option = proposal.options.find((o) => o.id === optionId)
      if (!option) return
      set({
        agentGate: {
          approved: {
            approvalId: newId('apr'),
            proposalId: proposal.id,
            option,
            consumed: []
          }
        }
      })
    },

    addAgentPin(pin) {
      const pins = get().agentPins
      if (pins.some((existing) => pinKey(existing) === pinKey(pin))) return
      set({ agentPins: [...pins, pin] })
    },

    removeAgentPin(key) {
      set({ agentPins: get().agentPins.filter((pin) => pinKey(pin) !== key) })
    },

    clearAgentPins() {
      set({ agentPins: [] })
    },

    declineProposal() {
      set({ agentProposal: null })
    },

    revokeApproval() {
      // Back to a gated session with nothing permitted, not to no session at all: the agent is
      // still driving, it just may no longer write.
      if (get().agentGate) set({ agentGate: { approved: null } })
    },

    consumeApproval(index) {
      const gate = get().agentGate
      const current = gate?.approved
      if (!current || current.consumed.includes(index)) return
      set({ agentGate: { approved: { ...current, consumed: [...current.consumed, index] } } })
    }
  }
}
