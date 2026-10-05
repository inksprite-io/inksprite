# Files

A project that holds more than prose: research papers, images, whatever the
writer drops in. The writer can look at them, the model can work with them to
the extent its provider and model allow, and the reading tools are tuned so
the model handles a folder of papers the way it handles a manuscript.

The target is a project like this one:

    Design/
      Retrieval design          the document being written
    Papers/
      Notes on tide tables        a PDF
      RAG survey 2025             a PDF
      Figure 3 sketch             a PNG

and a chat that reads the papers, quotes them by page, and writes the design.

Four parts, in the order they can land. The first delivers most of the value
on its own: once a PDF's text is a document's `content`, every tool the model
has works on it, on every model, with no change to the wire.

`document_tree_design.md` stands for the tree; `character_cards_design.md` for
`kind` and pins; `markdown_library_design.md` for where content is going.
This adds one thing to each.

---

# 1. A file as a document

## Decision: `type: 'file'`

A third value beside `folder` and `text`. The cards design argued against a
third `type` for cards, and it was right: a card is a folder of text, and a
`type` value that changes nothing about how a document is stored, shown or
edited is a claim without a consequence. A file is the opposite case. It has
bytes and a media type, no editor can lay it out, no edit tool can change a
passage of it, and pinning it means something different for a model that can
see it than for one that cannot. Every one of those is a branch, and it is
better to branch on what the document *is* than on `kind`, which belongs to
importers.

Ten sites branch on `type === 'text'` today (`useDocuments` ×3, `usePlainText`,
`build.js` ×2, `cards/chat.js`, `documents.js` ×2, `DocumentNode`). For most
of them a file should be excluded exactly as a folder is: it cannot be made
plain, it is not the first document to open, it is not a text pin, a proposal
cannot be applied to it. Three change: tabs (a file can be open), `read_document`
(a file answers with its text), and `readContent` (a file rides as text or as
an attachment — part 3). A file that pretended to be text would be a text
document the editor tried to lay out, and that would be wrong at the first
site rather than the tenth.

## Shape

```js
/**
 * @property {'folder'|'text'|'file'} type
 * @property {string} [mime] - Files only: `application/pdf`, `image/png`, …
 * @property {number} [size] - Files only: bytes
 * @property {number} [pages] - Files only, when the format has pages
 * @property {string} content - A file's text, as extracted at import; '' for
 *   an image, or whatever the writer or a model wrote about it
 */
```

`content` is the decision that makes the rest cheap. A PDF's `content` is its
text, one line per page break (`[p.7]`), extracted when it is imported. It is
then a document like any other to `read_document`, `search_documents`, the
working set, pins, the summarizer, and the project block. A text-only model on
llama.cpp reads a paper this way; so does every other model, and it is the
cheapest way any of them can.

Extraction is `pdfjs-dist` in the browser, `getTextContent` per page, loaded
on demand — it is 1.5 MB of JavaScript that nothing else needs. A scanned PDF
has no text layer and comes out empty; the import says so, and part 3 is how
a vision model reads it anyway. OCR in the browser (tesseract.js) is possible
and heavy; not now.

The extracted text is the writer's to correct. The existing plain-text view
(`RawMarkdown`) already edits any document's `content` as typed; for a file it
is reached from the tab's menu as "Show as text", beside the viewer. Nothing
new to build there.

Titles come from the filename without its extension: the model addresses
`Papers/RAG survey 2025`, not `Papers/RAG survey 2025.pdf`, and the extension
is the `mime`'s to know. Download restores it. A file's `wordCount` is counted
from its text like anyone else's but is left out of the project total —
a novel's word count should not go up by a hundred thousand when a reference
is dropped in.

## Decision: the bytes live in their own table

```js
db.version(16).stores({
  files: 'id, storyId',   // { id: <document id>, storyId, blob: Blob }
})
```

`loadStory` reads the story's whole `documents` table into memory to show the
tree, and a project of twenty papers is a hundred megabytes that the listing
does not need. The row stays small; the viewer and the request builder fetch
the blob by the document's id when they want it. Dexie stores a `Blob` as a
`Blob` — IndexedDB structured-clones it — so there is no encoding on this
side. One blob per document, keyed by the document's id, deleted when
`hardDeleteOldDeleted` purges the row.

## Backup

`readAllTables` walks `db.tables` and `JSON.stringify`s the result, and a Blob
stringifies to `{}`. Left alone, a backup would silently drop every file. So
the `files` table is transformed on the way out — blob to a base64 string with
its type — and back on the way in, in `useBackup` beside the API-key redaction,
which is the one other per-table rule there is. A backup grows by a third of
the files' size, and a project with a hundred papers makes a JSON file the
browser is slow to build as one string. Acceptable for now, shown as a size
beside the button, with a switch to leave files out. A zip envelope is where
this goes if it hurts; `scope` in the envelope already anticipates a second
kind of file.

Storage: `navigator.storage.estimate()` in the Data settings, so the writer can
see what the project weighs, and `navigator.storage.persist()` asked once, so
Safari does not evict the papers under a project it has not opened for a week.

## Import

The tree's file chooser stops saying what it accepts. Dropping files on a
folder row does the same thing, which is how anyone expects to put a PDF into
a tree; the internal drag is `vuedraggable`'s and the native `drop` with
`dataTransfer.files` is the other one.

`useCardImport.inspect` already decides by content rather than extension, and
keeps doing so with one more outcome:

| What arrives | What it becomes |
| --- | --- |
| PNG with a `chara`/`ccv3` chunk | a card, as now — and its PNG kept, below |
| JSON that is a card or a book | as now |
| `.md`, `.txt` | a text document, as now |
| PDF | a file, text extracted, `pages` set |
| any other image | a file, `content: ''` |
| anything else | a file, no text; the viewer offers a download |

The dialog is skipped for a file, as it is for markdown: there is nothing to
decide. The toast says how much text came out, or that none did.

**Character cards keep their picture.** The importer writes the PNG as a file
document in the card's folder, `kind: 'portrait'`, not hidden. It is what the
card looks like where people browse for them, it costs a thousand tokens on a
vision model and nothing on any other, and a chat on the card can unpin it
like anything else in the folder. The sidecar holds the JSON; the portrait
holds the pixels; between them the card round-trips.

## Summaries

The listing is how the model finds a paper, and the listing carries the
summary. A paper imported with none is a title in a list. The summarizer the
tree already has works on a file's `content` unchanged, so "Summarize" on a
file's row does the right thing from day one. Summarizing on import, or a
folder at a time, is worth having and is a feature of its own.

---

# 2. The viewer

`EditorPanel` picks a view by the document: `Editor` for a structured text
document, `RawMarkdown` for a plain one, and `FileView` for a file — which
picks again by `mime`:

- **`image/*`** — an `<img>` on an object URL, fit to the panel, click for
  natural size.
- **`application/pdf`** — `PdfView`: the pages and nothing else, drawn by
  pdf.js. The first cut was an `<iframe>` on the object URL, the browser's
  own viewer for no code; it brought its whole interface along (side pane,
  print, download, zoom bar), the flags that hide it are Chrome-only, and
  WebKitGTK on the desktop has no viewer at all. So: one sheet per page,
  stacked and fit to the panel's width, drawn as they scroll into view (one
  screen ahead) and cleared as they scroll out, so an eight-hundred-page
  thesis opens in tens of milliseconds and holds three drawn pages at a time.
  pdf.js's `TextLayer` sits over each drawn page, with its stylesheet's rules
  copied in, so a passage can be selected and copied. A resize re-fits every
  sheet and keeps the reader at the same fraction of the document. pdf.js's
  task objects are `markRaw`, because a Vue proxy over them cannot reach
  their private fields. No zoom, search or page jump yet; the browser's
  find-in-page works on the text layer of the drawn pages only.
- **anything else** — "No preview available", the type and size, and
  Download. A slide deck, a Word file: the bytes are kept and the
  writer can get them back, and that is all the panel says about them.
- **epub** — its chapters, read out of the file again and rendered as
  markdown in a reading column (see *Epubs* below).

Object URLs are revoked when the view unmounts. `normalizeTabs` admits a file
as it admits text; `useEditor` never holds one, so `editor.holds(id)` is false
and a write to a file's `content` goes to the store, which is right.

*Built 26 Sep 2026 (branch `file-viewer`), with these decisions:*

- **The text is a second view, not the default.** A file's tab opens on the
  file. "Show as text" on the tab's menu and the outline's switches to
  `RawMarkdown` on its `content`, editable — the extraction is the writer's
  to correct or cut down — and "Show the file" switches back. The choice is
  per document and kept for the session (`useFileView`). A file's `plain`
  flag stays true, since its text is stored as typed, but the panel checks
  `type` before `plain`. The text is never hidden as metadata: what the
  model reads is always something the writer can open.
- **Re-extract text.** On the outline's menu for a file whose type yields
  text (PDF, HTML, text), `reextractFile` reads the bytes again and replaces
  `content`, pages and size, after a confirm when there is text to lose.
  For when the first reading was wrong, or an edit is regretted. A later
  skill can do the same job with a better reader for a PDF that does not
  parse well.
- **Re-import card.** A card folder's menu offers "Re-import card…", which
  reads the card back out of its sidecar (`useCardImport.inspectCard`),
  asks the import's questions again — the name for `{{user}}`, the system
  prompt — and `reimportCard` rewrites the folder's children in place,
  portrait kept, folder id and title kept so a chat on the card still
  knows what it was on. Edits to the card's documents are lost, and the
  dialog says so.
- **A saved web page is its words.** `text/html` goes through
  `files/html.js`: scripts, styles, nav, header, footer and forms dropped,
  one block to a line, the title first. Raw source was a stylesheet with an
  article somewhere in it. Under Node, with no `DOMParser`, the source is
  kept as it is.
- **Types by extension** now include epub, doc/docx, ppt/pptx, xls/xlsx,
  odt, rtf and zip, so the panel can say what a file is and Download can
  give the extension back. None of them yields text yet but epub, which
  is now read (below).
- **`npm run files -- <folder>`** runs the importer over a folder of real
  files and prints one line each (time, size, pages, words, type, first
  words). `harness/research/` holds the shelf it was checked against and is
  gitignored. On 60 files (papers, two books, a game's design documents,
  saved articles) every PDF and page read out; the epub, `.doc` and `.ppt`
  came out with no text, as expected; 822k words in 7 seconds.

*Bulk import, 26 Sep 2026 (branch `bulk-import`):*

- **Three ways in, one path.** "Import files…" (the chooser takes several),
  "Import folder…" (a `webkitdirectory` chooser, which hands over every
  file under the folder with its `webkitRelativePath`), and a drop from
  the desktop onto the outline. `files/batch.js` turns each into the same
  thing — a list of files, each with the folders above it — walking dropped
  folders through `webkitGetAsEntry` and `readEntries`, and skipping
  dotfiles, `Thumbs.db` and `desktop.ini`. `useBulkImport.importMany`
  writes them: a folder already there under the same name is reused, one
  that is not is made, and each file goes through `useCardImport.inspect`
  and `write` as a single import would.
- **A folder keeps its own name.** Importing `papers/` makes `papers/` in
  the tree, with what was under it under that. That is what the chooser
  gives and what a drop gives, and it is what someone dragging a folder
  in expects.
- **A batch asks nothing.** A card in it is written with the defaults and
  the tally says so, with "re-import one to set yours" — which is what
  "Re-import card…" is for. One file chosen on its own still goes the old
  way, dialog and all.
- **One tally at the end.** The tree fills in as files land, which is the
  progress; the toast says how many documents and new folders, how many
  cards took the defaults, how many PDFs were scans, and which files were
  skipped and why. A file that cannot be read never stops the rest.
- **The drop lands where it is dropped.** The folder under the pointer,
  a document's folder, or the project for the space below; a dashed
  outline and "Drop to import into X" say so while the drag is over the
  tree. A drag of a document within the tree carries no `Files` type and
  is left to the rows. Checked in Chromium with the choosers (a 20-file
  folder in 4.8 s, structure kept) and a synthetic drop; a real drag from
  the Finder across vuedraggable's rows is not yet checked.

*Before reading at scale, 26 Sep 2026 (branch `hide-summary`):*

- **Summaries are hidden from the model.** They were vestigial from the old
  app model and it was not clear how they should be used. The field stays
  on the row, and the outline's summary panel and the summarize action are
  still in the code, but the outline no longer offers "Show summary", the
  project block and `list_folder` no longer carry a document's summary,
  `search_documents` looks in titles and text only, `create_document` and
  `update_document` take no summary, and `edit_document` no longer has a
  summary-misquote error. The project's overview (the root's summary) is
  still shown in the block, but the model can no longer edit it; the
  writer does, in Project settings. Summaries may come back with a place
  of their own later.
- **Listings say how long a document is.** Every document entry in the
  block, in `list_folder`, in `search_documents` hits and in a
  `read_document` result carries `words`, and a file with pages carries
  `pages`. Otherwise the model would not know it needs a paged read until
  it had already asked for the whole thing.

---

# 3. The model


Three ways a file reaches a model. The app should do all three, and the order
is the order of preference.

## As text — always

Part 1 did this. `content` flows through the listing, `read_document`,
`search_documents`, the working set, and pins. It is the only way on
llama.cpp for anything but images, the only way on a model with no vision, and
the cheapest way on every model: a thirty-page paper is fifteen to twenty
thousand tokens as text, and the same tokens are what a native PDF costs
*before* its pages are added as images.

## Natively — when the model takes the modality

**The wire.** OpenAI-style content parts. A message's `content` becomes an
array:

```json
{"role": "user", "content": [
  {"type": "text", "text": "<project>…</project>\n\n---\n\nWhat does figure 3 show?"},
  {"type": "image_url", "image_url": {"url": "data:image/png;base64,…"}},
  {"type": "file", "file": {"filename": "rag-survey.pdf", "file_data": "data:application/pdf;base64,…"}}
]}
```

- **Images** as `image_url` with a data URL. OpenRouter, OpenAI, llama-server
  with `--mmproj`, LM Studio and vLLM all take this shape; it is the one
  everyone implements.
- **PDFs** as a `file` part with `file_data` as a data URL. OpenRouter takes it
  for any model — a `file-parser` plugin extracts text (`cloudflare-ai`, free),
  OCRs (`mistral-ocr`, $2 per thousand pages), or hands the PDF to a model that
  reads it itself (`native`: Claude, GPT, Gemini, which see the figures).
  OpenAI takes the same shape directly. **llama-server does not take PDFs at
  all**, and a generic endpoint probably does not either.
- Everything else — audio, video — is out of scope; the shapes exist and the
  builder below can grow them.

**Where it rides.** A tool result cannot carry an image: in the chat
completions format a `tool` message's content is a string or text parts, on
every backend. So the bytes cannot come back from `read_document`. They ride
where read and pinned text already rides — in the writer's latest message,
after the project block, at the tail, past every cache breakpoint, on every
turn while the file is pinned or in the working set. `readContent` already
returns what the block should carry for each document; for a file it returns
either its text or an attachment, and `attachProjectState` builds the array.
`wire.js` passes `content` through untouched, so nothing changes there; the
harness (`scripts/chat-harness.js`) is where to confirm each backend renders
an array.

Within the turn that read it, the file is one request late: the tool result
says "the image is in front of you from your next request" and the loop, on a
read that names a native-capable file, appends a `user` message carrying the
attachment after the tool results. `tool` followed by `user` is legal in the
format; whether every chat template renders it is a thing to check on
llama-server before relying on it, and if one does not, the file arrives on
the next turn and the tool result says so instead.

**Knowing what the model takes.** OpenRouter's `/models` lists
`architecture.input_modalities` per model — `text`, `image`, `file`, `audio`,
`video` — and the app already fetches that endpoint for the picker, so the
list keeps the field and the request builder reads it. Today 288 of its 458
models take images and 180 take files. llama-server's `/props` answers
`modalities: {vision: true|false}`. A generic endpoint says nothing; the
profile gets a switch, "This model accepts images", off by default, and a
wrong guess is a 400 that `explainFailure` learns to name.

**Cost, said plainly, because it decides the default.**

| A thirty-page paper, in context | Tokens per request |
| --- | --- |
| as extracted text | ~15–20k |
| as a native PDF on Claude (text and every page as an image) | ~60–90k |
| an image | ~1–1.5k |

A native PDF is three to four times the price of its text, on every turn it is
carried, and a twenty-megabyte PDF is a twenty-seven-megabyte request body
every turn (providers cap around 32–50 MB). So:

- **Images ride natively** when the model takes them. There is no text to
  send instead.
- **PDFs ride as text.** The original goes only when the writer says so — a
  "Send the file itself" toggle on the row, per chat, beside the pin — or
  when there is no text to send (a scan), in which case it goes natively and
  the toast said so at import. A question about a figure is what the toggle
  is for; reading the paper is not.
- A file over a size cap never goes natively, and the row says why.

**Pages as images** is the third way, for a vision model on a backend that
takes no PDFs — a local Gemma looking at a figure. pdf.js renders a page to a
canvas, and `read_document(path, page)` could attach it. Not in this step; the
attachment builder takes a document and the model's modalities and decides
the part, so this is one more case in one function.

OpenRouter returns `annotations` with a parsed PDF's content so a later turn
can resend those instead of the PDF; with extraction done in-app this only
matters for OCR, and it can wait until someone pays for OCR.

## Reading at scale

None of the above survives a two-hundred-page document. `read_document`
returns the whole body today, and a whole body that is 200k tokens is a turn
that dies. Independent of files, and needed by them:

- `read_document(path, from?, pages?)` returns at most a budget of text
  (about 40k characters, 10k tokens), says how much there is
  (`length`, `pages`), and takes `from` — a character offset, or a page for a
  file — to go on from. The working set carries the whole text as it does
  now; the tool result is what is paged. *(Whether the block should also be
  capped is an open question below.)*
- `search_documents` returns several snippets per document, each with its
  page where there is one, so the model can search a paper for "ablation",
  get page 7, and read pages 7–8. `fuse.js` is already a dependency and the
  substring match could become a ranked one at the same time; the snippet
  shape is the change that matters.
- ~~`readTurns` becomes a per-chat setting~~ — gone with the working set;
  a document is read for the turn or kept for the chat. *Since 5 Oct 2026,
  neither: reads stay in the conversation and only the writer pins. See
  `project_context_design.md`.*

*Built 27 Sep 2026 (branch `paged-reads`), with these decisions:*

- **The offset is the unit; pages and headings name offsets.** `read_document`
  has a budget, `READ_BUDGET` (40k characters, about 10k tokens, about 7,000
  words). A document under it is read whole, as before. A longer one comes a
  slice at a time: `from`, `to`, `length`, `next`, the slice cut back to a
  paragraph break (or a line) within the last 4k of the budget so it reads as
  prose. `from` is a character offset; `page` names a PDF page by its `[p.N]`
  marker and wins over `from`; the first slice carries `headings` (Markdown
  heading lines with offset, level and page) as a map, presented as what it
  is. A slice says its `page`. `ai/tools/slices.js` is the pure part.
- **No windows in the block.** A long document cannot be kept: `keep: true`
  on one is refused with a note and the slice still comes back. A writer's
  pin on one carries it whole (27 Sep, after the first cut put a note there
  instead): a long document in the pin list is the writer's decision from
  the outline, or a card import, and a chapter being drafted is the very
  thing a writer pins. The
  window (keep a slice) is deferred until the tuning loop shows the model
  paying two requests a turn to hold one section of a paper. Pins default
  to off: for small always-needed documents, and the document being worked
  on and edited between turns.
- **Whose pin it is.** `kept: true` said nothing that `content` did not, so
  it is gone; a pinned entry says `pinned-by: assistant` or `pinned-by:
  user` instead, in the block, in `list_folder` and in a read. The chat
  keeps `keptIds` beside `pinnedIds`: `read_document(keep)` writes to both
  through `withKept`, every other mark takes the id off `keptIds`, so a
  long document or a folder pin or a card's pins are always the writer's.
  `release_document(path, asked?)` refuses a writer's pin with a one-line
  error unless `asked: true`; not a lock, since the model can say the writer
  asked, but a reason to check. No writer-visible change.
- **The map is real for PDFs (27 Sep).** A PDF's extracted text has no `#`
  lines, so the first cut's map was empty for exactly the documents that
  need one, and the model fell back on the table of contents, whose page
  numbers are the book's, not the file's. `headingsOf` now reads numbered
  structure — `Chapter 4` with its title on the next line, `4.1 Early
  Results` on a line of its own — skipping everything before the first
  chapter (contents, list of figures), lines with dot leaders or a trailing
  page number, bare numbers once chapters exist (a sentence starting with a
  year), and repeats (running headers); a paged text prefers numbers over
  `#` lines, which in a PDF are code comments. The map is cut to 120 with
  chapters and sections whole. `read_document(path, heading)` names a
  section by number (`4`, `4.1`, `Chapter 4`) or a piece of its title, reads
  from it, stops at the next heading at its level or above, and says
  `section: {number, title, from, until, pages}`; a section longer than a
  slice goes on with `from: next` and the same heading. On an
  eight-hundred-page thesis the detector finds every chapter and 120
  headings, and a chapter of 120 pages comes a slice at a time.
- **Search says where, per passage.** A hit carries `passages`, each with
  its own `at` and `page` in a long document; the single `at` of the first
  cut sat beside passages from elsewhere and misled the model.
  passage's offset) and `page` when the file has pages, so the model reads
  from there. A short document's hits say nothing, since it is read whole.
- **Reads stay out of the trajectory across turns.** Considered again and
  left: replaying read text is the old working set by another route; a
  stub of the call (path only) may be worth adding if the loop shows the
  model losing track of what it consulted.

---

# 4. Tuning the reading tools

## What is known

`harness/findings.md`: with no tool instructions at all, every run still read
three documents before writing, and the shipped prompt's tool paragraph is
"insurance, not instruction". Across fourteen adventure runs, `read_document`
was called 57 times and `search_documents` never. Pinning by the model landed
on 25 Sep and has not been measured.

The uncommitted change in `documents.js` shortens `read_document`,
`pin_document` and `unpin_document` to one line each and leaves the policy —
what a read is for, what a pin costs — to the system prompt. That is right
for `chat.md`, which carries it. **It leaves Adventure and Roleplay with no
policy anywhere**: neither prompt mentions the tools (roleplay.md says only
that the `<project>` block exists), and the write skill's prompt names
`read_document` alone. Tool descriptions are the one text that reaches the
model under every profile, and they sit in the cached prefix, so their length
is paid once a session and not per turn. So: **descriptions carry the policy,
prompts carry the role**, and the policy is written once, in the descriptions,
and not repeated in `chat.md`. That is the reverse of the uncommitted diff,
and the harness is the way to settle it rather than taste.

## What a description has to say

The decision the model faces is "will I need this after the next few turns?",
and a description helps by stating the consequence of each answer rather than
the mechanism behind it:

- `read_document` — "for what you need now; it stays in front of you for your
  next few turns and then leaves. Read a folder to list it."
- `pin_document` — "for what you will need in most turns from here on — the
  chapter being revised, the paper the design is built on. Every pin costs
  its whole length on every turn."
- `unpin_document` — "when the chapter is done or the paper has been mined."

And one reminder at the moment the choice is made: `read_document`'s result
carries a line — "kept for your next three turns; pin it if you will need it
after that" — which lands exactly when it is useful and costs a sentence per
read.

## How to measure it

A `research` fixture and scenario in the harness: three papers' extracted
text as `.md` files (the fixture format already takes markdown beside
`project.json`), a `Design/` folder with a stub, and four turns — summarize
the papers, which handles X best, draft a section using paper 2's approach,
revise it against paper 3's objection. `surface.js` counts what does not need
a reader:

- reads and pins by path and by turn;
- **re-reads of a document still in the working set** (wasted tokens);
- **pins never referred to again** (wasted tokens, every turn);
- turns that answered about a document without reading it (guessing);
- prompt tokens per request, from `requests-N.json`, which is the cost the
  policy is meant to bound.

Then the loop as the README has it: five runs, surface, score, change one
sentence. The scoring rubric wants a research counterpart to `scoring.md` —
whether the draft says what the papers say, whether it cites the right one —
but the surface counts come first and may be enough to choose between the two
description styles.

---

# Sequencing

| Step | Delivers | Depends on |
| --- | --- | --- |
| 1. Files as documents, import, backup | PDFs and images in the tree; the model reads a paper's text through every existing tool | — |
| 2. The viewer | Looking at what was imported; the card's portrait | 1 |
| 3a. Reading at scale | Paged reads, page-numbered search, per-chat `readTurns` | — |
| 3b. Native attachments | Images to vision models everywhere; PDFs on OpenRouter and OpenAI | 1, modality detection |
| 4. Tuning | The fixture, the surface checks, the descriptions | 3a |

1 and 3a are independent and both small. 3b is the one with a wire question
to answer on each backend before it ships. 4 can start on text documents
today and gains the papers when 1 lands.

# 5. Long jobs, and Convert to Markdown

Text read out of a PDF has lost its layout: headings are plain lines,
tables are rows of words, lines break where the page did. A model can put
the structure back, and for a rulebook full of tables that is the
difference between a document the model can use and one it cannot. But a
book is more than any model writes in one answer, so the conversion is a
*job*: many requests, minutes long, paused and taken up again, surviving a
closed tab. That class of work is new to the app, and the conversion is
its first member; a podcast — summarise, script, edit, speak, check, mix —
is the next.

**Jobs.** A `jobs` table (Dexie v18): one row per job with its plan, every
step's state and output, and its status. `jobs/runner.js` walks the steps
from the first not done, writes each result as it lands, and stops when
told: pause aborts the request in flight and leaves that step pending,
cancel closes the job, resume starts again and skips what is done. A job
found `running` when its story loads was interrupted and comes back
`paused`. A kind (`registerJobKind`) says what a step does and what
happens at the end; the runner knows nothing else. Requests go through
`ai/complete.js`, one answer in full with its own abort signal, because the
chat's service owns one request at a time and a job must not cancel a
turn. A Jobs tab on the rail lists a project's jobs with progress, the
step in hand, the error when there is one, and pause / resume / retry /
cancel / remove.

**Roles** (renamed **Workflows** on 30 Sep 2026: `workflows` in the
application state, a job's `workflow`, Settings → Workflows). A job may want
a different model from the chat's: stronger for a one-time conversion,
cheaper for an hour of work. `roles` in the application state names an AI
preset per role (`convert` first), null for the active preset; a Roles
section in Settings sets it. The wider question of roles, skills, tools and
MCP is the writer's open design and this is the smallest thing that does not
prejudge it; see `skills_design.md`.

**Convert to Markdown.** On the outline's menu for any document with
text; a confirm says the word count and the request count. `jobs/convert.js`
cuts the text at page boundaries into chunks of up to 24k characters
(about 6k tokens, well inside what a model writes back); a text without
pages is cut at paragraph breaks. Each chunk goes to the model with the
prompt in `ai/prompts/convert.md` and the outline so far — the last sixty
headings the earlier chunks produced — so levels carry across the cuts.
The page markers must come back, every one, in order; an answer missing
one, cut off (`finish_reason: length`), empty, or under forty percent of
the chunk's length is a failed step, which the panel shows and Retry
runs again. When every chunk is done the outputs are joined and replace
the document's text; Re-extract puts a file's raw text back. The plan
keeps its own copy of the text, so a document edited while its conversion
runs does not shift the chunks under it.

**Checking it.** `npm run convert -- <pdf|text> --endpoint openrouter
[--limit N] [--out file]` runs the same pipeline headless and reports each
chunk's size, headings, table rows, time and tokens. The reference is the
writer's own: `harness/test-pdfs/` (gitignored) holds a TTRPG rulebook
whose tables extract badly, beside a Markdown of it made by another
service.

**Measured (28 Sep, GLM 5.2, the rulebook: 107 pages, 476k chars, 23
chunks).** 20 of 23 chunks converted first time; 40 minutes, 261k tokens.
The three refusals were an answer cut off at the output limit, a marker
dropped, a marker doubled — so a refused chunk is now halved at the page
nearest its middle and each half asked for, twice over if need be, before
the step fails. Against the writer's reference (another service's
Markdown of the same PDF): 867 table rows to its 1,089 with the three
chunks missing, 476 headings to its 919 — the reference makes many more
lines headings (250 `#` to our 11), which is convention as much as
quality; ours leaves some sub-headings as bold lines and keeps bare
page-number footers, both prompt work for the tuning loop. Checked in the
browser end to end: menu, confirm, Jobs tab, pause, resume, done.

**Refined (28 Sep, after the writer's first look).** The confirm is one
line: words, requests, "the text is replaced". A running job shows a
status line under its bar, the chat's thinking-box line reused: the step,
what is happening — waiting for the model, N characters back, checking the
answer, asking again in two halves, writing the result — and the time.
`jobs/live.js` holds that in memory; the runner and the convert kind
report into it. The outline spins a document's icon while a job works on
it; the Jobs rail button carries a count of running jobs. A role is its
own configuration now — provider, model, reasoning effort — filled from the active
preset the first time the Roles section opens and independent after; the
two paragraphs went. "Convert documents on import" starts a job for every
file with text as it lands, singly or in a batch.

**App-wide (28 Sep, second look).** Jobs belong to the app, not the open
project: the Jobs panel lists every project's jobs, each with its
project's name, and a job runs on through a project switch. A step loads
its job's project before it reads the document, so a job resumed from
another project after a reload finds it. Deleting a project stops and
drops its jobs. The time on the status line is the job's, not the step's:
a job keeps `elapsed` over every run, the run in hand adds its own, and a
stopped job shows its total ("3 steps done in 54s"). A step's time says
little when there are twenty. The Roles section is laid out like the AI
section, with the same controls at the same size, and its effort menu is
the preset menu's own list under the same name, "Reasoning Effort". An
unset effort had shown "Off" while a request fell back to the app
default, Medium; a role now takes the active preset's effort with its
provider and model, and an unset one shows the default it sends. Both
measured runs, GLM and Sonnet, were at Medium, since the harness sends
no effort either.

**Not yet.** Page images to a vision model (recovers figures and scans;
waits on native attachments). Superseded by section 6: the tree is now
decided up front, so heading levels no longer drift and requests no longer
depend on each other.

---

# 6. Sections first

**Why the chunked conversion was not enough (28 Sep).** It found structure a
chunk at a time, so heading levels drifted between chunks; sections could
only be found by guessing at numbered headings; every table broke at a page
marker, because nothing could move across one; and the page markers it kept
were the one handle a model had, pointing at the file's pages rather than the
book's. The writer's goals: a model reads a long document by section, not by
guessing pages and offsets — `read_document(path, section: <link>)`, with a
`describe_document(path)` that gives the tree and each section's size — and,
second, clean Markdown a person can use. The converted copy is a new document
beside the source, for now.

**The tree comes first, and is not the model's to change.**
`jobs/sections.js` settles every heading before any text is converted:

- **From bookmarks** when the PDF has them (`files/pdf.js` `readPdfLayout`:
  each page's lines with size and height, the outline resolved to pages and
  heights). A bookmark is matched to its printed line on its page or the
  next — the title itself, the title after a short label (`3.2`, `Core Lineage:`),
  a bracketed gloss (`Might (MT):`), or a heading wrapped over two lines —
  and a `Chapter 4` label line above goes with it. Earlier on the page only the
  exact title counts (a table's `2 Core` row is not the `Core` bookmark). A
  bookmark not printed as a line — `Core`, grouping `Dwarf` and `Elf`, which
  points at a table a page earlier — goes just before its first child; any
  other at the height it points to. The headings come back in text order,
  since an outline can list a heading after ones printed below it.
- **From a model** otherwise: one request with every line numbered, a line set
  larger than the body carrying its size, answering `<line> <level> <title>`
  per heading (`ai/prompts/structure.md`). The job's first step; the requests
  are planned when it answers.

**Then the text is cut along the tree.** A request is a section, or a run of
small ones, up to 24,000 characters; a longer section splits at a paragraph
into parts. Each request's text has its headings written in as Markdown and
no page markers, so a table that ran over a page arrives in one piece. The
model is told where the text sits (the headings above it) and that the
headings are final (`ai/prompts/convert.md`). `jobs/convert.js` puts back what
it changed of them, demotes a heading it added at a level it may not use to a
bold line, writes back a dropped heading that had nothing under it, and checks
the rest: not cut off, no given heading missing, and a word count (letters
only) within 85–120 % of the text's. A failed request is asked again as two
halves, twice over at most. A table cut by a split is joined again, its
repeated header dropped. The answers are joined under an index of links
(three levels deep), and the copy — `<title> (Markdown)`, plain, marked
`convertedFrom` — is written beside the source; a later conversion of the
same source replaces it.

**Links** are made the way Markdown viewers make them (lower case, spaces as
hyphens, punctuation dropped, a repeat numbered `-1`), so the index works
outside the app and the model reads a section by the name the index gives it
(`utils/sections.js`).

**Reading by section.** `describe_document(path)` returns the section tree,
each node `{link, title, words, sections?}`, cut to 300 nodes by whole levels
with `more: N` where subsections were left out. `read_document(path, section)`
takes a link (or a title) and returns the section whole when it fits in a
read, subsections and all; a longer one comes a slice at a time with its
subsections' links on the first slice, going on with `from: next`. The first
slice of a long document carries its top sections (60 nodes). The old
`heading` parameter is gone; an unconverted PDF is still read by `page`, and
its numbered headings (`4.1 Early Results`) are sections too
(`slices.sectionsOfText`).

**Measured (28 Sep, GLM 5.2, default effort, `npm run convert -- harness/test-pdfs
harness/research --concurrency 10`).** 47 PDFs, 410 requests, 65 minutes,
2.29M prompt + 3.72M completion tokens, about $9. 12 requests failed a check
and were halved; 2 failed even halved, and both were the check's fault, since
fixed: one rulebook prints a sidebar twice in its text, which the model wrote once
(long repeated lines now count once), and a slide deck whose PDF reads `ti`
as `8` got its headings spelled right by the model (a near match now counts,
keeping the model's wording). Words kept against the source: 93–101 % on
everything but four one-page documents (81–94 %, footers and print headers
dropped, rightly). Bookmarks placed the tree for the six bookmarked research
PDFs and all four rulebooks (807, 519, 121 and 28 headings); a model
request found it for the rest. The largest rulebook alone: 23 requests, about 5 minutes, $0.48 — against 40
minutes for the chunked version — 809 headings (reference 919), 1,286 table
rows (reference 1,089), 74 bold lines where GLM had left 239.

**Reading by section, on the converted thesis.** The two scenarios
from section 4, rerun against a fixture of the converted Markdown
(`harness/research/sections/`, gitignored): GLM 5.2 called
`describe_document` first, unprompted, for every whole-document question,
then read by `section` link — the chapter-4 deep dive went straight to the
chapter's subsections, and "how long is it?" was answered from the tree's
word count. 5 of 5 checks, no tool errors. The one detour: the bookmarks
carry no chapter numbers, so "chapter 4" took a read of the introduction to
map to a title.

**Not yet.** Requests are independent now, so the app's job could run
several at once, as the harness does; it still runs one at a time. The
model leaves some sub-headings (`Feat: …`) as plain lines rather than
adding them one level down. Chapter numbers are not in the tree when the
bookmarks leave them out.

---

# 7. Structure from the layout, and lookups that land on the entry

**Why (29 Sep).** Reading by section worked for structure ("which chapter
covers magic, and how long is it") and not for lookups. On an openly
licensed rules reference (spells, monsters, magic items) the bookmarks
stop above the entries, so the model decided, request by request,
whether a spell was a heading: 185 spells came out as headings, 61 bold,
90 plain — each request consistent in itself, the requests disagreeing. A
spell that is not a heading is not a section; the model read 120,000
characters of the Spells chapter to find one spell. Research on how others
do it (Docling, marker, MinerU, PyMuPDF4LLM, pdf-to-markdown; memory
`pdf-structure-research-2026-09`): none gets a consistent tree from
per-page or per-chunk decisions; the consistent ones settle structure once,
from bookmarks and type, before a model sees the text. Every working
lookup tool for game rules keeps one record per spell, monster and item.

**The tree is settled in code** (`jobs/sections.js`, `structureOfLayout`):

- **Running headers and footers out first.** The same text, digits aside, at
  the same height, as the outermost line of the page's top or bottom tenth,
  on a fifth of the pages — or on three pages running when it carries a
  page number. Peeled in passes, so a footer's title over its page number
  goes too; the passes after the first need half the pages. A stat block
  that often starts a column has text further out, or moves, and stays.
- **Bookmarks placed** as before.
- **Headings from the type below them** (`styleHeadings`): a line set larger
  than the body (5 % and 0.8 pt), at most 60 characters, not ending in
  `. , ; :`, not a caption, contents line or filler, followed by smaller
  text. Two same-size lines with smaller text after are one heading; a
  short same-size line just before (a table's header, a caption) rules a
  line out. Nothing before the first bookmark (the title page).
- **Levels by how a heading is set**: its size and the size of the text
  under it. A heading set like an open heading, or like one closed since in
  the same bookmark's section, is its sibling and takes its place — so a
  stat block set large inside the spells does not take the spells after it
  as its children. Otherwise it goes one below the nearest open heading set
  larger, never out of its bookmark's section. On the rules reference: 2,846
  headings,
  every spell (339) and magic item (258) at one level, monsters and their
  Traits/Actions nested, 744 of the 745 entries the bookmarks miss found
  (the miss: a name wrapped over two lines).
- **The model adds no headings.** Given headings are written in; any heading
  it writes of its own becomes a bold line (`fixHeadings` floor 6), and the
  prompt says so.

**Lookup tools.**

- `search_documents`: in a long document with sections, `titled` lists the
  sections named with the query — the exact name first — and each passage
  says its `section` and where it sits (`in: Spells / Spell Descriptions /
  Fire Burst`), one passage per section, `inSections` counting the rest. Hits
  in the converted document's index lines are skipped. A document with an
  exactly named section ranks first.
- `describe_document(path, section?)`: a run of more than 30 subsections is
  given as `entries` and `range` ("the first spell … the last") instead of
  listed; `section` lists one section's subsections (up to 600). The rules
  reference's whole tree is 6,300 characters, with every chapter's shape visible.
- The index on top of a converted document counts a long run ("Spell
  Descriptions (343 entries)"): the rules reference's index is 499 lines,
  not ~2,000.

**Harness.** `--dry` writes the tree with the text under it as read, no model
(the rules reference in 4 seconds, free): enough to try the structure and the reading
tools. `--pages a-b` converts the requests that start on those pages, cut
along the whole book's tree. Requests that fail in passing (dropped
connection, 429, 5xx) are asked again after 5, 15 and 45 seconds, in the
harness and in the app's job runner.

**Measured, lookups, no model conversion** (`harness/research/rules-layout`,
the dry rules reference and the largest rulebook, the same seven questions): 18 of 18 checks in
two runs, 86k prompt tokens against 289k for the earlier conversion and
276k for the raw text; every lookup one search and at most one section
read (the spell: 652 characters, not 120,000).

**Iterating on it (29 Sep).** What the samples and the full run turned up:

- **Running lines**, first version, took stat-block rows and "Casting Time:
  Action" out of the rules reference — they repeat at a column's top. Now: the same
  height (12-unit buckets), the outermost line of its page, and a streak
  only with a page number; peeled in three passes, the passes after the
  first on half the pages. Spacing is ignored in the key (one footer is set
  with stray spaces inside its words).
- **Bold at the body size.** Size alone found none of the thesis's
  sub-sections or the largest rulebook's feat lines: they are bold at 12 and
  8 pt. `readPdfLayout` now reads each page's fonts (`getOperatorList`, then
  the font's name: `LMRoman12-Bold`) and marks a line bold when all its
  letters are; a bold line at the body's size over regular text is a
  heading, ranked below any larger one, and a line set like the one before
  it (a bold paragraph, a table's header row) is not. The thesis 146 →
  504 headings, the largest rulebook 820 → 1,053, the rules reference
  2,845 → 3,037 (table titles). Reading the fonts costs about 5 s on the
  eight-hundred-page thesis.
- **Numbers kept.** A bookmark's title leaves out the number printed with it;
  the heading now carries it — `Chapter 4: Early Results`,
  `4.1.6 Sampling` — so "chapter 4" and "section 4.1.6" are found by
  name (137 numbered headings in the thesis, 13 before: none).
- **Twins.** A group bookmark and its only entry named alike (a monster's
  name over the same name) are written once by a model; both go back.
- **Nothing lost to one bad answer.** A request that still fails at its
  smallest goes in as the text was read, under its headings (`#` at a
  line's start escaped), and the job goes on; the harness counts these.
- **Paths as names.** `section` may be given as the path a search hit gives
  (`Part / Chapter / Section`).
- **Transient failures.** A network drop killed every request in flight at
  275 s in one attempt; requests are now asked again after 5, 15, 45 s.

**Measured, full run** (GLM 5.2, 47 PDFs, before bold and numbers): 402
requests in 70 minutes, $10.53, 27 halved, 3 failed (the footer with odd
spacing, one pair of twins, two sidebar titles in one rulebook and a one-letter
heading), all since handled; words kept as before, 92–101 % bar the
one-page documents. The model added no headings anywhere: the given ones
are the tree. The twins' request reran first time after the fixes.
One rulebook's word tables came out as numbered lists this run and as tables
the last: table form is still the model's per-request choice.

**Measured, reading** (GLM 5.2): the rules reference and largest-rulebook lookups 18/18 at
87k tokens with bold; the thesis deep dive 10/10 in two runs with
numbers in the tree — straight to `Chapter 4: …`, `4.1.6 …`
by one search and one small read, the chapter on a system it describes and
its length from the search alone. The whole-thesis summary 7/7.

**Still open.** Table form (list or table) is left to the model; bold table
header rows in the largest rulebook become headings (a row of column names);
one design book sets its sub-headings some other way (neither larger nor
bold) and keeps 138; the app plans a conversion before the job exists, so a
long PDF's layout (a few seconds) is read while the confirm waits; requests
still run one at a time in the app.

**Refined again (29 Sep, the writer's look at the result).** The copy is
an ordinary document now, not a plain one: the editor shows everything a
conversion writes but tables, whose rows it keeps as lines of text (a table
parses to a paragraph with a line break per row, and round-trips word for
word). Parsing the rules reference's copy takes ~130 ms; serializing it after an edit
~7 s, so a copy is stored as written and settled only when edited.
"Convert to Markdown" is offered on a file with text only — not on a
document written here, nor on a conversion's own copy.

The toast is the only view of the jobs (29 Sep 2026): the Jobs panel and
its sidebar tab are gone. One toast (PrimeVue headless, group `jobs`,
bottom left, clear of the chat input and of the ordinary toasts top right,
whose stack would overlap it in the same corner) lists every job, newest
first — title, status, project, progress bar, the status line while
running — with Pause, Resume or Retry, Cancel, and Clear once a job is
done or cancelled; no clear-all for now. It opens when a job starts
(conversions on import too) and stays until closed; the Jobs button,
at the foot of the rail above Settings with the running count on its
badge, toggles it, and the toast opens just right of the rail so it never
covers that button (`useJobsToast`, `JobsToast`, `JobsToastHost`). Empty,
it says "No running jobs". On a phone (no rail, under 768px) it spans the
width at the bottom, and the top bar carries the same Jobs button, with
its badge, between Projects and Settings. Seven buttons is about as many
as that bar holds; a phone may want something less crowded later. The
count is the jobs store's `runningCount`, shared by both buttons.

---

# Open questions

- **Should the block carry a whole file's text?** A pinned two-hundred-page
  document is 200k tokens per turn, and the working set has the same shape.
  A cap with "… and N more pages; read_document(path, from) for the rest"
  keeps the block bounded; it also means a pin is no longer the whole
  document. Probably yes, and probably a large cap; decide with a real paper.
- **Native by default for small PDFs?** A four-page paper on Claude is
  cheap either way, and the figures come with it. A page threshold rather
  than a size one, if so.
- **The library on disk.** A file document is a file beside the `.md` files,
  which the library design wants anyway. Its extracted text is derived and
  can be regenerated on load; its title, summary and `kind` need a home —
  a `.name.pdf.md` frontmatter sidecar, or the folder's `.folder.md`. For
  `markdown_library_design.md`, not here.
- **Word count.** Left out of the project total above; whether a file's
  count shows on its own row at all.

*Epubs, 1 Oct 2026 (branch `epub`, then `epub-folders`):*

- **Much simpler than a PDF.** An epub is a zip of XHTML pages: the
  container names the package, the package's spine gives the reading
  order, and the pages already say which line is a heading. Nothing has
  to be reconstructed from layout. `files/epub.js` unzips with fflate
  (only the XML and XHTML; pictures and fonts are skipped before they
  are inflated), reads the package and the table of contents (EPUB 3 nav
  or EPUB 2 NCX, as a tree, by walking tags with a stack) with patterns,
  and puts each page through the editor's schema and serializer, so the
  text is **markdown**: headings, emphasis, lists and quotes kept, links
  reduced to their words, pictures dropped.
- **A book is a folder, a chapter a document.** First built as one file
  document with the whole book as its text; the same day changed so an
  epub imports as an ordered folder titled after the file: parts as
  ordered subfolders, chapters as markdown text documents, and the epub
  itself last with no text (so search finds each passage once) for the
  reader view and Download. A part's own text, when it has more than its
  title, is a document of the part's name inside its folder.
- **Pages are not chapters, so the table of contents decides.** O'Reilly
  gives a chapter a page with its sections as anchors; calibre and
  Gutenberg cut pages by size, mid-chapter; Gutenberg often puts the whole
  book in one page with anchors. So the book is cut wherever an entry
  points — a marker paragraph goes in front of the block holding the
  anchor, the pages are read in spine order, and the text between markers
  is the entry's own. Text before the first entry is "Front matter". An
  entry with children is a **part** (folder) when every child opens a page
  of its own (nothing ahead of it on that page) on another page than the
  entry; or, for one-page books, when it has under 100 words of its own and
  over 20,000 in all ("BOOK I"). Otherwise it is a **chapter** and keeps its
  sections. Own-words alone was tried first and made a folder of every
  chapter that opens straight into its first section. A book with no usable
  TOC is one chapter per page, titled by its first heading or "Section N".
  Titles have `/` replaced, since the tools read it as a folder.
- **Checked on seven books** (`harness/test-epubs`, the research shelf, the
  unstructured and docling samples): a novel (17 chapters), a short
  nonfiction book, a design book (3 parts, appendices under the third as its
  TOC has them), a Project Gutenberg book (size-cut pages, chapters kept
  whole), a poetry collection (one poem each), and an omnibus of three novels
  (novel → part → chapter, 139 chapters, read in 166 ms and written in 221 ms
  in the browser).
- **DRM is refused with a reason.** An `encryption.xml` that lists a page
  (not just fonts, which publishers obfuscate without locking the book)
  makes the import fail with "locked with DRM".
- **The file view is the book.** The epub's tab renders the whole book read
  from the bytes (`renderMarkdown`, which escapes all HTML) in a prose
  column. No Re-extract (its chapters are documents now) and no Convert to
  Markdown; convert-on-import skips an epub (`isStructured`).
- Left: re-importing a book's folder from its epub, as cards have; anchors
  that point inside a paragraph split before the paragraph, not in it.
