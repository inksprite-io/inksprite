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
  countOpen,
  commentOn,
  editAroundComments,
  findComments,
  keepComments,
  liftThreads,
  newCommentId,
  newPost,
  newThread,
  passageInText,
  placeThread,
  placedIds,
  plainPassage,
  quoteWithoutComments,
  readableText,
  sameThread,
  settleThreads,
  threadState,
  withoutComment,
  withoutComments,
  withThreadsOnly,
  rewriteAroundComments,
} from '@/editor/comments.js'

const MD = 'We had a {==cold and narrow==}{>>c7k2m1<<} attic.'

/** A thread with one post of the writer's, as of a fixed time. */
const thread = (text, quote, extra = {}) => ({
  ...newThread(newPost('writer', text, 1000), quote),
  ...extra,
})

describe('comments in markdown', () => {
  it('reads the markup as a mark on the passage, with the id', () => {
    const doc = parseMarkdown(MD)
    const paragraph = doc.firstChild
    expect(paragraph.textContent).toBe('We had a cold and narrow attic.')

    const marked = paragraph.child(1)
    expect(marked.text).toBe('cold and narrow')
    expect(marked.marks.map(m => m.type.name)).toEqual(['comment'])
    expect(marked.marks[0].attrs).toEqual({ id: 'c7k2m1' })
    expect(paragraph.child(0).marks).toEqual([])
  })

  it('writes the mark back as the same markup', () => {
    expect(serializeMarkdown(parseMarkdown(MD))).toBe(MD)
    expect(settleMarkdown(MD)).toBe(MD)
  })

  it('reads the form from before, and writes it as the id alone', () => {
    const md = 'We had a {==cold and narrow==}{>>c7k2m1: reword this<br>and the tense<<} attic.'
    expect(commentRanges(parseMarkdown(md))[0].id).toBe('c7k2m1')
    expect(settleMarkdown(md)).toBe(MD)
  })

  it('keeps a comment on text that carries other marks', () => {
    const md = 'She {==*ran* to the **door**==}{>>cabcd<<} at last.'
    expect(settleMarkdown(md)).toBe(md)
    const ranges = commentRanges(parseMarkdown(md))
    expect(ranges).toHaveLength(1)
    expect(ranges[0]).toMatchObject({ id: 'cabcd' })
  })

  it('keeps a picture in a commented passage as part of it', () => {
    const md = 'The {==gate ![](.images/doc_a1/gate.png) stood==}{>>cabcd<<} open.'
    expect(settleMarkdown(md)).toBe(md)
    const doc = parseMarkdown(md)
    const ranges = commentRanges(doc)
    expect(ranges).toHaveLength(1)
    expect(doc.textBetween(ranges[0].from, ranges[0].to, '', '[picture]')).toBe(
      'gate [picture] stood'
    )
  })

  it('leaves the markup alone when it is not a whole comment', () => {
    for (const md of ['a {==loose==} highlight', 'a {>>cabcd<<} on its own', '{== unclosed']) {
      const doc = parseMarkdown(md)
      expect(doc.textContent).toBe(md)
      expect(commentRanges(doc)).toEqual([])
    }
  })

  it('reads a comment inside another as both marks on its words', () => {
    const md = '{==outer {==inner==}{>>cinner<<} rest==}{>>couter<<}'
    expect(commentRanges(parseMarkdown(md))).toEqual([
      { id: 'couter', from: 1, to: 17 },
      { id: 'cinner', from: 7, to: 12 },
    ])
    expect(settleMarkdown(md)).toBe(md)
  })

  it('reads a comment written in pieces around another as one run', () => {
    const md =
      'We had a {==cold {==and narrow==}{>>ctwo22<<}==}{>>cone11<<}{== attic==}{>>ctwo22<<}.'
    expect(commentRanges(parseMarkdown(md))).toEqual([
      { id: 'cone11', from: 10, to: 25 },
      { id: 'ctwo22', from: 15, to: 31 },
    ])
    expect(settleMarkdown(md)).toBe(md)
  })

  it('leaves a close with no open of its id as text', () => {
    const md = '{==a {==b `x==}{>>cinner<<}` ==}{>>couter<<} c ==}{>>cloose<<} d'
    const doc = parseMarkdown(md)
    expect(commentRanges(doc).map(range => range.id)).toEqual(['couter'])
    expect(doc.textContent).toContain('==}{>>cloose<<}')
  })

  it('keeps the spaces at the edges of a comment in it', () => {
    const md = 'A {==cold ==}{>>cabcd<<}day.'
    expect(settleMarkdown(md)).toBe(md)
  })

  it("reads a comment inside a link's text, where a ] in the old form does not end the link", () => {
    const md = 'A [{==link==}{>>cabcd: a ] b<<}](https://example.com) here.'
    const doc = parseMarkdown(md)
    const marked = doc.firstChild.child(1)
    expect(marked.text).toBe('link')
    expect(marked.marks.map(m => m.type.name)).toEqual(['comment', 'link'])
    // Written back outermost, as the editor writes every comment.
    expect(settleMarkdown(md)).toBe('A {==[link](https://example.com)==}{>>cabcd<<} here.')
  })

  it('leaves a comment whose close a code span took as text, not open to the end', () => {
    const md = '{==a `code==}{>>cabcd<<} b` c\n\nnext ==}{>>cabcd2<<} end'
    const doc = parseMarkdown(md)
    expect(commentRanges(doc)).toEqual([])
    expect(doc.firstChild.textContent).toBe('{==a code==}{>>cabcd<<} b c')
    expect(settleMarkdown(md)).toBe(md)
  })

  it('keeps a comment whole in a list, a quote and a table', () => {
    const passage = schema.text('passage', [schema.marks.comment.create({ id: 'cabcd' })])
    const paragraph = schema.node('paragraph', null, [passage])
    const doc = schema.node('doc', null, [
      schema.node('bullet_list', null, [schema.node('list_item', null, [paragraph])]),
      schema.node('blockquote', null, [paragraph]),
      schema.node('table', null, [
        schema.node('table_row', null, [schema.node('table_cell', null, [passage])]),
      ]),
    ])
    expect(parseMarkdown(serializeMarkdown(doc)).eq(doc)).toBe(true)
  })

  it('reads a comment in a table cell', () => {
    const md = '| a | b |\n| --- | --- |\n| {==cell==}{>>cabcd<<} | two |'
    const [range] = commentRanges(parseMarkdown(md))
    expect(range).toMatchObject({ id: 'cabcd' })
    expect(settleMarkdown(md)).toBe(md)
  })
})

describe('comment helpers', () => {
  it('finds every comment with where it sits', () => {
    const md = `${MD}\n\nAnd {==another==}{>>cabcd2: shorter<<}.`
    const found = findComments(md)
    expect(found.map(c => [c.id, c.text, c.comment, c.legacy])).toEqual([
      ['c7k2m1', 'cold and narrow', '', false],
      ['cabcd2', 'another', 'shorter', true],
    ])
    const text = withoutComments(md)
    expect(found.map(c => text.slice(c.start, c.end))).toEqual(['cold and narrow', 'another'])
    expect(countComments(md)).toBe(2)
    expect(countComments('')).toBe(0)
    expect([...placedIds(md)]).toEqual(['c7k2m1', 'cabcd2'])
  })

  it("keeps a post's lines, tidied, and closes the markup with the id", () => {
    expect(cleanComment('  two  \n  lines <<} \t early ')).toBe('two\nlines <<} early')
    expect(cleanComment('one\r\n\r\ntwo')).toBe('one\n\ntwo')
    expect(closeMarkup('cabcd')).toBe('==}{>>cabcd<<}')
  })

  it('finds an old comment with its breaks as new lines', () => {
    const [found] = findComments('A {==b==}{>>cabcd: one<br>two<BR />three<<} c.')
    expect(found.comment).toBe('one\ntwo\nthree')
  })

  it('makes ids that read as handles', () => {
    const id = newCommentId()
    expect(id).toMatch(/^c[a-z0-9]{5}$/)
    expect(newCommentId()).not.toBe(id)
  })

  it('finds the ranges a comment covers in a document', () => {
    const doc = parseMarkdown('One {==two==}{>>cabcd<<} three.')
    const [range] = commentRanges(doc)
    expect(doc.textBetween(range.from, range.to)).toBe('two')
  })
})

describe('commentAround', () => {
  // "We had a " is nine characters, after the paragraph's opening at 0.
  const doc = parseMarkdown(`${MD}\n\nAnd **then {==it==}{>>cabcd2<<} ended**.`)
  const at = pos => commentAround(doc.resolve(pos))
  const ON = { id: 'c7k2m1', from: 10, to: 25 }

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
    expect(at(from + 1)).toEqual({ id: 'cabcd2', from, to: from + 2 })
  })
})

describe('comments for a list', () => {
  const md =
    'She {==*ran* to the **door**==}{>>cabcd1<<} and {==[out](https://example.com)==}{>>cabcd2<<}.\n\n' +
    'A {==first==}{>>cabcd3<<} line.'

  it('gives each comment once, with its passage as it reads', () => {
    const expected = [
      { id: 'cabcd1', passage: 'ran to the door' },
      { id: 'cabcd2', passage: 'out' },
      { id: 'cabcd3', passage: 'first' },
    ]
    expect(commentsInDoc(parseMarkdown(md))).toEqual(expected)
    // The same from the markdown, without parsing it.
    expect(commentsInMarkdown(md)).toEqual(expected)
  })

  it('joins the runs of a comment that spans paragraphs', () => {
    const mark = schema.marks.comment.create({ id: 'cabcd1' })
    const doc = schema.node('doc', null, [
      schema.node('paragraph', null, [schema.text('end of one', [mark])]),
      schema.node('paragraph', null, [schema.text('start of two', [mark]), schema.text(' rest')]),
    ])
    const expected = [{ id: 'cabcd1', passage: 'end of one start of two' }]
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
  const LINE = 'The ferry {==left at noon==}{>>cabcd1<<} for the island.'

  it('reads the text without the markup, and a quote cut from inside a comment too', () => {
    expect(withoutComments(LINE)).toBe('The ferry left at noon for the island.')
    expect(quoteWithoutComments('at noon==}{>>cabcd1<<} for')).toBe('at noon for')
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
    expect(edit.old).toBe('The ferry {==left at noon==}{>>cabcd1<<}')
    expect(edit.new).toBe('The old ferry {==left at noon==}{>>cabcd1<<}')
    expect(edit.resolved).toEqual([])
  })

  it('resolves a comment whose words the edit changes, even half of them', () => {
    const edit = editAroundComments(LINE, 'ferry left', 'boat sailed')
    expect(edit.old).toBe('ferry {==left at noon==}{>>cabcd1<<}')
    expect(edit.new).toBe('boat sailed at noon')
    expect(edit.resolved.map(comment => comment.id)).toEqual(['cabcd1'])
  })

  it('resolves a comment cut off mid-word when the sentence around it is rewritten', () => {
    const content = 'Some parts {==are built, some are pla==}{>>cabcd2<<}nned.'
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

describe('rewriteAroundComments', () => {
  const content = 'The {==tide==}{>>c1abcd<<} turned at {==noon==}{>>c2abcd<<}.'

  it('puts each comment back where the new body keeps its words', () => {
    expect(rewriteAroundComments(content, 'By noon the tide had turned.')).toEqual({
      body: 'By {==noon==}{>>c2abcd<<} the {==tide==}{>>c1abcd<<} had turned.',
      resolved: [],
    })
  })

  it('resolves a comment whose words are gone, or there twice', () => {
    const { body, resolved } = rewriteAroundComments(content, 'The tide, the tide, at dusk.')

    expect(body).toBe('The tide, the tide, at dusk.')
    expect(resolved.map(comment => comment.id)).toEqual(['c1abcd', 'c2abcd'])
  })

  it('takes out markup the body brings, so only the writer makes comments', () => {
    const { body } = rewriteAroundComments(
      content,
      'The {==tide==}{>>c1abcd<<} turned. {==Gulls==}{>>zz9999<<} cried.'
    )

    expect(body).toBe('The {==tide==}{>>c1abcd<<} turned. Gulls cried.')
  })
})

describe('threads', () => {
  it('stands open on its passage, stale without it, or resolved', () => {
    const open = thread('reword this', 'cold and narrow')
    const resolved = { ...open, status: 'resolved' }
    expect(threadState(open, true)).toBe('open')
    expect(threadState(open, false)).toBe('stale')
    expect(threadState(resolved, false)).toBe('resolved')
    // A marker back in the text, as undoing a resolve puts it, opens it.
    expect(threadState(resolved, true)).toBe('open')
  })

  it('keeps its passage and the words around it as the text reads now', () => {
    const threads = { c7k2m1: thread('reword this', 'old words') }
    const settled = settleThreads(MD, threads)
    expect(settled.c7k2m1).toMatchObject({
      status: 'open',
      quote: 'cold and narrow',
      before: 'We had a ',
      after: ' attic.',
    })
    // Nothing to change, nothing changed: the same object back.
    expect(settleThreads(MD, settled)).toBe(settled)
  })

  it('cuts the words around a passage back to whole words', () => {
    const md = `${'one two three four five six seven eight '}{==here==}{>>cabcd<<}${' nine ten eleven twelve thirteen fourteen fifteen'}`
    const { cabcd } = settleThreads(md, { cabcd: thread('x', 'here') })
    expect(cabcd.before).toBe('three four five six seven eight ')
    expect(cabcd.after).toBe(' nine ten eleven twelve thirteen')
  })

  it('reopens a resolved thread whose marker is back, and leaves an unplaced one be', () => {
    const resolved = thread('reword this', 'cold and narrow', { status: 'resolved' })
    const stale = thread('gone', 'the old lines')
    const settled = settleThreads(MD, { c7k2m1: resolved, cgone1: stale })
    expect(settled.c7k2m1.status).toBe('open')
    expect(settled.cgone1).toBe(stale)
  })

  it('lifts what the old form said onto threads, the markup left holding the id', () => {
    const md = 'A {==b==}{>>cabcd: one<br>two<<} c and {==d==}{>>cabce<<} e.'
    const { content, threads, lifted } = liftThreads(md, { cabce: thread('kept', 'd') }, 5)
    expect(lifted).toBe(1)
    expect(content).toBe('A {==b==}{>>cabcd<<} c and {==d==}{>>cabce<<} e.')
    expect(threads.cabcd).toMatchObject({
      status: 'open',
      quote: 'b',
      posts: [{ author: 'writer', text: 'one\ntwo', created: 5 }],
    })
    expect(threads.cabce.posts[0].text).toBe('kept')
    expect(liftThreads(content, threads)).toEqual({ content, threads, lifted: 0 })
  })

  it('takes out the markers that have no thread, and counts the ones that do', () => {
    const md = 'A {==b==}{>>cabcd<<} c {==d==}{>>czzzz<<} e.'
    const threads = { cabcd: thread('x', 'b') }
    expect(withThreadsOnly(md, threads)).toBe('A {==b==}{>>cabcd<<} c d e.')
    expect(withThreadsOnly('plain', threads)).toBe('plain')
    expect(countOpen({ ...threads, cdone1: { ...threads.cabcd, status: 'resolved' } })).toBe(1)
    expect(countOpen(undefined)).toBe(0)
  })

  it('takes one comment off, every run of it', () => {
    const md = 'A {==b==}{>>cabcd<<} c\n\n{==d==}{>>cabcd<<} {==e==}{>>cother<<}.'
    expect(withoutComment(md, 'cabcd')).toBe('A b c\n\nd {==e==}{>>cother<<}.')
    expect(withoutComment(md, 'cnone1')).toBe(md)
  })

  it('tells two versions of a thread apart by what was said, not by where', () => {
    const one = thread('reword this', 'cold')
    expect(sameThread(one, { ...one, quote: 'cold and narrow', before: 'x' })).toBe(true)
    expect(sameThread(one, { ...one, status: 'resolved' })).toBe(false)
    expect(sameThread(one, { ...one, posts: [...one.posts, newPost('model', 'done', 2)] })).toBe(
      false
    )
    expect(sameThread(null, undefined)).toBe(true)
    expect(sameThread(one, null)).toBe(false)
  })
})

describe('overlapping comments', () => {
  const LINE = 'We had a cold and narrow attic.'
  // "cold and narrow", then "and narrow attic" over the end of it.
  const one = commentOn(LINE, 9, 24, 'cone11')
  const both = commentOn(one, 14, 30, 'ctwo22')
  const BOTH =
    'We had a {==cold {==and narrow==}{>>ctwo22<<}==}{>>cone11<<}{== attic==}{>>ctwo22<<}.'

  it('puts a comment on words another is on, in pieces where it only partly is', () => {
    expect(one).toBe('We had a {==cold and narrow==}{>>cone11<<} attic.')
    expect(both).toBe(BOTH)
    expect(commentOn(one, 14, 24, 'cin333')).toBe(
      'We had a {==cold {==and narrow==}{>>cin333<<}==}{>>cone11<<} attic.'
    )
    expect(commentOn(one, 9, 9, 'cnone1')).toBe(null)
  })

  it('writes what the editor makes as the tools write it, whichever was first', () => {
    const mark = id => schema.marks.comment.create({ id })
    // The later comment's mark first on the words they share, as the editor
    // has it when the comment over the end of the other was made first.
    const doc = schema.node('doc', null, [
      schema.node('paragraph', null, [
        schema.text('We had a '),
        schema.text('cold ', [mark('cone11')]),
        schema.text('and narrow', [mark('ctwo22'), mark('cone11')]),
        schema.text(' attic', [mark('ctwo22')]),
        schema.text('.'),
      ]),
    ])
    expect(serializeMarkdown(doc)).toBe(BOTH)
    expect(settleMarkdown(BOTH)).toBe(BOTH)
  })

  it('reads each comment whole, the pieces of one joined', () => {
    expect(findComments(BOTH).map(c => [c.id, c.text])).toEqual([
      ['cone11', 'cold and narrow'],
      ['ctwo22', 'and narrow attic'],
    ])
    const expected = [
      { id: 'cone11', passage: 'cold and narrow' },
      { id: 'ctwo22', passage: 'and narrow attic' },
    ]
    expect(commentsInMarkdown(BOTH)).toEqual(expected)
    expect(commentsInDoc(parseMarkdown(BOTH))).toEqual(expected)
    const settled = settleThreads(BOTH, { ctwo22: thread('x', '') })
    expect(settled.ctwo22).toMatchObject({
      quote: 'and narrow attic',
      before: 'We had a cold ',
      after: '.',
    })
    expect(readableText(BOTH, { ctwo22: thread('x', '') }).placed[0]).toMatchObject({
      start: 14,
      end: 30,
    })
  })

  it('takes one comment off and leaves the other whole', () => {
    expect(withoutComment(BOTH, 'cone11')).toBe(
      'We had a cold {==and narrow==}{>>ctwo22<<}{== attic==}{>>ctwo22<<}.'
    )
    expect(settleMarkdown(withoutComment(BOTH, 'cone11'))).toBe(
      'We had a cold {==and narrow attic==}{>>ctwo22<<}.'
    )
    expect(withoutComment(BOTH, 'ctwo22')).toBe(one)
  })

  it('resolves the comments an edit changes the words of, and keeps the others whole', () => {
    const attic = editAroundComments(BOTH, 'attic', 'loft')
    expect(attic.new).toBe('{==cold and narrow==}{>>cone11<<} loft')
    expect(attic.resolved.map(c => c.id)).toEqual(['ctwo22'])

    const cold = editAroundComments(BOTH, 'cold', 'cool')
    expect(cold.new).toBe('cool {==and narrow attic==}{>>ctwo22<<}')
    expect(cold.resolved.map(c => c.id)).toEqual(['cone11'])

    const narrow = editAroundComments(BOTH, 'narrow', 'wide')
    expect(narrow.new).toBe('cold and wide attic')
    expect(narrow.resolved.map(c => c.id)).toEqual(['cone11', 'ctwo22'])

    // Before them both: the markup is left as it was.
    const before = editAroundComments(BOTH, 'We had', 'They had')
    expect(before).toMatchObject({ old: 'We had', new: 'They had', resolved: [] })
  })

  it('puts overlapping comments back on a new body as they were', () => {
    const { body, resolved } = rewriteAroundComments(BOTH, 'Then we had a cold and narrow attic.')
    expect(body).toBe(`Then w${BOTH.slice(1)}`)
    expect(resolved).toEqual([])
  })

  it('finds the innermost comment at the caret', () => {
    const doc = parseMarkdown('{==outer {==inner==}{>>cinner<<} rest==}{>>couter<<}')
    expect(commentAround(doc.resolve(9))).toEqual({ id: 'cinner', from: 7, to: 12 })
    expect(commentAround(doc.resolve(3))).toEqual({ id: 'couter', from: 1, to: 17 })
    // In both, on as few words: the one that starts later.
    const split = parseMarkdown(BOTH)
    expect(commentAround(split.resolve(20)).id).toBe('cone11')
    expect(commentAround(split.resolve(28)).id).toBe('ctwo22')
  })
})

describe('placeThread', () => {
  const resolved = (quote, before, after) =>
    thread('x', quote, { status: 'resolved', before, after })

  it('puts the marker back where the quote is once', () => {
    const md = 'The ferry left at noon for the island.'
    expect(placeThread(md, 'cabcd', resolved('left at noon'))).toBe(
      'The ferry {==left at noon==}{>>cabcd<<} for the island.'
    )
  })

  it('chooses among repeats by the words that were around it', () => {
    const md = 'She said yes. He said no. She said yes.'
    const second = resolved('said', 'He ', ' no.')
    expect(placeThread(md, 'cabcd', second)).toBe(
      'She said yes. He {==said==}{>>cabcd<<} no. She said yes.'
    )
    // Two places the words around it fit as well: nothing to choose by.
    expect(placeThread(md, 'cabcd', resolved('said yes', 'She ', '.'))).toBe(null)
  })

  it('places it on words another comment is on, nested in it or around it', () => {
    const md = 'One {==two three==}{>>cother<<} four.'
    expect(placeThread(md, 'cabcd', resolved('three'))).toBe(
      'One {==two {==three==}{>>cabcd<<}==}{>>cother<<} four.'
    )
    expect(placeThread(md, 'cabcd', resolved('One two three four'))).toBe(
      '{==One {==two three==}{>>cother<<} four==}{>>cabcd<<}.'
    )
    expect(placeThread(md, 'cabcd', resolved('three four'))).toBe(
      'One {==two {==three==}{>>cabcd<<}==}{>>cother<<}{== four==}{>>cabcd<<}.'
    )
  })

  it('gives up on words that are gone, or a passage over paragraphs', () => {
    expect(placeThread('Nothing here.', 'cabcd', resolved('left at noon'))).toBe(null)
    expect(placeThread('a\n\nb', 'cabcd', resolved('a\n\nb'))).toBe(null)
  })
})

describe('reads', () => {
  it('reads the text without markup, with each thread it places', () => {
    const md = 'A {==b==}{>>cabcd<<} c\n\nd {==e==}{>>cabcd<<} f {==g==}{>>cnone1<<}.'
    const threads = { cabcd: thread('x', 'b') }
    const { text, placed } = readableText(md, threads)
    expect(text).toBe('A b c\n\nd e f g.')
    expect(placed).toEqual([{ id: 'cabcd', thread: threads.cabcd, start: 2, end: 10 }])
  })

  it('tells a passage apart from its repeats by what is around it', () => {
    const text = 'She said yes. He said no. She said yes.'
    expect(passageInText(text, 14, 25)).toEqual({ passage: 'He said no.' })
    // As far as it takes: here the whole of the line.
    expect(passageInText(text, 17, 21)).toEqual({ passage: 'said', in: text })
  })

  it('says which of its repeats it is past a paragraph of the same words', () => {
    const text = 'word '.repeat(300)
    expect(passageInText(text, 700, 704)).toEqual({ passage: 'word', occurrence: '141 of 300' })
  })
})

describe('keepComments', () => {
  it('takes off the comment marks a paste may not keep, wherever they are in it', () => {
    const doc = parseMarkdown(
      'A {==b==}{>>cabcd1<<} c {==d==}{>>cabcd2<<}.\n\n- e {==f==}{>>cabcd2<<}'
    )
    const slice = doc.slice(0, doc.content.size)
    const kept = keepComments(slice, id => id === 'cabcd1')
    const ids = []
    kept.content.descendants(node => {
      for (const mark of node.marks) if (mark.type.name === 'comment') ids.push(mark.attrs.id)
    })
    expect(ids).toEqual(['cabcd1'])
    expect(kept.openStart).toBe(slice.openStart)
    // Nothing to take off: the slice as it was.
    expect(keepComments(slice, () => true)).toBe(slice)
  })
})
