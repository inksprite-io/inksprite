import 'fake-indexeddb/auto'
import { describe, it, expect } from 'vitest'
import db from '../../src/stores/db.js'
import { upgradeTables, validateBackup } from '../../src/utils/backup.js'

describe('the database schema', () => {
  it('can take a backup from any version before it up to its own', () => {
    // A schema version added without a backup upgrade beside it leaves every
    // backup taken before it unrestorable, and nothing else would say so until
    // somebody tried.
    for (let from = 1; from < db.verno; from++) {
      const { ok, errors } = validateBackup(
        { app: 'inksprite', format: 1, dbVersion: from, exported: 0, tables: {} },
        db.verno
      )
      expect(errors, `from version ${from}`).toEqual([])
      expect(ok).toBe(true)
    }
    expect(() => upgradeTables({}, 1, db.verno)).not.toThrow()
  })
})
