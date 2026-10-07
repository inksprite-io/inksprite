/* global atob */
import { describe, it, expect } from 'vitest'
import { takeImages } from '@/drive/images.js'

/** A 1×1 PNG. */
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

/** A Doc as Google's export writes one: pictures by reference, defined at the end. */
const EXPORTED = `# The Lantern Road

The caravan left at dusk.

![][image1]

## Chapter 2

A map of the pass: ![The northern pass][image2] drawn from memory.

| Day | Miles |
| :---- | :---- |
| 1 | 12 |

[image1]: <data:image/png;base64,${PNG}>

[image2]: <data:image/png;base64,${PNG}>
`

describe('takeImages', () => {
  it('takes each picture out, its use and its definition, and leaves the rest as it was', () => {
    const { markdown, images } = takeImages(EXPORTED)

    expect(markdown).toBe(`# The Lantern Road

The caravan left at dusk.

## Chapter 2

A map of the pass: drawn from memory.

| Day | Miles |
| :---- | :---- |
| 1 | 12 |
`)
    expect(markdown).not.toContain('base64')
    expect(images.map(({ ref, alt, mime }) => ({ ref, alt, mime }))).toEqual([
      { ref: 'image1', alt: '', mime: 'image/png' },
      { ref: 'image2', alt: 'The northern pass', mime: 'image/png' },
    ])
  })

  it('decodes each picture to its bytes', () => {
    const { images } = takeImages(EXPORTED)
    expect(Array.from(images[0].bytes.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47])
    expect(images[0].bytes.length).toBe(atob(PNG).length)
  })

  it('takes a definition with no angle brackets, and the collapsed and shortcut uses', () => {
    const { markdown, images } = takeImages(
      `Before ![Fig][] and ![fig] after.\n\n[FIG]: data:image/gif;base64,R0lGODlhAQABAAAAACw=\n`
    )
    expect(markdown).toBe('Before and after.\n')
    expect(images).toHaveLength(1)
    expect(images[0]).toMatchObject({ ref: 'fig', alt: 'Fig', mime: 'image/gif' })
  })

  it('takes a picture written inline as a data URI', () => {
    const { markdown, images } = takeImages(`Look: ![a seal](data:image/png;base64,${PNG})\n`)
    expect(markdown).toBe('Look:\n')
    expect(images).toEqual([expect.objectContaining({ ref: '', alt: 'a seal', mime: 'image/png' })])
  })

  it('leaves pictures on the web, links and reference links alone', () => {
    const text = [
      '![a cover](https://example.com/cover.png)',
      'See [the notes][notes] and ![the plan][notes].',
      '',
      '[notes]: https://example.com/notes',
      '',
    ].join('\n')
    expect(takeImages(text)).toEqual({ markdown: text, images: [] })
  })

  it('hands back markdown with no pictures untouched', () => {
    const text = '# Title\n\n\n\nBody  \nwith a hard break\n'
    const taken = takeImages(text)
    expect(taken.markdown).toBe(text)
    expect(taken.images).toEqual([])
  })

  it('takes a definition no use points at, since it still holds the picture', () => {
    const { markdown, images } = takeImages(`Text.\n\n[image9]: <data:image/png;base64,${PNG}>`)
    expect(markdown).toBe('Text.')
    expect(images).toHaveLength(1)
  })

  it('unescapes alt text', () => {
    const { images } = takeImages(
      `![Map \\[draft\\]][image1]\n\n[image1]: <data:image/png;base64,${PNG}>\n`
    )
    expect(images[0].alt).toBe('Map [draft]')
  })
})
