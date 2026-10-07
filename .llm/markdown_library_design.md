# Markdown Library

Documents become markdown. The editor becomes ProseMirror and owns the open
document. The library becomes a folder on disk, and the app becomes a desktop
app that opens one.

Four steps, in that order. Each lands on its own and is what the next builds on.
`document_tree_design.md` stands for everything about the tree — ids, roots,
ordering, folders. This supersedes only what it says about `content`.

**Status, 6 Oct 2026.** Steps 1 and 2 are built (2e46231b, f75c7861). Step 4
moved to `desktop_design.md` and ships before step 3. Step 3 was revised for
what landed after it was written: hard deletes, the `files`, `jobs`, `skills`
and `mcpServers` tables, and chats in the tens of megabytes.

## Why this order

The desktop app was the original question. It is last because its on-disk
layout depends on the content format, and the content format is the one change
that pays off on the web today.

- **Markdown first** because the AI loop is lossy right now and this fixes it.
- **Editor second** because the serializer is the file format, and the file
  format should sit on a schema we own — that is decided before the migration
  is written, not after.
- **Library third** because with markdown in hand, a story is a folder and a
  document is a file, and almost nothing else has to be invented.
- **Desktop last** because it is a shell around the other three.

The last of these did not hold. Once step 1 settled the format, the shell was
worth having over IndexedDB, and the library was the larger step, so the shell
goes first (`desktop_design.md`).

## What was true before step 1

**Storage is a sink.** Eleven Dexie call sites in the whole store layer, every
one `toArray()`, `get(id)`, or `where(field).equals(x).toArray()`. No compound
queries, no cursors. Stores hold everything in Pinia `shallowRef(Map)` and
`syncStore` flushes dirty rows on a 500ms debounce. Dexie is not a query engine
here; it is where rows go.

**Content is TipTap HTML.** `useEditor.js:61` is `extensions: [StarterKit]`,
nothing custom. Two files import TipTap. Every StarterKit node has an exact
markdown form.

**The AI loop drops structure.** The model writes markdown; `renderMarkdown()`
turns it into HTML at `ai/tools/documents.js:479`, `:611`, `:664`. The model
reads a document back through `extractTextFromHTML()` (`utils/storyParser.js:56`),
which walks `textContent` — headings, emphasis, blockquotes, lists all gone.
Same in context assembly (`ai/context/build.js:201`, `:437`). It writes
`## Chapter One` and reads back `Chapter One`.

**Two authorities for one document.** The comment above `writeContent` in
`documents.js:179` says it: the store is not the editor's source of truth after
mount, nothing pulls store changes back in, and a store write to the open
document is clobbered by the next keystroke. So AI writes are routed through
the editor when it is showing the target — a rule every writer has to know.

**Nothing streams into the editor.** `57d58490` removed continue-writing.
`insertAt`, `replaceRange`, `deleteRange` in `useEditor.js` are exported and
unused.

---

# Step 1: Markdown

`Document.content` holds markdown. Everything that turned markdown into HTML or
HTML into text is deleted.

## Decision: the schema is ours, and closed

The document schema is declared explicitly, with exactly the nodes and marks
that have a markdown form:

| Nodes | Marks |
| --- | --- |
| doc, paragraph, text, heading, blockquote, bullet_list, ordered_list, list_item, code_block, horizontal_rule, hard_break | strong, em, code, strikethrough, link |

Nothing else gets in. A node without a markdown representation would
round-trip to nothing, silently. Underline is the concrete example: TipTap 3's
StarterKit adds it by default, and a document with underlined text would lose
it on the next save.

Strikethrough is GFM, not CommonMark. The parser is built on markdown-it's
`default` preset (which enables it) with a `strikethrough` mark spec, not on
`prosemirror-markdown`'s bundled `commonmark` parser.

## Decision: `prosemirror-markdown`

The reference implementation, markdown-it underneath, and the parser and
serializer are configured against our schema rather than inherited from a
framework's defaults. `@tiptap/markdown` exists and is marked-based; it is
newer, and it comes with a TipTap 3 upgrade this design does not want (step 2).

## Migration (schema v13)

Same pattern as v3–v12: a pure transform, a Dexie hook, and a backup upgrade.

```js
// src/stores/migrations/markdown.js
/**
 * @param {Document[]} documents
 * @returns {{documents: Document[], converted: number}}
 */
export function documentsToMarkdown(documents)
```

The conversion is `DOMParser.fromSchema(schema).parse(dom)` followed by the
markdown serializer. Not turndown: parsing with the editor's own schema means
what survives migration is, by construction, what the editor can represent.

This needs a DOM. The page has one at upgrade time; happy-dom has one in tests.
`utils/backup.js` has been DOM-free on purpose, and `UPGRADES[13]` will be its
first transform that is not — that is a test-setup cost, accepted.

**Idempotency is the version gate, not a content check.** A markdown string
run through the HTML parser becomes a paragraph of escaped text, and there is
no reliable way to look at a string and know which it is. Dexie runs v13 once;
`UPGRADES[13]` runs only on backups below v13. Neither path can see a document
twice, as with every migration before it.

Folders keep `content: ''`.

## What changes in the AI layer

| Site | Now | After |
| --- | --- | --- |
| `documents.js:479`, `:611`, `:664` | `renderMarkdown(text)` → HTML | `text`, as written |
| `documents.js:349`, `:410` | `extractTextFromHTML(content)` | `content` |
| `build.js:201`, `:437` | `extractTextFromHTML(content)` | `content` |
| `documentsStore.countWords` | strips tags | strips markdown syntax |

`utils/storyParser.js` is deleted: `splitStoryContent` has no callers and
`extractTextFromHTML` loses its last. `utils/markdown.js` stays — chat
messages, summaries, and `DocumentSummary.vue` still render markdown to HTML
for display.

The model now reads back exactly what it wrote. That is the whole point of the
step, and it ships to the web before anything desktop exists.

## Testing

- Round trip, per node and mark: `parse(serialize(doc))` equals `doc`.
- Stability: `serialize(parse(md))` is a fixed point after one pass. This is the
  property that matters once files are edited outside the app.
- `documentsToMarkdown` against fixtures cut from a real backup.
- Backup v12 → v13 restore.

## Rollback

Branch. `content` is the only field that changes, and the Dexie `VersionError`
rule from the tree design applies: a rollback is a backup restore. Export
before upgrading.

---

# Step 2: The editor

## Decision: ProseMirror directly

What TipTap does for us today, and what replaces it:

| TipTap | Replacement |
| --- | --- |
| `StarterKit` schema | `prosemirror-schema-basic` + `prosemirror-schema-list`, trimmed to the table above |
| keymap, commands, history | `prosemirror-keymap`, `prosemirror-commands`, `prosemirror-history` |
| input rules (`**bold**` as you type) | `prosemirror-inputrules` |
| `EditorContent` | a `ref` and `new EditorView(el, …)` in `onMounted` |
| `chain()…run()` | `view.dispatch(tr)` |

Roughly 200 lines of setup, once. `useEditor.js` comes out about the size it is
now; its 473 lines of tests are rewritten against `EditorState`.

Three reasons, none of them "TipTap is bad":

1. The v3 upgrade is a forced march either way, so "least motion" does not
   favour staying.
2. The file format should not inherit StarterKit's defaults, which shift
   between versions (underline, above).
3. The rest of this step is about transactions, which `chain()` exists to hide.

## Decision: the open document's `EditorState` is the app state

Not a mirror of it. The intuition that the editor should present store state
is the controlled-component instinct, and for ProseMirror it is the trap.
`EditorState` is not the doc; it is doc, selection, undo history, IME
composition, and plugin state, as one immutable value. If the store owned the
doc and the editor re-rendered from it, every outside write would have to be
diffed into a transaction to keep selection and history — which is the problem
transactions already solve.

So:

- **Open document:** the `EditorState` is the truth. Every change — keystroke,
  AI append, undo, a future token stream — is a transaction dispatched to the
  view. The store's copy is a projection, serialized on a debounce.
- **Closed document:** the store's markdown is the truth. Writes go there.

There is never a moment where both are authoritative for the same document.
Data flow is one-directional; the direction flips when a document opens or
closes. It feels like typing because, in the sense ProseMirror cares about,
it is.

## The document API owns the routing

`useDocuments` gains `appendContent(id, markdown)` beside `setContent`. Both
decide: if the editor holds `id`, parse the markdown and dispatch a
transaction; otherwise write the store. The AI tools call these and nothing
else. `ai/tools/documents.js` stops importing `useEditor`, and `writeContent`
and its warning comment are deleted.

The rule moves from "every writer must know" to "one function knows".

## Projection

`Editor.vue:76` serializes on every keystroke. Instead: a transaction marks the
document dirty; serialization runs on a debounce, on blur, on close, and on
`flush()`. `flush()` is called before context assembly — the model has to see
the latest text — the way `createBackup` already calls `processSync()` first.

Word count is computed from the projection, so it lags typing by the debounce.
Fine.

## Streaming, for when continue-writing returns

Streaming markdown into a structured document has one specific problem:
`**bold` is not parseable until it closes. The answer is a `pending` mark:

1. Tokens are inserted as plain text at the end, under `pending`.
2. On completion, the pending range is replaced with the parsed markdown in one
   transaction.
3. Undo sees one step, which removes the generation as a unit.

That is the "everything is a transaction" model paying for itself: the
streamed text is document content with a mark, not a parallel state beside the
editor. It is also what `generation.md`'s retry wanted — remove the last
generation and go again — done inside the document rather than around it.

Not built in this step. Designed here so nothing in this step forecloses it.

## What is deleted

- `@tiptap/starter-kit`, `@tiptap/vue-3`.
- `insertContent`, `insertAt`, `replaceRange`, `deleteRange` — dead since
  `57d58490`. Rebuilt when something needs them, against transactions.
- The `he.decode` in `insertContent`; `he` stays a dependency for the lore
  migration.

## Testing

The state layer — `EditorState.create`, transactions, the projection — needs no
view and is where the tests go. `EditorView` in happy-dom mostly works but not
entirely; keep view tests thin.

---

# Step 3: The library on disk

## Decision: files are the truth, the index is disposable

Obsidian's model. A library is a folder. A story is a folder inside it. A
document is a file. The Pinia maps are a cache built by reading the folder,
and anything else the app keeps to go faster is derived and can be deleted.

Two things about Obsidian do not transfer, and are handled below:

- It has no user-defined ordering; a novel does.
- Its editor works on the markdown string itself and never serializes. Ours
  serializes (step 1), which is why the stability property there matters here.

## Layout

```
My Library/
  My Novel/
    .inksprite/
      story.json                 Story: options, layout, openDocumentIds, lastDocumentId
      chats/
        chat_xxx.jsonl           the chat's row, then one message per line
      files/
        file_xxx.md              an imported file's id, title, path, and extracted text
    .folder.md                   root: id, summary
    Drafts/
      .folder.md
      An idea.md
    manuscript/
      .folder.md                 ordered: true
      01 - Act 1/
        .folder.md
        01 - Chapter 1.md
        02 - Chapter 2.md
      02 - Act 2/
    notes/
      .folder.md
      Characters/
        .folder.md
        Elara.md
      Rulebook.pdf               an imported file, as it was imported
```

A text document:

```markdown
---
id: scene_xxx
title: Chapter 1
summary: Elara finds the door.
created: 2026-03-01T10:00:00Z
updated: 2026-09-04T18:30:00Z
---

The door had been there all along...
```

A folder's `.folder.md` carries `id`, `ordered`, and the timestamps in
frontmatter, with the summary as its body.

## Decision: an imported file is itself, with its text beside it

A `type: file` document is the file as it was imported, in its place in the
tree: a PDF is a PDF that opens in Preview. A PDF cannot carry frontmatter,
so its identity and its extracted text go in `.inksprite/files/<id>.md`: `id`,
`title`, the file's `path`, pages and size in frontmatter, and the text as the
body. The bytes leave the `files` table. Renaming the PDF outside the app
breaks the link until 3b, under the same rule as any other outside edit.

## Decision: a chat is a JSONL file

A chat runs to tens of megabytes, and `syncStore` flushes every 500ms while a
reply streams in, so a chat cannot be one JSON file rewritten whole. The first
line is the chat's row and every line after it is a message. A new message is
appended. An update to the last one truncates the file at that line and
appends it again, and the adapter keeps where the line starts. Anything older,
such as an edit or a compaction that rewrites earlier messages, rewrites the
file.

Chats live in the library, not the app's data directory: a project export
already carries them, and a library in a synced folder should too.

## Decision: identity is in frontmatter, the filename is derived

`id` lives in the file. Nothing internal ever references a path. So renaming or
moving a file cannot break a chat trajectory, a `lastDocumentId`, or a route —
the same property "keep existing ids" bought in the tree design, carried to
disk.

`title` is in frontmatter too, and the filename is derived from it. Titles are
not filenames: they can contain `/`, they are not unique, and case-insensitive
filesystems would merge `Elara` and `elara`. The file is named from the title
by a safe transform, with a numeric suffix on collision.

## Decision: order is in the filename

In an ordered folder, children are named `NN - Title.md`, two digits, widened
if a folder ever needs three. Unordered folders have no prefix and sort by
name, which is what they do in the app already.

The tree design rejected storing the display prefix in `title` because a
dragged document would rename itself. That still holds — `title` stays clean.
The prefix is in the *filename*, which is derived, and a reorder renames the
files. That is the cost of a folder that is correct when opened in Finder or
Obsidian, and it is paid on reorder, which is rare, not on typing.

## Decision: deletes go to the system trash

The app has had no soft delete since 9c6b0e60: a delete removes the row and
the bytes. On disk, a deleted document's file goes to the system's trash
(Finder's Trash, the Recycle Bin, the desktop's trash), from Rust with the
`trash` crate. The app keeps nothing and prunes nothing. A file put back is
the same document the next time the project opens, because its id is in its
frontmatter.

## Decision: settings stay out of the library

`aiProviders`, `aiParameterPresets`, `aiPrompts`, `chatProfiles`, `skills`
and `mcpServers` have no `storyId`. They are app configuration, and some hold
API keys or point at sign-ins. They go in the app's data directory, not in the
library. A library dropped into a synced folder must not sync keys. Skills
are already SKILL.md files, so the app-wide library becomes
`skills/<name>/SKILL.md` there.

`jobs` have a `storyId` but stay out too. As the project export puts it, a
running job is work on this copy of the app, not part of the project, and
what a finished one made is already in the tree.

`version` is dropped from frontmatter. It exists for `syncStore` to bump on
persist; on disk, mtime is the version. `wordCount` is derived and not stored.

## The adapter

```js
/**
 * @typedef {Object} StorageAdapter
 * @property {() => Promise<Story[]>} loadStories
 * @property {(storyId: string) => Promise<{documents: Document[], chats: Chat[]}>} loadStory
 * @property {(chatId: string) => Promise<Message[]>} loadMessages
 * @property {(fileId: string) => Promise<Blob|undefined>} loadFileBytes
 * @property {(table: string, rows: object[]) => Promise<void>} put
 * @property {(table: string, ids: string[]) => Promise<void>} remove
 */
```

`syncStore` talks to the adapter instead of `db`. Two implementations: Dexie
for the web, filesystem for desktop.

The eleven call sites counted on 5 Sep are about thirty-five now, and some
are not the shape this sketch assumed. Messages load by chat
(`messagesStore.js:653`), documents by story and by root
(`documentsStore.js:386`, `:507`), and file bytes by id (`filesStore.js:53`).
`jobsStore` and `filesStore` write past `syncStore`, and `useSkills.js:135`
writes `db.chats` from a composable. The lazy reads become adapter methods
like the two above. Every write goes through `syncStore` or the adapter, never
`db`. Gathering them changes nothing a writer sees, so it lands on the web
before the filesystem adapter exists.

The filesystem adapter owns the id↔path map. It is built by walking the story
folder on load and is private to the adapter; the stores never see a path. A
write is a diff of rows: a changed `parentId` is a move, a changed `title` or
`order` is a rename, a changed `content` or `summary` is a file write. Writes
go to a temp file and `rename` over the target, so a crash cannot leave half a
chapter.

Because the adapter is a function from `(previous rows, next rows)` to
filesystem operations, it tests against an in-memory fake without touching
disk.

## Decision: 3a does not watch the filesystem

The first version reads on open and writes on change, and assumes it is the
only writer while a story is open. An edit made outside the app to a document
the app has open is overwritten by the app's next save of that document. Said
plainly, in the docs.

**3b** adds watching and reconciliation: check mtime before writing and refuse
to clobber a newer file, reload closed documents when they change on disk,
and prompt on a conflict with the open one. This is most of the difficulty of
being a real vault, and it is not needed to ship a folder people can back up
and read.

## Migration from the web

Export a backup on the web, import it on desktop. `useBackup` restores through
the stores, the stores flush through the adapter, the adapter writes files.
`UPGRADES` brings old backups forward on the way. No new migration code.

The desktop app ships before this step, so its writers already have data in
the webview's IndexedDB. Moving it to a folder needs no backup: load through
the Dexie adapter, write through the filesystem one.

**Choosing the library.** The update asks for a folder, or creates one in
Documents. The path is remembered in app settings, and the app opens it on
start.

## What web keeps

Dexie, behind the adapter. The web version does not get files; it gets the
same stores over the same interface. If the divergence ever matters, OPFS is a
filesystem in the browser and the fs adapter could run on it — invisible to
the user, but one code path.

## Testing

- Adapter round trip: rows → files → rows, for every table.
- Rename, reorder, move, delete produce the expected operations and nothing
  else.
- Load a hand-built folder, including an imported file and its sidecar.
- A chat: append, rewrite the last message, edit an earlier one; the file
  reads back as the rows that were written.
- Stability: a document saved, loaded, and saved again is byte-identical.

---

# Step 4: The desktop shell

Moved to `desktop_design.md`, decided 6 Oct 2026, and shipped before step 3.
Tauri v2 is still the choice. What changed is that the shell comes first, the
fetch seam covers the whole app rather than `useAIService` alone, and OAuth
through the system browser is needed in the first build.

---

# Sequencing

| Step | Ships to | Depends on | |
| --- | --- | --- | --- |
| 1. Markdown | web | — | built |
| 2. Editor | web | 1 | built |
| 4. Shell | desktop | — | `desktop_design.md` |
| Adapter seam | web | — | |
| 3a. Library | desktop | 1, seam, 4 | |
| 3b. Watching | desktop | 3a | |

# Open questions

- **What does 3b do to the open document on conflict?** Prompt, or merge? Not
  decided; not needed until 3b.

Settled 6 Oct 2026: folder metadata stays in a hidden `.folder.md`; chats
live in the library; keys are in `desktop_design.md`. The question about lore
migrated with `he` closed when step 1 shipped.
