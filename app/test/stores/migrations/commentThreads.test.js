import { describe, it, expect } from 'vitest'
import { threadsOffText } from '@/stores/migrations/commentThreads.js'
import { upgradeTables } from '@/utils/backup.js'

const doc = (id, content, extra = {}) => ({
  id,
  storyId: 'story_1',
  parentId: 'story_1',
  type: 'text',
  title: id,
  content,
  updated: 1700,
  ...extra,
})

describe('threadsOffText', () => {
  it("moves what each comment says onto a thread of the writer's", () => {
    const { documents, moved } = threadsOffText([
      doc('a', 'We had a {==cold and narrow==}{>>c7k2m1: reword this<br>and the tense<<} attic.'),
    ])
    expect(moved).toBe(1)
    expect(documents[0].content).toBe('We had a {==cold and narrow==}{>>c7k2m1<<} attic.')
    expect(documents[0].comments).toEqual({
      c7k2m1: {
        status: 'open',
        quote: 'cold and narrow',
        before: 'We had a ',
        after: ' attic.',
        posts: [{ author: 'writer', text: 'reword this\nand the tense', created: 1700 }],
      },
    })
  })

  it('makes one thread of a comment over two paragraphs', () => {
    const content = 'One {==end==}{>>cabcd: both<<}\n\n{==start==}{>>cabcd: both<<} two.'
    const [brought] = threadsOffText([doc('a', content)]).documents
    expect(brought.content).toBe('One {==end==}{>>cabcd<<}\n\n{==start==}{>>cabcd<<} two.')
    expect(Object.keys(brought.comments)).toEqual(['cabcd'])
    expect(brought.comments.cabcd.quote).toBe('end\n\nstart')
  })

  it('leaves folders, files, and documents already brought forward as they are', () => {
    const folder = { id: 'f', type: 'folder', content: '' }
    const file = doc('b', '{==x==}{>>cabcd: y<<}', { type: 'file' })
    const done = doc('c', 'A {==b==}{>>cabcd<<}.', {
      comments: { cabcd: { status: 'open', quote: 'b', posts: [] } },
    })
    const plain = doc('d', 'Nothing here.')
    const { documents, moved } = threadsOffText([folder, file, done, plain])
    expect(moved).toBe(0)
    expect(documents[0]).toBe(folder)
    expect(documents[1]).toBe(file)
    expect(documents[2]).toBe(done)
    expect(documents[3]).toBe(plain)
  })

  it('brings a backup from schema 29 forward the same way', () => {
    const tables = {
      documents: [doc('a', 'A {==b==}{>>cabcd: note<<} c.')],
      cards: [],
      cardFiles: [],
    }
    const upgraded = upgradeTables(tables, 29, 30)
    expect(upgraded.documents[0].content).toBe('A {==b==}{>>cabcd<<} c.')
    expect(upgraded.documents[0].comments.cabcd.posts[0].text).toBe('note')
    // Twice is once.
    expect(upgradeTables(upgraded, 29, 30)).toEqual(upgraded)
  })
})
