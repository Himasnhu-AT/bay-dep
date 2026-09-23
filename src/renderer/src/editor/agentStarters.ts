/**
 * The conversation starters on an empty agent panel.
 *
 * So nobody starts from a blank box. Each one is a thing bay's tools can actually do today —
 * a starter that promises something the agent then has to refuse is worse than none — and its
 * prompt opens a conversation rather than issuing a command: it asks the agent to find out what
 * it needs first, because the agent proposes before it edits, and a proposal built on a guess is
 * one the user has to turn down.
 *
 * Choosing a starter fills the composer; it does not send. The prompt is a draft the user
 * finishes — which clip, which words, what style.
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

export interface AgentStarter {
  id: string
  title: string
  /** Picks out a starter that uses something new. Shown as a small uppercase tag. */
  badge?: 'new'
  icon: LucideIcon
  /** The tile behind the icon: two stops of a gradient, so each starter is recognisable. */
  tint: [string, string]
  prompt: string
}

export const AGENT_STARTERS: readonly AgentStarter[] = [
  {
    id: 'talking-head',
    title: 'Talking Head Editing',
    icon: Scissors,
    tint: ['#3b2a22', '#7a4a32'],
    prompt:
      "I'd like to tighten a talking-head recording. Look through the timeline, find the long " +
      'pauses, false starts and repeated lines, and show me what you would cut and why before ' +
      'you change anything. Keep every track in sync, and leave a natural breath between ' +
      'sentences rather than jump-cutting every gap.'
  },
  {
    id: 'captions',
    title: 'Captions',
    icon: Captions,
    tint: ['#1f2d3a', '#35577a'],
    prompt:
      "I'd like captions on this video. Ask me whether I have an SRT or WebVTT file, or whether " +
      "I'll give you the lines and timings. Keep each caption short enough to read comfortably, " +
      'place them low in the frame, and check a few frames so nothing covers a face.'
  },
  {
    id: 'lower-third',
    title: 'Lower Third',
    icon: SquareUser,
    tint: ['#20332c', '#3f6f5c'],
    prompt:
      "I'd like a lower third introducing the person on screen. Ask me for their name and role, " +
      'and a colour if I have one. Put it on its own track when they first appear, hold it for ' +
      'a few seconds, and show me a frame of it before we move on.'
  },
  {
    id: 'motion-graphics',
    title: 'Motion Graphics',
    badge: 'new',
    icon: Sparkles,
    tint: ['#2e2440', '#5e4a8a'],
    prompt:
      "I'd like to design a motion graphic, and I want you to guide me through it. Help me decide " +
      'what the graphic should communicate, collect the actual content and any brand or style ' +
      'cues from me, then build it and walk me through the result so we can iterate together.'
  },
  {
    id: 'title-card',
    title: 'Opening Title',
    icon: Type,
    tint: ['#3a2f1d', '#8a6a33'],
    prompt:
      "I'd like an opening title for this video. Ask me for the title and an optional kicker " +
      'line above it, then place a title card at the very start, sized to the canvas, and show ' +
      'me how it looks.'
  },
  {
    id: 'rough-cut',
    title: 'Rough Cut from Clips',
    icon: Film,
    tint: ['#2a2a2a', '#555555'],
    prompt:
      "I'd like a rough cut from the clips I've imported. Look at what's in the media pool, " +
      'ask me what the video is about and roughly how long it should be, then propose an order ' +
      "and lay the clips out on the timeline. We'll tighten it from there."
  },
  {
    id: 'transitions',
    title: 'Polish with Transitions',
    icon: Layers,
    tint: ['#1d3336', '#2f6a70'],
    prompt:
      "I'd like to polish the cuts. Go through the edit points and suggest where a dissolve or a " +
      'dip to black would help and where a straight cut is better, then add the ones I agree ' +
      'with and fade the audio in and out at the very start and end.'
  },
  {
    id: 'end-card',
    title: 'End Card',
    icon: Clapperboard,
    tint: ['#3a2022', '#7a3a40'],
    prompt:
      "I'd like an end card to close the video. Ask me for the call to action and my handle, " +
      'then add it over the last few seconds and show me a frame of it.'
  },
  {
    id: 'chapters',
    title: 'Chapter Markers',
    icon: Flag,
    tint: ['#2d3320', '#5b6a35'],
    prompt:
      "I'd like chapter markers on this video. Look through it, tell me where you think the " +
      'topic changes, and once I agree, add a labelled marker at each one.'
  },
  {
    id: 'review',
    title: 'Review My Edit',
    icon: MessageSquareText,
    tint: ['#262a36', '#4a5270'],
    prompt:
      'Please review my edit without changing anything. Look at frames across the timeline and ' +
      'tell me what works, what feels off — pacing, framing, text that is hard to read, audio ' +
      'jumps — and what you would change first.'
  },
  {
    id: 'freeform',
    title: 'Something Else',
    icon: Wand2,
    tint: ['#2a2a2a', '#444444'],
    prompt: "Here's what I'd like to do with this video: "
  }
]

/** How many starters show before "More". Two columns, four rows. */
export const STARTERS_SHOWN = 8
