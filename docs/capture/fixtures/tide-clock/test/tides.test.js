import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nextHighTide } from '../src/tides.js'

test('the first high tide of the year at North Point', () => {
  const next = nextHighTide(new Date(Date.UTC(2026, 0, 1, 0, 0)), 'north-point')
  assert.equal(next.toISOString(), '2026-01-01T04:12:00.000Z')
})
