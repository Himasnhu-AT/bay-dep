import type { ToolSpec } from './spec'
import { itemId } from './fields'

export const order = 30

export const tool: ToolSpec = {
  name: 'transcribe',
  description:
    'Transcribe a clip\'s speech on this Mac with whisper.cpp — nothing is uploaded. Use it ' +
    'for captions when the user has no transcript or subtitle file, or to find what is said ' +
    'where before cutting. Pass itemId for a clip on the timeline: the lines come back as ' +
    'cues in timeline frames, already shifted and clipped to what the clip plays, ready for ' +
    'add_captions. Pass assetId for a whole file: lines in seconds from its start, and SRT. ' +
    'A long recording comes back a page at a time (the answer says where the next page starts), or pass fromSeconds/toSeconds for one stretch. Takes a few seconds per minute of audio. The first run on a Mac with no model may ' +
    'download one (~150 MB, a minute or two) unless the user turned that off in Settings. If whisper.cpp ' +
    'or a model is missing, the error says what to do in Settings — tell the user; do not guess words.',
  category: 'read',
  readOnly: true,
  timeoutMs: 15 * 60_000,
  inputSchema: {
    type: 'object',
    properties: {
      itemId: { ...itemId, description: 'A clip on the timeline. ' + itemId.description },
      assetId: { type: 'string', description: 'An imported file, from browse_assets.' },
      language: {
        type: 'string',
        description: 'Spoken language as a code ("en", "fr", …) or "auto". Default "en".'
      },
      fromSeconds: {
        type: 'number',
        description: 'Only lines ending after this second of the file. With toSeconds, reads one stretch of a long recording; the transcription is cached, so later stretches are instant.'
      },
      toSeconds: { type: 'number', description: 'Only lines starting before this second of the file.' }
    }
  }
}
