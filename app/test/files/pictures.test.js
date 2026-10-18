/* global atob */
import { describe, it, expect } from 'vitest'
import { markerFor, placePictures, takePictures } from '@/files/pictures.js'

/** A 1×1 PNG. */
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

/** A Doc as Google's export writes one: pictures by reference, defined at the end. */
const EXPORTED = `# The Merchant's Quarter

The gate shut at dusk.

![][image1]

## The cistern

A sketch of the stair: ![The cistern stair][image2] drawn from memory.

| Night | Watch |
| :---- | :---- |
| 1 | Fulke |

[image1]: <data:image/png;base64,${PNG}>

[image2]: <data:image/png;base64,${PNG}>
`

describe('takePictures', () => {
  it('leaves a marker where each picture was, keeps its alt text, and drops its definition', () => {
    const { markdown, pictures } = takePictures(EXPORTED)

    expect(markdown).toBe(`# The Merchant's Quarter

The gate shut at dusk.

![](inksprite-picture-1)

## The cistern

A sketch of the stair: ![The cistern stair](inksprite-picture-2) drawn from memory.

| Night | Watch |
| :---- | :---- |
| 1 | Fulke |
`)
    expect(pictures.map(({ marker, name, mime }) => ({ marker, name, mime }))).toEqual([
      { marker: 'inksprite-picture-1', name: 'image1', mime: 'image/png' },
      { marker: 'inksprite-picture-2', name: 'image2', mime: 'image/png' },
    ])
  })

  it('decodes each picture to its bytes', () => {
    const { pictures } = takePictures(EXPORTED)
    expect(Array.from(pictures[0].bytes.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47])
    expect(pictures[0].bytes.length).toBe(atob(PNG).length)
  })

  it('takes one picture once for every use of it, the collapsed and shortcut ones too', () => {
    const { markdown, pictures } = takePictures(
      `Before ![Token][] and ![token] and ![The token][token] after.\n\n[TOKEN]: data:image/gif;base64,R0lGODlhAQABAAAAACw=\n`
    )
    expect(markdown).toBe(
      'Before ![](inksprite-picture-1) and ![](inksprite-picture-1) and ![The token](inksprite-picture-1) after.\n'
    )
    expect(pictures).toHaveLength(1)
    expect(pictures[0]).toMatchObject({ name: 'TOKEN', mime: 'image/gif' })
  })

  it('takes a picture written inline, with no name to keep', () => {
    const { markdown, pictures } = takePictures(
      `Look: ![a seal](data:image/png;base64,${PNG} "The seal")\n`
    )
    expect(markdown).toBe('Look: ![a seal](inksprite-picture-1)\n')
    expect(pictures).toEqual([expect.objectContaining({ mime: 'image/png' })])
    expect(pictures[0].name).toBeUndefined()
  })

  it('leaves pictures on the web, links and reference links alone', () => {
    const text = [
      '![a cover](https://example.com/cover.png)',
      'See [the notes][notes] and ![the plan][notes].',
      '',
      '[notes]: https://example.com/notes',
      '',
    ].join('\n')
    expect(takePictures(text)).toEqual({ markdown: text, pictures: [] })
  })

  it('drops a definition no use names, bytes and all', () => {
    const { markdown, pictures } = takePictures(`Text.\n\n[image9]: <data:image/png;base64,${PNG}>`)
    expect(markdown).toBe('Text.')
    expect(pictures).toEqual([])
  })

  it('numbers its markers from 1', () => {
    expect(markerFor(1)).toBe('inksprite-picture-1')
  })
})

describe('placePictures', () => {
  it("names each picture the document's own and puts its path where its marker was", async () => {
    const { markdown, pictures } = takePictures(EXPORTED)
    const placed = await placePictures(markdown, pictures, 'doc_a1')

    expect(placed.markdown).toContain('![](.images/doc_a1/image1.png)')
    expect(placed.markdown).toContain('![The cistern stair](.images/doc_a1/image2.png)')
    expect(placed.markdown).not.toContain('inksprite-picture')
    expect(Object.keys(placed.pictures)).toEqual(['image1.png', 'image2.png'])
    expect(placed.pictures['image1.png'].mime).toBe('image/png')
    expect(placed.files.map(({ key, blob }) => [key, blob.type])).toEqual([
      ['doc_a1/image1.png', 'image/png'],
      ['doc_a1/image2.png', 'image/png'],
    ])
  })

  it('numbers pictures that came with no name, or the same one', async () => {
    const bytes = Uint8Array.from(atob(PNG), c => c.charCodeAt(0))
    const placed = await placePictures(
      '![](inksprite-picture-1) ![](inksprite-picture-2)',
      [
        { marker: 'inksprite-picture-1', mime: 'image/png', bytes },
        { marker: 'inksprite-picture-2', mime: 'image/png', bytes },
      ],
      'doc_a1'
    )
    expect(Object.keys(placed.pictures)).toEqual(['image.png', 'image (2).png'])
    expect(placed.markdown).toBe(
      '![](.images/doc_a1/image.png) ![](.images/doc_a1/image%20%282%29.png)'
    )
  })
})
