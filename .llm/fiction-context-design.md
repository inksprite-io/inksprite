# Context Architecture for LLM Fiction and Roleplay

Design notes for inksprite and the TTRPG flow.

---

## 1. The core problem

Prose quality degrades as character and setting context is added. A bare scene beat
("Riley and Noah argue about his new gaming console") produces believable output. Adding
"Riley is petite, red hair, freckles" produces hair that bounces wildly. Adding "emotional
and explosive" produces `she yelled, explosively`.

Three mechanisms, stacked.

**Lexical echo.** Tokens in context raise their own probability of reappearing. `explosive`
in the prompt makes `explosively` cheap in the output. The model isn't reasoning about how
an explosive person behaves — it's performing the lowest-cost surface transformation
available, adjective to adverb. Same reason `petite` returns as "her petite frame."

**Slot colonization.** Prose has structural slots that need filling: dialogue tags, action
beats between lines, interiority. Each slot gets filled with whatever is most salient in
context. If the only concrete details supplied are hair and freckles, those win every slot
competition. With no character details, slots get filled from the general fiction
distribution instead — more varied, usually better.

**Genre shift.** This is the largest effect. A bare scene beat resembles the front matter of
actual fiction, so the continuation is drawn from fiction. A block of attributes followed by
"now write the scene" resembles a writing-prompt forum post, an RP character card, a
creative-writing exercise. That training data is dominated by amateur work. The character
sheet is a genre signal, and the genre it signals writes badly.

One caveat on the comparison: with no spec, nothing can be violated. Some of the perceived
drop is gaining the ability to see errors. But not most of it — the adverb problem is real
degradation.

---

## 2. Context architecture

**This is where most of the win is, and it requires no machinery.** Everything in later
sections is cleanup for material that shouldn't have entered context in that form.

### 2.1 Traits → behaviors

The conversion rule: for every trait, ask what someone would have had to watch the character
do to arrive at that word. Keep that. Discard the word.

| Given | Converted |
|---|---|
| petite | closes distance when angry instead of backing off; stands when others sit; puts a hand flat on the table to take the room |
| red hair | dyed it brown at nineteen; her mother didn't speak to her about anything else for a month |
| emotional | her anger arrives about a minute before she knows what it's about, so her first three lines in any fight are about the wrong thing |
| explosive | opens reasonable, almost conciliatory; around the third exchange starts citing precedent — the thing he did in March; goes personal faster than she means to, hears herself doing it mid-sentence, finishes the sentence anyway |

Why this works mechanically: there is no adjective left in context to recycle into a dialogue
tag. The model can't convert a described action into an adverb.

Additional layers worth writing:

- **Contradiction.** "Explosive" is a steady state and a steady state has nothing to narrate.
  "Explosive about small things, very quiet about the big ones" forces a choice about which
  mode this scene is in, and choosing is where characterization lives.
- **Negative space.** What the character *never* does. "Doesn't cry in an argument. Won't
  leave the room — will stand in a doorway for ten minutes rather than walk through it."
  Prohibitions are load-bearing in a way permissions aren't; they force the model off the
  default move.
- **Voice.** Sentence length under stress. Register when being unfair. What they say instead
  of "I'm sorry," because they don't say that. Two or three lines of actual dialogue beat any
  amount of description — dialogue can't be paraphrased into an adverb.

**Format matters as much as content.** Write the document as prose, in something near the
narrative voice, as if by someone who knows them. Not headed sections, not bullets. This keeps
the model in the fiction distribution rather than the prompt-response one.

### 2.2 The conversion is promptable

It's a transformation, not an invention — cheap models do it well, and it's paid once per
character rather than once per scene.

> Convert these notes into a behavioral sketch. Every trait adjective must be replaced by
> something an observer could have watched her do to earn that word. No adjective from the
> notes may appear in the output. Give me: how she escalates across an argument, in order;
> how long between feeling something and knowing what it is; three things she will never do;
> two lines of dialogue in her voice; one physical habit that is not crossing arms, clenching
> a jaw, or tucking hair. Invent specific history where it helps — named incidents, actual
> dates. Write it as prose, as if by someone who knows her.

Three non-obvious requirements in there:

1. **Name the failure, not just the goal.** Stating the mechanism being avoided ("so the prose
   model never sees a trait adjective it can recycle into a dialogue tag") measurably improves
   output over stating the desired outcome.
2. **Impose a checkable constraint.** "No adjective from the input may appear in any form" is
   mechanically verifiable and forces real work. Without it: "she's explosive, meaning she
   reacts strongly" — paraphrase in a costume.
3. **Ask by category.** Left open, expansion drifts back toward description. And ban the stock
   gestures explicitly, or you get arms crossed, jaw clenched, hair tucked.

Generate more than needed and cut. The cutting is where taste enters and shouldn't be
delegated. Expect dialogue lines to be the weakest output — generate six, keep two.

### 2.3 Setting is physics, not atmosphere

Same failure class. Given "apartment during a heat wave, old window AC that only cools
directly in front of it, grad student grading papers," the model returned humidity as a
physical weight, air like lukewarm soup, an ancient rattling beast of an AC — every spec item
discharged in three sentences, in the order given.

Two specific failures worth naming:

- **The task disappeared.** Grading, the only thing in the spec that could generate a scene,
  compressed into the abstract noun "stress" and vanished.
- **The constraint became a characterization.** The AC's limited radius — the actual idea in
  the premise — came back as "ancient, rattling beast." A spatial rule was converted into an
  adjective.

A good setting line states what the character cannot do, or what it costs to do it. The AC's
range isn't a description, it's a geometry: the cold air and the desk are in different places,
and Noah has to pick one. That single fact is the scene, and it produces sensory detail as a
byproduct.

Follow the consequences: grading on the floor means no desk means the stack slides. Sweat on
the heel of the hand smears ink, so he works with a paper towel under his wrist. A box fan
solves the heat and scatters the papers. None of it requires describing heat.

Working spec:

> Late afternoon, third day of the heat wave, upper-floor apartment. The window unit cools
> roughly three feet in front of it and nothing else; the desk is across the room. Noah has 40
> papers to get through, due tomorrow. In reach: the papers, a red pen, a box fan, a glass
> that's been sweating a ring into the wood, a laptop running hot on his legs, a phone too
> warm to hold against his face.
>
> Do not describe the heat directly. No similes for heat or humidity. Temperature enters only
> through what it does to objects and what it prevents Noah from doing. No more than two
> physical details per paragraph; most of the apartment should never be described. Conditions
> worsen across the scene.

The object list does more work than anything else there. Sensory prose is made of props; without
them the model reaches for abstraction, because abstraction is free. The direct prohibition on
describing heat feels perverse and is the highest-yield line in the prompt — it removes the lazy
option and what's left is the apartment.

Also: route perception through the task (the apartment is only noticed where it interferes with
grading, which is how attention works), and specify a **gradient**, since a steady state has
nothing to narrate.

### 2.4 Planning documents must not rise a level

Observed failure: a good brainstorm produced specific, unequal details — stale cigarettes and
chemical smell at Riley's, coffee and old textbooks at Noah's. The summarization step compressed
these into:

> **The Two Worlds:** A sequence contrasting Riley's home (stale cigarettes, chemical smells,
> shouting/oppressive silence) with Noah's apartment (coffee, old textbooks, humming AC).

After which every scene contained some version of "she was the chaos to his order."

The brainstorm wasn't the problem; the summarizer was. Its job is compression, and the cheapest
compression is to keep the pattern and demote the instances to parentheticals. Then a *named
thematic abstraction* sits at the top of an injected file, which reads as a requirement, and the
model discharges it the fastest way available — by stating it.

**For fiction, compression must run the other way: keep instances, discard abstractions.** An
instance is generative — "the chemical smell" can be deployed fifty ways. An abstraction is
prescriptive — "two contrasting worlds" has one move and the model makes it every time.

Rules that follow:

- **No thematic entries in planning docs.** Every entry is something that happens or something
  that is true. No entry may name a pattern, a contrast, an arc, or what a sequence is "about."
  If the model wants to write "The Two Worlds," it should write the two scenes instead.
- **Don't store themes; derive them.** Ask in a separate conversation and read the answer. The
  moment it's in an injected file it stops being an observation and becomes a directive.
- **Split contrasts across documents** so they have no single home. Cigarettes go in Riley's
  file, coffee in Noah's, neither file knows about the other. Contrast is a reader-side effect
  and still lands; there's just no retrievable object for the model to execute.
- **Schedule it if kept.** A contrast deployed once is a device; deployed every scene it's an
  allegory. Name the two or three scenes where it's active.
- **Corrupt the pattern deliberately.** Noah's apartment gets one genuinely revolting thing —
  something furred at the back of the fridge he's known about for a month. Riley's house gets one
  thing maintained with real care. Breaks the clean mapping and is also just truer.
- **Never describe characters as a pair.** If notes anywhere say Riley and Noah are opposites,
  the "X was the A to his B" sentence has been requested. Describe each alone.

### 2.5 Appearance budget

Physical details as a list where each item can be spent once, ever, then struck off. Red hair is
used the first time someone needs to spot her across a room, then it's gone. Roughly what good
prose does naturally; making it an explicit rule costs nothing.

For the TTRPG case there's an out that fiction doesn't have: a GM just *says* what someone looks
like, once, out of narrative voice, on first encounter. Players accept this completely because
it's how the medium works. The description is then spent and scene prose never carries it.

**Product tension, for the multi-user case:** users write these documents because they want the
details used. If Riley's hair never appears at all, some fraction will conclude the app is
ignoring their worldbuilding and respond by writing more emphatic documents, which makes it
worse. Suppression must be partial and legible.

---

## 3. Prompt-layer shape constraints

The distinction that matters: **shape constraints generalize; phrase bans accumulate and
interfere.** Phrase bans also put the banned construction in context, which is a mild version of
the echo problem — "never write 'she was the chaos to his order'" is a demonstration of the
sentence.

### 3.1 Killing "X was the A to his B"

This isn't a phrasing, it's a **vantage**. It requires a narrator standing outside both people,
seeing them as types, in a moment where nothing is happening. Ban the wording and the model routes
into synonym frames: "where he was careful, she was reckless," "he was all edges; she was all
motion," "two halves of the same broken thing."

Remove the vantage instead:

- **Lock POV tight.** Third limited, inside one head, no access to the other character's interior.
  A person cannot think this about themselves and someone standing in front of them. The frame
  becomes *unavailable* rather than discouraged. Kills more of this family than any wording ban.
- **Ban summary at close.** These sentences are almost always terminal — end of paragraph, end of
  scene, where the model reaches for assessment while wrapping up. Require every paragraph and
  scene to end on action, dialogue, or a physical object.
- **Kill the noun class.** The frame needs abstractions in its slots: chaos, order, fire, ice,
  storm, stone, noise, silence. Prohibit abstract nouns as predicates for people. The syntax
  survives with nothing to put in it.
- **Redirect rather than prohibit.** Give the comparison to a *character*. Noah can absolutely
  think this about Riley — in his head it's wrong, or self-serving, or something he's told himself
  since March. It becomes characterization instead of authorial assessment. Redirects hold better
  than prohibitions because the impulse has somewhere to go.

### 3.2 Dialogue constraints

Sample of the failure mode:

> "Noah," she groaned, her voice echoing from the floor. "This is stupid."
> He didn't turn around. "Math isn't stupid, Riley. The way you're approaching the problem is just
> inefficient."
> "It's all stupid. Why do I need to know how to find X? X is gone. Let it stay gone."

What's wrong, in order of severity:

1. **They're answering each other.** Every line responds directly to the previous line, on topic,
   in order — a clean call-and-response ladder. Real argument is mostly people talking past each
   other: answering the previous line *but one*, ignoring the question and asking a different one,
   responding to tone instead of content, continuing a thought interrupted thirty seconds ago.
   This is structural and no amount of voice work fixes it.
2. **`stupid` appears in all three lines.** Lexical echo operating *inside* the passage. Reads as
   a deliberate motif; is actually the cheapest available token. The closing joke is built out of
   it, which is why the whole thing feels closed and sketch-like.
3. **Noah's line is doing the author's work.** A correction, a name-use, and a characterization of
   him as precise, addressed to someone who already knows all of it.
4. **The joke is a standup beat.** Setup, turn, landing. Characters say funny things by accident,
   mid-frustration, without a clean two-beat structure.

Promptable rules (all mechanical, all shape constraints):

- No character says another's name except to genuinely get their attention. Models use names as
  beat-markers; people barely use them.
- No one explains their own reasoning. In a long-running relationship nobody explains their
  position to someone who's heard it. Shared history stays load-bearing and unstated.
- Two of the next six lines must fail to address what was just said.
- Characters want different things *in the conversation*. If Riley's goal is to stop working and
  Noah's is to not be the one who says so, the topic becomes a proxy and the exchange stops being
  a debate.
- Let the scene continue past the joke. The best version of the X line is the one nobody
  acknowledges.

What is **not** promptable: placement. Which line should land, where the joke should die. That's
taste and it isn't going in a rule.

---

## 4. Detection layer

Regex-based linting over the tiptap document. Cheap, deterministic, and — critically — it doesn't
share the generator's blind spots. An LLM critic is worse at exactly this task, because spotting
one's own house style is the thing it's bad at.

### 4.1 Decorations, not marks

A ProseMirror `Decoration` is computed from the document and lives in plugin state. A mark lives
*in* the document. Implementing flags as marks means storing lint results in the user's prose,
dirtying the doc every analysis pass, fighting undo history, and shipping highlight spans into
exported text. Decorations are ephemeral and correct.

### 4.2 Scheduling

Not during streaming — partial sentences false-positive constantly and flicker is unpleasant. Run
on stream end, then on ~500ms debounce of doc changes. Skip the block containing the cursor.

### 4.3 Rules as data

The stock-gesture detector (arms crossed, jaw clenched, breath he didn't know he was holding) is
the same pipeline with a different list. Make rules JSON from the start.

```js
{
  id: 'copula-abstraction',
  pattern: '\\b(?:he|she|they|{{NAMES}})\\s+(?:was|is|were)\\s+(?:the\\s+)?{{ABSTRACT}}\\b',
  severity: 'warn',
  terminalBonus: true,   // upgrade to 'flag' if sentence-final in block
  message: 'Character summarized as an abstraction.'
}
```

`{{NAMES}}` interpolates from character docs; `{{ABSTRACT}}` from a user-editable lexicon (chaos,
order, fire, ice, storm, stone, steel, silence, static, wreckage, anchor, hurricane, ember, void).
The lexicon is the load-bearing part and it's story-specific.

`terminalBonus` matters more than it looks: these constructions cluster at paragraph and scene
ends, so position is real signal. Using it allows loose patterns without drowning in noise.

**Strip dialogue before matching.** Characters are allowed to say this — that was the redirect.
Blank out quoted spans, replacing with same-length whitespace so offsets survive.

### 4.4 Offset mapping

Build text and position map in one walk. Accumulating per text node rather than assuming
`pos + 1 + i` is what keeps this correct across marks, hard breaks, and inline nodes.

```js
function blocks(doc) {
  const out = []
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    let text = '', map = []
    node.descendants((child, offset) => {
      if (child.isText) {
        for (let i = 0; i < child.text.length; i++) map.push(pos + 1 + offset + i)
        text += child.text
      } else if (child.isLeaf) {
        map.push(pos + 1 + offset); text += ' '
      }
    })
    out.push({ text, map })
    return false
  })
  return out
}
```

A match at `[s, e)` becomes `Decoration.inline(map[s], map[e - 1] + 1, { class: 'lint-warn' })`.
Between recomputes, map through transactions with `set.map(tr.mapping, tr.doc)` so highlights
track edits instead of jumping.

### 4.5 Flag, never block

Squiggle underline, hover for the rule message, click to dismiss.

**Log dismissals with the matched text.** This is the actual point of the system. After fifty
scenes the log shows which frames recur — frames appearing constantly are evidence that a shape
constraint isn't covering that class, which is the signal to adjust the prompt. Not a hunch, a
count. Frames always dismissed are bad rules and get deleted.

### 4.6 Why both layers

They fail differently. Prompt constraints are cheap and shape the whole distribution, but are
unfalsifiable — you can't tell whether a rule works, or whether adding the twentieth silently
broke the third. Detection is falsifiable and free per scene but only ever a net over what already
came out. The prompt operates on classes; the detector operates on instances.

**The detector is the measurement instrument for the prompt**, which is otherwise tuned by vibes.

Rough allocation of the win: most from not putting the trope in context, some from shape
constraints, the rest from detection. The detector's real value isn't the catching — it's knowing
which of the other two layers is leaking.

One detector worth building early: lexical overlap between adjacent dialogue lines, flagging
content words repeating across speakers within a short window. Would have caught `stupid`
immediately.

---

## 5. Multi-agent dialogue

### 5.1 Why single-pass dialogue fails structurally

Models write dialogue as a single author writing both sides with perfect information. That's a
property of one forward pass, not a quality ceiling.

All the failures follow from it: the ladder structure, the shared vocabulary, the clean joke. Real
dialogue is two agents with asymmetric information and unrelated goals, and the misfires that make
it feel real are artifacts of that asymmetry. A single pass has no mechanism to produce them
because nothing in it is ignorant of anything. Description doesn't have this problem, which is why
models are markedly better at it.

So: generate the speakers separately, one call per character, each with only its own goal and no
knowledge of what the other is about to say. Talking past each other stops being something
requested and becomes something unavoidable.

**Honest caveat:** this degrades the other way. Two agents with no shared plan will sometimes
produce four exchanges of nothing. Needs a light director and a turn cap.

### 5.2 Speaker call context

Gets:

- Behavioral sketch (§2.1) — prose, not fields. Plus two or three verbatim lines.
- **Scene-scoped objective**, concrete, able to succeed or fail within a few exchanges. Not "Riley
  is frustrated" but "get him to put the papers down without being the one who suggests it."
- **Their read on the other character, as belief, not fact.** "She thinks he uses work to avoid
  talking about the money thing. She's about sixty percent right." She knows him well and needs a
  model of him — it just has to be *her* model, with room to be wrong.
- Last 6–8 exchanges verbatim, plain transcript, positioned **last** so it's closest to generation.
- A short prop list — what's in reach, what could be picked up, put down, thrown.
- Shape constraints: 1–3 lines, no name in address, no self-explanation, physical action allowed,
  no interiority, no adverbs.

Must **not** get:

- The other character's objective, sketch, or interior state.
- Where the scene is supposed to end up, or any downstream plot beat.
- Thematic material of any kind.
- Any director narration about their emotional state — "Riley is getting angrier" in context is the
  adverb pipeline reopening one position from the output.

**Output format:** bare dialogue plus optional physical action. No dialogue tags. Tags are where
adverb slop lives; if the speaker call can't write one, it can't write "she said explosively." The
narration pass adds beats afterward, or the lines stay bare — tight exchanges often read better
untagged.

```
[Riley — behavioral sketch, ~150 words, prose]
[Her lines, verbatim, 2-3]

Right now she wants: to stop working without being the one who says so.
She thinks: he's using the papers to avoid the conversation about March.

In reach: the paper stack, his red pen, a warm can of something, the fan switch.

Rules: 1-3 lines. No names in address. Don't explain yourself.
Physical action allowed. No interiority. Output the line only.

---
NOAH: ...
RILEY: ...
NOAH: ...
```

~400 tokens, which is why a small fast model works here.

### 5.3 Thinking allocation

**Disable thinking on speaker calls** — and not mainly for latency.

Thinking makes dialogue worse. The reasoning block works out what the character should say and
why; the output stage then renders a line that has been pre-justified. That produces precisely the
failure being chased: dialogue that is correct, on-topic, and legible as authorial intent. The good
stuff in real speech is unconsidered. A character who deliberates before every line never blurts,
never misses the point, never says the slightly wrong thing.

There's also a direct contamination path: if the reasoning block says "Riley is frustrated and
wants to stop working," that adjective is now one position from the output. The shortest possible
version of the echo problem — and it explains why thinking-heavy generations state character
motivation more explicitly in the prose.

| Call | Thinking | Model |
|---|---|---|
| Speaker lines | off | small, fast |
| Director | on | capable |
| Narration / description pass | on | capable |

Also: run speaker calls in parallel (they don't depend on each other by design) — that recovers
more wall-clock than disabling thinking does.

**Worth testing rather than assuming.** Generate the same exchange 20× with thinking on and off,
read blind. Prediction: thinking-on reads more competent and less alive. May not hold on a given
stack.

### 5.4 Bid and arbitrate

Strict alternation rebuilds the ladder and makes the pass mechanism awkward. Instead: every turn,
call all NPC speakers concurrently; each returns a line or an explicit pass; an arbiter commits
one and discards the rest.

```ts
async function nextTurn(state: SceneState) {
  const npcs = Object.keys(state.speakers).filter(s => s !== 'user')
  const bids = await Promise.all(
    npcs.map(id => generateLine(id, state).catch(() => null))
  )
  const live = bids.filter(b => b && !b.pass)
  if (!live.length) return null          // hand the beat to the user
  return arbitrate(live, state)
}
```

Costs 2× tokens and zero latency — parallel calls on a cheap model. In exchange it solves turn
order without a rule and makes **silence structural**: if everyone passes, nobody speaks. Silence
in an argument is real and models never produce it unprompted, because a generation call always
generates.

`arbitrate` stays dumb — prefer whoever didn't speak last, break ties toward whoever was addressed.
No model in this path; it's a coin flip dressed as a decision and it's on the critical path.

### 5.5 Director

**Runs off the critical path.** Fire after a turn commits, write back when done, let turns continue
meanwhile. Touches only `objective` and `belief`, never the transcript, so a late write is harmless.

```ts
function maybeDirect(state: SceneState) {
  if (state.directorRunning) return
  if (state.turns.length % 5) return
  state.directorRunning = true
  runDirector(state).then(update => {
    for (const [id, o] of Object.entries(update)) {
      Object.assign(state.speakers[id], o)
    }
  }).finally(() => { state.directorRunning = false })
}
```

Because it's advisory and non-blocking it can have thinking and a capable model without anyone
waiting.

**Its job is narrow: objective maintenance.** Read the transcript, decide whether each objective
still holds, rewrite the ones that don't. Not scene planning. A speaker pursuing a stale objective
is how these systems produce four exchanges of nothing — she's still trying to get him to stop
reading twenty turns after he stopped. Get this call right and the whole thing works; skip it and
it's an expensive way to generate circular dialogue.

**On the earlier synchronous version.** The 30s cost in the TTRPG experiment wasn't mainly the local
model — the director ran at the top of the turn, fully on the critical path, turning one generation
into two sequential ones. The same director run *after* the previous turn commits costs zero
perceived latency at 10 tps. It's advisory; it can be a turn stale.

**Injection format.** `<director>this scene is dragging</director>` appended to the user message
sits in the strongest position in context, written in critique voice. That's an out-of-fiction
instruction in the highest-leverage slot, and it surfaces as narrator throat-clearing and abrupt
gear changes. Inject the same guidance as **in-fiction fact** — something that is now true, a
person entering, a knock at the door. Facts over notes.

### 5.6 State shape

```ts
type Turn = {
  id: string
  speaker: string          // character id, or 'user'
  line: string             // dialogue only
  action?: string          // physical beat, if any
  objectiveAtTime: string  // what they were pursuing — for debugging
}

type SceneState = {
  turns: Turn[]
  speakers: Record<string, { sketch: string; objective: string; belief: string }>
  props: string[]
  directorRunning: boolean
}
```

Discrete turns rather than accumulated prose buys: per-line reroll without touching the rest, the
transcript format the speaker prompts want, and a clean commit step. It also sidesteps the
streaming-markdown problem for this surface entirely — a 1–3 line dialogue response has no
structural markdown, so plain text append works and the conversion layer isn't needed.

**The human is just another speaker.** In the TTRPG case `user` participates in the bid as an
always-passing agent whose line arrives from an input box rather than an API call. Same log, same
shape. That's what lets one runner serve both the solo-fiction and the play cases.

**Commit, then flatten.** Line-per-row UI with reroll/delete/edit during the exchange. When the
scene is done, a single narration pass renders the committed transcript into manuscript prose —
adding beats, cutting tags, deciding what needs interiority — and *that* goes into tiptap through
the existing pipeline. Don't live-edit prose while the exchange runs; that means reverse-parsing
paragraphs into turns.

**Build for these failure modes from the start:**

- Objective staleness → director, plus a hard cap of 12–15 turns before a forced narration beat.
- Mutual pass loops → fall back to narration, don't retry.
- Log every discarded bid alongside the winning line. When a scene reads badly, knowing whether the
  losing candidate was better tells you whether the problem is the speakers or the arbiter.

---

## 6. Interface

### 6.1 Chat is machinery, not a neutral container

The chat interface encodes an assumption — one linear context, one model, one response — that fits
assistant work and fits fiction badly. Tools don't relax it; they let a single model reach sideways
mid-response. What's needed is multiple contexts with deliberately *different* knowledge, which
chat has no way to express.

But the layers are separable and have very different cost-to-value ratios:

| Layer | Cost | Value |
|---|---|---|
| Context architecture (§2) | none — pure prompt work | most of the win |
| Shape constraints (§3) | none | moderate |
| Async director | small — one scheduled call, one state field | high for TTRPG |
| Detection (§4) | moderate | diagnostic more than corrective |
| Per-speaker calls (§5) | structural — leaves the chat shape | the only fix for dialogue |

### 6.2 The shape that works

Conversation as **control surface**, artifact as **work surface**, explicit **accept** between them.
Claude Code, Cursor, and canvas-style editors converged on this independently. Chat is a good place
to express intent and a terrible place to hold a manuscript; the accept step is the boundary where
model output becomes the user's document, and the only place taste operates.

Surfaces:

1. **Chat** — intent, and the write path for everything else.
2. **Artifact pane** — swaps between prose and the turn-list (dialogue exchange in progress, with
   line-level controls). Users understand a surface changing modes; they won't understand a fourth
   panel.
3. **State panel** — character sketches (user's original beside the derived version), props,
   standing constraints. Inspectable and hand-editable.
4. **Objective strip** — see §6.4.

### 6.3 Document tree as substrate

Markdown files in a user-arranged tree: versionable, diffable, portable, editable outside the app,
and state isn't locked in a database the user can't reach. Keep it.

The trap is treating a file as both storage and affordance. Separate them: file is source of truth,
and the ones needing to be live get a pinned surface reading and writing the same file.

Two different kinds of thing, which shouldn't share a namespace:

- **Style guide** — user-authored config. Set rarely, read every generation. A plain file is fine;
  needs only a visible indicator that it's active. Should be a **visible file with an ordinary
  name** — `.llm/` is a dev convention, and a hidden directory is invisible by design to exactly
  the fiction writers who most need to see what's steering their output.
- **Scene state** — runtime state the director writes. Not really a document; a serialized object
  with a schema. User editing the same file the director writes is a concurrency problem, and free-
  form markdown means parsing arbitrary prose back into objectives. Keep out of the tree, or make
  it a read-only artifact of the run.

### 6.4 Depth-pinned injection

The thing worth stealing from NovelAI's author's note isn't the UI, it's the mechanism: insertion
at a fixed **depth from the end** rather than a fixed point in a template. As the manuscript excerpt
grows, anything pinned at the top decays in influence. Depth-pinning is how a short instruction
still works at turn 200. (Same reason the SillyTavern card guides push high-value material to the
bottom of the description field.)

If style guidance currently goes in a system block at the top of the prompt, moving it to a fixed
depth near the end is probably a bigger quality change than any UI work.

Author's note's second virtue is being small enough to hold in your head — which is also its
notorious failure, where people cram `[Style: dark, gritty, visceral]` and get gritty visceral
paragraphs forever. That's §1's echo problem at maximum leverage, three segments from generation.
So: **cap it hard** (a few hundred characters) and bias the UI toward constraints and prohibitions.
The field should feel like it wants "no dialogue tags, tight on Noah" and resist "atmospheric,
tense, literary."

### 6.5 The objective strip

Runtime state goes in the **compose area**, not a side panel. A panel is a document by another name,
and state the user won't watch has to sit where their eyes already are.

```
┌──────────────────────────────────────────────┐
│ ⬤ Riley   stop working without asking    5   │
│ ⬤ Noah    avoid the March conversation   2 🔒 │
│ ▸ next: the downstairs neighbor knocks   ✕   │
└──────────────────────────────────────────────┘
│ [ chat input                              ]  │
```

Three requirements a naive rendering would miss:

1. **Show age, not just value.** The number is turns since that objective last changed. Staleness is
   *the* failure mode and it's invisible if only current state is rendered — a stale objective and a
   fresh one look identical. Color-shift past a threshold. This single number is most of the value
   of the surface.
2. **User edits are sticky.** If the user types an objective, the director must not silently
   overwrite it next cycle. Lock it, show the lock, allow release. Without this the panel is
   infuriating: you fix the thing, it reverts four turns later, and you can't tell whether your edit
   did anything. Same pinned-vs-derived distinction as user notes vs. derived sketch, and it should
   look the same in both places.
3. **Render the director's steer as the fact it will inject**, not as critique. "The downstairs
   neighbor knocks," not "this scene is dragging." The user sees ground truth rather than a summary
   of it, and a *pending* steer with an ✕ is a much better product than one that already fired.

Chat is the write path: "Riley should back off" lands as a pinned objective rather than a message.
That also solves standing-instruction decay — a constraint typed into chat becomes an object with a
visible lifetime instead of a message scrolling out of view.

Accumulating scene facts (what's established, who's where, what got broken) are reference, not
control. Collapsible, read-only, mostly a debugging surface. Don't build much of it before it's
needed.

---

## 7. What to build, in order

1. **Trait→behavior conversion at document-save time.** Background pass when a character document
   is written or edited; store the derived sketch beside the original, inject the derived one, keep
   the original for the user. Cached, no per-generation latency. Highest value, lowest cost.
2. **Prompt ordering.** Documents high, manuscript low, beat last. Never let a reference block be
   the final thing before generation. Close to free.
3. **Depth-pinned style field**, capped, constraint-biased.
4. **Objective chips with age counter and lock.** Watching those numbers for a few sessions will
   teach more about what the director gets wrong than designing the rest up front.
5. **Async director**, facts-not-critique injection, objective maintenance only.
6. **Detection**, starting with adjacent-line lexical overlap and the copula-abstraction rule. The
   dismissal log is the deliverable.
7. **Per-speaker bid architecture** — only if the TTRPG dialogue matters enough to leave the chat
   shape for.

## 8. Open questions

- **Does the derived sketch drift from the user's intent** enough to be annoying? Users may edit the
  original and not understand why nothing changed until the background pass runs.
- **How partial should appearance suppression be** before users read it as the app ignoring their
  worldbuilding (§2.5)?
- **Does the bid architecture's 2× token cost hold** when scenes have four or five present
  characters? May need presence-gating rather than calling everyone.
- **Where do standing constraints live in the document tree?** They're user-authored like the style
  guide, but scene-scoped and created conversationally.
- **Is the narration pass one call or several?** Flattening 15 turns into prose is a long generation
  with the same slot-colonization risks as anything else.
