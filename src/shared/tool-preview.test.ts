/**
 * Reading a tool call while it is still being written. Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { partialStringField, toolPreview } from './tool-preview'

const whole = JSON.stringify({ path: '/p/story-cards.html', html: '<div class="a">\n  "hi" é\n</div>' })

test('a string field decodes as far as it has arrived, at every cut point', () => {
  const full = partialStringField(whole, 'html')
  assert.equal(full, '<div class="a">\n  "hi" é\n</div>', 'positive control: the finished JSON reads back whole')
  for (let cut = 0; cut <= whole.length; cut++) {
    const partial = partialStringField(whole.slice(0, cut), 'html')
    if (partial === null) continue
    assert.ok(full!.startsWith(partial), `cut at ${cut} gave ${JSON.stringify(partial)}, not a prefix of the real value`)
  }
})

test('a field that has not started is null, and one escape cut in half is dropped rather than garbled', () => {
  assert.equal(partialStringField('{"path":"/p/x.html","ht', 'html'), null)
  assert.equal(partialStringField('{"html":"line\\', 'html'), 'line')
  assert.equal(partialStringField('{"html":"a\\u00', 'html'), 'a')
})

test('a composition shows its file name, size and the end of its HTML', () => {
  const preview = toolPreview('write_composition', whole.slice(0, whole.length - 3), 2)
  assert.match(preview.label, /^Writing story-cards\.html · \d+ B$/)
  assert.equal(preview.tail, '  "hi" é\n</div')
})

test('a tool with no streamed field shows its raw input', () => {
  assert.equal(toolPreview('edit_item', '{"itemId":"x","vol').tail, '{"itemId":"x","vol')
})
