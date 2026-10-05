# Transcript harness

Chat as the app runs it, from the terminal, written to files. The point is
to tune a prompt by reading what it produces: run a scenario a handful of
times, score the transcripts, change the prompt, run it again.

The turn is the real one. A fixture project is built through the stores,
the chat goes through `composables/useAIChat.js` with the context builder
and the document tools, and the request is built by `ai/wire.js`. Nothing
here re-implements the app; the browser is replaced by happy-dom and
IndexedDB by fake-indexeddb, and that is all.

For questions about the request itself, what a turn sends back to itself
after a tool call, or how a backend renders the template, use
`scripts/chat-harness.js` instead. That one varies the wire; this one
reads the prose.

## Running

    npm run transcripts -- --scenario riley-noah-argument --runs 5
    npm run transcripts -- --scenario riley-noah-argument --endpoint lmstudio
    npm run transcripts -- --scenario riley-noah-argument --prompt harness/prompts/minimal.md

Endpoints come from `scripts/endpoints.local.json`, keys and all, which is
why it is not committed; `scripts/endpoints.example.json` shows the shape.
`--endpoint` picks one by name, the first in the file otherwise. `--model`
overrides the model the entry names. An OpenRouter entry takes a `routing`
block in the app's shape — `only`, `ignore`, `quantizations` — and gets
the app's floor (no data collection, zero data retention, eight-bit
precision or better, and Morph left out unless the entry's `ignore` says
otherwise) whether or not it has one. Routed by price with no
floor, a model is served at fp4 as often as not, and nothing in a
transcript says which; every run now records which upstream served each
request (`meta.json`, and the timing line under each gm turn), and a batch
worth comparing is one served at one precision.

## What a run writes

Each batch goes to `runs/<timestamp>-<scenario>/` (ignored by git):

- `run-N.md` — the transcript to read: what was said, which tools the model
  called and what came back, the reply, the token counts.
- `run-N.json` — the chat's messages as stored, trajectory included.
- `requests-N.json` — every chat completion request the app sent, in order.
  The first is the title call; the next is the turn, system prompt and
  project block and all. This is what the model saw. Each carries the
  `usage` the server reported for it, which is the only record of what a
  skill's own requests cost.
- `log-N.txt` — everything the app logged during the run.
- `meta.json` — endpoint, model, prompt hash, timing and usage per run.

## Scenarios and fixtures

A scenario (`scenarios/<name>.json`) names a fixture and what the writer
says, one message per turn:

    { "fixture": "riley-noah", "messages": ["Write the scene where…"] }

A message is submitted the way the composer submits it, so one that begins
with a slash runs the command: `"/write Write the scene where…"` exercises
the write skill on its own prompt, and `--prompt` then only governs the
chat around it. A command's turn reports no usage, since a consultation's
tokens are not recorded on its message; the request bodies still are.

A fixture (`fixtures/<name>/`) is a project: `project.json` names the
title, the root summary, and the documents, each a markdown file beside it.
See `seed.js` for the shape. Every run builds a fresh copy, so a turn that
writes to the project does not leak into the next run.

A document entry can name a character card instead of a file
(`"card": "../../cards/Riley.json"`, PNG or JSON), which goes through the app's
own importer and lands as the folder an import leaves — description, example
dialogue, greetings, the hidden rules and sidecar — titled by the path's last
segment. `"hidden": ["greeting"]` then hides documents of those kinds from
the model, the way a writer hides one in the tree. `riley-card` is
`riley-noah` with Riley as a card (`cards/Riley.json`, written for the
harness) in place of her note, greetings hidden. Cards under `test-cards/`
are other people's and not committed, so a fixture that names one only runs
where the card is.

A message can also be an object: `{ "text": "…", "mentions": ["150 ?ms"],
"reads": ["Notes/Meeting 2026-09-09"] }`, carrying what the turn is expected
to do. `tools.js` checks each expectation against the transcript and the
`state-N.json` the runner writes after every turn (every document's text and
summary, and the chat's pins). The keys are `mentions` (regexes the reply
should match), `reads` (documents the turn should have to hand — read this
turn, or kept when the turn began), `finds` (read, or turned up by a
search), `pins` and `pinnedAtEnd` (what the chat keeps, which the writer
sees as pins), `noWrites`, and `document`, `notContains` and `summary` for
what a document should say afterwards. See `run.js` for the shape and
`scenarios/findable-design.json` for a whole one. `findable` is a design
workspace of 38 documents for exactly this: whether the model finds, reads,
keeps and edits the right things across a long chat; `findable-keep` edits
one document over eight turns without ever saying "keep", to see whether
the model keeps it or reads it every time.

A scenario can put skills in the writer's library before the first run:
`"skills": ["house-style"]` names folders under `skills/` (or paths relative
to the scenario), each a `SKILL.md` and whatever files sit beside it, which
come along by their path in the folder (`references/voice.md`), the way an
imported skill keeps its files. They go in through the store the Skills
settings save with, so the model is offered them as it would be in the app:
one that joins the conversation through `use_skill`, one that runs on its own
as a tool of its own. The library is app-wide, so every run in the batch sees
the same skills, and `meta.json` lists them. A file the parser refuses, or a
built-in's name, stops the batch rather than leaving the skill out. The
`riley-noah-house-style` scenarios run `skills/house-style`, a house style
whose rules a regex can count (`rules/house-style.json`, below), against a
scene, a question that wants no style, and two scenes in one chat.

Findings from the batches, and the things that are not about one batch, are
in `findings.md`. `dialogue.js` is a separate runner for the multi-agent
scene architecture; see its module comment.

## Game Master architectures

    npm run gm -- --arch planner --runs 3 --endpoint openrouter --model z-ai/glm-4.7
    npm run gm -- --arch single --thinking off

`gm.js` runs the adventure scenario under architectures that separate the
Game Master's planning and tool calls from its narration: `single` (one call
with tools, the control), `planner` (a planner with tools writes a beat, a
narrator with none writes the turn), `questions` (a questioner lists the
yes/no questions the turn hinges on, the runner asks the oracle, the
narrator writes from the answers), and `referee` (the Game Master drafts,
a referee with the oracle rules on what the draft decided, the Game Master
revises). The role prompts live in `gm/`, one file each, and the notes ride
inline in every system prompt. Batches go to `runs/<stamp>-gm-<arch>/` in
the same shape as the transcript batches, with the machinery stages
rendered above the narration the player saw. `npm run surface` reads them.

## Surface checks

    npm run surface -- harness/runs/<batch>

Counts what does not need a reader: words per turn, tool calls by name, a
pre-tool preamble fused to the prose, non-Latin script in the output, empty
turns, and hits against the fixture's `surface.json` — the sample lines a
character note quotes, the secrets a premise says are unstated. Run it on a
batch before sending it to the scorers: a rule that plainly did not hold
shows up here in seconds, and the counts are comparable across batches in
a way five readers' scores are not.

`counts` in `surface.json` are counted by how often they occur, per turn,
rather than whether. `--rules <file>` lays another spec over the fixture's,
for rules that belong to something else — a skill's house style, counted the
same way in a batch that ran with the skill and in one that did not:

    npm run surface -- --rules harness/rules/house-style.json harness/runs/<batch>

`use_skill` calls are listed by what they asked for: a load by the skill's
name, a read of one of its files as `name:path`.

## Tool checks

    npm run tools -- harness/runs/<batch>

For a chat that works on the project rather than writes prose: per turn,
what was read (and whether it was already in the block), searched, written
and pinned, which tool calls came back with an error, the prompt tokens the
turn cost, and whether the scenario's expectations for that turn held. The
last lines say which turns failed across the batch and why, which is what
to change something about. `meta.json` records the commit the tools were
at, since tool definitions are code and a prompt hash does not cover them.

## File import checks

    npm run files -- harness/research
    npm run files -- harness/research/papers --show 400

Runs the app's own importer (`src/files/inspect.js`) over every file under
a folder and prints one line each: how long it took, the size, the pages
and words read out, the media type, and the first words. `--show N` prints
the first N characters of each extraction. `harness/research/` is where
real papers, books and saved pages go; it is gitignored, being other
people's work. A PDF with no words is a scan; a page whose first words are
its menu is a reader to fix.

## The loop

1. Run the scenario five or so times.
2. Run the surface checks, or the tool checks for a project-work scenario.
   If the rule under test did not hold on the counts, there is nothing for
   the scorers to add.
3. Score each transcript against `scoring.md` — or `scoring-research.md`
   for a chat over notes. Subagents do this well: one per transcript, in
   parallel, each returning the report the rubric asks for.
4. Change the prompt for the top problem that recurs across runs, not the
   one that happened once.
5. Run again. `meta.json` carries the prompt hash, so two batches are
   comparable.
