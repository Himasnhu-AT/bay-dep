import type { WorkspacePage } from '@/store/editor'
import type { CommandHandler, Handlers } from './types'

const inEditor: CommandHandler['when'] = ({ state }) => state.screen === 'editor'
const inResolve: CommandHandler['when'] = ({ state }) => state.screen === 'editor' && state.layoutMode === 'resolve'

// In the AI layout a page is not a layout of its own: its panels open in the Pages drawer.
const page = (to: WorkspacePage): CommandHandler => ({
  when: inEditor,
  run: ({ state }) => {
    state.setPage(to)
    if (state.layoutMode === 'ai') state.setAiPanel('pages', true)
  }
})

export const workspaceHandlers = {
  'workspace.media': page('media'),
  'workspace.edit': page('edit'),
  'workspace.color': page('color'),
  'workspace.audio': page('audio'),
  'workspace.deliver': page('deliver'),
  // The AI layout always shows the agent and the media pool; there is nothing to toggle there.
  'workspace.toggleAgent': { when: inResolve, run: ({ state }) => state.setAgentDocked(!state.agentDocked) },
  'workspace.toggleLibrary': { when: inResolve, run: ({ state }) => state.toggleRegion('side') },
  'workspace.toggleInspector': {
    when: inEditor,
    run: ({ state }) => (state.layoutMode === 'ai' ? state.toggleAiPanel('inspector') : state.toggleRegion('inspector'))
  },
  'workspace.toggleTimeline': {
    when: inEditor,
    run: ({ state }) => (state.layoutMode === 'ai' ? state.toggleAiPanel('timeline') : state.toggleRegion('timeline'))
  },
  'workspace.toggleLayoutMode': { when: inEditor, run: ({ state }) => state.toggleLayoutMode() }
} satisfies Handlers
