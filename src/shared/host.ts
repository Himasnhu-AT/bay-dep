/**
 * Where a project is edited: in bay's own editor, or in DaVinci Resolve with bay's agent driving it.
 *
 * The agent is the product; the editor is where its work lands. A project made for Resolve keeps
 * its timeline in Resolve — bay holds the conversation, the transcript and generated media, and the
 * agent reaches Resolve through the Resolve MCP server (`src/main/resolve/`). Premiere Pro is the
 * next host and is not built; it is not in the union until it is.
 */
import type { Project } from './project'

export type ProjectHost = 'bay' | 'resolve'

export const PROJECT_HOSTS: readonly ProjectHost[] = ['bay', 'resolve']

/** What the New Project choice calls each host. */
export const HOST_LABEL: Record<ProjectHost, string> = {
  bay: 'bay editor',
  resolve: 'DaVinci Resolve'
}

/** Absent means bay: every project written before the field existed is a bay project. */
export function hostOf(project: Pick<Project, 'host'>): ProjectHost {
  return project.host === 'resolve' ? 'resolve' : 'bay'
}

/** Anything off the wire, read as a host. An unknown value is bay, never an error. */
export function parseHost(value: unknown): ProjectHost {
  return value === 'resolve' ? 'resolve' : 'bay'
}

/**
 * Whether the agent can reach Resolve right now, and what to do when it cannot.
 *
 * One state per sentence a person reads (`resolveStatusMessage`):
 *
 * - `not-installed` — DaVinci Resolve is not on this Mac.
 * - `not-set-up` — Resolve is here, bay's connector (the MCP server and its Python environment)
 *   is not. `setup` is the command that installs it.
 * - `not-running` — everything is installed; Resolve is closed.
 * - `bridge-needed` — Resolve is open but refuses outside scripts, which is every free edition:
 *   the bridge script has to be started from inside Resolve, once per launch.
 * - `ready` — the connector reached Resolve.
 */
export type ResolveState = 'not-installed' | 'not-set-up' | 'not-running' | 'bridge-needed' | 'ready'

export interface ResolveStatus {
  state: ResolveState
  /** Resolve's version when it is installed, e.g. `21.0.4`. */
  version?: string
  /** Known only once connected. */
  edition?: 'free' | 'studio'
  /** The project open in Resolve, when `ready` and one is open. */
  projectName?: string
  /** For `not-set-up`: the command that installs the connector. */
  setup?: string
  /** For `bridge-needed`: false when the bridge script is not in Resolve's Scripts menu yet. */
  bridgeInstalled?: boolean
  /** What the probe itself said, when it failed in a way the states above do not name. */
  detail?: string
}

/** The one line shown for a status: what is wrong and what to do about it. */
export function resolveStatusMessage(status: ResolveStatus): string {
  switch (status.state) {
    case 'not-installed':
      return 'DaVinci Resolve is not installed on this Mac. Install it from blackmagicdesign.com, then check again.'
    case 'not-set-up':
      return `bay's Resolve connector is not set up. Run ${status.setup ?? 'script/setup-resolve-mcp.sh'}, then check again.`
    case 'not-running':
      return 'DaVinci Resolve is not open. Open it and open a project there.'
    case 'bridge-needed':
      return status.bridgeInstalled === false
        ? `Resolve is open, but bay's bridge script is not installed in it. Run ${status.setup ?? 'script/setup-resolve-mcp.sh'}, restart Resolve, then choose Workspace › Scripts › resolve_bridge.`
        : 'Resolve is open but not connected. In Resolve, choose Workspace › Scripts › resolve_bridge — it is needed once each time Resolve starts.'
    case 'ready': {
      const app = `Resolve${status.version ? ` ${status.version}` : ''}${status.edition ? ` (${status.edition})` : ''}`
      return status.projectName
        ? `Connected to ${app} — project “${status.projectName}”.`
        : `Connected to ${app}. No project is open there yet.`
    }
  }
}
