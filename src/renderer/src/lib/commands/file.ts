import type { Handlers } from './types'

export const fileHandlers = {
  'file.open': { run: ({ host }) => host?.open() },
  'file.save': { run: ({ host }) => host?.save() },
  'file.saveAs': { run: ({ host }) => host?.saveAs() },
  'file.import': { run: ({ host }) => host?.importMedia() },
  'file.export': { run: ({ host }) => host?.openExport() },
  'app.settings': { run: ({ state }) => state.setSettingsOpen(true) }
} satisfies Handlers
