import { test } from 'node:test'
import assert from 'node:assert/strict'
import { copyName, displayFolder, projectStems, refuseUnlisted, renamedPath } from './manage'

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
