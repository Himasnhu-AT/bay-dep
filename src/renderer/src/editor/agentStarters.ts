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
  Layers,
  MessageSquareText,
  Scissors,
  Sparkles,
  SquareUser,
  Type,
  Wand2
} from 'lucide-react'
import { BAY_SKILLS } from '@shared/skills'

export interface AgentStarter {
  /** The skill it starts: `/<slug>` at the front of the message. See `@shared/skills`. */
  skill: string
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
  review: { icon: MessageSquareText, tint: ['#262a36', '#4a5270'] }
}

/** Every bay skill as a starter card, in the skills' own order. */
export const AGENT_STARTERS: readonly AgentStarter[] = BAY_SKILLS.map((skill) => ({
  skill: skill.slug,
  title: skill.title,
  ...(LOOK[skill.slug] ?? { icon: Wand2, tint: ['#2a2a2a', '#444444'] as [string, string] })
}))

/** How many starters show before "More". Two columns, four rows. */
export const STARTERS_SHOWN = 8
