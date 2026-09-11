/**
 * Tests for the application menu.
 *
 * The first one is the rule: **no item may exist without a `role` or a `click`.** A dead menu
 * item is the most common way a desktop app announces it is a prototype, and it is a defect
 * that survives review indefinitely because nobody clicks every item in every menu. Asserting
 * it over the flattened template costs nothing and cannot be forgotten.
 *
 * The absences are tested too, which is unusual and deliberate. `role: 'undo'` drives the
 * *system text* undo stack — correct inside a text field, wrong everywhere else in an editor,
 * where Cmd+Z must reach the store's history. An item that is present and wrong is worse than
 * one that is missing, so its absence is pinned rather than left to be "helpfully" restored.
 *
 * Mutation-tested: an item with neither role nor click added, `undo` restored to Edit,
 * `reload` restored to View, and DevTools leaking into a release menu. All fail here.
 *
 * Run with `pnpm test`, or on its own:
 *   node --import ./src/test-hooks.mjs --test src/main/menu.test.ts
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { MenuCommand } from '@shared/ipc'
import { menuLeaves, menuTemplate } from './menu'

function build(overrides: Partial<Parameters<typeof menuTemplate>[0]> = {}) {
  const sent: MenuCommand[] = []
  const template = menuTemplate({
    appName: 'bay',
    isMac: true,
    includeDevTools: false,
    onCommand: (command) => sent.push(command),
    ...overrides
  })
  return { template, sent }
}

function labels(template: ReturnType<typeof menuTemplate>): string[] {
  return menuLeaves(template)
    .map((item) => item.label ?? String(item.role ?? ''))
    .filter(Boolean)
}

// ---------------------------------------------------------------------------
// The rule
// ---------------------------------------------------------------------------

test('every menu item does something', () => {
  const { template } = build()
  for (const item of menuLeaves(template)) {
    if (item.type === 'separator') continue
    const wired = item.role !== undefined || typeof item.click === 'function'
    assert.ok(
      wired,
      `"${item.label ?? '(unlabelled)'}" has neither a role nor a click — a menu item that ` +
        `does nothing is worse than one that is absent`
    )
  }
})

test('every item that is not a separator is labelled or has a role to label it', () => {
  const { template } = build()
  for (const item of menuLeaves(template)) {
    if (item.type === 'separator') continue
    assert.ok(item.label !== undefined || item.role !== undefined)
  }
})

test('no submenu is empty', () => {
  // An empty top-level menu is a title that opens onto nothing.
  const { template } = build()
  for (const menu of template) {
    assert.ok(Array.isArray(menu.submenu) && menu.submenu.length > 0, `${menu.label} is empty`)
  }
})

// ---------------------------------------------------------------------------
// File — the items that need the renderer
// ---------------------------------------------------------------------------

test('every File command reaches the renderer with the right type', () => {
  const { template, sent } = build()
  const file = template.find((menu) => menu.label === 'File')
  const items = Array.isArray(file?.submenu) ? file.submenu : []

  const byLabel = (label: string) => items.find((item) => item.label === label)
  for (const [label, expected] of [
    ['Open…', 'open'],
    ['Save', 'save'],
    ['Save As…', 'save-as'],
    ['Import Media…', 'import'],
    ['Export…', 'export']
  ] as const) {
    const item = byLabel(label)
    assert.ok(item, `File is missing "${label}"`)
    assert.equal(typeof item?.click, 'function', `"${label}" is not wired`)
    sent.length = 0
    ;(item?.click as () => void)()
    assert.deepEqual(sent, [{ type: expected }], `"${label}" sent the wrong command`)
  }
})

test('the File accelerators are the ones a Mac user will try', () => {
  const { template } = build()
  const file = template.find((menu) => menu.label === 'File')
  const items = Array.isArray(file?.submenu) ? file.submenu : []
  const accel = (label: string) => items.find((item) => item.label === label)?.accelerator

  assert.equal(accel('Open…'), 'CmdOrCtrl+O')
  assert.equal(accel('Save'), 'CmdOrCtrl+S')
  assert.equal(accel('Save As…'), 'CmdOrCtrl+Shift+S')
  assert.equal(accel('Import Media…'), 'CmdOrCtrl+I')
})

// ---------------------------------------------------------------------------
// The deliberate absences
// ---------------------------------------------------------------------------

test('Edit has no Undo or Redo', () => {
  // They would drive the system text undo stack, not bay's. A user pressing Cmd+Z expecting
  // their cut back would get their last keystroke instead — present and wrong, which is worse
  // than absent. Restore these only together with a channel to the store's history.
  const { template } = build()
  const roles = menuLeaves(template).map((item) => item.role)
  assert.equal(roles.includes('undo'), false)
  assert.equal(roles.includes('redo'), false)
})

test('View has no Reload', () => {
  // In an editor Cmd+R means "discard everything since the last save", and it sits next to
  // Cmd+E for export.
  const { template } = build()
  const roles = menuLeaves(template).map((item) => item.role)
  assert.equal(roles.includes('reload'), false)
  assert.equal(roles.includes('forceReload'), false)
})

test('DevTools is absent unless asked for', () => {
  const release = build({ includeDevTools: false })
  assert.equal(
    menuLeaves(release.template).some((item) => item.role === 'toggleDevTools'),
    false
  )
  const dev = build({ includeDevTools: true })
  assert.equal(
    menuLeaves(dev.template).some((item) => item.role === 'toggleDevTools'),
    true
  )
})

// ---------------------------------------------------------------------------
// Platform shape
// ---------------------------------------------------------------------------

test('macOS gets an application menu named after the app', () => {
  const { template } = build({ isMac: true })
  assert.equal(template[0]?.label, 'bay')
  const first = Array.isArray(template[0]?.submenu) ? template[0].submenu : []
  assert.ok(first.some((item) => item.role === 'about'))
  assert.ok(first.some((item) => item.role === 'quit'))
})

test('other platforms get no application menu, and Quit moves into File', () => {
  const { template } = build({ isMac: false })
  assert.equal(template[0]?.label, 'File')
  const file = Array.isArray(template[0]?.submenu) ? template[0].submenu : []
  assert.ok(file.some((item) => item.role === 'quit'))
  assert.equal(labels(template).includes('front'), false)
})

test('the menu is the same shape whatever the app is called', () => {
  // The name is passed in rather than read from a constant here, so a rename cannot leave the
  // menu bar saying something else.
  const { template } = build({ appName: 'Hearth' })
  assert.equal(template[0]?.label, 'Hearth')
})
