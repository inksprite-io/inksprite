/* global File */
import { describe, it, expect } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { extractEpub, readPackage, readToc, resolvePath } from '@/files/epub.js'
import { inspectFile, hasText, isStructured } from '@/files/inspect.js'
import { minimalEpub } from './helpers.js'

const PAGES = [
  '<img src="../cover.jpg" alt="Cover"/>',
  '<p class="chapter-title">ONE</p><p>The <em>tide</em> came in.</p><p>See <a href="page%203.xhtml#n1">note 1</a>.</p>',
  '<h1>Two</h1><h2 id="ebb">Ebb</h2><ul><li>Salt</li><li>Kelp</li></ul><blockquote><p>Quoted.</p></blockquote>',
]
const TOC = [
  { title: 'Cover', page: 0 },
  { title: 'One: The Tide', page: 1 },
  { title: 'Two', page: 2, children: [{ title: 'Ebb', page: 2, anchor: 'ebb' }] },
]

/** Titles and kinds of a section tree, for comparing shapes. */
const shape = sections =>
  sections.map(section =>
    section.children ? { [section.title]: shape(section.children) } : section.title
  )

describe('resolvePath', () => {
  it('reads a reference from where the referring file is', () => {
    expect(resolvePath('OEBPS/content.opf', 'Text/ch%201.xhtml#start')).toBe(
      'OEBPS/Text/ch 1.xhtml'
    )
    expect(resolvePath('OEBPS/Text/nav.xhtml', '../Text/two.xhtml')).toBe('OEBPS/Text/two.xhtml')
    expect(resolvePath('content.opf', 'one.xhtml')).toBe('one.xhtml')
  })

  it('keeps a name with a stray percent sign', () => {
    expect(resolvePath('a/b.opf', '100%.xhtml')).toBe('a/100%.xhtml')
  })
})

describe('readPackage', () => {
  it('finds the title, the pages in spine order, and the table of contents', () => {
    const book = readPackage({
      'META-INF/container.xml': '<container><rootfile full-path="book/package.opf"/></container>',
      'book/package.opf': `<package><metadata><dc:title>Salt &amp; Kelp</dc:title></metadata>
        <manifest><item href="b.xhtml" id="b"/><item id="a" href="a.xhtml"/>
        <item id="toc" href="toc.ncx" media-type="application/x-dtbncx+xml"/></manifest>
        <spine toc="toc"><itemref idref="a"/><itemref idref="missing"/><itemref idref="b" linear="no"/></spine></package>`,
    })

    expect(book).toEqual({
      title: 'Salt & Kelp',
      spine: ['book/a.xhtml', 'book/b.xhtml'],
      toc: 'book/toc.ncx',
    })
  })

  it('looks for a package file when the container does not name one', () => {
    const book = readPackage({ 'x/content.opf': '<package><spine/></package>' })
    expect(book.spine).toEqual([])
  })

  it('refuses a zip with no package in it', () => {
    expect(() => readPackage({ 'readme.txt': 'hi' })).toThrow(/not an epub/)
  })
})

describe('readToc', () => {
  it('reads a nav page as the tree it is, leaving out the landmarks', () => {
    const toc = readToc(
      `<nav epub:type="landmarks"><ol><li><a href="t/one.xhtml">Begin</a></li></ol></nav>
       <nav epub:type="toc"><ol><li><a href="t/one.xhtml"><span>One</span></a>
       <ol><li><a href="t/one.xhtml#s%202">One, part two</a></li></ol></li></ol></nav>`,
      'OEBPS/nav.xhtml'
    )
    expect(toc).toEqual([
      {
        title: 'One',
        path: 'OEBPS/t/one.xhtml',
        fragment: '',
        children: [
          { title: 'One, part two', path: 'OEBPS/t/one.xhtml', fragment: 's 2', children: [] },
        ],
      },
    ])
  })

  it('points a heading with no link where its first child points', () => {
    const [part] = readToc(
      `<nav epub:type="toc"><ol><li><span>Part One</span>
       <ol><li><a href="one.xhtml#top">One</a></li></ol></li></ol></nav>`,
      'nav.xhtml'
    )
    expect(part).toMatchObject({ title: 'Part One', path: 'one.xhtml', fragment: 'top' })
  })

  it('reads an NCX as the same tree, ignoring the book title above the map', () => {
    const toc = readToc(
      `<ncx><docTitle><text>Book</text></docTitle><navMap>
        <navPoint id="a"><navLabel><text>Part &amp; One</text></navLabel><content src="p.xhtml"/>
          <navPoint id="b"><navLabel><text>Chapter 1</text></navLabel><content src="c1.xhtml#x"/></navPoint>
        </navPoint></navMap></ncx>`,
      'OEBPS/toc.ncx'
    )
    expect(toc).toEqual([
      {
        title: 'Part & One',
        path: 'OEBPS/p.xhtml',
        fragment: '',
        children: [{ title: 'Chapter 1', path: 'OEBPS/c1.xhtml', fragment: 'x', children: [] }],
      },
    ])
  })
})

describe('extractEpub', () => {
  it('makes each entry a chapter of markdown, sections and all', () => {
    const book = extractEpub(minimalEpub(PAGES, { title: 'Tides', toc: TOC }))

    expect(book.title).toBe('Tides')
    // The cover is a picture and nothing else: no chapter.
    expect(book.sections).toEqual([
      { title: 'One: The Tide', text: 'ONE\n\nThe *tide* came in.\n\nSee note 1.' },
      {
        title: 'Two',
        text: '# Two\n\n## Ebb\n\n- Salt\n- Kelp\n\n> Quoted.',
      },
    ])
  })

  it('reads an EPUB 2 table of contents the same way', () => {
    const nav = extractEpub(minimalEpub(PAGES, { toc: TOC }))
    const ncx = extractEpub(minimalEpub(PAGES, { toc: TOC, format: 'ncx' }))
    expect(ncx.sections).toEqual(nav.sections)
  })

  it('makes an entry whose children open pages of their own a part', () => {
    const book = extractEpub(
      minimalEpub(
        [
          '<h1>Part One</h1><p>Where it begins.</p>',
          '<h2>Chapter 1</h2><p>A.</p>',
          '<h2>Chapter 2</h2><p>B.</p>',
        ],
        {
          toc: [
            {
              title: 'Part One',
              page: 0,
              children: [
                { title: 'Chapter 1', page: 1 },
                { title: 'Chapter 2', page: 2 },
              ],
            },
          ],
        }
      )
    )

    expect(shape(book.sections)).toEqual([{ 'Part One': ['Chapter 1', 'Chapter 2'] }])
    // What the part says before its first chapter is kept with it.
    expect(book.sections[0].text).toBe('# Part One\n\nWhere it begins.')
  })

  it('keeps a part that is only its title as a folder with no text', () => {
    const book = extractEpub(
      minimalEpub(['<h1>Part One</h1>', '<p>A.</p>'], {
        toc: [{ title: 'Part One', page: 0, children: [{ title: 'Chapter 1', page: 1 }] }],
      })
    )
    expect(book.sections).toEqual([
      { title: 'Part One', text: '', children: [{ title: 'Chapter 1', text: 'A.' }] },
    ])
  })

  it('splits a book that is one page at the anchors its entries point to', () => {
    const page =
      '<h1>A Tale</h1><h2><a id="c1"></a>CHAPTER I</h2><p>First.</p>' +
      '<div><h2 id="c2">CHAPTER II</h2><p>Second.</p></div>'
    const book = extractEpub(
      minimalEpub([page], {
        toc: [
          { title: 'CHAPTER I', page: 0, anchor: 'c1' },
          { title: 'CHAPTER II', page: 0, anchor: 'c2' },
        ],
      })
    )

    expect(book.sections).toEqual([
      { title: 'Front matter', text: '# A Tale' },
      { title: 'CHAPTER I', text: '## CHAPTER I\n\nFirst.' },
      { title: 'CHAPTER II', text: '## CHAPTER II\n\nSecond.' },
    ])
  })

  it('keeps a chapter whole when its pages were cut by size, sections and all', () => {
    const book = extractEpub(
      minimalEpub(
        [
          '<h2 id="c1">Chapter 1</h2><p>Start.</p>',
          '<p>Carried over.</p><h3 id="s">A section</h3><p>More.</p>',
          '<h2 id="c2">Chapter 2</h2><p>Next.</p>',
        ],
        {
          toc: [
            {
              title: 'Chapter 1',
              page: 0,
              anchor: 'c1',
              children: [{ title: 'A section', page: 1, anchor: 's' }],
            },
            { title: 'Chapter 2', page: 2, anchor: 'c2' },
          ],
        }
      )
    )

    expect(shape(book.sections)).toEqual(['Chapter 1', 'Chapter 2'])
    expect(book.sections[0].text).toBe(
      '## Chapter 1\n\nStart.\n\nCarried over.\n\n### A section\n\nMore.'
    )
  })

  it('makes a long book of headings alone, all on one page, a part', () => {
    const words = 'word '.repeat(12000)
    const page =
      '<h1 id="b1">BOOK I</h1><h2 id="c1">CHAPTER I</h2>' +
      `<p>${words}</p><h2 id="c2">CHAPTER II</h2><p>${words}</p>`
    const book = extractEpub(
      minimalEpub([page], {
        toc: [
          {
            title: 'BOOK I',
            page: 0,
            anchor: 'b1',
            children: [
              { title: 'CHAPTER I', page: 0, anchor: 'c1' },
              { title: 'CHAPTER II', page: 0, anchor: 'c2' },
            ],
          },
        ],
      })
    )
    expect(shape(book.sections)).toEqual([{ 'BOOK I': ['CHAPTER I', 'CHAPTER II'] }])
  })

  it('makes each page a chapter when there is no table of contents', () => {
    const book = extractEpub(minimalEpub(['<h1>Opening</h1><p>A.</p>', '<p>B.</p>']))
    expect(shape(book.sections)).toEqual(['Opening', 'Section 2'])
  })

  it('keeps a slash out of a title, where the tools would read a folder', () => {
    const book = extractEpub(minimalEpub(['<p>A.</p>'], { toc: [{ title: 'Either/Or', page: 0 }] }))
    expect(book.sections[0].title).toBe('Either - Or')
  })

  it('has the whole book as one text, each chapter under its title', () => {
    const book = extractEpub(minimalEpub(PAGES, { toc: TOC }))
    expect(book.text).toBe(
      '# One: The Tide\n\nONE\n\nThe *tide* came in.\n\nSee note 1.\n\n' +
        '# Two\n\n## Ebb\n\n- Salt\n- Kelp\n\n> Quoted.'
    )
  })

  it('refuses a book whose pages are locked', () => {
    const locked = minimalEpub(PAGES, {
      toc: TOC,
      extra: {
        'META-INF/encryption.xml':
          '<encryption><EncryptedData><CipherData><CipherReference URI="OEBPS/Text/page%201.xhtml"/></CipherData></EncryptedData></encryption>',
      },
    })
    expect(() => extractEpub(locked)).toThrow(/DRM/)
  })

  it('reads a book whose only encrypted files are its fonts', () => {
    const fonts = minimalEpub(PAGES, {
      toc: TOC,
      extra: {
        'META-INF/encryption.xml':
          '<encryption><EncryptedData><CipherData><CipherReference URI="OEBPS/Fonts/serif.otf"/></CipherData></EncryptedData></encryption>',
      },
    })
    expect(extractEpub(fonts).sections).toHaveLength(2)
  })

  it('refuses something that is not a zip', () => {
    expect(() => extractEpub(strToU8('hello'))).toThrow(/not a zip/)
  })

  it('refuses a zip that is not an epub', () => {
    expect(() => extractEpub(zipSync({ 'notes.txt': strToU8('hi') }))).toThrow(/not an epub/)
  })
})

describe('inspectFile on an epub', () => {
  it('takes its chapters as sections, and the whole book as its text', async () => {
    const found = await inspectFile(new File([minimalEpub(PAGES, { toc: TOC })], 'Tides.epub'))

    expect(found).toMatchObject({ title: 'Tides', mime: 'application/epub+zip' })
    expect(shape(found.sections)).toEqual(['One: The Tide', 'Two'])
    expect(found.text).toContain('# Two')
    expect(found.pages).toBeUndefined()
  })

  it('has no text to read again once its chapters are documents, and its structure already', () => {
    expect(hasText('application/epub+zip')).toBe(false)
    expect(isStructured('application/epub+zip')).toBe(true)
    expect(isStructured('application/pdf')).toBe(false)
  })
})
