/**
 * `fill_prompt_kit` through the real dispatcher: the schema lets it through, the answer is the
 * request, and nothing in the project moves. The kits themselves are tested in
 * `src/shared/prompt-kits.test.ts`. Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { useEditor, emptyProject } from '@/store/editor'
import { executeToolCall } from './index'

const call = (args: Record<string, unknown>) => executeToolCall({ id: 't', tool: 'fill_prompt_kit', args })

test('a kit and its slots come back as the request to pass on, and the project is untouched', async () => {
  useEditor.getState().enterProject(emptyProject())
  const before = JSON.stringify(useEditor.getState().project)
  const result = await call({ kit: 'rack-focus', slots: { far: 'a mountain ridge', near: 'a climber’s chalky hand' } })
  assert.ok(result.ok, result.ok ? '' : result.error)
  const value = result.value as { tool: string; request: { model: string; prompt: string }; next: string }
  assert.equal(value.tool, 'generate_video')
  assert.match(value.request.prompt, /Focus starts on a mountain ridge/)
  assert.match(value.next, /generate_video.*validateOnly: true/)
  assert.equal(JSON.stringify(useEditor.getState().project), before)
})

test('slots that are not an object, or a slot the kit lacks, are refused with what to pass', async () => {
  const notObject = await call({ kit: 'rack-focus', slots: ['a', 'b'] })
  assert.equal(notObject.ok, false)
  assert.match(notObject.ok ? '' : notObject.error, /slots must be an object/)
  const unknown = await call({ kit: 'rack-focus', slots: { far: 'x', near: 'y', speed: 'slow' } })
  assert.match(unknown.ok ? '' : unknown.error, /no slot "speed".*far \(required\), near \(required\)/)
})
