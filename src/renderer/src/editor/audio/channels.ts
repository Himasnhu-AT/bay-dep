/**
 * The mixer's channels: which tracks get a strip, and what each strip says about whether it is
 * heard. Pure, so "a video track carrying speech gets a strip" and "a soloed-out track says so"
 * are tested without a window.
 */

import { findAsset, trackAudible, type Project, type Timeline, type Track } from '@shared/project'
import { canSound } from '@shared/inspector'

export interface MixerChannel {
  track: Track
  /** The badge on the strip: V for a video track carrying sound, A for an audio track. */
  badge: 'V' | 'A'
  /** How many of its clips can sound. */
  soundingClips: number
  /** Whether the mix plays it right now, mute and solo taken together (`trackAudible`). */
  audible: boolean
  /** The line under the strip's name: "Muted", "Soloed", "Silent — another track is soloed", or null. */
  state: string | null
}

/**
 * A strip per track that can put sound in the mix: every audio track (an empty one is still a
 * place to put dialogue, and its meter reads silence rather than vanishing), and every video track
 * with at least one clip that sounds (`canSound`: not detached, its asset has audio). A video
 * track of pictures only has nothing to mix and gets no strip. Timeline order: V tracks, then A.
 */
export function mixerChannels(project: Project, timeline: Timeline): MixerChannel[] {
  const channels: MixerChannel[] = []
  for (const track of timeline.tracks) {
    const soundingClips = track.items.filter((item) => canSound(findAsset(project, item.assetId), item)).length
    if (track.kind === 'video' && soundingClips === 0) continue
    const audible = trackAudible(timeline.tracks, track)
    const state = track.muted
      ? 'Muted'
      : track.solo
        ? 'Soloed'
        : audible
          ? null
          : 'Silent — another track is soloed'
    channels.push({ track, badge: track.kind === 'video' ? 'V' : 'A', soundingClips, audible, state })
  }
  return channels
}
