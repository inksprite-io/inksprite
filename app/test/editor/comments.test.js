import { describe, it, expect } from 'vitest'
import { parseMarkdown, serializeMarkdown, settleMarkdown } from '@/editor/markdown.js'
import { schema } from '@/editor/schema.js'
import {
  cleanComment,
  closeMarkup,
  commentAround,
  commentRanges,
  commentsInDoc,
  commentsInMarkdown,
  countComments,
  editAroundComments,
  findComments,
  newCommentId,
  plainPassage,
  quoteWithoutComments,
  withoutComments,
} from '@/editor/comments.js'

const MD = 'We had a {==cold and narrow==}{>>c7k2m1: reword this<<} attic.'

describe('comments in markdown', () => {
  it('reads the markup as a mark on the passage, with the id and the comment', () => {
    const doc = parseMarkdown(MD)
    const paragraph = doc.firstChild
    expect(paragraph.textContent).toBe('We had a cold and narrow attic.')

    const marked = paragraph.child(1)
    expect(marked.text).toBe('cold and narrow')
    expect(marked.marks.map(m => m.type.name)).toEqual(['comment'])
    expect(marked.marks[0].attrs).toEqual({ id: 'c7k2m1', text: 'reword this' })
    expect(paragraph.child(0).marks).toEqual([])
  })

  it('writes the mark back as the same markup', () => {
    expect(serializeMarkdown(parseMarkdown(MD))).toBe(MD)
    expect(settleMarkdown(MD)).toBe(MD)
  })

  it('keeps a comment on text that carries other marks', () => {
    const md = 'She {==*ran* to the **door**==}{>>cabcd: slower<<} at last.'
    expect(settleMarkdown(md)).toBe(md)
    const ranges = commentRanges(parseMarkdown(md))
    expect(ranges).toHaveLength(1)
    expect(ranges[0]).toMatchObject({ id: 'cabcd', text: 'slower' })
  })

  it('leaves the markup alone when it is not a whole comment', () => {
    for (const md of [
      'a {==loose==} highlight',
      'a {>>cabcd: note<<} on its own',
      '{== unclosed',
    ]) {
      const doc = parseMarkdown(md)
      expect(doc.textContent).toBe(md)
      expect(commentRanges(doc)).toEqual([])
    }
  })

  it('does not let one comment nest in another', () => {
    const md = '{==outer {==inner==}{>>cinner: in<<} rest==}{>>couter: out<<}'
    const doc = parseMarkdown(md)
    // The first `{==` opens on the first close it finds; what is left is text.
    const ranges = commentRanges(doc)
    expect(ranges).toHaveLength(1)
    expect(ranges[0].id).toBe('cinner')
  })

  it("reads a comment inside a link's text, where a ] in it does not end the link", () => {
    const md = 'A [{==link==}{>>cabcd: a ] b<<}](https://example.com) here.'
    const doc = parseMarkdown(md)
    const marked = doc.firstChild.child(1)
    expect(marked.text).toBe('link')
    expect(marked.marks.map(m => m.type.name)).toEqual(['comment', 'link'])
    expect(marked.marks[0].attrs.text).toBe('a ] b')
    // Written back outermost, as the editor writes every comment.
    expect(settleMarkdown(md)).toBe('A {==[link](https://example.com)==}{>>cabcd: a ] b<<} here.')
  })

  it('leaves a comment whose close a code span took as text, not open to the end', () => {
    const md = '{==a `code==}{>>cabcd: x<<} b` c\n\nnext ==}{>>cabcd2: y<<} end'
    const doc = parseMarkdown(md)
    expect(commentRanges(doc)).toEqual([])
    expect(doc.firstChild.textContent).toBe('{==a code==}{>>cabcd: x<<} b c')
    expect(settleMarkdown(md)).toBe(md)
  })

  it('reads a break in a comment as a new line, and writes it as <br>', () => {
    const md = 'We had a {==cold and narrow==}{>>c7k2m1: reword this<br>- and the tense<<} attic.'
    const [range] = commentRanges(parseMarkdown(md))
    expect(range.text).toBe('reword this\n- and the tense')
    expect(settleMarkdown(md)).toBe(md)
  })

  it('keeps a comment of more than one line whole in a list, a quote and a table', () => {
    const { comment } = schema.marks
    const mark = comment.create({ id: 'cabcd', text: 'one\n# two\n\n- three' })
    const passage = schema.text('passage', [mark])
    const paragraph = schema.node('paragraph', null, [passage])
    const doc = schema.node('doc', null, [
      schema.node('bullet_list', null, [schema.node('list_item', null, [paragraph])]),
      schema.node('blockquote', null, [paragraph]),
      schema.node('table', null, [
        schema.node('table_row', null, [schema.node('table_cell', null, [passage])]),
      ]),
    ])

    const md = serializeMarkdown(doc)
    expect(md).not.toMatch(/two\n/)
    expect(parseMarkdown(md).eq(doc)).toBe(true)
  })

  it('reads a break written another way, or a new line typed in the plain view', () => {
    const md = 'A {==b==}{>>cabcd: one<br/>two\nthree<<} c.'
    expect(commentRanges(parseMarkdown(md))[0].text).toBe('one\ntwo\nthree')
    expect(settleMarkdown(md)).toBe('A {==b==}{>>cabcd: one<br>two<br>three<<} c.')
  })

  it('reads a comment with a pipe in it in a table cell', () => {
    const md = '| a | b |\n| --- | --- |\n| {==cell==}{>>cabcd: x \\| y<<} | two |'
    const [range] = commentRanges(parseMarkdown(md))
    expect(range).toMatchObject({ id: 'cabcd', text: 'x | y' })
    expect(settleMarkdown(md)).toBe(md)
  })
})

describe('comment helpers', () => {
  it('finds every comment with where it sits', () => {
    const md = `${MD}\n\nAnd {==another==}{>>cabcd2: shorter<<}.`
    const found = findComments(md)
    expect(found.map(c => [c.id, c.text, c.comment])).toEqual([
      ['c7k2m1', 'cold and narrow', 'reword this'],
      ['cabcd2', 'another', 'shorter'],
    ])
    expect(md.slice(found[0].from, found[0].to)).toBe(found[0].markup)
    expect(countComments(md)).toBe(2)
    expect(countComments('')).toBe(0)
  })

  it("keeps a comment's lines, tidied, and keeps it from closing itself", () => {
    expect(cleanComment('  two  \n  lines <<} \t early ')).toBe('two\nlines << } early')
    expect(cleanComment('one\r\n\r\ntwo')).toBe('one\n\ntwo')
    expect(closeMarkup('cabcd', 'fix')).toBe('==}{>>cabcd: fix<<}')
    expect(closeMarkup('cabcd', 'one\n\ntwo')).toBe('==}{>>cabcd: one<br><br>two<<}')
  })

  it('finds a comment with its breaks as new lines', () => {
    const [found] = findComments('A {==b==}{>>cabcd: one<br>two<BR />three<<} c.')
    expect(found.comment).toBe('one\ntwo\nthree')
  })

  it('makes ids that read as handles', () => {
    const id = newCommentId()
    expect(id).toMatch(/^c[a-z0-9]{5}$/)
    expect(newCommentId()).not.toBe(id)
  })

  it('finds the ranges a comment covers in a document', () => {
    const doc = parseMarkdown('One {==two==}{>>cabcd: a<<} three.')
    const [range] = commentRanges(doc)
    expect(doc.textBetween(range.from, range.to)).toBe('two')
    expect(schema.marks.comment).toBeDefined()
  })
})

describe('commentAround', () => {
  // "We had a " is nine characters, after the paragraph's opening at 0.
  const doc = parseMarkdown(`${MD}\n\nAnd **then {==it==}{>>cabcd2: who?<<} ended**.`)
  const at = pos => commentAround(doc.resolve(pos))
  const ON = { id: 'c7k2m1', text: 'reword this', from: 10, to: 25 }

  it('finds the comment the position is in, or against at either end', () => {
    expect(at(15)).toEqual(ON)
    expect(at(10)).toEqual(ON)
    expect(at(25)).toEqual(ON)
  })

  it('finds nothing outside one', () => {
    expect(at(5)).toBe(null)
    expect(at(28)).toBe(null)
  })

  it('takes the run of its mark, whatever else is marked there', () => {
    const second = doc.child(1)
    const start = doc.child(0).nodeSize + 1
    const from = start + second.textContent.indexOf('it')
    expect(at(from + 1)).toEqual({ id: 'cabcd2', text: 'who?', from, to: from + 2 })
  })
})

describe('comments for a list', () => {
  const md =
    'She {==*ran* to the **door**==}{>>cabcd1: slower<<} and {==[out](https://example.com)==}{>>cabcd2: where?<<}.\n\n' +
    'A {==first==}{>>cabcd3: one<<} line.'

  it('gives each comment once, with its passage as it reads', () => {
    const expected = [
      { id: 'cabcd1', passage: 'ran to the door', comment: 'slower' },
      { id: 'cabcd2', passage: 'out', comment: 'where?' },
      { id: 'cabcd3', passage: 'first', comment: 'one' },
    ]
    expect(commentsInDoc(parseMarkdown(md))).toEqual(expected)
    // The same from the markdown, without parsing it.
    expect(commentsInMarkdown(md)).toEqual(expected)
  })

  it('joins the runs of a comment that spans paragraphs', () => {
    const { comment } = schema.marks
    const mark = comment.create({ id: 'cabcd1', text: 'both' })
    const doc = schema.node('doc', null, [
      schema.node('paragraph', null, [schema.text('end of one', [mark])]),
      schema.node('paragraph', null, [schema.text('start of two', [mark]), schema.text(' rest')]),
    ])
    const expected = [{ id: 'cabcd1', passage: 'end of one start of two', comment: 'both' }]
    expect(commentsInDoc(doc)).toEqual(expected)
    expect(commentsInMarkdown(serializeMarkdown(doc))).toEqual(expected)
  })

  it('has nothing to say of text with no comments', () => {
    expect(commentsInMarkdown('Plain {== text')).toEqual([])
    expect(commentsInMarkdown(null)).toEqual([])
    expect(commentsInDoc(parseMarkdown('Plain text.'))).toEqual([])
  })

  it('reads a passage without its markdown', () => {
    expect(plainPassage('*ran* to the **door**')).toBe('ran to the door')
    expect(plainPassage('the `code` and ~~gone~~')).toBe('the code and gone')
    expect(plainPassage('[a link](https://example.com/x_y)')).toBe('a link')
    expect(plainPassage('2 \\* 3 and snake\\_case')).toBe('2 * 3 and snake_case')
  })
})

describe('edits around comments', () => {
  const LINE = 'The ferry {==left at noon==}{>>cabcd1: Check the time.<<} for the island.'

  it('reads the text without the markup, and a quote cut from inside a comment too', () => {
    expect(withoutComments(LINE)).toBe('The ferry left at noon for the island.')
    expect(quoteWithoutComments('at noon==}{>>cabcd1: Check the time.<<} for')).toBe('at noon for')
    expect(quoteWithoutComments('The ferry {==left')).toBe('The ferry left')
  })

  it('leaves an edit that reaches no comment as it is', () => {
    expect(editAroundComments(LINE, 'for the island', 'for the mainland')).toEqual({
      count: 1,
      old: 'for the island',
      new: 'for the mainland',
      resolved: [],
    })
  })

  it('keeps a comment whose words the edit leaves alone', () => {
    const edit = editAroundComments(LINE, 'The ferry left at noon', 'The old ferry left at noon')
    expect(edit.old).toBe('The ferry {==left at noon==}{>>cabcd1: Check the time.<<}')
    expect(edit.new).toBe('The old ferry {==left at noon==}{>>cabcd1: Check the time.<<}')
    expect(edit.resolved).toEqual([])
  })

  it('resolves a comment whose words the edit changes, even half of them', () => {
    const edit = editAroundComments(LINE, 'ferry left', 'boat sailed')
    expect(edit.old).toBe('ferry {==left at noon==}{>>cabcd1: Check the time.<<}')
    expect(edit.new).toBe('boat sailed at noon')
    expect(edit.resolved.map(comment => comment.id)).toEqual(['cabcd1'])
  })

  it('resolves a comment cut off mid-word when the sentence around it is rewritten', () => {
    const content = 'Some parts {==are built, some are pla==}{>>cabcd2: Reword this.<<}nned.'
    const edit = editAroundComments(
      content,
      'Some parts are built, some are planned.',
      'Half is built.'
    )
    expect(edit.old).toBe(content)
    expect(edit.new).toBe('Half is built.')
    expect(edit.resolved.map(comment => comment.id)).toEqual(['cabcd2'])
  })

  it('says how many times the quote is there, and makes no edit unless once', () => {
    expect(editAroundComments(LINE, 'the', 'a').count).toBe(1)
    expect(editAroundComments(`${LINE} ${LINE}`, 'ferry', 'boat').count).toBe(2)
    expect(editAroundComments(LINE, 'a bus', 'a car').count).toBe(0)
  })
})
