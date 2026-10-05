# Character cards

A character card imported as documents, and a chat started on one. The cards
are SillyTavern's — V1, V2 and V3, as PNG or JSON — and they come in because
the people who write them have already done, by hand and at volume, the work
`fiction-context-design.md` §2.1 describes: turning traits into behaviours.
An Ali:Chat card is a page of example dialogue, not a page of adjectives. A
PList is the index to it.

## Why

Two reasons, and neither is roleplay for its own sake.

**A known-good character removes a variable.** Tuning the writing and adventure
prompts against characters we wrote ourselves confounds two things: whether the
prompt is working, and whether the character was any good. A card with a
reputation is a fixed point. What changes is our end.

**It is a direct comparison of two context architectures.** SillyTavern pushes:
the card's fields go into every request, and a lorebook entry is injected when
one of its keywords appears in the scan window. InkSprite pulls: the model is
handed a listing and fetches what it wants. Both are trying to have the right
paragraph in context at the right turn, and the second has never been measured
against the first on material the first was designed for. Same card, same
model, same scenario, our retrieval against theirs — that is a question the
transcript harness can answer, and until now we had no way to ask it.

So: the pull model stays. Nothing here ports scan depth, token budget,
recursion, constant-versus-selective, or insertion position. If pull loses, we
will know what it lost to.

## The card as documents

A card is a folder of text documents. Not one document: a blob is invisible to
search, uneditable in the editor, and would need a viewer of its own. As
documents, every tool the app already has works on it, and the question of how
to edit a card answers itself — the editor edits it.

    Characters/
      Seraphina/              folder, kind: card
        Description           kind: description
        Personality           kind: personality
        Scenario              kind: scenario
        Greeting              kind: greeting
        Example Dialogue      kind: examples
        Lore/                 kind: lore
          Elderly Nomad       an entry; its keys on its first line
        .card.json            hidden: true

A field with nothing in it gets no document. Most cards have no `personality`
separate from the description, and an empty stub would only be one more line in
the listing for the model to read past.

### kind, not title

`Document.kind` is a short string, absent on ordinary documents. It is what
says this folder came from a card and this document is its greeting.

`card` rather than `character`, because much of what the format is used for is
not a person. A scenario — a world, a premise, a book of lore, and a greeting
that opens it — ships as a character card because that is the file format the
ecosystem has. It imports the same way and needs no second kind, but calling
the folder `character` would be a claim the format does not make.

It matters that this is a field and not a title, because the titles belong to
the writer. Rename `Example Dialogue` to `How she talks`, drag it somewhere
else, and export still finds it. Sniffing titles would mean the writer's own
tree is load-bearing for a file format, which is exactly backwards.

It also matters that it is not `type`. `type: 'folder'|'text'` is load-bearing
in the store, the tree, the editor and the tools; a third value would have to be
handled in every one of them. `kind` is read by the importer, the exporter, and
the one menu item — nothing else has to know it exists.

This is the part that generalises. The next importer sets a different `kind`
and writes documents; it needs no new table, no new type, and no new panel.

### The sidecar

`.card.json` holds the card exactly as it arrived, `plain` so it is stored as
written rather than settled to what the editor can show. `hidden` already means
"kept from the model, out of reach of its tools, and so is everything under a
hidden folder" — which is the whole specification for a round-trip sidecar,
already written and already backed up.

Hidden documents still show in the tree, dimmed and marked, and that is the
right outcome here: the writer can see what the import wrote, open it, and
delete it. A sidecar nobody can find is a file that rots.

Export regenerates the fields we understand from the documents and merges them
over the sidecar, so `extensions`, `creator_notes`, V3's `assets` and anything
a future spec adds survive a round trip through an app that has never heard of
them.

### Two names

A card has a `name` and, often, a `nickname`, and they are not alternatives.
`name` is the character's, and what `{{char}}` substitutes to. `nickname` is
what the card is called where people browse for it — and on a card that is
really a scenario, the two have nothing to do with each other. A scenario
card in `app/harness/test-cards` is `name: "Narrator"`, with the name of the
game it runs as its `nickname`. Import it by `name` and the
writer gets a folder called Narrator and no way to find it again.

So the folder takes the nickname when there is one and the name otherwise, and
`{{char}}` substitutes the name either way.

### Macros

`{{char}}` and `{{user}}` are substituted at import, not at render. The
alternative is carrying a template language into the editor, where the writer
would have to know not to type two braces.

`{{char}}` becomes the card's name. `{{user}}` becomes a name the import dialog
asks for, defaulting to `You`. The substitution is one-way: the documents are
the writer's copy now, and an export says what the documents say. The sidecar
still has the original, for anyone who wants to see what was replaced.

`{{original}}` and ST's persona macros are dropped — they refer to a prompt
architecture we do not have.

## What is not context

Four fields do not want to be a document the model reads. Each has a slot that
already exists.

**`first_mes`** is seeded as the chat's first assistant message. This is most of
why cards work at all: the opening turn sets voice, tense, length and formatting
by example, before anything has been asked. It is a message in the chat, so the
writer can edit it, retry it or delete it like any other.

`alternate_greetings` land as further documents of `kind: greeting`, and the
dialog that starts the chat lists them. Only that dialog: once the writer has
taken a turn, the greeting is a message in a conversation that answered it, and
swapping it out from under the reply is not a thing to offer.

**`mes_example`** is a document like the rest, pinned, with `<START>` turned into
a rule and the speaker prefixes kept. It stays prose rather than being replayed
as fake turns: injected as messages it competes with the real conversation for
what the last few turns look like, and once the chat is twenty turns long the
examples are no longer near the end anyway. As a pinned document it rides at the
tail where the card guides want it.

**`system_prompt`** overrides the chat's prompt. It is rare and usually bad, so
the import dialog shows it and defaults to off — most cards that carry one are
carrying an ST preset's scaffolding, not anything about the character.

**`post_history_instructions`** is imported as a document like every other
field — "Author's Note", hidden from the model — because the card's value is
the context it puts in the tree, not prompt machinery. When a chat starts on the
card it becomes the chat's **author's note** (`Chat.rules`): in place of the
profile's note, as in ST, unless it says `{{original}}`, which is where the
profile's note goes. Resolved once, into plain text the writer then owns; the
document keeps the macro. The card's system prompt gets the same treatment
against the Roleplay prompt.

_Revised 23 Sep 2026._ This used to go last, after the writer's message. It now
goes in the writer's latest message after the project block and ahead of what
they said (`<authors_note>`): still in the last message, which is what the
recency argument below needs, but the answer is to what the writer said and
not to the instructions, and what sits right before generation is what gets
echoed. The Director no longer runs at the start of a turn, so nothing else
went last either, and `attachDirection` is gone.

### On post-history instructions

Since it came up: this is the field ST calls Post-History Instructions, and used
to call the Jailbreak. It is injected at depth zero — after the entire chat
history, immediately before generation — and in practice it holds the standing
rules about how a turn is written rather than anything about who the character
is. The recurring contents, across every card guide, are roughly four things:

- _Never write {{user}}'s dialogue, actions or thoughts._ This is the one that
  earns its place. It is the most common roleplay failure, it happens more the
  longer the chat runs, and a reminder at the top of the prompt stops working
  around turn thirty.
- Length and form — two to three paragraphs, past tense, third person, no
  summarising the turn at the end.
- Prohibitions on the model's favourite tics: no asking "what do you do next?",
  no wrapping up, no narrating out of character.
- Content permissions, on cards that want them.

The mechanism is the one §6.4 argues for, and the reason it is a separate field
rather than more system prompt is exactly the decay §6.4 describes: the same
sentence at the top of a long conversation does not survive the recency
competition, and at depth zero it does. It is small — a few lines — and it
should stay small for §1's reasons, since anything in it is three tokens from
generation and echoes accordingly.

This is worth having whether or not a card supplies one, and the preset is
where a chat that has no card gets it.

## Lorebooks

A `character_book` entry becomes a document under `Lore/`: `content` is the
body, `comment` is the title, and `keys` go in the body, on their own first
line.

The summary is a sentence about what the entry says — which the importer has no
way to write, since it has no model to ask. So it starts empty, and a document
with no summary is a listing entry with a title and nothing else, which is what
the rest of the app already does with an unsummarised document. Filling them in
is a feature of its own (see **Not yet**), not a thing the importer should fake.

### Keys in the body, not the summary

The summary is in the project listing, which is rebuilt into every turn past
every cache breakpoint. So whatever goes in it is paid for on every turn, by
every chat, for the life of the project. A body is paid for once, by a turn that
opens the document.

Key lists want the second kind of budget. They are long — tens of keys on an
entry is ordinary, and they are mostly inflections of each other — and they earn
nothing on a turn that is not looking for that entry. In the body they are still
matched by `search_documents`, which reads titles and content, so nothing is
lost but the standing cost.

This is a rule about summaries rather than a rule about cards: a summary is the
one field with a per-turn price, so it holds a sentence about the document and
nothing that is merely useful to have somewhere.

(Search should cover summaries too, which it does not today. Worth doing on its
own account — the listing advertises every document by its summary, so a summary
is the text the model has most reason to search for and the one place a search
will not find it. It is not what the keys depend on either way.)

### What the keys are for

Mostly they are a stemming table. `Wolves`, `Wolf Pack`, `Wolfkin`
under a title of `Wolf`; `Thieves' Guild`, `Thief-Guild`, `Thieving Guild` under
`Thieves Guild`. ST matches literal substrings, so an author who wants the entry to
fire has to write the inflections out by hand.

A model forming its own query does not need that. It searches `wolf`, which
matches the title. What the list carries that a query would miss is narrower:
aliases in another language, and synonyms filed under a different word entirely
— `Abyss` and `the Pit` under a title of `Underworld`. Keeping the whole list is
how that survives, and in the body the whole list is nearly free.

### What is dropped

`insertion_order`, `position`, `case_sensitive`, `selective`, `secondary_keys`,
`use_regex`, `scan_depth`, `token_budget`, `recursive_scanning` and the
`extensions` block ST's own plugins write. Kept in the sidecar, none acted on.

Some of these are not even claims the card is making: a book can arrive with
`selective` and `use_regex` set on every entry and no secondary key or pattern
anywhere in it, because that is what ST serialises rather than what the author
chose. Reading them as intent would be reading noise.

`constant: true` is the exception, because it is not retrieval — it is a
statement that this paragraph is always in context. Those get pinned at import.

### Entries that are not entries

An entry with no content injects nothing in ST either — the title is a memo
shown in its editor and never sent to the model — so an empty one is a row that
exists to be looked at while editing. Authors use them as headings, and decorate
the titles of real entries the same way, because World Info is a flat list with
no folders and no headings of its own.

So: an entry with no content is skipped, and a title is taken as written apart
from stripping the decoration around it. Neither is a convention worth
reimplementing. Box-drawing is one author's way of faking a tree, the next
author has another, and the tree is a thing this app actually has — the writer
can arrange the folder after import far better than a guess at somebody's
punctuation could.

### Lorebooks that arrive on their own

A lorebook is also a file. SillyTavern exports World Info as JSON, and those
turn up shared on their own — a world several characters are played in, rather
than one character's notes.

Same data, different serialisation, because the card spec wrote `character_book`
to describe ST's structure while ST kept exporting its own. An export has
`entries` as an object keyed by index rather than a list, and each entry carries
ST's native field names beside the spec's: `key` and `keysecondary` next to
`keys` and `secondary_keys`, `disable` next to `enabled`, plus `uid`, `order`,
`depth`, `displayIndex`, `probability`, `selectiveLogic`, `characterFilter` and
`addMemo`. The fields that matter here — content, title, keys, constant — are in
both under one name or the other.

So the importer normalises a book to one shape before it writes documents, and
that shape is what both paths hand it: a `character_book` from a card, or a file
on its own. A standalone book imports as a folder of documents with no card
around it, which is the same code with the card half not running.

Worth having for its own sake: a world that outlives the character who came with
it is exactly what the document tree is for, and pinning a lore folder into a
chat does not care where the folder came from.
"""

### The bet

Keyword injection fires on a word the model did not know to look up. Pull cannot
do that: something has to decide the document is worth opening. Against that,
the model sees every entry's title every turn, which a scanner never provides,
and a large book stays out of the window until something wants it.

A book big enough to matter does not fit in a context window, so ST is not
holding it either — it is betting its scanner picks the right few entries, and
we are betting the model asks for them. That is the comparison, and it wants a
few books of different sizes to run on, not one.

There is a scale where the listing itself is the problem, and the books to hand
reach it: 240 entries on one card, 674 on another, and a standalone lorebook of
1,027, each entry a line in the project block on every turn. Affordable in the
hundreds; not obviously past that.

Not a problem to solve now, and not one to solve automatically. A folder gets a
switch for whether its contents are listed — the writer's call, the way `hidden`
is — and a folder that is not listed still appears, so the model knows it is
there and can search or read into it. That is a flag and a branch in
`descendantsOf`, it needs no heuristic about size, and it is worth building when
a real book makes the listing hurt rather than before. See **Not yet**.

## Pinning

A card's description has to be in context from the first turn. The project
block only carries `content` for documents the chat has read, which is right
for a manuscript and wrong for a character sheet.

So: `Chat.pinnedIds`, a list of document ids whose content rides in the
`<project>` block from turn one without a read. Pinning a folder pins what is
under it, the way `hidden` hides what is under it.

It lives on the chat, not the document, because a project holds many characters
and only one of them is in the scene. A document-level "always in context" flag
— for a style guide, or the author's note §6.4 wants — is a different feature
and can be OR'd in later without disturbing this one.

The mechanism is small. `descendantsOf()` keeps a `pinned` marker on the listing
(not sent to the model, like `id`), and `readContent()` in `ai/context/build.js`
seeds its map from the pinned set before it walks the trajectory. Everything
downstream is unchanged: pinned content appears as the same `content` field a
read produces, at the tail, kept current.

Pinned content is re-sent on every turn and sits past the cache breakpoint, so
a pin is a per-turn cost, not a one-off. It stays at the tail all the same: the
chapter the writer is working on is the likeliest thing to be pinned, and it
changes every turn, so anywhere ahead of the history it would break the cache
for the whole history rather than for itself. The cost is bounded and legible —
tree, pins, and the working set — and the explorer is where it is trimmed.

### Working set

_Revised 26 Sep 2026._ The working set below is gone. A read is for the turn
that made it and nothing stays in the block that is not kept; the model
keeps a document by reading it with `keep: true`, lets it go with
`release_document`, and the listing marks what is kept. Three states became
two because the model could not see the third: it never knew whether a
document it read two turns ago was still in front of it, and a state it
cannot see is one it cannot reason about. The read result now counts how
many times the chat has read the document, which is the one signal the
model has that it keeps coming back to it. The measurements are in
`app/harness/findings.md` under 26 Sep. What follows is the design as it
was.

A pin is "keep this in context". What the model is looking at right now is a
different thing, and it is the model's: the **working set** is what it read in
its last few turns (`AI_DEFAULTS.readTurns`, three), carried in the block the
way reads always were, kept current, and gone after that unless it reads again
or pins. Reads used to stay for the rest of the chat, which made the block grow
with the conversation and cost the whole of it every turn; and the writer could
see none of it and shed none of it short of hiding the document.

The window is measured in the assistant's own turns, the same as the replays
are, so a consultation's reads stay with the consultation. Compaction clears
the working set for free — it replaces the turns the reads were on — and pins
survive it, because they are on the chat.

The model can pin, with `pin_document` and `unpin_document`, writing the same
`pinnedIds` the writer's explorer toggle writes. That is the check on a model
that pins too much: every pin is a row in the outline with a pin on it, and one
click takes it off. The working set itself is not shown anywhere; the tool
chips in the chat already say what was read, and a set only the model manages
is not the writer's to manage.

In the outline, with a chat open, each row has two toggles on hover: a pin
and an eye, in the primary colour when on. Nothing shows at rest but the row
itself: dimmed where the chat cannot see the document, whichever folder decided
that, and the title in the primary colour where the chat carries it. A column
of icons said the same thing louder. On a phone there is no hover, so there
are no toggles and the menu has the items instead. A folder's pin shows
faintly on the rows under it when hovered, and clicking it lets that one
document go — marked shown, so listed and readable and not carried, with the
folder's pin left as it was; `unpinned()` in `utils/visibility.js` is that
rule, and the tool uses the same one. "Hide" — from every chat — stays in the
menu: it is the document's, not the chat's, and a mis-click there would pull
the document from every chat. The menu itself is on right-click and on the
menu key; the `⋯` button on every row is gone except on a phone, which has no
right-click and whose long press is the drag, and there the menu keeps the
chat's items too, since there is no hover to find a toggle by.

## Chat presets

"Chat with Seraphina" is not a feature of cards. It is a preset being applied:
a prompt, tools off, that folder pinned, that greeting seeded. Build the preset
and the card work is an importer and a menu item.

**Not "profile".** `aiProfileStore` already owns that word for provider and
model, and two kinds of profile in one settings menu is a UI nobody can
navigate. A preset is what a new chat is stamped from.

A preset holds what a chat already has fields for — `promptId`,
`disabledTools`, `disabledToolGroups`, `projectContextEnabled`,
`directorEnabled` — plus `pinnedIds`, the greeting, and the author's note a
card's `post_history_instructions` is composed into.

**Copy on create, save back explicitly.** `createChat()` already works this way
and says why: _"Copied rather than inherited so editing a default never rewrites
old chats."_ Live binding would mean unchecking a tool in one chat silently
rewrites nine others, with nothing on screen to warn you. So a chat's settings
are its own, and a preset gains a visible "save to preset" instead.

The built-in presets ship as source next to `BUILT_IN_PROMPTS`, for the same
reason those do — an improvement reaches existing installs on update:

- **Chat** — the prompt, all tools, project block on. What a new chat is today.
- **Adventure** — the adventure prompt, RPG tools, Director on.
- **Roleplay** — new. No tools, project block on, greeting seeded, card pinned.

Tools off in Roleplay is a starting position, not a principle. Cards are written
for a model with no tools, and a tool schema in context pulls the voice toward
assistant register. Once cards are working, the oracle is the obvious first one
to try putting back — it is small, it answers in a sentence, and it is the one
tool whose absence a roleplay chat actually feels.

## AI settings in the chat menu

The model and its settings move into the chat menu, where the rest of a chat's
settings are. They stay app-wide for now — a preset does not carry a model.

That is the smaller change and it is not a dead end: presets are copy-on-create,
so a preset that names an AI profile later is an added field on new presets, not
a migration of old chats. It is worth doing eventually, since the model is the
largest single lever on roleplay output and a Roleplay preset that does not
carry one is half a preset.

## Import and export

PNG and JSON. A card's JSON lives base64-encoded in a PNG `tEXt` chunk — keyword
`chara` for V1 and V2, `ccv3` for V3, and a V3 file usually carries both, so
prefer `ccv3` and fall back. Walking PNG chunks is a `DataView` and a loop; it
needs no dependency, which is the reason to start here.

V1 is a flat object, V2 and V3 wrap it in `{ spec, spec_version, data }`. One
normaliser to the V3 shape, and the importer only ever sees one.

CHARX — V3's zip with assets — is deferred. There is no zip library in the app
and the format is rare.

A lorebook on its own is JSON too, in ST's World Info shape rather than the
card's; see **Lorebooks that arrive on their own**. The importer tells them
apart by what is in the file — a card has a `name` and a `first_mes`, a book has
`entries` — rather than by extension, since both are `.json`.

Import is a file chooser in the tree's context menu, and a drop onto the tree.
It shows what it found before it writes: the name, the fields, how many lore
entries, whether there is a `system_prompt`, and the `{{user}}` name to use.

The card lands in the folder it was dropped on, or the root. No `Characters/`
folder is invented on the writer's behalf — the tree is theirs to lay out, and
an importer that creates folders by convention is an importer with opinions
about someone else's project.

A card belongs to the project it was imported into, like every other document.
Using the same card in two projects means importing it twice, which is a file
chooser and a few seconds. Cards that lived somewhere outside a project would
need documents that belong to no story, chats that reach across stories, and a
second place for the writer to look for things — a large change to the data
model in exchange for saving a re-import.

Export writes a JSON card. PNG export needs an image to embed and the card's
own portrait is in the sidecar at best — deferred with CHARX.

## Chats from SillyTavern

A chat played in ST comes in through the chat history's own Import, the same
door a chat exported from this app uses. It is told apart by what is in it — a
JSON Lines file whose first line is ST's header or a message — rather than by
its extension, and ends up as the same rows: `cards/transcript.js` reads, and
`useChats().importChat` writes, knowing nothing about where they came from.

The reason to want it is the reason to want cards. A conversation that went
well in ST, continued here on the same card, is the pull model measured against
the push one from the middle of a scene rather than the top of one.

**What the file is.** A transcript, and nothing else. Who said what, when, the
other things they might have said, and what the model thought on the way.
Everything that made the conversation go the way it did lived somewhere else in
ST and is not in the file: the card, the persona's description, the preset and
its system prompt, the samplers, the lorebook. It does not even say which card
it was — the header's `character_name` is the literal string `unused` in
current builds — so the character is known by the name on their messages.

**So the chat is put onto its card by name.** Imported as it stands, it is the
bug a fork used to have: the history, with nobody in it. After the import, the
project is searched for a card folder whose character has that name — the name
in the sidecar, since the folder's title is the writer's to change and on a
scenario card was never the character's — and if there is exactly one, the chat
gets what "Chat with…" would have given it: the pins, the card's rules, its
system prompt as a profile. No greeting, since it has its opening already. With
no card, or two, it is imported anyway and the writer is told; which of two
Elaras was meant is not something to guess at.

It runs on the Roleplay profile either way. A transcript carries none of what
ran it, and a roleplay is what it was.

**What maps.**

- `swipes` are alternates — every answer a message has had, the one it is
  showing among them — with each one's own thinking and timing from
  `swipe_info`. The greeting's swipes are the card's alternate greetings, and ST
  leaves `{{user}}` unfilled in the ones nobody chose, so they are filled here
  with the names the transcript spoke under.
- `extra.reasoning`, `gen_started`, `gen_finished` and `reasoning_duration` are
  the message's reasoning and its three times.
- `send_date` is `created`, read from each of the four ways ST has written it
  down. Messages sort by it, so each is made later than the one before: an old
  stamp was good to the minute, and a fast exchange shares one.
- ST's Author's Note goes after the chat's author's note. Despite the name it
  is not a note to self: ST inserts it into the prompt on every turn, or every
  few, and it is the one piece of the prompt a chat file carries. `rules` is
  the nearest home for it, though not the same place — ST puts it four
  messages up by default, and this is the writer's latest message. A note whose `note_interval` is zero was
  switched off, kept and never sent, and is left behind.
- `extra.model` and `extra.api` are the message's `model` and `provider`, swipe
  by swipe. A message here did not say which model wrote it until an ST chat
  turned up that did; now every generated turn does, and the turn's header
  shows it. Comparing models over one scene is the point of bringing one in.
- The title is the file's name without ST's timestamp.

**What does not.**

- _Hidden messages._ `is_system` is ST's flag for a message kept out of the
  prompt — hidden by hand, usually after it was summarised. There is no such
  flag on a message here, so it comes in as what it was before it was hidden. A
  conversation with holes in it is worse than one the writer has to trim, and
  compaction is this app's answer to the length.
- _Who spoke._ A message here has a role and no name, which is enough for one
  character and not for a group or a narrator's aside. They come in as the
  assistant's.
- _Lineage._ `main_chat` names the chat a branch came from. A fork here keeps
  no record of that either.
- Attachments, per-message token counts, the bias field, script variables, and
  World Info's timed state, which are ST's own runtime.

**The persona is the seam.** The transcript says `Alex`; the card's documents
say whatever `{{user}}` was given when the card was imported, which by default
is `You`. The model copes, but it is the second place substituting at import
rather than at context-build shows — the first is export, where the macros
cannot be put back.

## Storage

- `Document.kind` — `card` on the folder, the field name on its children,
  `lore` on the lorebook folder. Absent on everything else.
- `Chat.pinnedIds` — document ids. Absent means none.
- `Chat.rules` — the author's note, sent in the writer's latest message after
  the project block. Absent means none.
- `.card.json` — an ordinary hidden document holding the card as it arrived.
- `MessageMetadata.model` and `.provider` — which model wrote an answer and
  where it ran. Per answer, so each alternate keeps its own.
- `chatPresets` — a new table, at schema v14, carried by the backup. Built-in
  presets are source and are not in it.

Only the last needs a schema version. The rest are fields on rows that exist,
and a backup carries them.

## Shape of the work

Each of these is useful before the next one lands.

1. ~~Chat profiles, built-in only, and the AI settings moved into the chat
   panel.~~ Done. They are profiles rather than presets — a preset is what the
   request runs on — and they own their prompt and their roles' prompts.
2. ~~`Chat.pinnedIds`, and pinning from the tree.~~ Done.
3. ~~The importer: PNG and JSON in, documents and sidecar out.~~ Done, and
   markdown with it: the menu item is Import, not Import a card.
4. ~~"Chat with…" — the Roleplay profile, the greeting picker, the pin.~~ Done.
   The feature is answerable from here: everything below is convenience.
5. ~~The stored-profile table.~~ Done as `chatProfiles`, which the prompt
   library became.
6. JSON export.

Then the measurement, which is the point: the same card and the same scenario
through the harness, against a SillyTavern run, scored on whether the right
material was in context when it was needed.

## Not yet

- CHARX, and PNG export.
- Writing the summaries. A lore entry arrives with a title, a body and no
  summary, and a summary per entry is what makes a book of them findable. It
  wants a model, so it is a feature — summarise a folder, or tidy a whole
  imported book — and not something the importer invents.
- Keywords or tags as a field of their own on a document, rather than a line at
  the top of a body. That is the honest home for what a lore entry's keys are,
  and it would give search something to match on that the reader does not have
  to read past. It is a change to the document model, so it is not this.
- A switch on a folder for whether its contents are listed in the project
  block. For a lore folder of a few hundred entries, where the titles cost more
  every turn than they are worth; the folder itself stays listed, so nothing
  becomes invisible.
- A document-level always-in-context flag, for a style guide or an author's
  note.
- A persona — `{{user}}` is a name at import, not a thing the app knows about.
- Group chats, and V3's `group_only_greetings`. An imported ST group chat
  arrives as one assistant speaking every part.
- A message kept out of context without being deleted, which an ST chat has
  and a chat here has nowhere to put; see **Chats from SillyTavern**.
- The model on a consultation. A turn says which model wrote it; a `/write` or
  a `/compact` is a model call too, and its record does not say.
- Regex scripts, ST's prompt manager, and anything else that is a feature of
  SillyTavern rather than a feature of the card.
