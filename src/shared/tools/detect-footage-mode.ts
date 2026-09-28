import type { ToolSpec } from './spec'

export const order = 39

export const tool: ToolSpec = {
  name: 'detect_footage_mode',
  description:
    'Work out what kind of footage this project holds — podcast (two or more long recordings of ' +
    'one conversation), talking-head (one long take to camera), screen-recording, b-roll-pile (many ' +
    'short clips, few words), music-video, or mixed — from signals computed on this Mac: frame ' +
    'sizes, durations, how many files match in length, audio channels, how much is speech (from a ' +
    'transcript bay already has, or a quick silence analysis of the first two minutes), and cut ' +
    'rate and beat where those were already analysed. Returns the mode, a 0..1 confidence, the ' +
    'evidence, and what to reach for: suggestedTools, suggestedSkills and suggestedLayout. Call it ' +
    'at the start of an open-ended request ("edit this", "what can you do with these") and say what ' +
    'you found and why before acting on it; the thresholds are heuristics, so a low confidence ' +
    'means ask. Changes nothing. analyzeAudio: false skips the silence analysis (instant, less sure).',
  category: 'read',
  readOnly: true,
  timeoutMs: 5 * 60_000,
  inputSchema: {
    type: 'object',
    properties: {
      analyzeAudio: {
        type: 'boolean',
        description: 'Run a quick silence analysis on files with no transcript (default true).'
      }
    }
  }
}
