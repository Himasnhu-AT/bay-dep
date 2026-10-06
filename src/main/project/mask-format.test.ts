/**
 * `item.masks` across the widening from "one subject mask" to a union with shape masks.
 *
 * The reader that matters is the one that cannot be changed: a `.bay` already on disk, written
 * when `Mask` was `SubjectMask` alone. So the subject masks here are **literal bytes**, not
 * values built from today's types — if the widening renamed a key, reordered one, or started
 * writing a default, the bytes would move and this fails. They go through the real load path
 * (`migrate`), the real writer (`writeProjectFile`), and the validator a tool or the store
 * applies before storing (`checkMasks`), and must come out as they went in.
 *
 * Shape masks are a new optional shape of an optional field: additive, no version bump.
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PROJECT_VERSION, type Project } from '@shared/project'
import { V1_ON_DISK } from '@shared/project-fixtures'
import { checkMasks, shapeMasksOf, subjectMaskOf } from '@shared/matte'
import { cutoutPartner } from '@shared/behind-subject'
import { adjustmentAsset } from '@shared/adjustment-layer'
import { migrate, readProjectFile, writeProjectFile } from './persistence'

/** Subject masks exactly as builds before shape masks wrote them — every field combination they could store. */
const SUBJECT_MASKS_ON_DISK = [
  '[{"kind":"subject"}]',
  '[{"kind":"subject","feather":4}]',
  '[{"kind":"subject","invert":true}]',
  '[{"kind":"subject","assetId":"ast_other","invert":true,"feather":12.5}]'
]

const firstItem = (project: Project) => project.timelines[0]!.tracks[0]!.items[0]!

/** The version-1 document with `"masks":<literal>` spliced into its first item, as text. */
function documentWith(masksLiteral: string): string {
  const marker = '"speed": 1'
  const at = V1_ON_DISK.indexOf(marker)
  assert.ok(at > 0, 'the fixture must hold an item to carry the masks')
  const spliced = `${V1_ON_DISK.slice(0, at + marker.length)}, "masks": ${masksLiteral}${V1_ON_DISK.slice(at + marker.length)}`
  // The specimen is what it claims: valid JSON whose first item carries exactly these masks.
  assert.equal(JSON.stringify(firstItem(JSON.parse(spliced) as Project).masks), masksLiteral)
  return spliced
}

test('masks widened without a format bump', () => {
  assert.equal(PROJECT_VERSION, 1)
})

test('a subject mask written before shape masks existed loads and saves byte-identical', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bay-mask-format-'))
  try {
    for (const literal of SUBJECT_MASKS_ON_DISK) {
      const loaded = migrate(JSON.parse(documentWith(literal)), join(dir, 'in.bay'))
      assert.equal(JSON.stringify(firstItem(loaded).masks), literal, 'loaded as written')
      // Saved by the real writer, and read back off the disk as text.
      const path = join(dir, 'out.bay')
      await writeProjectFile(loaded, path)
      const saved = await readFile(path, 'utf8')
      const reread = await readProjectFile(path)
      assert.equal(JSON.stringify(firstItem(reread).masks), literal, 'saved as written')
      assert.ok(JSON.stringify(JSON.parse(saved)).includes(`"masks":${literal}`), `the saved file holds the same bytes for ${literal}`)
      // The validator every writer goes through returns the same value, key for key and in order —
      // so an edit that passes the list back (the inspector clearing a shape, say) cannot rewrite it.
      const checked = checkMasks(JSON.parse(literal))
      assert.ok(checked.ok)
      assert.equal(JSON.stringify(checked.ok && checked.masks), literal)
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('and it is still read as a subject mask: the cut-out logic sees what it always saw', () => {
  for (const literal of SUBJECT_MASKS_ON_DISK) {
    const loaded = migrate(JSON.parse(documentWith(literal)), '/tmp/in.bay')
    const item = firstItem(loaded)
    assert.deepEqual(subjectMaskOf(item), JSON.parse(literal)[0])
    assert.equal(shapeMasksOf(item), null, 'no shapes: the compositor takes the path it took before')
    // Linked to a clip of the same file at the same moment, it is that clip's cut-out — unless its
    // matte is another asset's, exactly as before.
    const timeline = loaded.timelines[0]!
    const track = timeline.tracks[0]!
    item.linkId = 'lnk_x'
    const clip = { ...structuredClone(item), id: 'itm_clip', linkId: 'lnk_x' }
    delete clip.masks
    track.items.push(clip)
    const partner = cutoutPartner(timeline, item)
    assert.equal(partner?.id, literal.includes('assetId') ? undefined : 'itm_clip')
    track.items.pop()
  }
})

test('a document carrying shape masks loads and saves with them intact — an additive field', async () => {
  const literal =
    '[{"kind":"subject"},{"kind":"ellipse","x":0.5,"y":0.5,"width":0.6,"height":0.8,"feather":40},' +
    '{"kind":"rect","x":0.25,"y":0.5,"width":0.5,"height":1,"radius":0.2,"rotation":-10,"invert":true,"opacity":0.5,"combine":"subtract"},' +
    '{"kind":"path","x":0.5,"y":0.5,"width":1,"height":1,"points":[{"x":0,"y":0,"outX":0.2,"outY":-0.1},{"x":1,"y":0},{"x":0.5,"y":1}]}]'
  const dir = await mkdtemp(join(tmpdir(), 'bay-mask-format-'))
  try {
    const loaded = migrate(JSON.parse(documentWith(literal)), join(dir, 'in.bay'))
    const path = join(dir, 'out.bay')
    await writeProjectFile(loaded, path)
    assert.equal(JSON.stringify(firstItem(await readProjectFile(path)).masks), literal)
    const shapes = shapeMasksOf(firstItem(loaded))
    assert.ok(Array.isArray(shapes) && shapes.length === 3)
    assert.equal(JSON.stringify([{ kind: 'subject' }, ...(shapes as object[])]), literal, 'drawn from the stored values, unchanged')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
  // Positive control: the plain fixture has no masks, and loads without the key.
  assert.equal('masks' in firstItem(migrate(JSON.parse(V1_ON_DISK), '/tmp/plain.bay')), false)
})

test('an adjustment layer — a new asset kind and an item of it — loads and saves intact', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bay-mask-format-'))
  try {
    const raw = JSON.parse(V1_ON_DISK) as Project
    const assetLiteral =
      '{"id":"ast_adj","kind":"adjustment","name":"Adjustment layer","path":null,"durationUs":0,"width":null,"height":null,"fps":null,' +
      '"hasAudio":false,"hasVideo":false,"posterPath":null,"waveformPath":null,"createdAt":1}'
    raw.assets.push(JSON.parse(assetLiteral))
    const layer = { ...structuredClone(firstItem(raw)), id: 'itm_adj', assetId: 'ast_adj', from: 100_000, adjustments: { saturate: 0.2 } }
    raw.timelines[0]!.tracks[0]!.items.push(layer as never)
    const loaded = migrate(JSON.parse(JSON.stringify(raw)), join(dir, 'in.bay'))
    const path = join(dir, 'out.bay')
    await writeProjectFile(loaded, path)
    const reread = await readProjectFile(path)
    assert.equal(JSON.stringify(reread.assets.find((asset) => asset.id === 'ast_adj')), assetLiteral)
    const item = reread.timelines[0]!.tracks[0]!.items.find((candidate) => candidate.id === 'itm_adj')!
    assert.equal(item.assetId, 'ast_adj')
    assert.equal(item.adjustments?.saturate, 0.2)
    // What the store mints today is that same shape, key for key.
    assert.equal(JSON.stringify(adjustmentAsset('ast_adj', 1)), assetLiteral)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
