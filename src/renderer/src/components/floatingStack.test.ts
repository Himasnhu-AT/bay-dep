import { test } from 'node:test'
import assert from 'node:assert/strict'
import { anyFloatingOpen, claimFloating, onFloatingChange, tooltipAllowed } from './floatingStack'

test('a tooltip outside an open menu is held back; one inside it, or with nothing open, shows', () => {
  // Positive control first: with nothing open, every tooltip shows.
  assert.equal(tooltipAllowed(false), true)
  const release = claimFloating()
  // The verification run: a tile's tooltip drawing over the tile's own context menu.
  assert.equal(tooltipAllowed(false), false)
  // A control inside the popover still explains itself.
  assert.equal(tooltipAllowed(true), true)
  release()
  assert.equal(tooltipAllowed(false), true)
})

test('claims nest, a double release cannot close someone else’s surface, and listeners hear each change', () => {
  let heard = 0
  const off = onFloatingChange(() => {
    heard += 1
  })
  const menu = claimFloating()
  const popover = claimFloating()
  menu()
  menu()
  assert.equal(anyFloatingOpen(), true, 'the popover is still open')
  popover()
  assert.equal(anyFloatingOpen(), false)
  assert.equal(heard, 4)
  off()
  claimFloating()()
  assert.equal(heard, 4, 'unsubscribed')
})
