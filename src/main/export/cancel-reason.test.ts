import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cancelFailureStage } from './cancel-reason'

const running = { stage: 'rendering' as const, failed: false }

test("a cancel the renderer makes because it failed is counted, at the stage it names or main's last", () => {
  assert.equal(cancelFailureStage({ failed: true, stage: 'encoding' }, running), 'encoding')
  assert.equal(cancelFailureStage({ failed: true }, running), 'rendering')
  // A stage that is not one of the contract's is not sent; main's own is.
  assert.equal(cancelFailureStage({ failed: true, stage: '/Users/alice/cut.mov' }, running), 'rendering')
})

test("a user's cancel is not a failure, nor is anything that is not exactly { failed: true } (negative controls)", () => {
  for (const reason of [undefined, null, {}, { failed: 'yes' }, { failed: 1 }, 'failed', true]) {
    assert.equal(cancelFailureStage(reason, running), null, JSON.stringify(reason))
  }
})

test('a job main already failed was counted then, and is not counted again by its cancel', () => {
  assert.equal(cancelFailureStage({ failed: true }, { stage: 'encoding', failed: true }), null)
})
