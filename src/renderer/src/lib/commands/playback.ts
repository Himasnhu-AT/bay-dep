import { selectDuration } from '@/store/editor'
import type { Handlers } from './types'

export const playbackHandlers = {
  'playback.toggle': { run: ({ state }) => state.togglePlay() },
  'playback.stepBack': { run: ({ state }) => state.nudgePlayhead(-1) },
  'playback.stepForward': { run: ({ state }) => state.nudgePlayhead(1) },
  'playback.stepBackMany': { run: ({ state }) => state.nudgePlayhead(-10) },
  'playback.stepForwardMany': { run: ({ state }) => state.nudgePlayhead(10) },
  'playback.toStart': { run: ({ state }) => state.setPlayhead(0) },
  'playback.toEnd': { run: ({ state }) => state.setPlayhead(selectDuration(state)) }
} satisfies Handlers
