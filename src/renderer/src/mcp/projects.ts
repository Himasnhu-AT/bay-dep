/**
 * `list_projects` and `open_project` — how an agent gets past the projects screen.
 *
 * bay launches with no project open, and the store then holds an empty placeholder nobody chose.
 * A tool acting on it would edit something invisible that vanishes the moment the user opens a
 * real project, so the executor refuses every other tool until one is open (see `index.ts`), and
 * these two are the way through.
 */

import { bay } from '@/lib/bay'
import { fail, store, type Handlers } from './helpers'

function api(): NonNullable<ReturnType<typeof bay>> {
  const bridge = bay()
  if (!bridge) fail('This window has no bridge to the app, so it cannot reach the project files.')
  return bridge
}

export async function listProjects(): Promise<Record<string, unknown>> {
  const state = store()
  const recents = await api().project.recent()
  return {
    open:
      state.screen === 'editor'
        ? { name: state.project.name, filePath: state.project.filePath ?? null, unsaved: state.dirty }
        : null,
    projects: recents.map((recent) => ({
      name: recent.name,
      filePath: recent.filePath,
      lastEdited: new Date(recent.updatedAt).toISOString()
    }))
  }
}

export async function openProject(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const filePath = String(args['filePath'] ?? '')
  const state = store()
  if (state.screen === 'editor' && state.dirty) {
    fail(
      `"${state.project.name}" is open with unsaved changes, and opening another project would ` +
        `discard them. Ask the user to save it (or to open "${filePath}" themselves) — do not ` +
        `work around this.`
    )
  }
  let project
  try {
    project = await api().project.openPath(filePath)
  } catch (error) {
    fail(
      `Could not open "${filePath}": ${error instanceof Error ? error.message : String(error)}. ` +
        `Call list_projects and use a filePath from it.`
    )
  }
  store().enterProject(project)
  const timeline = project.timelines.find((t) => t.id === project.activeTimelineId)
  return {
    opened: project.name,
    filePath: project.filePath ?? filePath,
    items: timeline?.tracks.reduce((n, track) => n + track.items.length, 0) ?? 0,
    next: 'The project is open. read_project shows its timeline.'
  }
}

export const handlers: Handlers = {
  list_projects: () => listProjects(),
  open_project: (args) => openProject(args),
}
