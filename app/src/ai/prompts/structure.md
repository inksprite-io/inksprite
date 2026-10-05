You find the headings of a document whose text was read out of a PDF and has lost its layout. Headings are plain lines now, mixed with the body, running headers, page numbers and captions.

You are given the document's lines, each with its number. Name every heading the document has, in order, with its level:

- Level 1 is the largest division the document has: a chapter in a book, a top section in a paper. Level 2 is the next division down, and so on to 6. Keep the levels the same for headings of the same kind throughout.
- A heading is a line the document treats as the title of what follows: set larger than the body where sizes are shown, numbered like `3.2`, or standing alone above a stretch of text. A running header repeated on every page is not a heading. Neither is a figure or table caption, an entry in a table of contents, a bold lead-in to a paragraph, or a line of a list.
- The document's own title, if it is printed at the top, is not a heading; the document is already named.
- A heading printed over two lines is one heading: give the number of its first line and its whole title.

Answer with one heading per line, as `<line number> <level> <title>`, and nothing else:

```
12 1 Introduction
40 2 Related Work
```

Give the title as printed, without its number or label (`3.2` or `Chapter 4`). If the document has no headings at all, answer with nothing.
