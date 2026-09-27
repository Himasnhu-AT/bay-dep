/**
 * `search_styles`, `read_style` and `write_style` through the executor, with main's styles folder
 * stood in by a list. What is held still: the catalog answers with no project open, a write never
 * touches the project or its undo history, validateOnly saves nothing, a built-in id never reaches
 * main, and a file on disk that fails its check (or claims a built-in id) is left out by name.
 * Main's own checks on disk are `main/styles/store.test.ts`.
 */

import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { useEditor } from '@/store/editor'
import { executeToolCall } from './index'

let onDisk: unknown[] = []
const writes: { style: unknown; options: unknown }[] = []

;(globalThis as { window?: unknown }).window = {
  bay: {
    styles: {
      list: async () => onDisk,
      write: async (style: { id: string }, options?: { replace?: boolean }) => {
        writes.push({ style, options })
        onDisk = [...onDisk.filter((s) => (s as { id: string }).id !== style.id), style]
        return { ok: true, style, replaced: false }
      }
    }
  }
}

const run = (tool: string, args: Record<string, unknown>) => executeToolCall({ id: 't', tool, args })

const style = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'warm-podcast-clip',
  title: 'Warm podcast clip',
  summary: 'A two-person podcast moment with a warm grade and clean captions.',
  tags: ['podcast', 'warm'],
  body: '1. transcribe the clip.\n2. add_subtitles with style "clean".',
  ...overrides
})

beforeEach(() => {
  onDisk = []
  writes.length = 0
})

test('the catalog answers on the projects screen, before any project is open', async () => {
  assert.notEqual(useEditor.getState().screen, 'editor', 'specimen: no project is open')
  const answer = await run('search_styles', { query: 'hormozi' })
  assert.ok(answer.ok, answer.ok ? '' : answer.error)
  const styles = (answer.value as { styles: { id: string }[] }).styles
  assert.equal(styles[0]?.id, 'retention-talking-head')
  // Positive control that the gate is still there for a project tool.
  const gated = await run('read_project', {})
  assert.equal(gated.ok, false)
})

test('read_style returns the steps and tokens; an unknown id is refused with every id named', async () => {
  const answer = await run('read_style', { id: 'news-lower-thirds' })
  assert.ok(answer.ok)
  const value = answer.value as { body: string; params: { canvas: string }; source: string; uri: string }
  assert.match(value.body, /add_template/)
  assert.equal(value.params.canvas, 'landscape-1080')
  assert.equal(value.source, 'built-in')
  assert.equal(value.uri, 'bay://style/news-lower-thirds')
  const missing = await run('read_style', { id: 'news' })
  assert.equal(missing.ok, false)
  assert.match(!missing.ok ? missing.error : '', /no style "news".*news-lower-thirds \(built-in\).*ugc-ad \(built-in\)/)
})

test('write_style saves through main, changes nothing in the project, and the style is then found as the user\'s', async () => {
  const past = useEditor.getState().past.length
  const project = useEditor.getState().project
  const answer = await run('write_style', style({ body: '1. transcribe it.\n<script>x</script> then frame_grid.' }))
  assert.ok(answer.ok, answer.ok ? '' : answer.error)
  assert.equal(writes.length, 1)
  assert.ok(!JSON.stringify(writes[0]!.style).includes('<script>'), 'main is sent the cleaned style')
  assert.equal(useEditor.getState().past.length, past)
  assert.equal(useEditor.getState().project, project)
  const found = await run('search_styles', { query: 'warm podcast' })
  assert.ok(found.ok)
  const first = (found.value as { styles: { id: string; source: string }[] }).styles[0]
  assert.deepEqual(first && { id: first.id, source: first.source }, { id: 'warm-podcast-clip', source: 'user' })
})

test('validateOnly checks and saves nothing; a built-in id is refused before main is asked', async () => {
  const checked = await run('write_style', { ...style(), validateOnly: true })
  assert.ok(checked.ok, checked.ok ? '' : checked.error)
  assert.equal((checked.value as { valid: boolean }).valid, true)
  assert.equal(writes.length, 0)
  const shadow = await run('write_style', style({ id: 'ugc-ad' }))
  assert.equal(shadow.ok, false)
  assert.match(!shadow.ok ? shadow.error : '', /built-in style.*"ugc-ad-custom"/)
  assert.equal(writes.length, 0)
})

test('a file on disk that fails its check is left out and named, never served', async () => {
  onDisk = [style({ id: 'kinetic-typography', title: 'Impostor' }), style({ id: 'fine-one' })]
  const answer = await run('search_styles', {})
  assert.ok(answer.ok)
  const value = answer.value as { styles: { id: string; title: string; source: string }[]; skipped?: string }
  assert.equal(value.styles.find((s) => s.id === 'kinetic-typography')?.source, 'built-in')
  assert.ok(!value.styles.some((s) => s.title === 'Impostor'))
  assert.ok(value.styles.some((s) => s.id === 'fine-one' && s.source === 'user'))
  assert.match(value.skipped ?? '', /kinetic-typography: .*built-in/)
})
