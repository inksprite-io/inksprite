# Skills

What the writer and the model can each call on in a chat, how it is shown,
and how a writer adds their own: skills as SKILL.md files in an app-wide
library, and tools from MCP servers.

The writer types `/` in the message field and a menu lists everything they
can call: the dice and the oracle, Write, Interpret and Compact, the skills
they have written or imported, and the prompts of any server they have
connected. The model is offered the same skills as tools, the ones it is
allowed. A skill is a SKILL.md, the format Claude, Codex, Copilot and others
read, so a writer can bring one they already use and hand on one they wrote.
A tool can come from an MCP server, connected by its URL.

The first part is a refactor nobody would notice; each part after it stands
on the ones before. `files_design.md` left "the wider question of roles,
skills, tools and MCP" open when it added the Roles setting, now Workflows; this is that
question. `character_cards_design.md` stands for profiles and presets.

---

# 1. One definition of a skill

## Where things stand

A skill is spread over four places today:

- `ai/skills/` has the three that are code: Director, Interpret, Write.
- `ai/roles/` lists them again, with Compaction, so a profile can reword them.
- `COMMANDS` in `ai/commands.js` has a hand-written command for each one the
  writer can call.
- `ai/tools/index.js` registers the two the model can call, in the `skills`
  group.

Which of these a skill appears in decides who can call it, and the reason is
usually where its answer goes. Write is the writer's alone because a tool's
answer is read by the model that called it, and a scene handed back that way
is written twice. Compact is the writer's because a summary stands in for the
conversation instead of answering it.

And "role" means two things: a skill's wording on a profile (`ai/roles`), and
which model a piece of work runs on (the Roles setting,
`useApplicationState().roles`, since renamed Workflows).

## Decision: three settings

A skill is a name, a description, a body, and three settings.

**Who may call it.** The model, the writer, or both. Two switches, spelled as
Claude Code spells them: `disable-model-invocation: true` keeps it from the
model, `user-invocable: false` keeps it from the writer. Both are allowed by
default.

**How it runs.** Inline, or on its own.

- *Inline*: its body is instructions that join the conversation of whoever
  called it. This is what a skill is in the Agent Skills standard, and what
  claude.ai and Codex mean by one.
- *On its own* (`context: fork`): a separate inference under its own prompt,
  reading the conversation as a transcript, handing back what it said. All
  four of ours run this way.

**Where its answer goes**, for a skill that runs on its own:

- `result`: back to whoever called it. For the model, the tool result; for
  the writer, a record in their turn, which is what `/interpret` writes today.
- `reply`: it is the reply. `/write` today.
- `summary`: it stands in for the conversation above it. `/compact`, and
  nothing else.
- `edit`: a replacement for a passage in a document. Part 7.

The built-ins, restated:

| Skill | Model | Writer | Runs | Answer |
|---|---|---|---|---|
| Director | ✓ | — | on its own | result |
| Interpret | ✓ | ✓ | on its own | result |
| Write | — until the harness says | ✓ | on its own | reply |
| Compact | — | ✓ | on its own | summary |

## Decision: markup and tool commands are not skills

`/director Wrap this scene up` and `@cody I hide in the closet` run nothing:
they are the writer's words, tagged. `/roll`, `/oracle`, `/roll-table`,
`/name` and `/tarot` run a tool and no model. These stay
hand-written in `COMMANDS`, with their parsers and previews, and appear in
the `/` menu beside the skills. They get no row in the skills list: there is
nothing about them to switch or reword.

A skill the writer can call gets its command from its definition: it
consults, it is repeatable, and it is its own turn when its answer is a reply
or a summary. So `interpret`, `write` and `compact` leave `COMMANDS`.
Compact keeps its `(turns to keep)`, which belongs to the `summary` answer
rather than to the skill.

The Director is one row with a note: the model can ask it, and the writer can
give a direction themselves with `/director`. Both land under `<director>`,
which is already how the Game Master reads either.

## Decision: "skill" for the thing, and no "role" at all

"Skill" is the word writers will know, and Claude Code's `context: fork`
shows the standard has room for skills that run on their own. So running on
its own is a setting, not what makes something a skill.

`ai/roles` folds into `ai/skills`, which becomes the registry. A profile's
`roles` becomes `skills`, keyed by skill name, with a migration for stored
profiles and one for backups.

"Role" was left, at step 1, meaning what the Roles setting gave it: which
provider, model and effort a piece of work runs on. On 30 Sep 2026 that
setting was renamed Workflows (`useApplicationState().workflows`, a job's
`workflow`, schema 21), and the word is gone from the app.

## Decision: built-ins ship as SKILL.md

Each built-in becomes a folder under `ai/skills/` with a SKILL.md, loaded with
`?raw` the way the prompts are and parsed by the same code that reads an
import. The import path is then in use every day, and the format has to
answer to the four skills that were measured.

A built-in may still have code. Interpret draws its card before it runs
and names the draw in its body as `$draw`, a variable nothing else sets. A
library skill is its file and nothing more.

The sampling bags (`DIRECTOR_SETTINGS` and the rest) are all empty today.
They stay as code beside a built-in that needs one, and stay out of the file
format until a library skill needs one too.

---

# 2. The file format

## Decision: SKILL.md, with Claude Code's names for what we share

A skill is a folder with a SKILL.md: YAML frontmatter, then the body in
Markdown. Where Claude Code already has a field for something we need, we
use its name, so its commands and claude.ai's skills import as they are.

| Field | Meaning here |
|---|---|
| `name` | Required. Lowercase letters, digits and hyphens, at most 64 (the standard's rule), starting with a letter (the command line's). It is the command and the tool name. |
| `description` | Required. What it does and when to use it, for the model: it reads this to decide whether to call it, and it is the tool's description. `when_to_use` is appended to it. |
| `disable-model-invocation`, `user-invocable` | Who may call it. |
| `context: fork` | Runs on its own. Absent means inline. |
| `arguments` | The name of its one argument; see below. |
| `argument-hint` | What the writer sees after the name in the menu, e.g. `<question>`. |
| `allowed-tools` | For a skill that runs on its own, the tools it is given: the whole list, as `DIRECTOR_TOOLS` is today. Ignored for an inline skill, which has whatever its chat has. |
| `metadata.inksprite-output` | `result`, `reply` or `edit`. `result` by default, or `reply` when only the writer can call it: a skill nobody else calls is one they wanted to read. |
| `metadata.inksprite-summary` | What it does, in a line, for the writer: the `/` menu and the chat's settings. Falls back to `description`. |
| `metadata.inksprite-argument` | What the model is told about the argument. Falls back to `argument-hint`. |
| `metadata.inksprite-speakers` | What the transcript calls its two voices, e.g. `player game_master`. `user assistant` by default. |

The description is the model's and the summary is the writer's. Claude Code
shows one text to both, but a description tuned for a model — "Ask the
oracle for an idea when the fiction has not settled something and you would
otherwise be inventing it yourself: what an NPC really wants, …" — is a poor
line in a menu, and the built-ins' descriptions were tuned, so they could not
be shortened for the writer's sake.

Our own settings go under `metadata`, because claude.ai refuses a skill whose
frontmatter has fields it does not know.

**Ignored on import**: `model` and `effort`, which name another product's
models, and which model runs a skill is the writer's setup rather than the
skill's content (part 3); `agent`, `background`, `hooks`, `paths` and
`shell`, which are about a coding tool. `license` and `compatibility` are
kept and shown.

**Files**: `references/` and other text files are kept with the skill, and an
inline skill can read them (part 4). `scripts/` and binary assets are dropped,
with a note on import: nothing in the page can run them.

**`context: fork` does not mean quite what it means in Claude Code.** There,
a forked skill runs without the conversation. Ours reads the conversation it
was called in, as a transcript; the Director has nothing to direct otherwise.
A Claude Code skill imported here sees more than it expected, which does it
no harm. One of ours exported to Claude Code runs without the story. We
accept the difference: what both readings share is that the skill does not
run inside its caller's context, and that is what the key says.

## Decision: one argument

A command is everything after its name, the rule `ai/commands.js` already
follows, so a skill takes at most one argument. `arguments: [question]` names
it, and a named argument is required. A library skill's body uses it as
`$question`, or as `$ARGUMENTS`, which Claude Code's files already use; a
body that uses neither gets it appended at the end, under `ARGUMENTS:`.

To the model, the argument is the tool's one string parameter, named as
`arguments` names it and described by `metadata.inksprite-argument`. A skill
with no argument, like the Director, is a tool with no parameters.

The built-ins keep what the model reads today, word for word. Their tool
descriptions became their `description`, and their parameter descriptions
their `inksprite-argument`. The headings their code appends (`## The
question`, `## The brief`) stay in their code rather than moving into their
bodies: a profile that rewords one stores the prompt alone, and a body that
expected to be filled in would lose the question from every one of those.
The document-tools work showed how much a model's use of a tool turns on
this wording, and step 1 was checked against a record of every request the
skills made before it; only the writer-facing text changed. The panel's own
blurbs in `ROLES` went, for each skill's `inksprite-summary`.

The Director, as it would ship:

```markdown
---
name: director
description: >-
  Ask the Director what the story needs next. The Director consults the
  oracle when its advice depends on something the fiction has not settled,
  and says so — ...
user-invocable: false
context: fork
allowed-tools: oracle
metadata:
  inksprite-summary: >-
    Asked what the story needs next, and answers with a beat rather than prose.
  inksprite-speakers: player game_master
---

You are the Director of a text-based tabletop RPG. ...
```

A writer's own, inline, which the model loads when it needs it:

```markdown
---
name: house-style
description: >-
  The house style for this series: tense, point of view, dialogue
  punctuation, words to avoid. Load it before writing or revising prose.
---

Past tense, close third person, one point of view per scene. ...
```

And one only the writer calls, a prompt for the turn they call it in:

```markdown
---
name: tighten
description: Cut a passage by a third without losing a beat of it.
disable-model-invocation: true
argument-hint: <the passage, or which one>
---

Tighten $ARGUMENTS by about a third. Keep every beat; cut what repeats ...
```

## Decision: import and export

Import takes a SKILL.md, a folder, or a `.zip` of one, which is the form
claude.ai takes and GitHub serves. It shows the whole file before saving,
since a skill is instructions the model will follow. A name already taken
asks for another.

Export writes a `.zip` of the skill's folder — a folder of its name, its
SKILL.md and the rest in it — even when there is nothing but the SKILL.md,
because that is the shape claude.ai takes and a skills folder holds, and a
lone `SKILL.md` downloaded is a file every export would call the same. Export
all writes every one of the writer's skills into one.

Two dependencies. `js-yaml` for frontmatter, which the markdown library will
want as well; it came with step 1, because the built-ins are read at startup
and so it is in every page, and it is 14 KB gzipped where `yaml` is 31. And
`fflate` for zips, which is small and has no dependencies of its own.

---

# 3. The library

Settled with the writer on 30 Sep 2026, and built as step 3.

## Decision: app-wide, beside the profiles, and stored as the file

A Dexie table `skills`, app-wide like `chatProfiles`: one row per skill,
holding the SKILL.md as text and the other files that came with it. The text
is the skill. It is read with the same parser the built-ins are, so export
writes back exactly what came in, and a field this app does not use — a
license, a `model`, a key another tool invented — survives the round trip. It
rides in backups.

Built-ins stay source and are listed with the writer's own, read-only. There
is no Duplicate: a built-in is reworded on a profile, in a chat's settings,
for "the same skill in different company", and a different skill is a New
one. Two ways to make a variant of the Director, one of them a copy that
stops picking up improvements, was more to explain than it was worth.

A name is unique across the built-ins, the library, the commands (`roll`,
`oracle`, `director` and the rest) and the registered tools, since it is what
the writer types and what the model calls.

## Decision: what a skill of the writer's can do, for now

| Kind | Steps 3 and 4 |
|---|---|
| On its own, answering back, for the model, the writer, or both | Runs |
| On its own, answering as the reply, for the writer | Runs, as `/write` does |
| On its own, answering as the reply, for the model | Runs since step 4: the turn hands its reply over |
| Inline, for the writer only: a saved prompt | Runs; see below |
| Inline, for the model to load | The model is not offered it until step 5; the writer can call it now, as a saved prompt |
| Answering with an edit | Saved; nothing to put it in until step 8 |

What is saved and not yet offered says so on its screen, in a line: a skill
that looks broken is worse than one that says it is waiting.

A skill of the writer's that runs on its own has no code of its own, so it
runs on a general runner: its instructions (a profile's rewording, if there is
one) with the argument filled in — `$ARGUMENTS` or `$name`, or appended under
`ARGUMENTS:` when the body uses neither — over the conversation, with the
tools it names and the speakers it names. The model's call answers
`{"answer": "…"}`.

## Decision: a saved prompt is the writer's words

A skill only the writer can call, that does not run on its own, is a prompt
they saved: `/tighten the fight scene`. Nothing is asked of a model to run
it. Its instructions, with what they typed filled in, go into their turn as
a record under the skill's name; the record shows what they typed, and the
instructions fold away under it. What the model reads is the instructions.

It asks for a reply, the way a character's line does and a roll does not:
it is the writer saying something. It is not asked again, because nothing
about it was drawn, and an edited turn fills it in again from the skill as
it is now rather than keeping the old text — the rule `/director` already
follows. A record whose skill has since gone keeps what it said.

## Decision: renames carry what hangs on the name

A skill's name is what the writer types, the model's name for the tool, and
the key a profile's rewording and a chat's switched-off tools are kept under.
A rename carries the rewordings and the switches across. The records of old
turns keep the name they were run under, which is history; asking one of them
again after a rename says there is no such command.

## Decision: its other files come along, and wait

A skill's text files are kept with it — references, examples, templates — so
one imported and exported again loses nothing. `scripts/` and anything that
is not text are dropped, with a note on import. Nothing reads the kept files
until step 5 gives an inline skill `use_skill(name, file)`.

## Decision: library skills reach every chat, as built-ins do

A skill the writer wrote or imported joins the `skills` group, so it reaches
every chat that has not switched the group off, and can be switched off in
any one. That is the rule a built-in tool follows (`getEnabledDefinitions` in
`ai/tools/registry.js`), and the trust is the same: the writer put it there
and has read it. Roleplay chats keep the model off all of them, since the
profile withholds the whole group.

A skill only the writer can call is in the `/` menu of every chat regardless.
It offers the model nothing.

## Decision: a profile may reword any skill

A profile can reword a built-in today, which is how Roleplay compacts
differently. That stays, and extends to library skills: the skill's own
wording, and a profile's override of it, with a reset back. Editing a skill
in the library changes its own wording; editing it in a chat's settings
writes the profile's override. The same two layers the built-ins have, with
the library where the source was.

## Decision: a skill runs on the chat's profile, for now

A skill that runs on its own could want a model of its own: the Director on a
small fast one, Write on the best there is. For now every skill runs on
whatever profile the chat uses, as it always has; a model per skill is an
improvement for later.

When it comes: provider, model and effort, where unset means the chat's own.
It lives in app state and not in the skill's file, so it never rides in an
export, since it names this writer's providers. Not in Workflows, which is
the long work jobs do, and a skill is not one; the skill's own screen in the
library is the likelier place. `consult` then has to reach a provider other
than the chat's, as `complete.js` already does for jobs; the skill loop needs
the same, with tools.

An inline skill has none. It runs in its caller's request.

---

# 4. Running them

## Decision: `consult` leaves the chat, with step 8

The skill loop in `composables/useAIChat.js` (`consult`: its rounds, its
tools, its depth) moves into `ai/skills/`, and takes what the skill reads as
an argument: a chat's transcript, or, from the editor, a passage and its
document. The chat hands over its transcript and its tool executor as it
does now. `SKILL_MAX_ROUNDS` and `SKILL_MAX_DEPTH` stay as they are.

Not in step 4. With every skill on the chat's profile, the only caller that
is not a chat is the editor, so the move waits for skills on the manuscript
(step 8), or for a model per skill, whichever comes first.

## Decision: the model can hand the turn to a `reply` skill

When a round's tool calls include a skill whose answer is the reply, the loop
runs the round's other calls, then the skill, streaming what it writes into
the assistant message, and ends the turn there with no round after. What the
caller wrote before the call is kept as working, folded like thinking, and is
not part of the reply. A second reply skill in the same round is answered
with an error: one voice writes the reply.

*Built* (`handOverReply` in `composables/useAIChat.js`). The caller's words
go into the message's thinking, followed by the skill's own thinking as it
streams. The skill's result on the trajectory says it wrote the reply rather
than holding the text again: the message's content is the one copy, and no
round follows to read it. A skill that writes nothing, or fails, gives the
turn back as it was, and the model reads the error in the next round as it
would any tool's. Its tool description gets a sentence after its own saying
that what it writes is the reply and the turn ends there, since a file
written for another app would not say so.

This is what `ai/skills/write.js` has been waiting for ("until a turn can be
delegated to a skill outright"). Write gets a description for the model, and
the chat offers it, once the harness says a chat that can hand off its
writing still reads well.

## Decision: one block per consultation

Every skill the model consults shows in the turn as a folded block of its
own: its name, what it was asked, what it answered, its thinking, and its own
tool calls inside it. The Director block in `ChatMessage.vue` becomes this,
for every skill, and the tool-call panel stops listing skills among the
lookups.

*Built* (`ChatConsultation.vue`, from `ai/skills/consultations.js`). What a
skill did rides on its result as `_consultation` (its thinking, and each call
with its arguments, its result cut to 2,000 characters, and its own
consultation when it was a skill), stripped before the wire like
`_document`. A skill a skill called is a block inside its parent's. One
still running shows by its name while its call is in flight. The note a turn
from before kept for the Director is read into the same block.

## Decision: inline skills load through `use_skill`

The model gets one tool for them, `use_skill(name, file?)`. Its description
lists the inline skills it may load, a line each, and `name` is an enum of
them. It answers with the body and a list of the skill's files; given `file`,
with that file. Asked for a skill already loaded, it says so instead of
sending the body twice.

A load stays where it happened. `use_skill`'s calls are sent back with the
conversation, as the dice's are (`replaysAcrossTurns`), so the body stays at
the point it was loaded and the cached prefix before it is untouched. The
chat records which skills are loaded, and a summary carries them past itself:
the context builder puts them just under the newest summary. The chat's
settings list them, with a way to drop one.

The writer calls one the same way as any other. A skill the model could load,
the writer's `/house-style` loads, and it is kept the same way. One only the
writer can call is a prompt for their turn: `/tighten the fight scene` puts
Tighten's body, with the argument in it, into the writer's turn under the
skill's name, where the record shows the command they typed. It is part of
that turn, and goes where the turn goes.

Only the skills that join the conversation are behind `use_skill`. One that
runs on its own stays a tool of its own (`interpret(question)`,
`director()`): it is a function call with a parameter of its own and an
answer, a small model fills a named, described parameter better than a
generic one, and the Adventure prompt was tuned calling the built-ins by
name. One that joins the conversation has nothing to fill in, so a line in
one tool's list costs less than a tool. If a library collects many skills
that run on their own, the writer's could move behind a dispatcher too and
the tuned built-ins stay named; that waits for a library that needs it.

*Decided with the user, 1 Oct 2026:* `use_skill` is offered in every chat
whose Skills group is on and which has at least one skill to load, as every
library skill reaches every chat; and the writer can load a skill in a chat
whose Skills group is off, since that switch is about the model.

*Built* (`ai/tools/useSkill.js`, `ai/skills/loads.js`):

- The record of a load is where it happened, and nothing else keeps a list:
  a `use_skill` call and its result on the assistant's turn, or the writer's
  command with `load: true` on theirs. What is loaded is read off the
  messages, so a turn rewound takes its loads with it. Asked for a skill
  already loaded, `use_skill` says so; the turn hands it the chat's list.
- The context builder sends every load back where it was made on every
  turn, not inside `replayTurns` the way dice are, since instructions that
  fell out of the window would stop being followed. The loads a summary
  stands in for go just under it: the model's as their call and result, the
  writer's as the line in their turn.
- Each skill the model loads keeps a switch of its own in the chat's
  settings, by its name, which takes it out of `use_skill`'s list for that
  chat; with none left, `use_skill` goes. A skill loaded in the chat says so
  there, with Drop.
- Drop means the skill is not kept past a summary, and nothing else. It
  marks the records, `_dropped` on the model's result and `dropped` on the
  writer's command, and they stay where they are, read there until a summary
  stands in for them; then the skill is not carried under it and is no
  longer loaded. Nothing is edited, and neither counts as an edit. Once it
  is gone the model may load it again, as it may read a document again.
  *Changed with the user, 5 Oct 2026:* Drop used to take the load out of the
  next request. That edited the middle of the conversation, which cost the
  cached prefix from the load on and left the words around it pointing at
  nothing, as Claude Code avoids by having no unload at all; and telling the
  model to stop would not last, since a summary condenses the telling and
  carries the skill whole.
- `file` reads one of the files that came with the skill, by its path in the
  skill's folder, `./` or not. A file read is not a load and is not carried
  under a summary. The load's result says how to read them: told only that
  there were files, GLM 5.2 went for `read_document`, which knows the project
  and not the skill.
- A load is sent back even in a request with no tools offered, as the dice's
  calls already are. Whether every provider takes calls in the history of a
  request that defines no tools has not been checked.

## Later: the app as a caller

The app already calls on models unasked: titles, document summaries,
conversion on import. The skill-shaped one is compaction at a context
threshold, and the Director on every turn was once run that way and removed.
When one is wanted it is a trigger on a skill, not a new kind of thing.
Nothing here builds it.

---

# 5. Where the writer meets them

## Decision: a `/` menu

`/` at the start of a line in the message field opens a menu, since commands
are lines. Filtered as they type, it lists:

- the commands, markup and tools
- the skills they can call, built-in and their own
- prompts from connected servers (part 6)

Each row has the name, its argument hint or usage line, the description in
up to two lines, and a mark on the ones that call the model, which take
seconds where the rest are instant. Enter or Tab finishes the name, with a
space after it, or with none for a command that takes a setting, so the
writer can open the parentheses or not. Enter on a name already typed out in
full sends it, as it would have without the menu. Typing on without the menu
works as it does now, and the unknown-command error stays.

Built first, ahead of part 1, from `COMMANDS` as they stand
(`composables/useCommandMenu.js`, `ChatCommandMenu.vue`); the registry will
feed it the same entries.

`@` gets no menu, for the reason there is no list of characters to check it
against: most of the cast never gets a note.

## Decision: the chat's Skills section lists every skill

The section keeps its place under Tools, with a row per skill, built-in and
the writer's:

- the name, and "built-in" beside the built-ins
- "The model can use it", a switch, for a skill the model may call
- its `/name`, when the writer can call it
- opened: the description, how it runs and where its answer goes, the tools
  it is given, what it runs on (see part 3), and the prompt with the
  profile's override and a reset, as now

Under the list, the skills loaded in this chat, and a link to the library.

## Decision: a Skills section in Settings

The library, beside Workflows, since it is app-wide: every skill, the built-ins
read-only, with New, Import, Export and Delete. A skill's form has its name,
description, summary, the two who-may-call switches, how it runs, where its
answer goes, its argument's name and hint, the tools it is given (a
checklist of the registered ones), and its body. The form is the frontmatter;
the only fields in it that are ours alone are the ones under `metadata`.

"Edit as file" shows the SKILL.md itself, for anything the form does not
reach. Saving from the form writes the frontmatter afresh, so a comment in
it does not survive that; everything else in it does. Whether the form is
the right way in is to be seen once it exists.

Import takes a SKILL.md, a `.zip`, or a folder, and finds every SKILL.md in
what it is given, so a whole skills folder comes in at once; a Markdown file
with frontmatter in no skill's folder is a skill of its own, named for its
file when it names nothing, the way a Claude Code command is. It shows what it
found — each skill, what is wrong with it, what it will not use, what it left
behind, which would replace one of the writer's own, which need another name —
before anything is saved. Export writes a `.zip` of the skill's folder; see
part 2.

---

# 6. Tools from MCP servers

## Decision: remote servers, reached from the page

inksprite has no backend, so it talks to a server from the browser: Streamable
HTTP, falling back to the older HTTP with SSE the way the spec says a client
should. The client is the SDK's (`@modelcontextprotocol/client`, which has
browser shims), imported the first time a server is connected, so a writer
with none loads none of it. If its bundle turns out large, our own is small:
POST and server-sent events, which `complete.js` already reads, and a handful
of methods.

What the browser rules out:

- **stdio.** A server that runs as a local program has to be put behind a
  bridge that serves it over HTTP, such as supergateway or mcp-proxy. A
  pasted entry with a `command` is kept, and shown as needing one. The
  desktop build is where stdio belongs.
- **Servers that will not answer a page.** The server has to allow the app's
  origin (CORS) and expose `Mcp-Session-Id` to it. Many hosted servers expect
  a client with a backend and do neither. A failure that looks like this
  says so, rather than "connection failed".

## Decision: adding a server

Settings gets a Connections section. A server is added by URL, with a name
and, optionally, a header for a key; or by pasting JSON in the `mcpServers`
shape Cursor and LM Studio use, where each entry with a `url` becomes a
server.

On adding, the app connects, lists the server's tools and prompts, and shows
each with its description before saving it: that is what the model will be
told. A table `mcpServers` keeps them. A key in a header rides in backups as
provider keys do. OAuth tokens do not, and a restored server signs in again.

## Decision: OAuth as the spec has it

A server that answers 401 names its authorization server in its resource
metadata. The app signs in with PKCE (S256) and the `resource` parameter, and
the answer comes back to a route of its own, `/connect/mcp`, as OpenRouter's
comes back to `/connect/openrouter`.

For its client ID, the app hosts a Client ID Metadata Document at a fixed
HTTPS path. The spec prefers it, and it suits a static site: no registration
step and nothing to keep. Where the authorization server does not accept one,
Dynamic Client Registration; failing that, the writer enters a client ID. A
copy of the app on localhost or a private host has no public URL for the
document, and falls through to registration.

## Decision: a server is a group, opted into per profile

Each server's tools are a group, labelled with its name, and offered to the
model as `<server>__<tool>`, cut to what a function name may be (64
characters of letters, digits, `_` and `-`). The names are stable, so a
chat's switches and a turn's record keep meaning the same tool.

A server is opted into, not out of. A profile lists the servers it uses, and
a chat copies the list and can change it, as it does everything else a
profile stamps on it. Inside a server a chat uses, the switches are the usual
withheld list, so a tool the server adds later reaches the chats that use it.

The reason is the Roleplay profile. It names the groups it withholds
(`ai/profiles/index.js`), and under the usual rule a server connected
tomorrow would be live in every roleplay chat.

*As built, the list is the other way round:* a server lists the profiles
whose chats use it, set in Settings → Connections. The built-in profiles are
read-only, so a list on the profile would have meant copying Chat to use a
server in it. A chat follows its profile's servers until the writer switches
one in the chat's Tools section, which writes the chat's own list
(`mcpServers`); moving the chat to another profile clears it again. A server
being added is set to the default profile unless the writer says otherwise.

## Decision: ask before a call, and propose every edit

A tool marked `readOnlyHint` runs when it is called. Any other call shows in
the turn and waits for the writer: Allow, Always allow, or Deny. Always allow
is this tool, or everything from its server, the tools it adds later
included; the server's settings have the same as a switch above its tools. A
server whose tools mostly do not say they only read would otherwise ask once
for each of them, one turn at a time. The wait does not count against the
tool's time limit. A hint is only the server's word, but a server the writer
does not trust should not be connected at all.

While a server's tools are offered in a turn, the document tools propose
their changes whatever the edit setting says. A tool's answer is text from a
stranger, arriving in the same context as `edit_document`.

Text in an answer goes to the model, structured content as JSON. Images and
anything else are left out with a note, until something needs them.

## Decision: a prompt is a skill from a server

An MCP prompt is something only the writer calls, with a body that comes from
the server: an inline skill for one turn. It appears in the `/` menu as
`/<server>:<prompt>`, the way Claude Code names a plugin's skills. The text
after the name fills its first required argument; the app asks the server for
the prompt, and the text that comes back becomes part of the writer's turn,
as Tighten's body does. A prompt with more than one required argument is
listed in its server's settings and not offered yet.

## Decision: a server's answer can be saved to the project

What a tool returns is the model's for one turn; the next sends the
conversation's words and not the calls. The reference material a design is
written against — an issue, a page — has to outlast that. Every hosted
server tried delivers its content through tools rather than resources
(below), so the keeping happens there: each server tool's result in a turn's
tool panel has Save to project, which asks for a title and a folder and
writes it as a text document. Its first line says where it came from and
when, since a saved page is a copy. JSON is kept as a block of JSON. The
folder last saved to in a project is offered next time (`mcp/saved.js`,
`SaveToolResultDialog.vue`).

## Not now

- Resources, which would arrive as documents. Of five servers probed on
  3 Oct 2026 without signing in, four declared them and one listed any:
  Hugging Face, whose 158 are skills served as `skill://…/SKILL.md`. Those
  could be imported into the skills library from Connections, if more
  servers serve skills that way.
- Sampling, where a server asks the client for an inference on the writer's
  model. That is a skill served from elsewhere, the shape inksprite's skills
  already have, and few servers use it.
- A server tool the writer calls themselves, as `/roll` calls the dice: worth
  having for a tool that takes one string, after prompts.
- Elicitation, and servers with interfaces of their own.

---

# 7. Skills on the manuscript

Sketched, not decided.

The writer selects a passage, opens a menu on it, and picks a skill: Tighten,
Describe, Critique. It runs on its own, reading the passage, the document's
title and the text around it, and no conversation. Its answer is `edit`: a
replacement for the passage, shown as a suggestion the writer accepts or
rejects.

It needs two things the editor does not have: a menu on a selection, and
suggestions, which the comments prototype plans (CriticMarkup's
substitutions). Until then there is nowhere for its answer to go.

---

# Order of work

1. **The registry.** Built-ins as SKILL.md with a parser; `ai/roles` into
   `ai/skills`; a profile's `roles` to `skills`, with the store and backup
   migrations; commands generated for Interpret, Write and Compact.
   `ai/skills/plan.md`, which nothing imports, goes. Nothing the model reads
   changes. *Done.* What a writer could notice: the chat settings list
   Compaction as Compact, each skill's line there is its summary, and
   `/interpret` or `/write` with nothing after it says "needs something to go
   on" rather than giving an example.
2. **The `/` menu.** *Done, ahead of step 1.*
3. **The library.** The table, holding the file; a registry that changes as
   the library does; the general runner, and saved prompts in the writer's
   turn; Settings → Skills, with the form and the file; import and export.
   *Done*, and checked in the browser with a skills folder holding an inline
   skill with a reference, a forked one with scripts, a Claude Code command
   and a name that clashed with a built-in. Not yet run against a model: a
   forked skill of the writer's is covered by tests, over the same `consult`
   the built-ins use.
4. **Running them.** One block per consultation; the reply hand-off, and
   Write offered to the model after harness rounds. *Built except the last*:
   the blocks and the hand-off are covered by tests and checked in the
   browser; Write stays the writer's until harness rounds say a chat that
   hands off its writing reads well. Skills run on the chat's profile; a
   model per skill, and `consult` out of the chat, come later (part 3, and
   step 8).
5. **Inline skills.** `use_skill`, replay, carrying loads past a summary,
   the writer's calls. Measured in the harness: a list of skills in a tool
   description is new for a small model to read. *Built*, and covered by
   tests. Checked in the browser on GLM 5.2 (1 Oct 2026), one run each: it
   loaded a house style unasked before writing, kept to it, did not load it
   again on the next turn, and read its file through `use_skill` once the
   result said how; Drop took it out of the next request, as it did then
   (it now waits for the next summary). The harness rounds
   wait on the user.
6. **MCP tools.** Connections, the client, a group per server opted into per
   profile, asking before calls, edits proposed; then OAuth. *Built*, OAuth
   included (`src/mcp/`, Settings → Connections, `stores/mcpServerStore.js`,
   schema 22); see the notes under this list. Still to come: a client ID the
   writer enters, for an authorization server that takes neither a metadata
   document nor registration.
7. **MCP prompts** in the menu. *Built*: `promptCommands` in
   `mcp/servers.js` and `serverPromptCommand` in `ai/commands.js`. A
   command name takes one colon, for `/` and not `@`, so `@Vivi:hi` is still
   Vivi. The text after the name fills the first required argument (the first
   argument, when none is required), or goes after a prompt that takes none,
   as `ARGUMENTS:`. The prompt is fetched afresh each time, an edit included,
   and a failure stops the turn being sent with the reason. Connections lists
   every prompt, saying which need more than one thing filled in.
8. **Skills on the manuscript**, once the editor has suggestions.

## Step 6 as built, and the servers it was tried on

The client is the SDK's `@modelcontextprotocol/client` 2.2, loaded on first
use: 322 KB minified, 89 KB gzipped, a third of it zod. Streamable HTTP, with
SSE as the fallback on a 400, 404 or 405. One connection per server, kept for
the session, opened again once on a forgotten session or a dropped
connection. A server's tools are registered from what it offered when it was
last listed, so nothing connects until a tool is called.

A tool's text goes to the model as text, not as a JSON string; structured
content as JSON when there is no text; images and other media are left out
with a note; an answer the server marks as an error goes back as one. A call
waiting on the writer shows in the turn with Deny, Always allow (the tool or
the server) and Allow; the wait is not timed, and a stopped turn denies it.
While any server's tools are offered, the document tools propose every
change. `harness/mcp-server.js` (`npm run mcp-server`) is a server to try it
all on: a tool that reads, one that writes, one that fails, a prompt,
sessions, `--key` and `--no-cors`.

What a browser needs from a server, probed on 1 Oct 2026 from an origin of
`http://localhost:8002`:

| Server | From a page | Sign-in |
|---|---|---|
| DeepWiki, Context7, Cloudflare docs | Yes | None |
| Hugging Face | Yes, with a session | None, or OAuth |
| Linear, Notion | Yes | OAuth: DCR and client ID metadata documents, PKCE, a public client, CORS on every endpoint |
| Cloudflare observability | Yes | OAuth: DCR, no metadata documents |
| Atlassian | Yes | OAuth: DCR; protected-resource metadata not at the path it should be, so discovery falls back to the origin |
| GitHub | Yes | Its OAuth cannot work from a page (no DCR, no CORS on the token endpoint); a personal access token in a header can |
| Sentry, Asana, Vercel, Supabase, Stripe | No: no CORS on the MCP endpoint | — |

Checked in the browser: the test server added by address and kept; DeepWiki,
Sentry and a server run as a program pasted as one `mcpServers` block, which
listed, said it could not be reached (CORS), and was kept as needing a bridge;
Linear said it asks to sign in. On GLM 5.2, a turn ran the test server's
read-only lookup without asking and waited on the note it was asked to save
until Allow, and a DeepWiki tool ran from the page once allowed.

### Signing in, as built

`src/mcp/auth.js` is the part of OAuth the SDK leaves to the app:
- the `OAuthClientProvider`: where things are kept, and how the writer is sent;
- `startSignIn`, which runs the SDK's `auth`;
- `finishSignIn`, for the callback.

A server that answers 401 while being added, or after it was kept signed in
and is not now, offers Sign in. That opens a tab straight from the click,
since one opened after waiting on discovery is a popup, and sends it to the
authorization server once discovery and registration are done. The tab comes
back to `/connect/mcp` (`components/oauth/McpCallback.vue`), which trades the
code for tokens, announces the server on a `BroadcastChannel`, and closes.
The broadcast is used rather than `window.opener` because an authorization
server's COOP header can sever the opener.

The state is read first and used up whatever came back, so a cancelled
sign-in names its server and the tab waiting on it hears. Cancel frees the
button when the writer closes the tab without finishing.

Credentials live in this browser's local storage, keyed by the server's
address and then by issuer, never in the database. A backup is a file the
writer hands around, and a restored server signs in again.

Asked for tokens with no issuer, which is the transport reading the bearer
token, the provider returns the newest set, as the SDK requires; returning
nothing there was the first bug. A connection carries the sign-in only once
there is one, so before that a 401 is the answer and the sign-in is the
writer's to start. A call made mid-turn never opens a tab: a lapsed sign-in
that a refresh cannot mend fails with a message saying to sign in from
Settings.

The client ID metadata document is `public/oauth/mcp-client.json`, served
at `https://inksprite.io/oauth/mcp-client.json` and used only by a page on
that origin. Everywhere else (localhost, previews, a writer's own host) the
app registers itself with Dynamic Client Registration. An authorization
server that offers neither is not supported yet; the writer entering a
client ID is still to come.

`harness/mcp-server.js --oauth` is its own authorization server, with
protected-resource metadata, authorization-server metadata, DCR, a consent
page, PKCE checked at the token endpoint, and refresh tokens; `--expires`
makes tokens lapse. `test/mcp/auth.test.js` runs the whole flow against it in
Node, a lapsed token refreshed included.

Checked in the browser on 1 Oct 2026:
- The test server: the sign-in tab opened on its consent page, came back
  and closed itself, and the server listed and was kept, shown as signed in.
- A tool called in the page carried the token. After Sign out, the row
  offered Sign in again and a call said to sign in.
- Linear: discovery and registration ran from the page, and its consent page
  named inksprite, `https://inksprite.io` and the local return address. It was
  not approved: the test browser was signed in to a Linear workspace that is
  not the app's to grant.

# Open questions

- Is `<server>__` too long a prefix for a small model that reads every token
  of every tool name?
