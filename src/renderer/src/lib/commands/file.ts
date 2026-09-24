import { useProjectSettingsDialog } from '@/store/project-settings-dialog'
import type { Handlers } from './types'

export const fileHandlers = {
  'file.open': { run: ({ host }) => host?.open() },
  'file.save': { run: ({ host }) => host?.save() },
  'file.saveAs': { run: ({ host }) => host?.saveAs() },
  'file.import': { run: ({ host }) => host?.importMedia() },
  'file.export': { run: ({ host }) => host?.openExport() },
  'app.settings': { run: ({ state }) => state.setSettingsOpen(true) },
  'file.projectSettings': {
    run: () => useProjectSettingsDialog.getState().show(),
    // Project settings belong to an open project; on the projects screen there is none.
    when: ({ state }) => state.screen === 'editor'
  }
} satisfies Handlers
