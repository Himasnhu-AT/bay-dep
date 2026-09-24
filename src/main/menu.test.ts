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
import { COMMANDS } from '@shared/commands'
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

function itemsOf(template: ReturnType<typeof menuTemplate>, menu: string) {
  const found = template.find((entry) => entry.label === menu)
  return Array.isArray(found?.submenu) ? found.submenu : []
}

test('every File command reaches the renderer as its registry id', () => {
  const { template, sent } = build()
  const items = itemsOf(template, 'File')

  const byLabel = (label: string) => items.find((item) => item.label === label)
  for (const [label, expected] of [
    ['New Project', 'file.newProject'],
    ['Open…', 'file.open'],
    ['Save', 'file.save'],
    ['Save As…', 'file.saveAs'],
    ['Import Media…', 'file.import'],
    ['Export…', 'file.export']
  ] as const) {
    const item = byLabel(label)
    assert.ok(item, `File is missing "${label}"`)
    assert.equal(typeof item?.click, 'function', `"${label}" is not wired`)
    sent.length = 0
    ;(item?.click as () => void)()
    assert.deepEqual(sent, [{ type: 'command', id: expected }], `"${label}" sent the wrong command`)
  }
})

test('the File accelerators are the ones a Mac user will try', () => {
  const { template } = build()
  const items = itemsOf(template, 'File')
  const accel = (label: string) => items.find((item) => item.label === label)?.accelerator

  assert.equal(accel('New Project'), 'CmdOrCtrl+N')
  assert.equal(accel('Open…'), 'CmdOrCtrl+O')
  assert.equal(accel('Save'), 'CmdOrCtrl+S')
  assert.equal(accel('Save As…'), 'CmdOrCtrl+Shift+S')
  assert.equal(accel('Import Media…'), 'CmdOrCtrl+I')
  assert.equal(accel('Export…'), 'CmdOrCtrl+E')
})

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

test('every registry command with a menu entry is in the menu bar, and sends its id', () => {
  const { template, sent } = build()
  const leaves = menuLeaves(template)
  let seen = 0
  for (const spec of COMMANDS) {
    if (spec.menu === false) continue
    const item = leaves.find((leaf) => leaf.label === spec.label)
    assert.ok(item, `"${spec.label}" (${spec.id}) is not in the menu bar`)
    sent.length = 0
    ;(item?.click as () => void)()
    assert.deepEqual(sent, [{ type: 'command', id: spec.id }])
    seen++
  }
  assert.ok(seen >= 20, `only ${seen} commands walked — the registry is not being read`)
})

test('the menu bar has a menu for every group that has commands, in order', () => {
  const { template } = build()
  const titles = template.map((menu) => menu.label)
  assert.deepEqual(titles, [
    'bay',
    'File',
    'Edit',
    'Clip',
    'Mark',
    'Timeline',
    'Playback',
    'View',
    'Window',
    'Help'
  ])
})

test('a single-key shortcut is shown but never registered, so it cannot steal a keystroke', () => {
  // A registered `S`, `M` or `Delete` would be taken from every text field in the window: a
  // clip name could not contain an "s". Only ⌘-combos declared native may register.
  const { template } = build()
  const leaves = menuLeaves(template)
  let checked = 0
  for (const spec of COMMANDS) {
    const item = leaves.find((leaf) => leaf.label === spec.label)
    if (!item?.accelerator) continue
    checked++
    const accelerator = String(item.accelerator)
    const registered = item.registerAccelerator !== false
    if (!accelerator.includes('CmdOrCtrl')) {
      assert.equal(registered, false, `${spec.id} registers "${accelerator}" natively`)
    }
    assert.equal(
      registered,
      spec.accelerator === 'native',
      `${spec.id}: registration disagrees with its spec`
    )
  }
  // The specimens: Set In's `I` is in the menu, shown and not registered; so is Split's ⌘B, which
  // the renderer handles too, so a registered one would split twice.
  const setIn = leaves.find((leaf) => leaf.label === 'Set In')
  assert.equal(setIn?.accelerator, 'I')
  assert.equal(setIn?.registerAccelerator, false)
  const split = leaves.find((leaf) => leaf.label === 'Split at Playhead')
  assert.equal(split?.accelerator, 'CmdOrCtrl+B')
  assert.equal(split?.registerAccelerator, false)
  assert.ok(checked >= 10, `only ${checked} accelerators checked — the walk is not reaching the registry`)
})

test('Undo and Redo are bay commands that reach the renderer', () => {
  const { template, sent } = build()
  const items = itemsOf(template, 'Edit')
  const undo = items.find((item) => item.label === 'Undo')
  const redo = items.find((item) => item.label === 'Redo')
  assert.ok(undo && redo)
  sent.length = 0
  ;(undo.click as () => void)()
  ;(redo.click as () => void)()
  assert.deepEqual(sent, [
    { type: 'command', id: 'edit.undo' },
    { type: 'command', id: 'edit.redo' }
  ])
  // Renderer-owned, so ⌘Z inside a text field is still the field's own undo.
  assert.equal(undo.registerAccelerator, false)
  // Select All is still the text-field role beside them.
  assert.ok(items.some((item) => item.role === 'selectAll'), 'Edit lost role selectAll')
})

test('Cut, Copy and Paste are bay commands, renderer-owned, never text-only roles', () => {
  // As roles ⌘C could only copy text, never a clip. As renderer-owned commands the handler gives
  // the key back to a focused field (execCommand) and otherwise acts on clips.
  const { template, sent } = build()
  const items = itemsOf(template, 'Edit')
  sent.length = 0
  for (const label of ['Cut', 'Copy', 'Paste']) {
    const item = items.find((candidate) => candidate.label === label)
    assert.ok(item, `Edit has no ${label}`)
    assert.equal(item.registerAccelerator, false, `${label} must not steal its key from text fields`)
    ;(item.click as () => void)()
  }
  assert.deepEqual(sent, [
    { type: 'command', id: 'edit.cut' },
    { type: 'command', id: 'edit.copy' },
    { type: 'command', id: 'edit.paste' }
  ])
  const roles = menuLeaves(template).map((item) => item.role)
  for (const role of ['cut', 'copy', 'paste', 'pasteAndMatchStyle']) {
    assert.equal(roles.includes(role as never), false, `role ${role} would take its key natively`)
  }
})

test('View has no page-zoom in/out roles: ⌘= and ⌘- zoom the timeline', () => {
  const { template } = build()
  const roles = menuLeaves(template).map((item) => item.role)
  assert.equal(roles.includes('zoomIn'), false)
  assert.equal(roles.includes('zoomOut'), false)
  assert.ok(roles.includes('resetZoom'), 'Actual Size must stay, to undo a pinch-zoom')
})

test('Settings is in the application menu on macOS and in File elsewhere', () => {
  const mac = build({ isMac: true }).template
  assert.ok(itemsOf(mac, 'bay').some((item) => item.label === 'Settings…'))
  assert.equal(itemsOf(mac, 'File').some((item) => item.label === 'Settings…'), false)
  const other = build({ isMac: false }).template
  assert.ok(itemsOf(other, 'File').some((item) => item.label === 'Settings…'))
})

test('no menu starts or ends with a separator, or has two in a row', () => {
  for (const isMac of [true, false]) {
    for (const menu of build({ isMac }).template) {
      const items = Array.isArray(menu.submenu) ? menu.submenu : []
      assert.notEqual(items[0]?.type, 'separator', `${menu.label} starts with a separator`)
      assert.notEqual(items[items.length - 1]?.type, 'separator', `${menu.label} ends with a separator`)
      items.forEach((item, i) => {
        if (item.type === 'separator') {
          assert.notEqual(items[i + 1]?.type, 'separator', `${menu.label} doubles a separator`)
        }
      })
    }
  }
})

// ---------------------------------------------------------------------------
// The deliberate absences
// ---------------------------------------------------------------------------

test('Edit has no undo or redo *role*', () => {
  // The roles would drive the system text undo stack, not bay's. A user pressing Cmd+Z expecting
  // their cut back would get their last keystroke instead — present and wrong, which is worse
  // than absent. Undo and Redo are registry commands instead (tested above).
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
