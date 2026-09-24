import { useProjectSettingsDialog } from '@/store/project-settings-dialog'
import { importCaptionsDialog } from '@/lib/mediaActions'
import type { Handlers } from './types'

export const fileHandlers = {
  'file.newProject': { run: ({ host }) => host?.newProject() },
  'file.open': { run: ({ host }) => host?.open() },
  'file.save': { run: ({ host }) => host?.save() },
  'file.saveAs': { run: ({ host }) => host?.saveAs() },
  'file.import': { run: ({ host }) => host?.importMedia() },
  // Cues go onto a Captions track through `add_captions`, so only with a project open.
  'file.importCaptions': { run: () => void importCaptionsDialog(), when: ({ state }) => state.screen === 'editor' },
  'file.export': { run: ({ host }) => host?.openExport() },
  'app.settings': { run: ({ state }) => state.setSettingsOpen(true) },
  'file.projectSettings': {
    run: () => useProjectSettingsDialog.getState().show(),
    // Project settings belong to an open project; on the projects screen there is none.
    when: ({ state }) => state.screen === 'editor'
  }
} satisfies Handlers
