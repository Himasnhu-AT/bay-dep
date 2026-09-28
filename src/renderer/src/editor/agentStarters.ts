/**
 * The conversation starters on an empty agent panel — a view of bay's skills.
 *
 * So nobody starts from a blank box. Each card is a skill (`@shared/skills`): choosing one puts
 * `/<skill>` at the front of the message, the way Claude Code does, and the user types what they
 * want after it. The instructions live in the skill, loaded into the agent's session, so the
 * composer never fills with a paragraph the user has to edit around. Nothing is sent on click.
 */

import type { LucideIcon } from 'lucide-react'
import {
  Captions,
  Clapperboard,
  Film,
  Flag,
  Languages,
  Layers,
  MessageSquareText,
  ScanLine,
  Scissors,
  Smartphone,
  Sparkles,
  SquareUser,
  Star,
  Rocket,
  Type,
  Wand2
} from 'lucide-react'
import {
  AudioLines,
  AudioWaveform,
  Blend,
  Eye,
  ListOrdered,
  Mic,
  Music,
  ScanSearch,
  SlidersHorizontal,
  SwitchCamera
} from 'lucide-react'
import { BAY_SKILLS } from '@shared/skills'
import { actionsFor, classifyFootage, signalsFromAssets, type FootageMode } from '@shared/footage-mode'
import type { Asset } from '@shared/project'

export interface AgentStarter {
  /** The skill it starts: `/<slug>` at the front of the message. See `@shared/skills`. */
  skill: string
  /**
   * A whole message to put in the composer instead of just `/<skill>` — a footage action such as
   * "Remove silences". Never sent on click, like every starter.
   */
  draft?: string
  /** Distinguishes starters that share a skill (two footage actions can). Defaults to `skill`. */
  id?: string
  title: string
  /** Picks out a starter that uses something new. Shown as a small uppercase tag. */
  badge?: 'new'
  icon: LucideIcon
  /** The tile behind the icon: two stops of a gradient, so each starter is recognisable. */
  tint: [string, string]
}

const LOOK: Record<string, Pick<AgentStarter, 'icon' | 'tint' | 'badge'>> = {
  'talking-head': { icon: Scissors, tint: ['#3b2a22', '#7a4a32'] },
  captions: { icon: Captions, tint: ['#1f2d3a', '#35577a'] },
  'lower-third': { icon: SquareUser, tint: ['#20332c', '#3f6f5c'] },
  'motion-graphics': { icon: Sparkles, tint: ['#2e2440', '#5e4a8a'], badge: 'new' },
  'opening-title': { icon: Type, tint: ['#3a2f1d', '#8a6a33'] },
  'rough-cut': { icon: Film, tint: ['#2a2a2a', '#555555'] },
  transitions: { icon: Layers, tint: ['#1d3336', '#2f6a70'] },
  'end-card': { icon: Clapperboard, tint: ['#3a2022', '#7a3a40'] },
  chapters: { icon: Flag, tint: ['#2d3320', '#5b6a35'] },
  review: { icon: MessageSquareText, tint: ['#262a36', '#4a5270'] },
  'short-form': { icon: Smartphone, tint: ['#33222e', '#6e3f5f'] },
  highlights: { icon: Star, tint: ['#3a3120', '#7a6530'] },
  dub: { icon: Languages, tint: ['#1f2f33', '#3a6570'] },
  'launch-film': { icon: Rocket, tint: ['#3a1f24', '#8a3a46'], badge: 'new' }
}

/** Every bay skill as a starter card, in the skills' own order. */
export const AGENT_STARTERS: readonly AgentStarter[] = BAY_SKILLS.map((skill) => ({
  skill: skill.slug,
  title: skill.title,
  ...(LOOK[skill.slug] ?? { icon: Wand2, tint: ['#2a2a2a', '#444444'] as [string, string] })
}))

/** The icons `@shared/footage-mode` names as hints, by name. An unknown name draws the wand. */
const FOOTAGE_ICONS: Record<string, LucideIcon> = {
  Mic, AudioWaveform, SwitchCamera, Scissors, SlidersHorizontal, Sparkles, AudioLines, Captions,
  ListOrdered, ScanSearch, Film, Music, Blend, Wand2, Eye
}

const FOOTAGE_TINT: Record<FootageMode, [string, string]> = {
  podcast: ['#2a2238', '#5a4a80'],
  'talking-head': ['#3b2a22', '#7a4a32'],
  'screen-recording': ['#1f2d3a', '#35577a'],
  'b-roll-pile': ['#2a2a2a', '#555555'],
  'music-video': ['#33222e', '#6e3f5f'],
  mixed: ['#2a2a2a', '#444444']
}

/** Heuristic, like the classifier's own: under this, the footage kind is a guess not worth acting on. */
const PALETTE_CONFIDENCE = 0.5

/**
 * The AI layout's tool palette, chosen from the footage ("smart mode"): the one-click actions for
 * what the project looks like — Auto-switch speakers for a podcast, Remove silences for a talking
 * head — ahead of every skill's starter. Classified on probe data alone (`signalsFromAssets`), so
 * it costs nothing to recompute when the media changes; unsure, it is just the skills.
 */
export function footagePalette(assets: readonly Asset[]): readonly AgentStarter[] {
  const { mode, confidence } = classifyFootage(signalsFromAssets(assets))
  if (confidence < PALETTE_CONFIDENCE) return AGENT_STARTERS
  const actions: AgentStarter[] = actionsFor(mode).map((action) => ({
    id: `footage:${action.id}`,
    skill: /^\/([a-z0-9-]+)/.exec(action.prompt)?.[1] ?? '',
    title: action.label,
    draft: action.prompt,
    icon: FOOTAGE_ICONS[action.icon] ?? Wand2,
    tint: FOOTAGE_TINT[mode]
  }))
  return [...actions, ...AGENT_STARTERS]
}

/** How many starters show before "More". Two columns, four rows. */
export const STARTERS_SHOWN = 8

/**
 * The agent's one-click jobs on the Generate tab. Each puts a prefilled message in the composer
 * and hands it back, like a starter — never sent on click: which clip, which language are the
 * user's to add, and a sent message starts a turn that may cost money.
 */
export interface AgentQuickAction {
  id: 'highlights' | 'dub' | 'detect-cuts'
  title: string
  /** One line under the title: what the agent will do. */
  detail: string
  icon: LucideIcon
  /** What lands in the composer. A skill action is `/slug …`, as its starter card writes it. */
  draft: string
}

export const AGENT_QUICK_ACTIONS: readonly AgentQuickAction[] = [
  {
    id: 'highlights',
    title: 'Find highlights',
    detail: 'Mark the moments of a long talk that work as clips on their own',
    icon: Star,
    draft: '/highlights '
  },
  {
    id: 'dub',
    title: 'Dub',
    detail: 'Translate the speech and voice it in another language, in sync',
    icon: Languages,
    draft: '/dub into '
  },
  {
    id: 'detect-cuts',
    title: 'Detect cuts',
    detail: 'Find the shot changes in a clip and mark each one',
    icon: ScanLine,
    draft:
      'Find the shot changes in the selected clip with detect_cuts, add a marker at each cut, and list them with their timecodes. '
  }
]
