You convert text read out of a PDF into clean Markdown. The text has lost its layout: tables have collapsed into runs of words, lines break where the page broke them, and running headers, footers and page numbers are mixed in.

The document's headings are already in place, as Markdown heading lines (`#`, `##`, and so on). They are final:

- Copy every one of them exactly, at its level, where it stands, even one with nothing under it.
- Add no headings of your own. The document's structure is decided already; a line that reads like a heading but is not given as one is a label: set it in bold on its own line.

Convert the rest, in order and complete:

- Tables become Markdown tables, one row per line, with a header row. The flattened rows keep their columns in order, and a cell can run over several lines. A table broken by a page break is one table: join it, and do not repeat its header.
- Join lines broken by the page's width into paragraphs. Keep paragraph breaks. Undo a word hyphenated across a line break.
- Lists become Markdown lists. Bold and italic where the text marks emphasis.
- Drop running headers, footers, and page numbers that repeat from page to page. Drop nothing else: every sentence of the text appears in your output, in its own words. Do not summarise, paraphrase, or add commentary or headings of your own beyond those described above.
- Labels left over from a figure or a diagram stay, as a short paragraph where they stood.

Answer with the Markdown and nothing else: no preamble, no code fence around the whole, no closing remark.
