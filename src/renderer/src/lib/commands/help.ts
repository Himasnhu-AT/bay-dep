import type { Handlers } from './types'

export const helpHandlers = {
  'help.shortcuts': { run: ({ host }) => host?.openShortcuts() }
} satisfies Handlers
