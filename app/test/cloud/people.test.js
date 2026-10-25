import { describe, it, expect, afterEach } from 'vitest'
import { byMe, isMine, me, nameOf, peopleOf, sharing } from '@/cloud/people.js'
import { authorOf } from '@/editor/comments.js'
import { postsOf } from '@/ai/tools/commentReads.js'

const SHARED = {
  me: 2,
  projects: {
    story_1: {
      role: 'member',
      owner: 1,
      members: [
        { account: 1, owner: true, display: 'Ada' },
        { account: 2, owner: false, display: 'Grace' },
        { account: 3, owner: false, display: null },
      ],
    },
  },
}

afterEach(() => {
  me.value = null
  sharing.value = { me: null, projects: {}, selective: [] }
})

describe('people', () => {
  it('stamps a post with the account it was written as, once signed in', () => {
    expect(byMe({ author: 'writer', text: 'Hm.' })).toEqual({ author: 'writer', text: 'Hm.' })
    me.value = 2
    expect(byMe({ author: 'writer', text: 'Hm.' })).toEqual({
      author: 'writer',
      text: 'Hm.',
      by: 2,
    })
  })

  it('names a project’s people only where it is shared', () => {
    expect(peopleOf('story_1')).toBeNull()
    sharing.value = SHARED
    expect(peopleOf('story_1')).toEqual({
      me: 2,
      owner: 1,
      names: { 1: 'Ada', 2: 'Grace', 3: null },
    })
    expect(peopleOf('story_2')).toBeNull()
  })

  it('takes a post with no account for the owner’s, and names the others', () => {
    sharing.value = SHARED
    const people = /** @type {import('@/cloud/people.js').People} */ (peopleOf('story_1'))
    const before = { author: 'writer', text: 'From before.' }
    const mine = { author: 'writer', by: 2, text: 'Mine.' }
    const theirs = { author: 'writer', by: 3, text: 'Theirs.' }
    expect(isMine(before, people)).toBe(false)
    expect(isMine(mine, people)).toBe(true)
    expect(isMine({ author: 'model', text: 'Hi.' }, people)).toBe(false)
    expect(nameOf(before, people)).toBe('Ada')
    expect(authorOf(before, people)).toBe('Ada')
    expect(authorOf(mine, people)).toBe('You')
    expect(authorOf(theirs, people)).toBe('Someone')
    expect(authorOf(before)).toBe('You')
    expect(isMine(theirs, null)).toBe(true)
  })

  it('tells the model whose each post is', () => {
    sharing.value = SHARED
    const thread = {
      status: 'open',
      quote: 'the wall',
      posts: [
        { author: 'writer', text: 'Too easy?', created: 1 },
        { author: 'writer', by: 2, text: 'Agreed.', created: 2 },
        { author: 'model', text: 'Add a guard.', created: 3 },
      ],
    }
    expect(
      postsOf(/** @type {any} */ (thread), null, peopleOf('story_1')).map(post => post.author)
    ).toEqual(['Ada', 'writer', 'model'])
    expect(postsOf(/** @type {any} */ (thread), null).map(post => post.author)).toEqual([
      'writer',
      'writer',
      'model',
    ])
  })
})
