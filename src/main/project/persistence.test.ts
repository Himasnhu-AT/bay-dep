/**
 * Tests for `.bay` persistence and for which project opens at launch.
 *
 * The headline case is the one that failed in the real app and that no test could see: seed
 * `lastProjectPath`, relaunch, get that project back. It was broken for a reason nothing in
 * the suite could reach — `better-sqlite3` could not load under Electron at all, so the
 * database handle was always null, `initial()` always fell through to a fresh project, and
 * every test passed because they ran under plain Node where the module loaded fine.
 *
 * Two things follow, and both are the design of this file rather than incidental to it.
 * The database is now `node:sqlite`, so these tests exercise the module that actually ships.
 * And `resolveInitialProject` takes the database as an argument, so the null-handle case —
 * the one that silently produced Untitled forever — is a case you can write down.
 *
 * Mutation-tested: the `exists` check dropped, the fallback-to-fresh path removed, the
 * `lastProjectPath` key changed, and the version guard disabled. All fail here.
 *
 * Run with `pnpm test`, or on its own:
 *   node --import ./src/test-hooks.mjs --test src/main/project/persistence.test.ts
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Project } from '@shared/project'
import { PROJECT_VERSION } from '@shared/project'
import { openDatabase } from './db'
import {
  LAST_PROJECT_KEY,
  autosavePathFor,
  freshProject,
  migrate,
  readProjectFile,
  resolveInitialProject,
  writeProjectFile
} from './persistence'

function scratch(): string {
  return mkdtempSync(join(tmpdir(), 'bay-persist-'))
}

function namedProject(name: string): Project {
  return { ...freshProject(), name }
}

/** A real on-disk database, as the app would have. */
function realDatabase(dir: string) {
  const result = openDatabase(join(dir, 'app.db'))
  assert.equal(result.error, null, 'the test database itself must open')
  assert.notEqual(result.db, null)
  return result.db!
}

// ---------------------------------------------------------------------------
// The launch round trip — the case that was broken in the shipped app
// ---------------------------------------------------------------------------

test('the last opened project is what comes back at launch', async () => {
  const dir = scratch()
  const db = realDatabase(dir)

  const saved = await writeProjectFile(namedProject('Goodall cut'), join(dir, 'goodall.bay'))
  db.setState(LAST_PROJECT_KEY, saved.filePath!)

  // A second `openDatabase` on the same file stands in for the relaunch: nothing is carried
  // over in memory, exactly as when the app is started again.
  db.close()
  const reopened = realDatabase(dir)

  const project = await resolveInitialProject(reopened)
  assert.equal(project.name, 'Goodall cut')
  assert.equal(project.filePath, saved.filePath)
  reopened.close()
})

test('the last-project key is pinned, because it lives in the user’s database', () => {
  // Written as a literal on purpose. Every other test reads and writes through the constant,
  // so renaming it moves both sides together and nothing notices — while on a real machine
  // the new key finds nothing and every existing user silently loses their last project on
  // upgrade. That is a compatibility surface, so it gets pinned the way a wire format does.
  assert.equal(LAST_PROJECT_KEY, 'lastProjectPath')
})

test('a null database yields a fresh project rather than throwing', async () => {
  // This is the state the app was actually in. It must stay non-fatal — and it must be the
  // *only* way to reach Untitled when a last project was recorded.
  const project = await resolveInitialProject(null)
  assert.equal(project.name, 'Untitled')
  assert.equal(project.filePath, null)
})

test('a remembered project whose file has been deleted falls back to a fresh one', async () => {
  const dir = scratch()
  const db = realDatabase(dir)
  db.setState(LAST_PROJECT_KEY, join(dir, 'moved-to-the-bin.bay'))

  const project = await resolveInitialProject(db)
  assert.equal(project.name, 'Untitled')
  db.close()
})

test('a remembered project that will not parse does not stop bay opening', async () => {
  const dir = scratch()
  const db = realDatabase(dir)
  const broken = join(dir, 'half-written.bay')
  writeFileSync(broken, '{"assets": [', 'utf8')
  db.setState(LAST_PROJECT_KEY, broken)

  const project = await resolveInitialProject(db)
  assert.equal(project.name, 'Untitled')
  db.close()
})

// ---------------------------------------------------------------------------
// Recents
// ---------------------------------------------------------------------------

test('recents come back newest first and survive reopening the database', async () => {
  const dir = scratch()
  const db = realDatabase(dir)
  db.rememberRecent({ filePath: '/a.bay', id: 'p1', name: 'Older', updatedAt: 1000 })
  db.rememberRecent({ filePath: '/b.bay', id: 'p2', name: 'Newer', updatedAt: 2000 })
  db.close()

  const reopened = realDatabase(dir)
  const rows = reopened.listRecent(10)
  assert.deepEqual(
    rows.map((r) => r.name),
    ['Newer', 'Older']
  )
  assert.equal(rows[0]?.filePath, '/b.bay')
  reopened.close()
})

test('re-saving a project updates its row rather than adding a second one', async () => {
  const dir = scratch()
  const db = realDatabase(dir)
  db.rememberRecent({ filePath: '/a.bay', id: 'p1', name: 'First name', updatedAt: 1000 })
  db.rememberRecent({ filePath: '/a.bay', id: 'p1', name: 'Renamed', updatedAt: 3000 })

  const rows = db.listRecent(10)
  assert.equal(rows.length, 1)
  assert.equal(rows[0]?.name, 'Renamed')
  db.close()
})

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

test('a saved project is readable JSON on disk, not an opaque blob', async () => {
  // The user has to be able to see and back up their own work; this is the property that
  // makes the format a promise rather than an implementation detail.
  const dir = scratch()
  const target = join(dir, 'readable.bay')
  await writeProjectFile(namedProject('Readable'), target)

  const parsed = JSON.parse(readFileSync(target, 'utf8')) as Project
  assert.equal(parsed.name, 'Readable')
  assert.equal(parsed.version, PROJECT_VERSION)
  assert.ok(Array.isArray(parsed.timelines))
})

/**
 * A version-1 `.bay` file, written out as a literal.
 *
 * The round-trip test below cannot hold the format still: it writes and reads through the
 * same code, so renaming `durationInFrames` to `duration` would move both sides together and
 * still pass — while every project already on a user's disk stopped loading. This fixture is
 * the fixed point. Every key here is a promise made to files that already exist.
 */
const V1_ON_DISK = `{
  "id": "prj_fixed",
  "name": "Fixture",
  "version": 1,
  "assets": [
    {
      "id": "asset_1",
      "kind": "video",
      "name": "goodall.mp4",
      "path": "/footage/goodall.mp4",
      "durationUs": 67833333,
      "width": 1080,
      "height": 1920,
      "fps": 30,
      "hasAudio": true,
      "hasVideo": true,
      "posterPath": null,
      "waveformPath": null,
      "createdAt": 1700000000000
    }
  ],
  "timelines": [
    {
      "id": "tl_1",
      "name": "Timeline 1",
      "fps": 30,
      "width": 1080,
      "height": 1920,
      "background": "#000000",
      "tracks": [
        {
          "id": "trk_v1",
          "kind": "video",
          "name": "V1",
          "locked": false,
          "muted": false,
          "hidden": false,
          "items": [
            {
              "id": "item_1",
              "assetId": "asset_1",
              "trackId": "trk_v1",
              "from": 0,
              "durationInFrames": 150,
              "sourceStartUs": 20000000,
              "layout": {
                "left": 0,
                "top": 0,
                "width": 1080,
                "height": 1920,
                "opacity": 1,
                "rotation": 0
              },
              "volume": 1,
              "fadeInFrames": 15,
              "fadeOutFrames": 15,
              "speed": 1
            }
          ]
        }
      ]
    }
  ],
  "activeTimelineId": "tl_1",
  "createdAt": 1700000000000,
  "updatedAt": 1700000000001
}`

test('a .bay file already on disk still loads, field for field', async () => {
  const dir = scratch()
  const target = join(dir, 'existing.bay')
  writeFileSync(target, V1_ON_DISK, 'utf8')

  const project = await readProjectFile(target)
  assert.equal(project.name, 'Fixture')
  assert.equal(project.activeTimelineId, 'tl_1')

  const asset = project.assets[0]
  assert.equal(asset?.path, '/footage/goodall.mp4')
  assert.equal(asset?.durationUs, 67833333)
  assert.equal(asset?.hasAudio, true)
  assert.equal(asset?.posterPath, null)

  const timeline = project.timelines[0]
  assert.equal(timeline?.fps, 30)
  assert.equal(timeline?.background, '#000000')

  const item = timeline?.tracks[0]?.items[0]
  assert.equal(item?.from, 0)
  assert.equal(item?.durationInFrames, 150)
  assert.equal(item?.sourceStartUs, 20000000)
  assert.equal(item?.fadeInFrames, 15)
  assert.equal(item?.speed, 1)
  assert.equal(item?.layout.opacity, 1)
  assert.equal(item?.layout.height, 1920)
})

test('what bay writes today is still loadable by the version-1 reader', async () => {
  // The other direction: today's writer must not emit something the fixture's shape would
  // not recognise. Compares key sets rather than values, since ids and timestamps differ.
  const dir = scratch()
  const written = join(dir, 'written.bay')
  await writeProjectFile(namedProject('Today'), written)

  const fresh = JSON.parse(readFileSync(written, 'utf8')) as Record<string, unknown>
  const onDisk = JSON.parse(V1_ON_DISK) as Record<string, unknown>
  for (const key of Object.keys(onDisk)) {
    assert.ok(key in fresh, `today's writer no longer emits "${key}" — old readers will break`)
  }
})

test('a project round-trips through write and read unchanged', async () => {
  const dir = scratch()
  const target = join(dir, 'round-trip.bay')
  const written = await writeProjectFile(namedProject('Round trip'), target)
  const read = await readProjectFile(target)

  assert.equal(read.name, written.name)
  assert.equal(read.id, written.id)
  assert.equal(read.activeTimelineId, written.activeTimelineId)
  assert.equal(read.timelines[0]?.tracks.length, 2)
})

test('saving stamps the path onto the project', async () => {
  const dir = scratch()
  const target = join(dir, 'stamped.bay')
  const written = await writeProjectFile(freshProject(), target)
  assert.equal(written.filePath, target)
})

test('a project from a newer bay is refused with the version in the message', () => {
  assert.throws(
    () => migrate({ version: PROJECT_VERSION + 1, assets: [], timelines: [] }, '/x/new.bay'),
    /newer version of bay/
  )
})

test('a file that is not a project is refused', () => {
  assert.throws(() => migrate({ hello: 'world' }, '/x/notes.bay'), /missing its timelines/)
  assert.throws(() => migrate('a string', '/x/notes.bay'), /is not a bay project/)
})

test('a version-less project is adopted at the current version', () => {
  const adopted = migrate({ assets: [], timelines: [] }, '/x/old.bay')
  assert.equal(adopted.version, PROJECT_VERSION)
})

// ---------------------------------------------------------------------------
// Autosave
// ---------------------------------------------------------------------------

test('autosave writes a sidecar beside a saved project, never over it', () => {
  // Overwriting `project.bay` — atomically or not — gives up the guarantee that a crash
  // during autosave cannot cost the user the version they deliberately saved.
  const project: Project = { ...freshProject(), filePath: '/work/film.bay' }
  const target = autosavePathFor(project, '/fallback')
  assert.equal(target, '/work/film.bay.autosave')
  assert.notEqual(target, project.filePath)
})

test('an unsaved project autosaves into the fallback directory under its own id', () => {
  const project = freshProject()
  const target = autosavePathFor(project, '/fallback')
  assert.equal(target, `/fallback/${project.id}.bay.autosave`)
})
