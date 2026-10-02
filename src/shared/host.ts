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
  /**
   * `ready` only: the open Resolve project's timeline and playback frame rates, present when
   * they disagree. Resolve then plays sound chopped and pitched, and only its own Project
   * Settings can fix it — no script can write the playback rate.
   */
  playback?: { timelineFps: number; playbackFps: number }
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

/**
 * What to do about a playback rate that disagrees with the timeline's, or null when they agree.
 * Its own sentence because it is the fault that hides best: everything reads connected and the
 * timeline is right, and the voice sounds broken.
 */
export function resolvePlaybackWarning(status: ResolveStatus): string | null {
  if (status.state !== 'ready' || !status.playback) return null
  const { timelineFps, playbackFps } = status.playback
  const shown = (fps: number): string => String(Number(fps.toFixed(3)))
  return (
    `Sound will play distorted in Resolve: this project’s timeline is ${shown(timelineFps)} fps but its playback frame rate is ${shown(playbackFps)}. ` +
    `In Resolve choose File › Project Settings › Master Settings and set Playback frame rate to ${shown(timelineFps)}. Resolve does not let bay change it.`
  )
}

/** One step of connecting Resolve: done already, the one to do now, or still ahead. */
export interface ResolveStep {
  id: 'install' | 'connector' | 'open' | 'bridge' | 'ask'
  title: string
  /** What to do, written for the person doing it. */
  detail: string
  progress: 'done' | 'now' | 'later'
}

/** The states in the order a person gets through them; a status means every earlier one is done. */
const STATE_ORDER: readonly ResolveState[] = ['not-installed', 'not-set-up', 'not-running', 'bridge-needed', 'ready']

/**
 * The whole way from nothing to a connected Resolve, with where this Mac is on it.
 *
 * Every step is always listed, so someone at step 2 can see step 4 is coming — the bridge is the
 * one nobody expects, and on the free edition it is needed again each time Resolve starts.
 */
export function resolveSetupSteps(status: ResolveStatus): ResolveStep[] {
  const at = STATE_ORDER.indexOf(status.state)
  const setup = status.setup ?? 'script/setup-resolve-mcp.sh'
  const steps: Omit<ResolveStep, 'progress'>[] = [
    {
      id: 'install',
      title: 'Install DaVinci Resolve',
      detail: 'The free edition works. Download it from blackmagicdesign.com and put it in Applications.'
    },
    {
      id: 'connector',
      title: 'Set up bay’s Resolve connector',
      detail: `In Terminal, run ${setup} — once per Mac. It also adds the bridge script to Resolve’s Scripts menu.`
    },
    {
      id: 'open',
      title: 'Open Resolve and a project',
      detail: 'Open DaVinci Resolve, then open or create the project you want bay to edit.'
    },
    {
      id: 'bridge',
      title: 'Start the bridge in Resolve',
      detail:
        status.state === 'bridge-needed' && status.bridgeInstalled === false
          ? `resolve_bridge is not in Resolve’s Scripts menu yet. Run ${setup}, restart Resolve, then choose Workspace › Scripts › resolve_bridge.`
          : 'In Resolve’s menu bar choose Workspace › Scripts › resolve_bridge. The free edition needs this each time Resolve starts; Studio connects without it.'
    },
    {
      id: 'ask',
      title: 'Ask the agent',
      detail: 'Describe the edit in bay. The agent makes it in the Resolve project that is open.'
    }
  ]
  return steps.map((step, index) => ({
    ...step,
    progress: index < at ? 'done' : index === at ? 'now' : 'later'
  }))
}
