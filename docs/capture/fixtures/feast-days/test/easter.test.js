import { test } from 'node:test'
import assert from 'node:assert/strict'
import { easter } from '../src/easter.js'

test('Easter in 1500', () => {
  assert.deepEqual(easter(1500), { month: 4, day: 19 })
})
