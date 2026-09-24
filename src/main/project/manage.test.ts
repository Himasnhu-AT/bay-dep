import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canonicalRecents, copyName, displayFolder, nameFromPath, projectStems, refuseUnlisted, renamedPath } from './manage'

const listed = ['/Users/me/Movies/bay/Trip.bay', '/Users/me/Movies/bay/Other.bay']

test('only a .bay on the projects list may be renamed, duplicated or trashed', () => {
  // Positive control: the listed project is accepted.
  assert.equal(refuseUnlisted('/Users/me/Movies/bay/Trip.bay', listed), null)
  // Built by concatenation so it is not normalised before the check sees it.
  const sneaky = '/Users/me/Movies/bay' + '/../bay/Trip.bay'
  assert.notEqual(sneaky, listed[0])
  assert.equal(refuseUnlisted(sneaky, listed), null)

  const key = refuseUnlisted('/Users/me/.ssh/id_rsa', listed)
  assert.match(key ?? '', /not a bay project/)
  const unlisted = refuseUnlisted('/Users/me/Desktop/Secret.bay', listed)
  assert.match(unlisted ?? '', /not on the projects list/)
  // A listed path's neighbour through traversal is not the listed file.
  assert.match(refuseUnlisted('/Users/me/Movies/bay' + '/../Trip.bay', listed) ?? '', /not on the projects list/)
  assert.match(refuseUnlisted('', listed) ?? '', /No project/)
})

test('a rename moves the file to the new name when it is free', () => {
  assert.equal(renamedPath('/p/Trip.bay', 'Holiday', ['Trip', 'Other']), '/p/Holiday.bay')
})

test('a rename never takes another project\'s file name, in any case', () => {
  // The Mac disk is case-insensitive: "other" is Other.bay.
  assert.equal(renamedPath('/p/Trip.bay', 'other', ['Trip', 'Other']), '/p/Trip.bay')
  assert.equal(renamedPath('/p/Trip.bay', 'OTHER', ['Trip', 'Other']), '/p/Trip.bay')
})

test('a rename that only changes case of its own name still renames', () => {
  assert.equal(renamedPath('/p/Trip.bay', 'trip', ['Trip', 'Other']), '/p/trip.bay')
})

test('a rename strips characters a file name cannot hold', () => {
  assert.equal(renamedPath('/p/Trip.bay', 'a/b:c', ['Trip']), '/p/a-b-c.bay')
  assert.equal(renamedPath('/p/Trip.bay', '...', ['Trip']), '/p/Trip.bay')
})

test('a duplicate is named "<name> copy", numbered past existing copies case-insensitively', () => {
  assert.equal(copyName('Trip', ['Trip']), 'Trip copy')
  assert.equal(copyName('Trip', ['Trip', 'trip COPY']), 'Trip copy 2')
  assert.equal(copyName('Trip', ['Trip', 'Trip copy', 'Trip copy 2']), 'Trip copy 3')
})

test('project stems come from .bay files only', () => {
  assert.deepEqual(projectStems(['A.bay', 'b.BAY', 'c.bay.autosave', 'd.txt']), ['A', 'b'])
})

test('the list shows the folder with home as ~', () => {
  assert.equal(displayFolder('/Users/me/Movies/bay/Trip.bay', '/Users/me'), '~/Movies/bay')
  assert.equal(displayFolder('/Users/me/Trip.bay', '/Users/me'), '~')
  // A sibling whose name starts like home is not inside it.
  assert.equal(displayFolder('/Users/meg/Trip.bay', '/Users/me'), '/Users/meg')
})

test('Save As names the project after its new file', () => {
  assert.equal(nameFromPath('/Users/me/Movies/bay/Saved As Copy.bay', 'Wild Sage Hare'), 'Saved As Copy')
  assert.equal(nameFromPath('/Users/me/Movies/bay/Trip.BAY', 'Old'), 'Trip')
  // A file called just ".bay" has no name to take; the project keeps its own.
  assert.equal(nameFromPath('/Users/me/Movies/bay/.bay', 'Old'), 'Old')
})

test('recents are one row per real file: an alias folds into the newest row, under its real path', () => {
  // The verification run: one file opened as /tmp/… and as /private/tmp/… was listed twice.
  const real = (path: string): string => (path.startsWith('/tmp/') ? `/private${path}` : path)
  const rows = [
    { filePath: '/tmp/v/Golden Sage Vole.bay', name: 'Golden Sage Vole', updatedAt: 3 },
    { filePath: '/private/tmp/v/Golden Sage Vole.bay', name: 'Golden Sage Vole', updatedAt: 2 },
    { filePath: '/Users/me/Movies/bay/Trip.bay', name: 'Trip', updatedAt: 1 }
  ]
  const out = canonicalRecents(rows, real)
  assert.deepEqual(
    out.rows.map((row) => [row.filePath, row.updatedAt]),
    [
      ['/private/tmp/v/Golden Sage Vole.bay', 3],
      ['/Users/me/Movies/bay/Trip.bay', 1]
    ]
  )
  // Both old keys go (the alias, and the older real row), and the newest is written back under
  // its real path — so the database agrees with the list the screen shows.
  assert.deepEqual(out.forget.sort(), ['/private/tmp/v/Golden Sage Vole.bay', '/tmp/v/Golden Sage Vole.bay'])
  assert.deepEqual(out.rekey.map((row) => row.filePath), ['/private/tmp/v/Golden Sage Vole.bay'])
  // Positive control: rows that are already real are left alone, and nothing is rewritten.
  const clean = canonicalRecents(rows.slice(1), real)
  assert.equal(clean.rows.length, 2)
  assert.deepEqual(clean.forget, [])
  assert.deepEqual(clean.rekey, [])
})
