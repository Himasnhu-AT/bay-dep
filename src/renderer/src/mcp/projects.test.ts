/**
 * The agent surface while bay is on its projects screen. Run with `pnpm test`.
 *
 * At launch no project is open and the store holds a placeholder nobody chose. A tool acting on
 * it would edit something invisible, gone the moment the user opens a real project.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Project } from '@shared/project'
import { useEditor, emptyProject } from '@/store/editor'
import { executeToolCall } from './index'

const onDisk: Project = { ...emptyProject(), name: 'Interview cut', filePath: '/p/interview.bay' }
const opened: string[] = []

;(globalThis as { window?: unknown }).window = {
  bay: {
    project: {
      recent: async () => [
        { id: onDisk.id, name: onDisk.name, filePath: onDisk.filePath!, updatedAt: 1_700_000_000_000 }
      ],
      openPath: async (filePath: string) => {
        opened.push(filePath)
        if (filePath !== onDisk.filePath) throw new Error(`ENOENT: ${filePath}`)
        return onDisk
      }
    }
  }
}

const state = () => useEditor.getState()
const run = (tool: string, args: Record<string, unknown> = {}) =>
  executeToolCall({ id: tool, tool, args })

function onHomeScreen(): void {
  state().setProject(emptyProject())
  state().showHome()
}

test('on the projects screen, project tools are refused and told how to open one', async () => {
  onHomeScreen()
  const refused = await run('read_project')
  assert.equal(refused.ok, false)
  assert.match(refused.ok ? '' : refused.error, /No project is open.*list_projects.*open_project/)
  // A write is refused the same way, and changes nothing.
  const before = JSON.stringify(state().project)
  assert.equal((await run('add_track', { kind: 'video' })).ok, false)
  assert.equal(JSON.stringify(state().project), before)
})

test('list_projects answers on the projects screen, with the paths open_project needs', async () => {
  onHomeScreen()
  const listed = await run('list_projects')
  assert.ok(listed.ok, listed.ok ? '' : listed.error)
  const value = listed.value as { open: unknown; projects: { filePath: string }[] }
  assert.equal(value.open, null, 'nothing is open on the projects screen')
  assert.deepEqual(value.projects.map((p) => p.filePath), ['/p/interview.bay'])
})

test('open_project enters the editor, after which the same tools work', async () => {
  onHomeScreen()
  const result = await run('open_project', { filePath: '/p/interview.bay' })
  assert.ok(result.ok, result.ok ? '' : result.error)
  assert.equal(state().screen, 'editor')
  assert.equal(state().project.name, 'Interview cut')
  // Positive control for the refusal above: the identical call now succeeds.
  assert.equal((await run('read_project')).ok, true)
})

test('open_project refuses to discard unsaved work, naming the project', async () => {
  state().enterProject({ ...emptyProject(), name: 'Draft' })
  state().renameProject('Draft, edited') // an edit: the project is now dirty
  assert.equal(state().dirty, true)
  const count = opened.length
  const result = await run('open_project', { filePath: '/p/interview.bay' })
  assert.equal(result.ok, false)
  assert.match(result.ok ? '' : result.error, /"Draft, edited" is open with unsaved changes/)
  assert.equal(opened.length, count, 'nothing was even read from disk')
  assert.equal(state().project.name, 'Draft, edited')
})

test('a path that will not open says to use list_projects', async () => {
  onHomeScreen()
  const result = await run('open_project', { filePath: '/p/missing.bay' })
  assert.equal(result.ok, false)
  assert.match(result.ok ? '' : result.error, /Could not open.*list_projects/)
  assert.equal(state().screen, 'home')
})
