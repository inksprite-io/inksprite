# Project context

What a chat's model has of the project on every turn, and how it finds the
rest. This replaces the two-state design in `files_design.md` and the
document context work of 26 Sep 2026: a document either read for the turn and
then gone, or kept by the model and carried whole at the tail.

*Decided with the user, 5 Oct 2026.*

## Where things stand

The project block rides on the writer's latest message every turn. It holds
the whole tree, every path with its length, and the full text of every pinned
document. A pin is the writer's, from the outline or a card import, or the
model's own, made with `read_document(keep: true)` and let go with
`release_document`. A read is shown to the model for the turn that made it and
never again; only what it said about the document stays.

That suits a chat working on a few known documents. It does not suit exploring,
which is reading a number of documents and building up an understanding of
them:

- **Reads vanish.** The model keeps only its own paraphrase of what it read,
  or reads again.
- **Keeping is the model's call, and it is not consistent about it.** Some
  documents it needs again are never kept; some it looked at once stay kept.
- **The block is the dearest part of every request.** It moves forward to the
  newest message each turn, so no prompt cache ever covers it: the tree and
  every kept document's text are paid in full on every request. A read left in
  the conversation is paid once and then served from the cache.

## Decision: document calls stay in the conversation

Every call a turn made to a document tool goes back with the conversation on
every later turn, where it was made, with its result: reads, describes,
searches, listings, and writes. This is how dice and `use_skill` calls already
go back (`replaysAcrossTurns`, `ai/context/build.js`), with no limit on age.

Nothing in the conversation changes between summaries. A summary is the one
place reads are let go, as it is for a dropped skill: a summary stands in for
the turns before it, their calls included.

Server tools are not part of this. Their answers still go for the turn, and
Save to project keeps one.

## Decision: the block says what changed since a read

The old design left reads out because a read is a record of one moment: a
chapter read ten turns ago and then edited would be quoted as it was, and one
read three times quoted three ways. Two things answer that now.

**A note in the block.** The block lists each document the model read in the
conversation, still in view, that has changed since its latest read: its text
edited (by the writer, or by the model's own writes), moved to another path, or
gone (deleted, or hidden from this chat). It is one line per document at the
tail, so it costs nothing in cache, and the chat prompt says to read one again
before quoting it. Claude Code does the same when a file it read changes on
disk.

A read records a hash of the text it read, so a change to anything but the text
(a summary, a title that keeps the path) is not called a change.

**No second copy of an unchanged document.** A read the same as one still in
view (the same path and the same section, offset or page) of a document whose
text has not changed since answers that it is unchanged and is above, rather
than sending it again; `use_skill` answers an already loaded skill the same
way. A read a summary has covered is not in view, and reading again sends the
text.

## Decision: the block is the writer's pins, and no tree

The block holds:

- `project` and `summary`: the project's name and overview, as now;
- `size`: how many documents and folders the chat can see, so the model knows
  there is more than the block and to list it;
- `pinned`: the documents the writer pinned for this chat, each with its path,
  length and current text;
- `changed`: what changed since it was read, as above.

Only the writer pins: from the outline, or by a card import. The model has no
keep and no release; `read_document(keep)`, `release_document`, `pinned-by`
and a read's `reads` count go. With its reads in the conversation it has no
need to hold anything, and the writer can predict exactly what is in the block.

The document open in the editor is not pinned by being open. It changes as the
writer clicks around, and each change would change the block.

## Decision: one listing tool, by full path

`list_documents(path = "/", depth?)` replaces `list_folder`. It lists what is
under a folder as one line per entry, each with its full path, the way every
other tool takes it, so a small model copies a path rather than assembling one
from indentation:

```
Manuscript/
Manuscript/Chapter 1 — 2,140 words
Manuscript/Chapter 2 — 1,980 words, pinned
Notes/Characters/ — 8 inside, not listed
Rulebook.pdf — file, 212 pages, 80,113 words
```

Without `depth` it lists everything under the folder when that is at most 200
entries, and otherwise the deepest level that fits, with each folder below it
said as how many it holds. With `depth`, that many levels. Text, not JSON: a
listing is the one result that is all names, and a line per name is a fraction
of the tokens.

`read_document` on a path with nothing at it says to list the project, and on
a folder says to list it.

## Old chats

A turn written before this keeps going back as it did: its document calls are
left out. A turn written since is marked (`metadata.documentCallsKept`), and
only marked turns send their document calls back. Otherwise every long chat
would grow by every read it ever made on its next turn.

The model's keeps in old chats are on the chat's pin list, recorded as the
model's in `keptIds`. A schema upgrade takes them off the pins and drops
`keptIds`: the writer never chose them, and the model can read them again.

## Costs

The conversation grows faster while exploring. Whole chapters read stay until
a summary, so a chat that reads a lot summarises sooner. On GLM 5.2 that is
fine; on a local model with a 16k to 32k context it will summarise often. The
7,000-word cap on a read keeps any one read in bounds.

Without the tree the model has to list before it can name a path. The size
line, and errors that say to list, are meant to be enough; the harness is
where to check it.
