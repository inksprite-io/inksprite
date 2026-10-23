import { describe, it, expect, beforeEach } from 'vitest'
import { linkTargets, relinked } from '@/utils/linkUpdates.js'

/** A small project, made again for each test: the tests change it. */
const project = () => [
  { id: 'root_s', parentId: 's', type: 'folder', title: 'Novel' },
  { id: 'notes', parentId: 'root_s', type: 'folder', title: 'Notes' },
  { id: 'cast', parentId: 'notes', type: 'text', title: 'Cast list' },
  { id: 'photo', parentId: 'notes', type: 'file', title: 'Harbour', mime: 'image/png' },
  { id: 'drafts', parentId: 'root_s', type: 'folder', title: 'Drafts' },
  { id: 'one', parentId: 'drafts', type: 'text', title: 'Chapter 1' },
  { id: 'paren', parentId: 'drafts', type: 'text', title: 'Asides (cut)' },
]

/** @type {ReturnType<typeof project>} */
let docs
const tree = {
  get: id => docs.find(doc => doc.id === id) ?? null,
  childrenOf: parentId => docs.filter(doc => doc.parentId === parentId),
  rootId: 'root_s',
}

/** Change a document in the project. */
const change = (id, fields) => Object.assign(tree.get(id), fields)

/**
 * The texts, read for their links, the tree changed, and what they say after.
 *
 * @param {Record<string, string>} texts - By document
 * @param {() => void} move
 */
const around = (texts, move) => {
  const documents = Object.entries(texts).map(([id, content]) => ({ id, content }))
  const targets = linkTargets(tree, documents)
  move()
  return Object.fromEntries(relinked(tree, documents, targets).map(d => [d.id, d.content]))
}

describe('linkUpdates', () => {
  beforeEach(() => {
    docs = project()
  })

  it('writes again every link to a renamed document, titles and all', () => {
    const after = around(
      {
        one: 'See [the cast](../Notes/Cast%20list.md "who is who"), and [again](../Notes/Cast%20list.md).',
      },
      () => change('cast', { title: 'People' })
    )
    expect(after.one).toBe(
      'See [the cast](../Notes/People.md "who is who"), and [again](../Notes/People.md).'
    )
  })

  it('writes a picture that is a file of the project again', () => {
    const after = around({ one: '![The harbour at dawn](../Notes/Harbour.png)' }, () =>
      change('photo', { parentId: 'drafts' })
    )
    expect(after.one).toBe('![The harbour at dawn](Harbour.png)')
  })

  it('writes a broken link of the writer’s own form in the app’s, encoded', () => {
    const after = around({ cast: 'An [aside](<../Drafts/Asides (cut)>).' }, () =>
      change('paren', { title: 'Asides (kept)' })
    )
    expect(after.cast).toBe('An [aside](../Drafts/Asides%20%28kept%29.md).')
  })

  it('takes a link back to its document when a rename sends it to another', () => {
    // "Cast list" renamed, and another document given its name: the link
    // would now open the newcomer.
    const after = around({ one: '[cast](/Notes/Cast%20list.md)' }, () => {
      change('cast', { title: 'People' })
      docs.push({ id: 'new', parentId: 'notes', type: 'text', title: 'Cast list' })
    })
    expect(after.one).toBe('[cast](/Notes/People.md)')
  })

  it('leaves what still goes where it went, a web address, and a missing document', () => {
    const texts = {
      one: '[cast](/Notes/cast%20LIST) [web](https://example.com/Cast) [gone](../Notes/Nothing.md)',
    }
    expect(around(texts, () => change('drafts', { title: 'Draft' }))).toEqual({})
    expect(linkTargets(tree, [{ id: 'one', content: texts.one }]).get('one')).toEqual(
      new Map([['/Notes/cast%20LIST', { id: 'cast', exact: false }]])
    )
  })

  it('leaves a link to a document no longer in the tree', () => {
    const after = around({ one: '[cast](../Notes/Cast%20list.md)' }, () => {
      docs = docs.filter(doc => doc.id !== 'cast')
    })
    expect(after).toEqual({})
  })
})
