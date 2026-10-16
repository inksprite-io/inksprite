import { describe, it, expect } from 'vitest'
import { orderSiblings } from '@/utils/siblingOrder.js'

const doc = (id, title, type = 'text', order = 0) => ({ id, title, type, order })

describe('orderSiblings', () => {
  it('puts folders first, then sorts by name, numbers by value, the unnamed as Untitled', () => {
    const children = [
      doc('a', 'Chapter 10'),
      doc('b', 'Chapter 2'),
      doc('c', 'Zeta', 'folder'),
      doc('d', ''),
      doc('e', 'Alpha', 'folder'),
    ]
    expect(orderSiblings(children).map(child => child.id)).toEqual(['e', 'c', 'b', 'a', 'd'])
  })

  it('keeps an ordered folder’s own order', () => {
    const children = [
      doc('a', 'A', 'text', 2),
      doc('b', 'B', 'folder', 3),
      doc('c', 'C', 'text', 1),
    ]
    expect(orderSiblings(children, true).map(child => child.id)).toEqual(['c', 'a', 'b'])
  })
})
