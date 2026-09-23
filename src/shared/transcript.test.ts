/**
 * Transcript export. Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AgentEntry } from './agent'
import { claudeProjectFolder, transcriptFolderName, transcriptMarkdown } from './transcript'

const log: AgentEntry[] = [
  { kind: 'user', id: '1', text: 'Fade in /captions', pins: [{ kind: 'range', fromFrame: 30, toFrame: 60 }] },
  { kind: 'tool', id: 'c1', tool: 'read_project', args: {}, state: 'done', result: '{"fps":30}' },
  {
    kind: 'proposal',
    id: 'p',
    proposal: {
      id: 'p',
      question: 'Add a fade?',
      options: [{ id: 'o', label: 'Fade', summary: 'A short fade', operations: [{ index: 0, tool: 'edit_item', args: { itemId: 'x', fadeInFrames: 12 } }] }]
    }
  },
  { kind: 'assistant', id: '2', text: 'Done — **checked** the frame.' },
  { kind: 'error', id: '3', text: 'Stopped.' }
]

test('every kind of entry reaches the markdown, with what a bug report needs', () => {
  const md = transcriptMarkdown('Smoke test', log, '2026-09-23T05:40:00Z')
  assert.match(md, /^# bay agent transcript — Smoke test/)
  assert.match(md, /## You\n\nPinned: `\{"kind":"range","fromFrame":30,"toFrame":60\}`\n\nFade in \/captions/)
  assert.match(md, /\*\*Tool\*\* `read_project` — done/)
  assert.match(md, /\{"fps":30\}/) // the tool's result, not just its name
  assert.match(md, /### Proposal: Add a fade\?\n\n- \*\*Fade\*\* — A short fade\n {2}- `edit_item \{"itemId":"x","fadeInFrames":12\}`/)
  assert.match(md, /## Agent\n\nDone — \*\*checked\*\* the frame\./)
  assert.match(md, /\*\*Error:\*\* Stopped\./)
})

test('Claude Code’s session folder is the working directory with every non-alphanumeric as -', () => {
  // A literal read off disk, so a change to the rule fails here rather than exporting nothing.
  assert.equal(
    claudeProjectFolder('/Users/himanshu/Library/Application Support/bay/agent-workspace'),
    '-Users-himanshu-Library-Application-Support-bay-agent-workspace'
  )
})

test('the export folder name is safe on disk whatever the project is called', () => {
  const name = transcriptFolderName('Shy Ruby: Panda/2', new Date('2026-09-23T05:40:12.345Z'))
  assert.equal(name, 'bay-transcript-Shy-Ruby-Panda2-2026-09-23T05-40-12')
  assert.equal(transcriptFolderName('???', new Date(0)).startsWith('bay-transcript-project-'), true)
})
