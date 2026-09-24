/**
 * The command registry and the shortcut spelling it is keyed by.
 *
 * The first block is the inventory: every binding the old hand-written `useKeyboard` switch
 * handled, pressed as a key event and required to reach the same command — so the refactor onto
 * the registry is checked key by key, not by reading it. The rest pin the spelling (parse,
 * match, draw, accelerator) and the one rule that makes a registry worth having: no two
 * commands claim the same keys. That check is proven against specimens that break it.
 *
 * Run: node --import ./src/test-hooks.mjs --test src/shared/commands/commands.test.ts
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  formatShortcut,
  matchesShortcut,
  parseShortcut,
  toAccelerator,
  type KeyLike
} from '../shortcuts'
import { COMMANDS, commandForKey, shortcutOf, shortcutProblems, type CommandSpec } from './index'

function key(k: string, mods: Partial<Omit<KeyLike, 'key'>> = {}): KeyLike {
  return { key: k, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods }
}

// ---------------------------------------------------------------------------
// Every binding useKeyboard had, still reaching the same action
// ---------------------------------------------------------------------------

const INVENTORY: [string, KeyLike, string][] = [
  ['⌘Z undoes', key('z', { metaKey: true }), 'edit.undo'],
  ['Ctrl+Z undoes too (Mod is either)', key('z', { ctrlKey: true }), 'edit.undo'],
  ['⇧⌘Z redoes', key('Z', { metaKey: true, shiftKey: true }), 'edit.redo'],
  ['⌘D duplicates', key('d', { metaKey: true }), 'clip.duplicate'],
  ['⌘A selects every clip', key('a', { metaKey: true }), 'edit.selectAll'],
  ['Space plays', key(' '), 'playback.toggle'],
  ['← steps back', key('ArrowLeft'), 'playback.stepBack'],
  ['⇧← steps back ten', key('ArrowLeft', { shiftKey: true }), 'playback.stepBackMany'],
  ['→ steps forward', key('ArrowRight'), 'playback.stepForward'],
  ['⇧→ steps forward ten', key('ArrowRight', { shiftKey: true }), 'playback.stepForwardMany'],
  ['Home goes to the start', key('Home'), 'playback.toStart'],
  ['End goes to the end', key('End'), 'playback.toEnd'],
  ['s splits', key('s'), 'clip.split'],
  ['S (caps lock) splits', key('S'), 'clip.split'],
  ['m adds a marker', key('m'), 'mark.add'],
  ['⇧M removes the marker here', key('M', { shiftKey: true }), 'mark.removeHere'],
  ['Delete lifts', key('Delete'), 'clip.delete'],
  ['Backspace lifts', key('Backspace'), 'clip.delete'],
  ['⇧Delete ripples', key('Delete', { shiftKey: true }), 'clip.rippleDelete'],
  ['⇧Backspace ripples', key('Backspace', { shiftKey: true }), 'clip.rippleDelete'],
  ['= zooms in', key('='), 'timeline.zoomIn'],
  ['+ zooms in', key('+', { shiftKey: true }), 'timeline.zoomIn'],
  ['- zooms out', key('-'), 'timeline.zoomOut'],
  ['_ zooms out', key('_', { shiftKey: true }), 'timeline.zoomOut'],
  ['⌘/ shows the shortcuts', key('/', { metaKey: true }), 'help.shortcuts'],
  ['? shows the shortcuts', key('?', { shiftKey: true }), 'help.shortcuts']
]

for (const [name, event, id] of INVENTORY) {
  test(`key: ${name}`, () => {
    assert.equal(commandForKey(event, false)?.id, id)
  })
}

test('no key runs a command while a text field has focus', () => {
  // Typing "s" into a clip name must not razor the timeline.
  // Undo/Redo are the exception, by design: they run whileTyping and their handler undoes the
  // *text* (see edit.ts), because macOS delivers a ⌘Z left to the field to nothing.
  const TEXT_AWARE = new Set(['edit.undo', 'edit.redo'])
  for (const [, event, id] of INVENTORY) {
    if (TEXT_AWARE.has(id)) continue
    assert.equal(commandForKey(event, true), undefined, id)
  }
  // Positive control: a whileTyping command does fire there.
  const specs: CommandSpec[] = [{ id: 'x.t', label: 'T', group: 'File', shortcut: 'S', whileTyping: true }]
  assert.equal(commandForKey(key('s'), true, specs)?.id, 'x.t')
})

test("the renderer's key handler leaves native accelerators to the menu", () => {
  // ⌘S is registered by main; if the renderer ran it too, Save would run twice.
  for (const k of ['s', 'o', 'e', 'i', ',']) {
    assert.equal(commandForKey(key(k, { metaKey: true }), false), undefined, `⌘${k}`)
  }
  // Positive control: the same spec without `native` is found.
  const specs: CommandSpec[] = [{ id: 'x.s', label: 'S', group: 'File', shortcut: 'Mod+S' }]
  assert.equal(commandForKey(key('s', { metaKey: true }), false, specs)?.id, 'x.s')
})

test('modifiers are exact: a bare key does not fire under Shift or ⌘', () => {
  assert.equal(commandForKey(key('S', { shiftKey: true }), false), undefined)
  assert.equal(commandForKey(key('m', { metaKey: true }), false), undefined)
  assert.equal(commandForKey(key(' ', { ctrlKey: true }), false), undefined)
  assert.equal(commandForKey(key('z'), false), undefined)
})

// ---------------------------------------------------------------------------
// The registry's rule
// ---------------------------------------------------------------------------

test('no two commands claim the same shortcut, and every spelling parses', () => {
  assert.deepEqual(shortcutProblems(COMMANDS), [])
})

test('the duplicate check sees a duplicate — spelled differently, too', () => {
  // Specimen 1: a second command on S, written lower-case. Canonicalisation must catch it.
  const dup = shortcutProblems([...COMMANDS, { id: 'x.dup', label: 'Dup', group: 'Clip', shortcut: 's' }])
  assert.equal(dup.length, 1)
  assert.equal(dup[0]?.problem, 'duplicate')
  assert.deepEqual(dup[0]?.ids, ['clip.split', 'x.dup'])
  // Specimen 2: '?' written as Shift+? is the same key.
  const shifted = shortcutProblems([
    { id: 'a', label: 'A', group: 'Help', shortcut: '?' },
    { id: 'b', label: 'B', group: 'Help', shortcut: 'Shift+?' }
  ])
  assert.equal(shifted[0]?.problem, 'duplicate')
  // Specimen 3: an alias inside one command's own list.
  const inner = shortcutProblems([{ id: 'c', label: 'C', group: 'Help', shortcut: ['Mod+K', 'Mod+k'] }])
  assert.equal(inner[0]?.problem, 'duplicate')
  // And a spelling that is not one.
  const bad = shortcutProblems([{ id: 'd', label: 'D', group: 'Help', shortcut: 'Cmd+K' }])
  assert.equal(bad[0]?.problem, 'unparseable')
})

test('every id is unique and namespaced by its group', () => {
  const ids = COMMANDS.map((c) => c.id)
  assert.equal(new Set(ids).size, ids.length)
  for (const c of COMMANDS) assert.match(c.id, /^[a-z]+\.[a-zA-Z]+$/)
})

test('the standard NLE editing keys reach the commands every editor binds them to', () => {
  // These were reserved (checked free) until the editing commands claimed them; now each must
  // reach its command, so a later command cannot quietly take ⌘B or J from the timeline.
  const expected: [KeyLike, string][] = [
    [key('b', { metaKey: true }), 'clip.split'],
    [key('B', { metaKey: true, shiftKey: true }), 'clip.splitAll'],
    [key('c', { metaKey: true }), 'edit.copy'],
    [key('x', { metaKey: true }), 'edit.cut'],
    [key('v', { metaKey: true }), 'edit.paste'],
    [key('V', { metaKey: true, altKey: true, shiftKey: true, code: 'KeyV' }), 'edit.pasteAttributes'],
    [key('i'), 'mark.setIn'],
    [key('o'), 'mark.setOut'],
    [key('≈', { altKey: true, code: 'KeyX' }), 'mark.clearRange'],
    [key('j'), 'playback.shuttleReverse'],
    [key('k'), 'playback.shuttleStop'],
    [key('l'), 'playback.shuttleForward'],
    [key('l', { metaKey: true }), 'playback.toggleLoop'],
    [key('Z', { shiftKey: true }), 'timeline.zoomToFit'],
    [key('n'), 'timeline.toggleSnapping'],
    [key('=', { metaKey: true }), 'timeline.zoomIn'],
    [key('-', { metaKey: true }), 'timeline.zoomOut'],
    [key('q'), 'clip.trimStartRipple'],
    [key('w'), 'clip.trimEndRipple'],
    [key('œ', { altKey: true, code: 'KeyQ' }), 'clip.trimStart'],
    [key('ArrowLeft', { altKey: true }), 'clip.nudgeLeft'],
    [key('ArrowRight', { altKey: true, shiftKey: true }), 'clip.nudgeRightMany'],
    [key('ArrowUp'), 'playback.prevEdit'],
    [key('ArrowDown', { shiftKey: true }), 'playback.nextMarker'],
    [key('E', { shiftKey: true }), 'clip.toggleEnabled'],
    [key('t', { metaKey: true }), 'clip.addTransition'],
    [key('Backspace', { metaKey: true, shiftKey: true }), 'mark.removeRange']
  ]
  for (const [event, id] of expected) {
    assert.equal(commandForKey(event, false)?.id, id, `${JSON.stringify(event)} should run ${id}`)
  }
  // ⌘C/⌘V/⌘X also run while typing (their handlers hand the key to the text); single keys never do.
  assert.equal(commandForKey(key('c', { metaKey: true }), true)?.id, 'edit.copy')
  // ⌘Z in a text field must reach the handler (which undoes the text): with no system Undo role
  // in the menu, a key left to the field is delivered to nothing on macOS.
  assert.equal(commandForKey(key('z', { metaKey: true }), true)?.id, 'edit.undo')
  assert.equal(commandForKey(key('Z', { metaKey: true, shiftKey: true }), true)?.id, 'edit.redo')
  assert.equal(commandForKey(key('i'), true), undefined)
  assert.equal(commandForKey(key('j'), true), undefined)
})

test('shortcutOf gives the primary binding', () => {
  assert.equal(shortcutOf('clip.delete'), 'Backspace')
  assert.equal(shortcutOf('file.save'), 'Mod+S')
})

// ---------------------------------------------------------------------------
// The spelling
// ---------------------------------------------------------------------------

test('parse', () => {
  assert.deepEqual(parseShortcut('Mod+Shift+z'), { mod: true, shift: true, alt: false, key: 'Z' })
  assert.deepEqual(parseShortcut('Shift+Delete'), { mod: false, shift: true, alt: false, key: 'Delete' })
  assert.deepEqual(parseShortcut('+'), { mod: false, shift: false, alt: false, key: '+' })
  assert.deepEqual(parseShortcut('Mod++'), { mod: true, shift: false, alt: false, key: '+' })
  for (const notOne of ['', 'Cmd+S', '⌘S', 'Mod+Mod+S', 'Media tools missing', 'Mod+', 'Shift+Foo']) {
    assert.equal(parseShortcut(notOne), null, notOne)
  }
})

test('match: ⌥ letters by physical key, since ⌥D types ∂ on a Mac', () => {
  const shortcut = parseShortcut('Mod+Alt+D')!
  assert.ok(matchesShortcut(shortcut, key('∂', { metaKey: true, altKey: true, code: 'KeyD' })))
  assert.equal(matchesShortcut(shortcut, key('∂', { metaKey: true, altKey: true, code: 'KeyF' })), false)
})

test('format: glyphs on a Mac in Apple order, words elsewhere', () => {
  assert.equal(formatShortcut('Mod+Shift+Z', true), '⇧⌘Z')
  assert.equal(formatShortcut('Mod+Alt+D', true), '⌥⌘D')
  assert.equal(formatShortcut('Shift+Delete', true), '⇧⌦')
  assert.equal(formatShortcut('Backspace', true), '⌫')
  assert.equal(formatShortcut('Shift+ArrowLeft', true), '⇧←')
  assert.equal(formatShortcut('Space', true), 'Space')
  assert.equal(formatShortcut('?', true), '?')
  assert.equal(formatShortcut('Mod+Shift+Z', false), 'Ctrl+Shift+Z')
  // Not a spelling: returned as given, so prose and pre-drawn glyphs pass through.
  assert.equal(formatShortcut('Storage unavailable', true), 'Storage unavailable')
  assert.equal(formatShortcut('⌘S', true), '⌘S')
})

test('accelerator: what Electron can spell, and nothing it cannot', () => {
  assert.equal(toAccelerator('Mod+Shift+S'), 'CmdOrCtrl+Shift+S')
  assert.equal(toAccelerator('Mod+,'), 'CmdOrCtrl+,')
  assert.equal(toAccelerator('Mod+Alt+D'), 'CmdOrCtrl+Alt+D')
  assert.equal(toAccelerator('ArrowLeft'), 'Left')
  assert.equal(toAccelerator('+'), 'Plus')
  assert.equal(toAccelerator('Space'), 'Space')
  assert.equal(toAccelerator('?'), undefined)
  assert.equal(toAccelerator('_'), undefined)
})
