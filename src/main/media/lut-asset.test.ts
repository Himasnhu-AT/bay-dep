/**
 * A `.cube` file becoming a `kind: 'lut'` asset: the table the renderer will upload must be the
 * table in the file, and a file that will not parse must still list, with the parser's reason.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { identityCube, parseCube } from '@shared/cube'
import { decodeLutData } from '@shared/grade'
import { isLutPath, lutAssetFrom } from './asset-mint'

test('a good cube becomes a lut asset whose decoded table is the file\'s', () => {
  const text = `TITLE "Night"\n${identityCube(5)}`
  const asset = lutAssetFrom('/luts/night.cube', text)
  assert.equal(asset.kind, 'lut')
  assert.equal(asset.error, undefined)
  assert.equal(asset.name, 'Night (night.cube)')
  assert.ok(asset.lut)
  const decoded = decodeLutData(asset.lut)
  const parsed = parseCube(text)
  assert.ok(decoded && parsed.ok)
  for (let i = 0; i < decoded.length; i += 1) {
    assert.ok(Math.abs((decoded[i] as number) - (parsed.cube.values[i] as number)) <= 1 / 65535)
  }
})

test('a bad cube still lists as a lut, carrying the line and the fix', () => {
  const asset = lutAssetFrom('/luts/bad.cube', 'LUT_1D_SIZE 16\n0 0 0')
  assert.equal(asset.kind, 'lut')
  assert.equal(asset.lut, undefined)
  assert.match(asset.error ?? '', /is not a usable \.cube LUT: line 1: this is a 1D LUT/)
})

test('only .cube paths route to the LUT importer', () => {
  assert.equal(isLutPath('/a/Look.CUBE'), true)
  assert.equal(isLutPath('/a/look.cube.mp4'), false)
  assert.equal(isLutPath('/a/cube'), false)
})
