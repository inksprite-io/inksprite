import { describe, it, expect } from 'vitest'
import {
  pictureHref,
  pictureKey,
  pictureOf,
  pictureName,
  pictureOfKey,
  picturesIn,
  repointPictures,
  unreferencedPictures,
} from '@/utils/pictures.js'

describe('pictureHref', () => {
  it('writes a picture as the path from its document, its name encoded', () => {
    expect(pictureHref('doc_a1', 'market map.png')).toBe('.images/doc_a1/market%20map.png')
    expect(pictureHref('doc_a1', 'gate (2).png')).toBe('.images/doc_a1/gate%20%282%29.png')
    expect(pictureHref('doc_a1', 'café.jpg')).toBe('.images/doc_a1/caf%C3%A9.jpg')
  })
})

describe('pictureOf', () => {
  it('reads a path back to its document and name', () => {
    expect(pictureOf('.images/doc_a1/market%20map.png')).toEqual({
      documentId: 'doc_a1',
      name: 'market map.png',
    })
    expect(pictureOf(pictureHref('doc_a1', 'gate (2).png'))?.name).toBe('gate (2).png')
  })

  it('reads it by the id, whatever comes before', () => {
    expect(pictureOf('../Act 1/.images/doc_a1/gate.png')).toEqual({
      documentId: 'doc_a1',
      name: 'gate.png',
    })
    expect(pictureOf('/Notes/.images/doc_a1/gate.png')?.documentId).toBe('doc_a1')
  })

  it('reads one written in <…> with its spaces left in', () => {
    expect(pictureOf('<.images/doc_a1/market map.png>')?.name).toBe('market map.png')
  })

  it('takes a % that starts no escape as a %', () => {
    expect(pictureOf('.images/doc_a1/50%.png')?.name).toBe('50%.png')
  })

  it('finds nothing in a link to a file document or an address on the web', () => {
    expect(pictureOf('Maps/gate.png')).toBe(null)
    expect(pictureOf('https://example.com/gate.png')).toBe(null)
    expect(pictureOf('.images/doc_a1')).toBe(null)
    expect(pictureOf('.images/doc_a1/')).toBe(null)
    expect(pictureOf('')).toBe(null)
    expect(pictureOf(null)).toBe(null)
  })
})

describe('pictureKey', () => {
  it('keys the bytes by document and name, and reads the key back', () => {
    expect(pictureKey('doc_a1', 'gate.png')).toBe('doc_a1/gate.png')
    expect(pictureOfKey('doc_a1/gate.png')).toEqual({ documentId: 'doc_a1', name: 'gate.png' })
  })

  it("does not take a file document's own key for a picture's", () => {
    expect(pictureOfKey('doc_a1')).toBe(null)
  })
})

describe('picturesIn', () => {
  it('finds every picture the text refers to, decoded', () => {
    const text = [
      'The gate ![](.images/doc_a1/gate.png) stood.',
      '![A map](.images/doc_a1/market%20map.png "The market")',
      '![](<.images/doc_b2/old wall.png>)',
      '{==the ![](.images/doc_a1/well.png) well==}{>>cabcd<<}',
      '![](Maps/gate.png) and ![](https://example.com/x.png)',
    ].join('\n\n')
    expect([...picturesIn(text)].sort()).toEqual(
      ['doc_a1/gate.png', 'doc_a1/market map.png', 'doc_a1/well.png', 'doc_b2/old wall.png'].sort()
    )
  })

  it('finds nothing in text with no pictures', () => {
    expect(picturesIn('Only words.').size).toBe(0)
    expect(picturesIn('').size).toBe(0)
    expect(picturesIn(undefined).size).toBe(0)
  })
})

describe('repointPictures', () => {
  it("makes one document's paths another's, and leaves the rest", () => {
    const text = '![](.images/doc_a1/gate.png) ![](.images/doc_a12/gate.png) ![](gate.png)'
    expect(repointPictures(text, 'doc_a1', 'doc_c3')).toBe(
      '![](.images/doc_c3/gate.png) ![](.images/doc_a12/gate.png) ![](gate.png)'
    )
  })
})

describe('unreferencedPictures', () => {
  it('names the pictures no text refers to', () => {
    const pictures = { 'gate.png': { mime: 'image/png' }, 'wall.png': { mime: 'image/png' } }
    expect(unreferencedPictures('doc_a1', pictures, new Set(['doc_a1/gate.png']))).toEqual([
      'wall.png',
    ])
    expect(unreferencedPictures('doc_a1', undefined, new Set())).toEqual([])
  })
})

describe('pictureName', () => {
  it('keeps the name a picture came with, numbered when the document has it', () => {
    const taken = new Set()
    expect(pictureName('market map.png', 'image/png', taken)).toBe('market map.png')
    expect(pictureName('Market Map.png', 'image/png', taken)).toBe('Market Map (2).png')
  })

  it('calls one with no name image, and gives one with no extension its own', () => {
    const taken = new Set()
    expect(pictureName(undefined, 'image/png', taken)).toBe('image.png')
    expect(pictureName('', 'image/png', taken)).toBe('image (2).png')
    expect(pictureName('image1', 'image/jpeg', taken)).toBe('image1.jpg')
    expect(pictureName('photo', 'image/heic', taken)).toBe('photo.heic')
  })

  it('makes a name safe for a file', () => {
    expect(pictureName('.hidden/map:1.png', 'image/png', new Set())).toBe('hidden-map-1.png')
  })
})
