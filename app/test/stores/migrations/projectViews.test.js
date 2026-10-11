import { describe, it, expect } from 'vitest'
import { viewsOffStories } from '@/stores/migrations/projectViews.js'
import { upgradeTables } from '@/utils/backup.js'

const layout = { sidebar: true, editor: true, chat: false, sidebarTab: 'outline' }

describe('viewsOffStories', () => {
  it('takes the tabs and the panels off the story, into a view under its id', () => {
    const { stories, views, moved } = viewsOffStories([
      {
        id: 's1',
        overview: '',
        options: {},
        lastDocumentId: 'd2',
        openDocumentIds: ['d1', 'd2'],
        previewDocumentId: null,
        layout,
        version: 7,
        updated: 500,
      },
    ])

    expect(moved).toBe(1)
    expect(stories).toEqual([{ id: 's1', overview: '', options: {}, version: 7, updated: 500 }])
    expect(views).toEqual([
      {
        id: 's1',
        version: 1,
        updated: 500,
        lastDocumentId: 'd2',
        openDocumentIds: ['d1', 'd2'],
        previewDocumentId: null,
        layout,
      },
    ])
  })

  it('keeps a story from before tabs reopening on its last document', () => {
    const { views } = viewsOffStories([{ id: 's1', lastDocumentId: 'd1', updated: 1 }])

    expect(views).toEqual([{ id: 's1', version: 1, updated: 1, lastDocumentId: 'd1' }])
  })

  it('leaves a story with none of it as it is, so it can run twice', () => {
    const story = { id: 's1', overview: '', updated: 1 }
    const { stories, views, moved } = viewsOffStories([story])

    expect(moved).toBe(0)
    expect(stories[0]).toBe(story)
    expect(views).toEqual([])
  })

  it('runs on a backup from before', () => {
    const tables = upgradeTables(
      { stories: [{ id: 's1', lastDocumentId: 'd1', openDocumentIds: ['d1'], updated: 9 }] },
      26,
      27
    )

    expect(tables.stories).toEqual([{ id: 's1', updated: 9 }])
    expect(tables.projectViews).toEqual([
      { id: 's1', version: 1, updated: 9, lastDocumentId: 'd1', openDocumentIds: ['d1'] },
    ])
  })

  it('leaves a chat on its own as it is', () => {
    const chat = { chats: [{ id: 'c1' }], messages: [] }
    expect(upgradeTables(chat, 26, 27)).toEqual(chat)
  })
})
