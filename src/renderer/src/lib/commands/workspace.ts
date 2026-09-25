import type { WorkspacePage } from '@/store/editor'
import type { CommandHandler, Handlers } from './types'

const page = (to: WorkspacePage): CommandHandler => ({
  when: ({ state }) => state.screen === 'editor',
  run: ({ state }) => state.setPage(to)
})

const inEditor: CommandHandler['when'] = ({ state }) => state.screen === 'editor'

export const workspaceHandlers = {
  'workspace.media': page('media'),
  'workspace.edit': page('edit'),
  'workspace.color': page('color'),
  'workspace.audio': page('audio'),
  'workspace.deliver': page('deliver'),
  'workspace.toggleAgent': { when: inEditor, run: ({ state }) => state.setAgentDocked(!state.agentDocked) },
  'workspace.toggleInspector': { when: inEditor, run: ({ state }) => state.toggleRegion('inspector') },
  'workspace.toggleLibrary': { when: inEditor, run: ({ state }) => state.toggleRegion('side') },
  'workspace.toggleTimeline': { when: inEditor, run: ({ state }) => state.toggleRegion('timeline') }
} satisfies Handlers
