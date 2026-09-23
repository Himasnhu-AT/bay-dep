/**
 * `.cube` parsing: a good file gives the table the file describes, and every malformed one is
 * refused with a message that says what to do next.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { identityCube, parseCube, sampleCube } from './cube'

function ok(text: string) {
  const result = parseCube(text)
  if (!result.ok) assert.fail(`expected a table, got: ${result.error}`)
  return result.cube
}

function refused(text: string, pattern: RegExp): void {
  const result = parseCube(text)
  assert.equal(result.ok, false, `expected a refusal for:\n${text.slice(0, 120)}`)
  if (!result.ok) assert.match(result.error, pattern)
}

test('an identity cube samples back to its input', () => {
  const cube = ok(identityCube(5))
  assert.equal(cube.size, 5)
  for (const rgb of [[0, 0, 0], [1, 1, 1], [0.3, 0.6, 0.9], [0.125, 0.5, 0.875]] as [number, number, number][]) {
    const out = sampleCube(cube, rgb)
    for (let c = 0; c < 3; c += 1) assert.ok(Math.abs((out[c] as number) - (rgb[c] as number)) < 1e-6)
  }
})

test('red varies fastest — the table is not read transposed', () => {
  // A 2-point cube that outputs only the input's red: rows where r=1 are (1,0,0). If the parser
  // read blue-fastest, sampling pure red would come back as pure blue.
  const rows = ['LUT_3D_SIZE 2']
  for (let b = 0; b < 2; b += 1) for (let g = 0; g < 2; g += 1) for (let r = 0; r < 2; r += 1) rows.push(`${r} 0 0`)
  const cube = ok(rows.join('\n'))
  assert.deepEqual(sampleCube(cube, [1, 0, 0]), [1, 0, 0])
  assert.deepEqual(sampleCube(cube, [0, 0, 1]), [0, 0, 0])
})

test('title, comments, blank lines, CRLF and unknown keywords are all accepted', () => {
  const text = ['# made by hand', 'TITLE "Night Look"', '', 'LUT_IN_VIDEO_RANGE', identityCube(2)].join('\r\n')
  const cube = ok(text)
  assert.equal(cube.title, 'Night Look')
})

test('DOMAIN_MIN/MAX and LUT_3D_INPUT_RANGE rescale the input', () => {
  const cube = ok(`DOMAIN_MIN 0 0 0\nDOMAIN_MAX 2 2 2\n${identityCube(2)}`)
  // With a 0..2 domain, an input of 1 sits halfway along the table.
  assert.ok(Math.abs((sampleCube(cube, [1, 1, 1])[0] as number) - 0.5) < 1e-6)
  const resolve = ok(`LUT_3D_INPUT_RANGE 0 2\n${identityCube(2)}`)
  assert.deepEqual(resolve.domainMax, [2, 2, 2])
})

test('values outside 0..1 are counted, so the importer can say they will be clamped', () => {
  const cube = ok(identityCube(2).replace(/\n1 1 1$/, '\n1.2 1 1'))
  assert.equal(cube.outOfRange, 1)
})

test('malformed files are refused with the line and the fix', () => {
  refused('LUT_1D_SIZE 1024\n0 0 0', /1D LUT.*3D \.cube/)
  refused('TITLE "x"\n0 0 0\n1 1 1', /line 2: a data row comes before LUT_3D_SIZE/)
  refused('LUT_3D_SIZE 1\n0 0 0', /line 1: LUT_3D_SIZE must be a whole number from 2 to 65/)
  refused('LUT_3D_SIZE 99', /from 2 to 65/)
  refused('LUT_3D_SIZE 2.5', /whole number/)
  refused(identityCube(2).split('\n').slice(0, -1).join('\n'), /7 rows but LUT_3D_SIZE 2 needs 8.*truncated/)
  refused(`${identityCube(2)}\n0 0 0`, /line 10: more rows than LUT_3D_SIZE 2 allows/)
  refused(identityCube(2).replace('\n0 0 0', '\n0 0'), /line 2: expected three numbers/)
  refused(identityCube(2).replace('\n0 0 0', '\n0 nan 0'), /line 2: .*not a finite number/)
  refused(identityCube(2).replace('\n0 0 0', '\n0 0 zero'), /line 2: expected three numbers/)
  refused('# only a comment', /no LUT_3D_SIZE/)
  refused('', /no LUT_3D_SIZE/)
  refused(`DOMAIN_MIN 1 0 0\nDOMAIN_MAX 1 1 1\n${identityCube(2)}`, /DOMAIN_MAX must be greater/)
  refused(`LUT_3D_SIZE 2\n${identityCube(2)}`, /appears twice/)
})
