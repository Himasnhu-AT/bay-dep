/**
 * Crash recovery on disk: what a sidecar is, where it is, and what reading one back gives.
 *
 * The sidecars here are **literal text** (CLAUDE.md, persisted data): a sidecar is read by a
 * build that is not the build that wrote it — the one the user restarts into after the crash,
 * possibly after an update — so a test that wrote them with today's writer would pass through
 * any rename of a key or of the suffix while every sidecar already on a disk stopped being found.
 * `V1_ON_DISK` is the version-1 document spelled out key by key; the sidecar is that text with a
 * later `updatedAt`, because that is all a sidecar is.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BAY_DOCUMENTS, V1_ON_DISK } from '@shared/project-fixtures'
import { PROJECT_VERSION } from '@shared/project'
import { recoverySentence } from '@shared/autosave'
import {
  checkRecovery,
  clearSidecarsAfterSave,
  listUnsaved,
  readProjectFile,
  readSidecar,
  removeSidecar,
  setSidecarAside,
  sidecarPathFor,
  writeSidecar
} from './persistence'

const SAVED_AT = 1700000000001
const stamped = (at: number): string => {
  const needle = `"updatedAt": ${SAVED_AT}`
  assert.ok(V1_ON_DISK.includes(needle), 'the fixture must carry the stamp this test rewrites')
  return V1_ON_DISK.replace(needle, `"updatedAt": ${at}`)
}

/** A folder holding `film.bay` as the version-1 fixture, and bay's own autosave folder. */
function scene(): { dir: string; file: string; fallback: string } {
  const dir = mkdtempSync(join(tmpdir(), 'bay-recovery-'))
  const fallback = join(dir, 'autosave')
  mkdirSync(fallback)
  const file = join(dir, 'film.bay')
  writeFileSync(file, V1_ON_DISK)
  return { dir, file, fallback }
}

const opened = (file: string | null, updatedAt = SAVED_AT) => ({ id: 'prj_fixed', filePath: file, name: 'Fixture', updatedAt })

test('the sidecar is `<file>.autosave` beside a saved project — a name sidecars on disk already have', () => {
  assert.equal(sidecarPathFor({ id: 'prj_fixed', filePath: '/work/film.bay' }, '/fallback'), '/work/film.bay.autosave')
  assert.equal(sidecarPathFor({ id: 'prj_fixed', filePath: null }, '/fallback'), '/fallback/prj_fixed.bay.autosave')
})

test('a sidecar newer than the saved file is offered, with both times', async () => {
  const { file, fallback } = scene()
  writeFileSync(`${file}.autosave`, stamped(SAVED_AT + 60_000))
  const offer = await checkRecovery(opened(file), fallback)
  assert.deepEqual(offer, {
    state: 'newer',
    target: { id: 'prj_fixed', filePath: file },
    name: 'Fixture',
    autosavedAt: SAVED_AT + 60_000,
    savedAt: SAVED_AT
  })
  assert.equal(
    recoverySentence(offer!, '3 minutes ago', '2 hours ago'),
    '“Fixture” has unsaved work from 3 minutes ago, later than the project you saved 2 hours ago. Restore it, or discard it and keep the saved project.'
  )
})

test('a sidecar older than the saved file is not offered, and is left where it is', async () => {
  const { file, fallback } = scene()
  writeFileSync(`${file}.autosave`, stamped(SAVED_AT - 60_000))
  assert.equal(await checkRecovery(opened(file), fallback), null)
  assert.ok(existsSync(`${file}.autosave`), 'checking must not delete anything')
  // The pair: the same sidecar is offered the moment it is the later of the two.
  assert.equal((await checkRecovery(opened(file, SAVED_AT - 120_000), fallback))?.state, 'newer')
})

test('a sidecar stamped exactly when the file was saved holds nothing new', async () => {
  const { file, fallback } = scene()
  writeFileSync(`${file}.autosave`, stamped(SAVED_AT))
  assert.equal(await checkRecovery(opened(file), fallback), null)
})

test('no sidecar, no offer', async () => {
  const { file, fallback } = scene()
  assert.equal(await checkRecovery(opened(file), fallback), null)
})

test('a sidecar cut short is reported with why and where, never offered and never thrown', async () => {
  const { file, fallback } = scene()
  const whole = stamped(SAVED_AT + 60_000)
  writeFileSync(`${file}.autosave`, whole.slice(0, Math.floor(whole.length / 2)))
  const offer = await checkRecovery(opened(file), fallback)
  assert.equal(offer?.state, 'unreadable')
  assert.equal(
    recoverySentence(offer!, '', null),
    `bay kept unsaved work for “Fixture”, but could not read it: It is not complete — bay may have been stopped while writing it. The file is still at ${file}.autosave.`
  )
})

test('a sidecar from a newer bay is refused by the same migrations as a project, naming the version', async () => {
  const { file, fallback } = scene()
  const needle = '"version": 1'
  assert.ok(V1_ON_DISK.includes(needle))
  writeFileSync(`${file}.autosave`, stamped(SAVED_AT + 60_000).replace(needle, `"version": ${PROJECT_VERSION + 1}`))
  const offer = await checkRecovery(opened(file), fallback)
  assert.equal(offer?.state, 'unreadable')
  assert.match(offer!.state === 'unreadable' ? offer!.reason : '', new RegExp(String(PROJECT_VERSION + 1)))
})

test('a sidecar belonging to another project is not offered to this one', async () => {
  const { file, fallback } = scene()
  const needle = '"id": "prj_fixed"'
  assert.ok(V1_ON_DISK.includes(needle))
  writeFileSync(`${file}.autosave`, stamped(SAVED_AT + 60_000).replace(needle, '"id": "prj_other"'))
  const offer = await checkRecovery(opened(file), fallback)
  assert.equal(offer?.state, 'unreadable')
  assert.match(offer!.state === 'unreadable' ? offer!.reason : '', /different project \(“Fixture”\)/)
})

test('recovery loads through the migrations: every format bay has written comes back at this one', async () => {
  const { file, fallback } = scene()
  for (const [version, text] of Object.entries(BAY_DOCUMENTS)) {
    writeFileSync(`${file}.autosave`, text)
    const project = await readSidecar(`${file}.autosave`, file)
    assert.equal(project.version, PROJECT_VERSION, `a version-${version} sidecar`)
    assert.deepEqual(
      { ...project, filePath: null },
      { ...(await readAs(text, join(fallback, `v${version}.bay`))), filePath: null },
      `a version-${version} sidecar must read exactly as the same text does as a project`
    )
  }
})

async function readAs(text: string, path: string) {
  writeFileSync(path, text)
  return readProjectFile(path)
}

test('a restored project lives at the project’s file, not at the sidecar', async () => {
  const { file } = scene()
  writeFileSync(`${file}.autosave`, stamped(SAVED_AT + 60_000))
  const restored = await readSidecar(`${file}.autosave`, file)
  assert.equal(restored.filePath, file)
  assert.equal(restored.updatedAt, SAVED_AT + 60_000)
  assert.equal(restored.assets[0]?.name, 'goodall.mp4')
})

test('autosaving never touches the project file, byte for byte', async () => {
  const { file, fallback } = scene()
  const before = readFileSync(file)
  const project = await readProjectFile(file)
  const wrote = await writeSidecar({ ...project, name: 'Changed since the save' }, fallback, SAVED_AT + 5_000)
  assert.equal(wrote, `${file}.autosave`)
  assert.ok(readFileSync(file).equals(before), 'the saved project must be untouched')
  // And what it wrote is what the next launch reads: the stamp it was given, the changed work.
  const offer = await checkRecovery(opened(file), fallback)
  assert.equal(offer?.state === 'newer' ? offer.autosavedAt : null, SAVED_AT + 5_000)
  assert.equal((await readSidecar(wrote, file)).name, 'Changed since the save')
})

test('a project never saved is listed from bay’s folder, newest first, and restores with no file', async () => {
  const { fallback } = scene()
  const other = stamped(SAVED_AT + 9_000).replace('"id": "prj_fixed"', '"id": "prj_later"').replace('"name": "Fixture"', '"name": "Later"')
  writeFileSync(join(fallback, 'prj_fixed.bay.autosave'), stamped(SAVED_AT + 1_000))
  writeFileSync(join(fallback, 'prj_later.bay.autosave'), other)
  writeFileSync(join(fallback, 'prj_torn.bay.autosave'), '{"id": "prj_torn", "timel')
  writeFileSync(join(fallback, 'notes.txt'), 'not a sidecar')
  const offers = await listUnsaved(fallback)
  assert.deepEqual(
    offers.map((offer) => [offer.state, offer.target.id, offer.name]),
    [
      ['newer', 'prj_later', 'Later'],
      ['newer', 'prj_fixed', 'Fixture'],
      ['unreadable', 'prj_torn', null]
    ]
  )
  assert.ok(offers.every((offer) => offer.target.filePath === null))
  assert.equal(recoverySentence(offers[0]!, '3 minutes ago', null), '“Later” was never saved. bay kept it from 3 minutes ago.')
  assert.match(recoverySentence(offers[2]!, '', null), /^Unsaved work bay kept could not be read: .* The file is still at .*prj_torn\.bay\.autosave\.$/)
  const restored = await readSidecar(sidecarPathFor(offers[1]!.target, fallback), null)
  assert.equal(restored.filePath, null)
  assert.equal(restored.id, 'prj_fixed')
})

test('a folder that is not there lists nothing rather than failing the projects screen', async () => {
  assert.deepEqual(await listUnsaved(join(tmpdir(), 'bay-recovery-absent-folder-that-was-never-made')), [])
})

test('saving clears the sidecar beside the file, beside the file it came from, and the never-saved one', async () => {
  const { dir, file, fallback } = scene()
  const copy = join(dir, 'film copy.bay')
  const unrelated = join(dir, 'other.bay.autosave')
  for (const path of [`${file}.autosave`, `${copy}.autosave`, join(fallback, 'prj_fixed.bay.autosave'), unrelated]) {
    writeFileSync(path, stamped(SAVED_AT + 60_000))
  }
  await clearSidecarsAfterSave({ id: 'prj_fixed', filePath: file }, copy, fallback)
  assert.deepEqual(
    [existsSync(`${file}.autosave`), existsSync(`${copy}.autosave`), existsSync(join(fallback, 'prj_fixed.bay.autosave'))],
    [false, false, false]
  )
  assert.ok(existsSync(unrelated), 'another project’s sidecar is not this save’s to remove')
  assert.ok(existsSync(file), 'and the project file is never removed')
  // Nothing there to clear is not an error: most saves have no sidecar.
  await clearSidecarsAfterSave({ id: 'prj_fixed', filePath: file }, copy, fallback)
})

test('discarding removes only the sidecar; discarding one that is gone is not an error', async () => {
  const { file, fallback } = scene()
  writeFileSync(`${file}.autosave`, stamped(SAVED_AT + 60_000))
  await removeSidecar({ id: 'prj_fixed', filePath: file }, fallback)
  assert.equal(existsSync(`${file}.autosave`), false)
  assert.ok(existsSync(file))
  await removeSidecar({ id: 'prj_fixed', filePath: file }, fallback)
})

test('a sidecar that will not load is moved aside, not deleted, and is no longer in autosave’s way', async () => {
  const { dir, file, fallback } = scene()
  writeFileSync(`${file}.autosave`, '{"torn":')
  const kept = await setSidecarAside({ id: 'prj_fixed', filePath: file }, fallback, 1234)
  assert.equal(kept, `${file}.autosave.unreadable-1234`)
  assert.equal(readFileSync(kept, 'utf8'), '{"torn":')
  assert.equal(await checkRecovery(opened(file), fallback), null)
  assert.deepEqual(readdirSync(dir).sort(), ['autosave', 'film.bay', 'film.bay.autosave.unreadable-1234'])
})
