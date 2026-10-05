import { describe, it, expect } from 'vitest'
import { withoutModelKeeps } from '@/stores/migrations/modelKeeps.js'
import { upgradeTables } from '@/utils/backup.js'

describe('withoutModelKeeps', () => {
  it('takes the model’s keeps off the pins, and leaves the writer’s', () => {
    const { chats, moved } = withoutModelKeeps([
      { id: 'c1', pinnedIds: ['mine', 'its'], keptIds: ['its'] },
    ])

    expect(moved).toBe(1)
    expect(chats).toEqual([{ id: 'c1', pinnedIds: ['mine'] }])
  })

  it('leaves no empty pin list behind', () => {
    const { chats } = withoutModelKeeps([{ id: 'c1', pinnedIds: ['its'], keptIds: ['its'] }])

    expect(chats).toEqual([{ id: 'c1' }])
  })

  it('leaves a chat with no keeps as it is, so it can run twice', () => {
    const chat = { id: 'c1', pinnedIds: ['mine'], hiddenIds: ['x'] }
    const { chats, moved } = withoutModelKeeps([chat])

    expect(moved).toBe(0)
    expect(chats[0]).toBe(chat)
  })

  it('runs on a backup from before', () => {
    const tables = upgradeTables(
      { chats: [{ id: 'c1', pinnedIds: ['mine', 'its'], keptIds: ['its'] }] },
      22,
      23
    )

    expect(tables.chats).toEqual([{ id: 'c1', pinnedIds: ['mine'] }])
  })
})
