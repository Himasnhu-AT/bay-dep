import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fontGroups, fontMatches } from './fonts'

const options = [
  { value: 'Menlo, monospace', label: 'Menlo', group: 'system' as const },
  { value: '"Archivo", sans-serif', label: 'Archivo', group: 'project' as const },
  { value: 'Georgia, serif', label: 'Georgia', group: 'system' as const },
  { value: '"Inter Display", sans-serif', label: 'Inter Display', group: 'project' as const }
]

test('the project’s fonts come first, then the machine’s, each in the order given', () => {
  const { project, system } = fontGroups(options, '')
  assert.deepEqual(project.map((o) => o.label), ['Archivo', 'Inter Display'])
  assert.deepEqual(system.map((o) => o.label), ['Menlo', 'Georgia'])
})

test('search matches the family’s name, case-insensitively, not its fallback stack', () => {
  // "sans" is in two stacks and no name: it must match nothing.
  assert.deepEqual(fontGroups(options, 'sans'), { project: [], system: [] })
  assert.deepEqual(fontGroups(options, 'GEOR').system.map((o) => o.label), ['Georgia'])
  assert.deepEqual(fontGroups(options, ' inter ').project.map((o) => o.label), ['Inter Display'])
  assert.equal(fontMatches({ label: 'Menlo' }, ''), true)
})
