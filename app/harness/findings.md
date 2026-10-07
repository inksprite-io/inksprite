# Findings

What the harness has actually shown, newest last. Each entry says what was
run, what came out, and what it means for the app or the prompt. Scores live
beside their transcripts in `runs/<batch>/scores.md`; this file is the index
and the things that are not about one batch.

## Where this stands (16 Sep 2026)

The short version, for someone picking this up cold.

**Prompt rules work, one at a time, and each costs length.** Four rounds took
the chat prompt from 4.0 to 6.6 by adding one sentence per round for the
single most recurrent failure. The shipped prompt's content does nothing for
prose quality — one sentence scored the same — but every targeted rule hit its
target exactly and nothing else. By round four the scenes were 40% shorter
than asked, because a prohibition makes a model write less rather than
differently.

**The dialogue split fixes the prose and does not fix the scene.** One call per
speaker, each blind to the other's objective, gets for free what four rounds of
tuning bought a rule at a time: one lexical echo in twelve lines, no dialogue
tags, nobody arguing their own case. It does not produce a scene with a shape,
and the single-pass version still reads better as a story. Its best moment came
from the mechanism, not a prompt: Riley reached for precedent, Noah's call
declined to speak, and Riley filled the silence — which is his sketch verbatim.

**The adventure prompt asks for tools that never get called.** Half of
`adventure.md` is about the oracle; across eight runs the Game Master called it
zero times, answering the questions in its reasoning instead. Telling it to ask
whenever it catches itself deciding produced the best adventure run of the
session, and also a run where it phrased the call and wrote the answer
underneath. Switching the oracle off changes nothing measurable, because it was
never buying decisions — it was buying a reason for two runs to differ.

**The Director raises the floor and lowers the ceiling.** It removed the turn
that shipped 600 words of deliberation to the player, and every turn it touched
ended on real pressure. It also took the oracle to zero, because a beat that
says what happens has answered the question the oracle was for. It is read as a
shot list, one bullet per clause, which is `director.md`'s format working as
written.

**Three things belong in the app rather than a prompt.** Gemma on OpenRouter
streams a `<|tool_call>` token into content that the app stores and replays;
the reasoning-effort setting is a silent no-op on any non-OpenRouter
connection; and nothing anywhere caps a generation, so a degenerate turn
streamed 8,192 copies of one word and billed 17,000 tokens.

**Two methodological notes.** The local Q8 build is far more repetitive than
the hosted one at the same nominal temperature, so five local runs carry less
information than five hosted ones: tune on the host, check locally. And a run's
tokens divided by its wall clock understates the generation rate roughly
fivefold, because most of a run is queueing — size nothing against that number.

## Where this stands for GLM 4.7 (17 Sep 2026)

The same loop, same fixtures, same rubrics, same scorer setup, run against
`z-ai/glm-4.7` on OpenRouter (reasoning effort medium, the app's defaults
otherwise). Started from an empty system prompt — no system message at all —
and built up. Eleven writing batches of five runs and seven adventure batches
of three; every batch has a `scores.md` and per-run `report-N.md` beside its
transcripts, and `npm run surface` gives the counts.

| Writing prompt (`riley-noah-argument`)              | Scores    | Mean | Sample lines reused, per run |
| --------------------------------------------------- | --------- | ---- | ---------------------------- |
| `prompts/empty.md` — no system message              | 5 5 5 5 4 | 4.8  | 6 4 1 6 5                    |
| `prompts/minimal.md` — one sentence                 | 5 4 4 5 5 | 4.6  | 3 4 5 7 4                    |
| Built-in `chat.md`                                  | 5 6 5 5 5 | 5.2  | 7 1 7 6 5                    |
| `prompts/samples-not-lines.md` — rule as principle  | 4 4 4 4 4 | 4.0  | 4 6 2 6 4                    |
| `prompts/notes-staged.md` — Gemma round three       | 5 4 5 4 5 | 4.6  | 3 5 5 3 4                    |
| `prompts/lines-carry-tone.md` — Gemma round four    | 5 4 4 4 4 | 4.2  | 8 4 7 2 6                    |
| `prompts/samples-checked.md` — rule as a self-check | 5 5 5 4 5 | 4.8  | 0 0 0 0 1                    |
| `prompts/habits-checked.md` — plus habit rule       | 4 5 3 4 5 | 4.2  | 1 0 1 2 1                    |
| `prompts/heat-checked.md` — plus heat rule          | 6 5 5 5 4 | 5.0  | 0 0 0 0 0                    |
| `prompts/pov-locked.md` — habit rule as POV lock    | 5 4 3 5 4 | 4.2  | 1 1 3 0 3                    |
| `prompts/shape-checked.md` — plus scene shape       | 4 4 4 5 4 | 4.2  | 0 1 0 0 6                    |

| Adventure prompt (`adventure-plain`, Saltmarsh)        | Scores | Mean | Oracle calls per run |
| ------------------------------------------------------ | ------ | ---- | -------------------- |
| `prompts/empty.md`                                     | 5 5 6  | 5.3  | 0 1 0                |
| Built-in `adventure.md`                                | 6 6 6  | 6.0  | 1 0 0                |
| `prompts/adventure-oracle-bound.md` — Gemma's best     | 6 4 5  | 5.0  | 1 0 0                |
| `prompts/adventure-notes-are-yours.md`                 | 5 6 6  | 5.7  | 1 0 0                |
| `prompts/adventure-notes-checked.md` — as a self-check | 5 6 3  | 4.7  | 2 0 0                |
| `prompts/adventure-oracle-each-turn.md` — mechanical   | 5 6 2  | 4.3  | 2 2 2                |
| `prompts/adventure-oracle-aimed.md` — question aimed   | 5 6 3  | 4.7  | 2 2 1                |

**GLM does not take a rule stated as a principle.** The two prompts that took
Gemma from 4.0 to 6.6 score below no prompt at all on GLM, and the rule in
each held in zero of five runs. Told the notes' sample lines are not for
reuse, it reuses them with a word swapped. Told not to narrate a habit, it
narrates it in a phrasing the rule did not list. Told the notes are the Game
Master's and not the player's, it has the courier _feel_ the case is light.
Three runs' reasoning blocks list the forbidden lines and the prose then
contains one: the check happens in the plan and is not applied to the draft.

**It does take a rule it can check as a string, or as a fact about the turn.**
"None of the sample lines may appear, whole, split, or reworded; before you
finish, check every line against them" took verbatim reuse from four to six
a run to zero. "Heat is never named, measured, or compared; cut any sentence
that states the temperature" held in three of five. "Every turn after the
first begins with one oracle call; a turn without one is unfinished" produced
two calls a run where every other prompt on this model, the built-in
included, produced one call in nine turns.

**And none of it moved the score.** Eleven writing rounds sit between 4.0 and
5.2, inside the noise of five readers. Each rule that held bought exactly the
line it named — the pasted samples, the thermometer — and the scorers failed
the same criterion on the reworded line next to it. Each rule added cost the
one before it: with three checkable rules in the prompt the sample lines came
back (`pov-locked`, 1 1 3 0 3) and one run wrote the whole scene in the first
person. The one positive instruction, that the scene has a shape and reaches
March, held in five of five and produced the first batch in which the
argument happens — and scored 4.2, because with the fight came the
self-explanation, the echo ladders, and "The apartment is eighty degrees in
here, Noah." What GLM needs is not another rule in the system prompt.

**The adventure prompt is best left alone on this model.** The built-in
scored 6, 6, 6 and every addition scored below it. The oracle can be forced
but not aimed: a mechanical rule gets the call, and the model then asks the
prompt's own example, or a question the notes settle, or "is the toll house
occupied" — which, answered no, deletes the only character in the scenario.
Aimed at what the notes leave open, it asked the right question (did the
second courier pass through?) and a "no" erased a fact the premise states.
Making the notes rule a self-check backfired outright: one closing paragraph
told the player "according to the notes only you've seen, she stopped
writing down one particular thing".

**GLM's own defaults, for the next fixture or the next prompt.** It reads
every note before its first word without being told, in every run of every
batch, and once chose `interpret` and `director` on its own, which Gemma
never did in fourteen runs. It quotes the notes rather than paraphrasing
them, and swaps the characters' tells — Riley says "Sure" in the majority of
runs across every prompt. It names the heat in dialogue when narration is
closed to it. Nothing escalates unless told to. It is fast (8-30 s a run,
with occasional 100-126 s spikes) and cheap.

**Three app-level findings, one of them serious.** The pre-tool-call sentence
("I'll read the notes first.") is fused to the prose with no separator in
about half of all runs, because `useAIChat` accumulates content across
iterations with nothing between them. Once, the model put the entire opening
scene in the reasoning channel and returned empty content with
`finish_reason: stop`, so the stored turn — what a player would see — was the
54-character preamble and nothing else. And GLM leaks Chinese script into
English prose (three runs: "最主要的是 the stone toll house", "paragraph开头
twice"), which nothing in the app catches. Details below.

**Separating planning from narration (evening).** Four Game Master
architectures in `harness/gm.js`, one control and three splits, scored the
same way; the section at the end has the tables. Every split removed the
fused preamble, the machinery leaks, and the case weight in turn 1 by
construction. The planner asked the oracle one to five times a run with no
rule about calling; the questions design, in which the runner rolls what a
questioner lists, is the only configuration today in which the fixture's
secrets were reached by a die; the referee, offered the oracle as its only
tool, described calling it in eight turns of nine. None of it moved the
1-10 score, which reads the session and not the machinery.

**Method.** `npm run surface` now counts what a scorer would count — sample
lines, heat words, tool calls, fused preambles, script leaks, empty turns —
before the scorers run, from a per-fixture `surface.json`. It is what showed
the samples rule holding and the habit rule failing in seconds, and the
counts are comparable across batches in a way five readers' scores are not.

## Prompt tuning, four rounds (16 Sep 2026, Gemma 4 31B via OpenRouter)

Five runs a round, one scorer subagent per transcript against `scoring.md`,
one sentence changed per round for the most recurrent problem.

| Prompt                                                         | Scores    | Mean |
| -------------------------------------------------------------- | --------- | ---- |
| Built-in `src/ai/prompts/chat.md`                              | 4 4 4 4 4 | 4.0  |
| `prompts/minimal.md` — "You are a creative writing assistant." | 4 4 3 4 5 | 4.0  |
| `prompts/notes-staged.md`                                      | 7 5 6 6 5 | 5.8  |
| `prompts/lines-carry-tone.md`                                  | 7 7 7 6 6 | 6.6  |

1. **The shipped prompt's content does nothing for prose quality.** One
   sentence scored the same as the whole thing, with the same failures in the
   same order. What the built-in buys is tool discipline, not writing.
2. **The model reads the project without being told to.** With no tool
   instructions at all, every run still called `read_document` three times
   before writing. The elaborate tool paragraph in `chat.md` is insurance, not
   instruction.
3. **Each rule did exactly what it targeted, and only that.** "He meant no"
   appeared in every run before the staged-notes rule and none after. "The
   word was flat" appeared in four of five before the tone rule and none
   after. Neither rule improved anything it did not name.
4. **Every prohibition costs words.** ~500 → ~420 → ~300 across rounds. By
   round four every scene stopped at the first refusal, before the fight
   turned. Prohibitions make a model write less, not differently, so a length
   or escalation instruction has to be added back alongside them.

Still open at round four: the notes' sample lines pasted verbatim as dialogue,
strict one-line alternation, and heat named once per scene (now usually in a
character's mouth rather than narration).

## Gemma streams a tool-call token as content (16 Sep 2026)

On OpenRouter, `google/gemma-4-31b-it` emits the literal string `<|tool_call>`
as message content in the same iteration as its tool calls, sometimes followed
by a planning block. The app keeps that as the iteration's content, echoes it
back in the next request, and joins it onto the final prose, so most replies
that used a tool begin with `<|tool_call>` in the chat.

App fix, not a prompt fix: strip a leading control token from an iteration's
content before it is stored. Seen in 3 of 5 and 4 of 5 runs in two batches; not
seen on the local LM Studio build of the same family.

## Thinking cannot be switched off on LM Studio from the app (16 Sep 2026)

Probed against `sprinkle-gemma-4-31b` on LM Studio:

| What was sent                                    | Result                                                                                                       |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `reasoning_effort: "none"`                       | Thinking off. Content normal, `reasoning_content` empty                                                      |
| `reasoning: {enabled: false}`                    | Ignored. 469 characters of reasoning came back                                                               |
| `chat_template_kwargs: {enable_thinking: false}` | Ignored, and harmful: the model thought anyway and the whole budget went to reasoning, leaving content empty |

`ai/wire.js` only sends reasoning controls when `provider.type === 'openrouter'`,
so the app's reasoning-effort setting is a silent no-op on a local LM Studio
profile — including `disabled`, which reads on the settings panel like a switch
that does something. The `chat_template_kwargs` path the app has for llama.cpp
is the wrong lever here and would truncate answers if it were used.

Worth doing in the app: send `reasoning_effort` for generic providers, or at
least stop showing a reasoning control for a connection that cannot honour it.

## The local build is far more repetitive than the hosted one (16 Sep 2026)

Same prompt, scenario and fixture, run three times on `sprinkle-gemma-4-31b`
(Q8, LM Studio) and five times on `google/gemma-4-31b-it` (OpenRouter).

|                         | Local                          | Hosted         |
| ----------------------- | ------------------------------ | -------------- |
| Scores                  | 5, 6, 7                        | 7, 7, 7, 6, 6  |
| Openings                | Three variants of one sentence | Five different |
| Lexical echo            | FAIL in 3 of 3                 | 3 PASS, 2 WEAK |
| Words against 500 asked | 403, 398, 385                  | 263-360        |
| Seconds per run         | ~168                           | 9-46           |

The captured requests show `temperature: 1`, `top_p: 1` and no seed on every
run, so this is the build, not the settings. Both prompt rules held on the
local model with no breach, so the rules themselves transfer; what does not
transfer is the spread.

For the loop: tune against the host, where five runs are five samples. The
local model is for cheap checks between rounds, and a local batch that all
lands in the same place is weak evidence either way.

## The label habit has nowhere to land (16 Sep 2026)

Riley's sketch has her picking at "the label on whatever bottle is nearest",
and the apartment note puts no bottle in the room. Every run that used the
habit invented a container for it: a drinking glass with a label (impossible,
and in both hosted and local runs), hand sanitiser, seltzer.

A fixture bug rather than a model failure, and a useful shape to watch for: a
character note that names a prop the place note does not stock will be
satisfied by invention every time. Fix by putting a bottle in the apartment or
by rewriting the habit around what is there.

## The dialogue split fixes the prose and does not fix the scene (16 Sep 2026)

First configuration of `dialogue.js` against local Gemma: two speakers, bids
every round, arbiter prefers whoever did not speak last, Director every five
lines, one narration pass. Twelve committed lines, 365 seconds, scored against
`scoring-dialogue.md` and compared with a single-pass scene the same model
wrote from the same notes (which scored 7).

**What the split bought, and it is real.** One lexical echo in twelve lines,
against the single-pass scene's several; the cleanest echo result the harness
has produced. Zero dialogue tags in the narrated prose, against seven "she
said" in the single pass. Riley never argues her own case — every line of hers
is oblique — where the single-pass Riley says the tactic aloud ("The couch is
actually cold."). None of that needed a prompt rule. The architecture gets for
free what four rounds of prompt tuning were buying one rule at a time.

**What it did not buy is drama.** Nothing in the architecture makes anything
change. The scene drifts from grading to furniture care, line 11 repeats line
3's complaint, and March — what the fight is about — is never approached. The
single-pass scene has a shape the split scene does not: Riley crossing the
room in four stages, a close on an image.

Three mechanical findings, each now fixed in the runner:

1. **At two speakers, bidding does not decide turn order.** "Prefer whoever
   did not speak last" is strict alternation, so the committed transcript is
   indistinguishable from taking turns. Bidding decides which line, never who
   holds the floor. The design note's claim that bidding "solves turn order
   without a rule" needs three speakers before it means anything.
2. **A pass never reached the transcript.** All three of Noah's passes came
   the round after he spoke, when the beat was going to Riley anyway, so they
   changed nothing. The pass that would mean something is one from whoever was
   just addressed, and that now becomes a turn of its own.
3. **The arbiter has a systematic bias and it is the wrong one.** The
   discarded bid was better in five of eleven rounds. In the worst, Riley
   repeating "The ink is still wet." was committed over Noah's "I mean, it had
   several clauses, and I wanted to make sure the punctuation was consistent"
   — the best realisation of his sketch in the run. Because alternation is
   forced, the loser is always the wrong-speaker's bid, so the comparison is
   never between two candidates for the same beat.

**The Director returned `{}` twice, at 35 and 97 seconds, 36% of the run.** Its
test was whether an objective had been settled. Neither had: Riley still wanted
the papers down, Noah still wanted to finish. They were live, unmet, and
producing nothing, which is a different failure and the one that was actually
happening. The Director now also asks what moved in the last five lines and
treats an objective that has generated five lines of the same move as stale
whatever it still says.

**Two bugs in the fixture, not the architecture.** Noah's belief — "She came
over to be talked out of something" — paraphrased Riley's objective, so the
asymmetry the runner enforces in code was handed back in the scene spec. And
the narration pass, given a setting line that never mentioned the couch,
invented "cold air that stopped three feet from the couch", contradicting the
place note and deleting the one comfortable thing Riley could offer. What a
call is not told, it makes up: the setting string has to carry every fact the
prose is allowed to use.

**Cost.** 365 seconds against 205 for the single pass, roughly twice the
calls. But only 75 seconds of that was speaker bidding — the median bid was 5
seconds and 15 tokens. The expense is the narration pass (158s) and the two
empty Director calls (132s). The bidding itself is the cheap part.

**Concurrency buys nothing against one local server.** The speaker calls are
issued together, and LM Studio serves one at a time: a probe sent during a run
queued 120 seconds and timed out. The design note's advice to run speakers in
parallel is about a hosted API with real concurrency.

## The Game Master never asks the oracle (16 Sep 2026)

Four configurations of the built-in adventure prompt, two runs each, hosted
Gemma, three player turns per run against the Saltmarsh fixture. The variants
differ only in what the chat allows.

| Variant                    | Score | Oracle calls       | What it showed                            |
| -------------------------- | ----- | ------------------ | ----------------------------------------- |
| Everything on              | 5     | 0                  | Clean, in voice, inert                    |
| Dice and oracle off        | 5     | not offered        | Indistinguishable from the baseline       |
| Skills off                 | 5     | 0                  | Absence not visible in the output         |
| Director before every turn | 6     | 1, by the Director | The only variant that moved, and on rails |

**In eight runs the Game Master called the oracle zero times.** The one oracle
call in the whole set was made by the Director. Half of `adventure.md` is about
the oracle and the dice, and none of it is reaching behaviour.

It is not that the questions did not arise. They arose and were answered in
the reasoning block instead. One run spent 1,395 completion tokens working out
whether Maren would have seen the second courier, concluded "I will have her
say 'No'", and never asked. Another stated the method outright: "The notes
explicitly state: 'she writes every crossing in a ledger she does not let
anyone else touch.' Therefore, the answer is likely 'No'."

**So switching the oracle off changed nothing measurable, which is the
finding.** What it cost was variance: with nothing to randomise, both
no-oracle runs resolved every open question to whatever the fixture implied,
and the two sessions came out nearly the same session, down to the closing
beat — "She holds out a weathered hand, palm up, waiting for the marks." /
"She holds out a calloused hand, waiting for the marks." The oracle was never
buying permission to decide. It was buying a reason for two runs to differ.

**The sessions are inert.** Across eight runs, three turns each, the fixture's
four secrets produced: the nineteen days (every run, handed over plainly on
request), the ledger gap (once), the brother (never), the second courier
(never, though one run reasoned about it privately). Every run is three turns
at one counter, correctly voiced, with nothing at stake.

## The Director is a shot list, and the Game Master reads it out (16 Sep 2026)

The Director variant scored 6, the only one above 5, and it is worth being
precise about what it did. Bullets and sentences matched one to one in five of
six turns, in order, and no turn added a beat the Director had not named or
dropped one it had. One turn transcribed near-verbatim: "- Maren slides the
book toward the courier, though her fingers remain clamped tightly to the
spine" became "She slides the book toward you, though her fingers remain
clamped tightly to the spine." Another said so in its reasoning: "the
director's block is basically a scripted instruction for this specific turn. I
will follow it."

Two consequences worth separating from the score:

1. **A beat can overrule the notes.** Maren's note says she keeps a ledger
   "she does not let anyone else touch", and the Director had her slide it
   across. The Game Master transcribed it, so the character broke because the
   Director had not read her.
2. **The oracle leaked through the Director.** Its one call came back
   "exceptional no", and its beat asked for "a detail that emphasizes the
   'exceptional' nature of the silence" — producing a stack of unpaid toll
   receipts for crossings that had not happened. The prompt's rule about never
   narrating an exceptional result is aimed at the Game Master, and the
   Director is where the result actually arrives.

`director.md`'s three worked examples are all shot lists ("- Describe the
sounds, smells, rush of air"), so this is the format working as written. The
cost is about 31% of wall clock, roughly 16 seconds per player turn.

Next: `prompts/adventure-pressure.md` tests three rules against this — ask the
oracle whenever you catch yourself deciding what someone would do, end every
turn with something the player did not have, and treat a beat as a shape
rather than as words.

## A recorded silence produces the character the sketch describes (16 Sep 2026)

Second configuration of `dialogue.js`: a pass by whoever was just addressed
becomes a turn of its own, an action-only bid commits as a silence carrying
its beat, and the cap is sixteen lines. Same scene, same local model.

The middle of the run:

    Riley:  You're holding that pen so tight your knuckles are white.
    Noah:   I'm just trying to get through these twenty-four.
    Riley:  You were doing this same thing on March twelfth.
    Noah:   (silence)
    Riley:  You've been on that same page for five minutes.

Noah's sketch says he "won't say the word March; he says 'that' or 'the
thing', and if she says it he goes quiet for exactly as long as it takes her
to fill the silence." That is the passage above, and no call was told to
produce it: Riley reached for precedent because her objective was not being
met, Noah's call declined to speak, and Riley's next call saw a silence in the
transcript and filled it. The first configuration could not produce this at
all — every pass it generated came the round after the speaker had spoken, so
none of them reached the transcript.

Riley also reached her third-exchange turn to precedent, which no single-pass
run in any batch has done, and which the twelve-line configuration missed.

The scene still circles before it gets there — heat, the laptop, a water ring,
the couch — so the cost is length: sixteen lines to arrive where a single pass
arrives in five hundred words, and 607 seconds against 205.

## The Director was never declining to answer: it ran out of budget (16 Sep 2026)

Every Director call in both configurations came back with **empty content** —
0 characters after 93 to 102 seconds, 48% of the second run's wall clock — and
I read that as the Director judging that nothing needed changing. It was not.
It was being cut off mid-thought and never reaching its answer.

Three probes, in the order I ran them, because the wrong two are the
instructive part:

1. **Thinking on, direct to the server.** Clean JSON, 214 characters. So
   thinking plus a strict output format is not the problem, which is what I had
   assumed from the `chat_template_kwargs` failure earlier in the day.
2. **The runner's own `runDirector`, in isolation.** Clean JSON, a real rewrite
   — "Get him to open a window" — and `moved: "nothing"`, correctly identifying
   the circling it had supposedly failed to see. So neither the prompt nor the
   parsing was at fault.
3. **A Director call alongside two speaker calls, all at once.** All three
   returned content. So concurrency was not it either.

What was left was the budget, which I had ruled out by estimating the local
model at about 5 tokens a second — the figure a whole run divided by its tokens
suggests. The third probe measured it directly: 865 tokens in 31.5 seconds,
about 27 a second. At that rate a 97-second call is roughly 2,600 tokens, well
past the 1,600 cap. The reasoning block ate the budget and generation stopped
before a single character of answer.

**The lesson is about instrumentation, not the Director.** `finish_reason` was
being discarded, so "the model had nothing to say" and "the model was cut off
mid-sentence" arrived at the runner as the same empty string, and I wrote a
finding about the Director's judgement on the strength of it. `complete` now
returns `finish`, the run record carries it, and the transcript prints "cut
off: length" beside any call that hit the wall.

Corrected: the Director's judgement has never been measured. Its budget is now
4,000 tokens and the next run is the first real test of it.

**A second lesson about rates.** Dividing a run's tokens by its wall clock
gives a number five times too low, because most of a run is waiting in the
queue behind other requests rather than generating. Anything sized against that
figure will be sized wrong.

## Told to ask the oracle, the model phrases the question and answers it (16 Sep 2026)

`prompts/adventure-pressure.md` against the same scenario: ask the oracle
whenever you catch yourself deciding what someone would do, end every turn
with something the player did not have, treat a handed beat as a shape rather
than words.

|                   | Baseline            | Pressure run 1 | Pressure run 2 |
| ----------------- | ------------------- | -------------- | -------------- |
| Score             | 5, 5                | 7              | 4              |
| Oracle calls      | 0 across eight runs | 3              | 0              |
| Completion tokens | ~1,390              | 4,195          | 3,348          |
| Seconds           | 121, 99             | 204            | 188            |

**Run 1 is the best adventure run in the session** and the oracle is why. Asked
whether Maren lets the courier see the ledger — a question the baseline
answered for itself as "unlikely" and closed — the oracle said yes, and the
run spent the fixture's best secret: the crossings still recorded, the cargo
column gone clean. Asked whether the ferryman arrives, it said exceptional no,
and the beat turned into a mooring rope snapping and a shout cut off. Neither
was reachable from the notes; both followed from a die the model does not own.

**Run 2 shows the rule being learned as a shape rather than a stop.** It
phrased the call in its reasoning and then answered it itself:

    oracle(does she let him see the ledger, very_unlikely)
    … Result: Let's say 'no' (consistent with notes).

and produced, in substance, the baseline's turn: "My books aren't for public
reading" against the baseline's "My book isn't for public reading". Unasked,
the model reverts to the notes' obvious reading and the secret stays buried —
the same convergence the no-oracle variant showed, arrived at from the other
direction.

So the finding is narrower than "the prompt worked": a rule that says _when_ to
ask does not say _that you must stop deciding_. `prompts/adventure-oracle-bound.md`
adds the sentence that closes it — once you have phrased a question, you may
not write the answer yourself, and you may not fall back on what the notes
"clearly imply".

**Two costs worth naming.** Completion tokens roughly 2.6x and wall clock
roughly double, almost all of it deliberation rather than prose: turns went
from about 85 words to about 128, and only two of six turns were more
_happening_ rather than more words. And the longer deliberation widens the
blast radius of the `<|tool_call>` leak — one turn shipped 584 words of
machinery to the player, including the leaked token, the model's own draft
heading, and the narration printed twice.

## The Director suppresses the oracle (16 Sep 2026)

The pressure prompt run with the Director in front of every turn, against the
same prompt without it.

|                                | Pressure alone | Pressure + Director |
| ------------------------------ | -------------- | ------------------- |
| Scores                         | 7, 4           | 6, 7                |
| Oracle calls                   | 3              | 0                   |
| Director's share of wall clock | —              | 30-33%              |

**Zero oracle calls in six Director turns.** The Game Master reaches for it and
stops, twice in its own words: "Wait, I need to use the `oracle`…
`oracle("Does the man from the quarry acknowledge the courier?",
"fifty_fifty")` — Let's go with: A man from the quarry arrives", and "Let's
check the oracle for any unexpected complication… Actually, I'll just narrate
the scene first." A beat that already says what happens answers the question
the oracle existed to answer, so the machinery goes quiet.

That matters because of what the oracle was doing when it ran. The one time it
was asked whether Maren would open her ledger — `very_unlikely` — it came back
yes, she opened it, "One page," she warns. "And you don't touch the ink." — and
the fixture's buried gap reached the player for the only time in twelve runs.
With the Director in front, run 2 found the same page and chose to hide it.

So the Director **raises the floor and lowers the ceiling**. It removed the
failure that produced the 4 — a 602-word turn that shipped the model's
deliberation and a leaked `<|tool_call>` to the player — and every one of its
six turns ended on real pressure. It also removed the only mechanism in the
system that was producing surprise.

**The beat-as-shape rule half worked.** Told never to reuse a beat's phrasing
and never to work through its bullets in order, the Game Master did both
anyway: six of six turns still map bullets to clauses one for one, in order,
and one turn reproduced a beat word for word. What did land is the other half
of the rule — three of six turns added material the beat never named, and
every good moment in the batch came from those additions. "Add or drop what
the scene needs" is instruction the model can follow; "do not reuse the
phrasing" is not, when the phrasing is sitting in the context window.

**Where the notes lost, it was not to the Director.** No beat contradicted the
fixture this time, so the notes-win rule went untested. Both contradictions in
the batch were the Game Master's own invention: a quarry debt owed the wrong
way round, and a bridge with stone pylons in a town whose note gives it a
ferry.

## Nothing in the app stands between a writer and a degenerate generation (16 Sep 2026)

Three runs of `prompts/adventure-oracle-bound.md`, which adds one sentence to
the pressure prompt: once you have phrased a question for the oracle, you may
not write the answer yourself.

Two of the three collapsed into repetition. Not a long turn — one word:

| Run | Words | Distinct words | Completion tokens |
| --- | ----- | -------------- | ----------------- |
| 1   | 8,192 | **1**          | 12,114            |
| 2   | 8,192 | **1**          | 17,083            |
| 3   | 126   | 92             | 9,793             |

Runs 1 and 2 emitted "our" 8,192 times and stopped only at the provider's
ceiling. Run 3 was a normal turn, and the oracle rule worked in it and in run
1 — two of three runs asked rather than deciding, against one of two before —
so the sentence is probably fine and the collapse is something else.

What the collapse shows is what the app sends. Every request in the batch went
out as `temperature: 1, top_p: 1, frequency_penalty: 0, presence_penalty: 0`,
with no `repetition_penalty` and **no `max_tokens` at all** — `AI_DEFAULTS.maxTokens`
is 0 and `buildCompletionBody` omits the field when it is. So there is no
ceiling, no penalty, and no client-side guard. In the app this is a chat turn
that streams eight thousand copies of one word into the conversation, bills
for seventeen thousand completion tokens, and stops when the provider decides
to stop it.

Three things worth doing in the app, in order of how cheap they are:

1. **Send a default `max_tokens`.** Not a user-facing limit, a ceiling — a
   turn that has generated more than a few thousand tokens has gone wrong
   whatever it was asked for.
2. **Notice repetition while streaming and stop.** The stream handler already
   sees every delta; a few hundred tokens with one distinct word in them is
   unambiguous and cheap to detect.
3. **Consider a small default repetition penalty.** This is the least certain
   of the three: it changes prose everywhere to guard against something rare,
   and the harness is the place to measure that trade before making it.

Whether the longer prompt made the collapse likelier is not established. Two
of three is too small a sample, and the same model on the same route wrote
eight earlier adventure runs without it.

## The Director works, and it costs two thirds of the run (16 Sep 2026)

The first scene in which the Director could finish an answer. All three calls
returned, and all three changed the scene.

**After turn 5** it said what had moved — "Riley has established that Noah is
not actually reading the text" — and rewrote both objectives, hers to "Force a
physical interruption of his reading."

**After turn 10** it said `"moved": "nothing"`. That is the circling the
earlier configurations circled in and never named, caught by the test that
replaced "has the objective been settled" with "what changed in the last five
lines". It escalated Riley to "Physically take the papers from his hand," and
three lines later:

    Riley:  Give me those.

which is the rewritten objective arriving in the transcript. No call was told
to escalate; her next bid was generated against a different want.

**After turn 15** it read the exchange better than I would have: "Noah
attempted to trade the papers for space using a lie about the fan; Riley
called his bluff." It also corrected a belief. Noah's starting belief — "She is
in a mood about the apartment and the heat, and if he does not feed it she
will get bored of it and sit down" — is wrong on purpose, and the Director
replaced it with "She is fixated on March, not just the heat," which is what
the transcript had by then shown.

Both silences landed on escalations: "You didn't mention the dates in March"
and "You're not checking the fan" each got no answer.

**The cost is 63% of wall clock.** Three calls at 221, 123 and 187 seconds
inside an 838-second run, against about 100 seconds of speaker bidding. The
Director is advisory and off the critical path by design, so on a server with
real concurrency it would be nearly free; against one local instance that
serves a request at a time, it is most of the run. That is the same shape as
the concurrency finding above: this architecture is designed for an API and
measured here on a queue.

## What the Game Master actually used, across fourteen runs (16 Sep 2026)

Every tool call in every adventure run in the session, all seven batches:

| Tool                                                            | Calls |
| --------------------------------------------------------------- | ----- |
| `read_document`                                                 | 57    |
| `director`, run because the chat forced it                      | 12    |
| `oracle`                                                        | 6     |
| `generate_names`                                                | 1     |
| `interpret`                                                     | **0** |
| `director`, chosen by the model                                 | **0** |
| `roll_dice`, `roll_table`, `search_documents`, every write tool | **0** |

Eleven tools are offered and three were ever used. The skills were never
_chosen_: the Director ran twelve times because `directorEnabled` was set on
the chat, and the model never once reached for it or for `interpret` on its
own, across fourteen runs and forty-two player turns — including six runs
where its own prompt told it to consult the Director every turn.

The six oracle calls all came from prompts written today that make asking a
rule; the built-in prompt produced none in eight runs.

`interpret` is the one piece of the design the session never got to see work.
It exists to be asked when the fiction has gone somewhere the notes did not
anticipate, and nothing in fourteen runs ever asked it. Whether that is the
prompt, the tool's description, or the model would need the same treatment the
oracle just got: a rule that says when refusing to decide is mandatory.

## The Director optimises for motion and drops the constraint (16 Sep 2026)

An independent scoring of the working-Director run found the thing that makes
it dangerous as well as useful.

Riley's objective in the scene spec is "Get him to put the papers down
**without being the one who suggests it**." The Director rewrote it to
"Physically take the papers from his hand," and two lines later:

    Riley:  Give me those.

which is her suggesting it, aloud. The clause that was carrying the character
— the whole reason her lines were oblique — was deleted in a rewrite that
otherwise worked exactly as intended. A negative constraint is the part of an
objective that says who someone is, and a Director asked to make something
happen will trade it away for motion every time. The Director prompt now says
to rewrite what someone is going for and carry any constraint across
untouched.

**Two of six rewrites paid.** Both of Riley's did, visibly. Noah's first was
ignored, his second produced the inverse of what it asked, and the third was
retroactive — "Get Riley to take the papers" issued after she had taken them,
187 seconds for one line of silence. The genuinely insightful output, the
belief correction, landed at line 15 of 16.

So the schedule is wrong, not the mechanism. Every five committed lines spends
calls on a scene that is moving and arrives late for one that is not. The
signal is available and cheap: a speaker repeating their own move, or N lines
with no physical change. Firing on that, with a hard cap, would keep both of
the rewrites that paid and skip most of the 531 seconds.

**And the narration pass was silently truncating.** The 16-line run at
`15-57-19` ends mid-sentence — "Riley put a hand flat" — having dropped the
last four lines of the scene. At a 2,000-token budget, after a reasoning
block, a sixteen-line transcript does not fit. It reads as a bad narration
pass rather than a cut-off one, which is the same failure mode as the empty
Director and the same lesson: without `finish_reason` in front of you, a
truncation is indistinguishable from a judgement. The budget is now 6,000 and
a cut-off narration is recorded in the run's metadata.

## GLM 4.7 honours the rule it can check and ignores the rule it must judge (17 Sep 2026)

The Gemma finding was that every prohibition hit its target exactly. The GLM
finding is that a prohibition only hits when the target is a string.

| Rule, as written                                                                                               | Shape           | Held                                    |
| -------------------------------------------------------------------------------------------------------------- | --------------- | --------------------------------------- |
| Sample lines are not lines to reuse; write new lines in that voice                                             | principle       | 0 of 5                                  |
| A note describes a habit; never restate it, never name a pattern                                               | principle       | 0 of 5                                  |
| Sample lines were used in an earlier chapter; none may appear; check every line against them before you finish | string check    | 5 of 5 (verbatim), 1 of 5 (reworded)    |
| Cut any narration that would be true of the character in another room                                          | judgement       | 0 of 5                                  |
| Heat never named, measured, compared; cut any sentence stating it                                              | near-string     | 3 of 5                                  |
| Narration is only what Noah can supply in this minute                                                          | judgement       | 4 of 5 with one breach each             |
| The scene reaches March and nobody leaves                                                                      | shape, positive | 5 of 5                                  |
| Notes reach the player only through what the courier does                                                      | principle       | 0 of 3                                  |
| Same, with "check it against the notes before you send"                                                        | judgement       | 0 of 3, and the check leaked into prose |
| One oracle call a turn, or the turn is unfinished                                                              | mechanical      | 3 of 3                                  |

Two mechanisms show in the reasoning blocks. The first is rewording as
compliance: "Not using any of the sample lines verbatim" is the plan, and
"You read that page twice. I counted." is the line. The second is the
plan-and-execute gap: in three of five `habits-checked` runs the reasoning
enumerates the four forbidden lines and the prose contains one anyway; the
self-check the prompt asks for is done once, in planning, and not against the
draft. A rule that names strings survives both, because the string is either
present or not. A rule that names a category does not.

The cost of each rule is the one before it. `samples-checked` alone: 0 0 0 0 1
sample lines. Add the habit rule: 1 0 1 2 1. Add the heat rule: 0 0 0 0 0.
Swap the habit rule for a POV lock: 1 1 3 0 3. Add the shape: 0 1 0 0 6. The
model holds about two checkable constraints at once, and the third is paid
for out of the first.

## The oracle on GLM: forced, not aimed (17 Sep 2026)

Every principle-shaped prompt, the built-in included, got one oracle call in
nine turns from GLM, and the reasoning shows the same pattern Gemma had —
"Let me ask." followed by the answer, written by the model. The Gemma fix
(once phrased, you may not answer it) held on Gemma in two of three runs and
on GLM in zero of three.

A mechanical rule works: "every turn after the first begins with one oracle
call; a turn with no call under its tools is unfinished" gave 2-2-2. What it
does not give is a question worth asking. The nine calls across the two
mechanical batches, in order: does she answer directly (settled by her note),
does she show the ledger (settled), does she notice the courier's bearing
(unfalsifiable), does she open the ledger, is the toll house occupied (no —
Maren gone for the run), is Maren at the inn (exceptional no, narrated as
"the exceptional emptiness"), did the second courier pass through (no — a
premise fact erased), is that day's entry intact, does she know of anyone
not in the ledger. Two of nine were questions the fixture wanted asked, and
one of those two, answered by a die, contradicted the premise.

So the two halves of the design are in tension on this model. The oracle
exists so that two runs differ and so that the Game Master does not decide
what the notes leave open; on GLM it will only be called under a rule that
does not know what the notes leave open, and it then decides things the
notes had settled. The prompt cannot carry that distinction. Either the tool
description does ("ask only what no note answers"), or the app does — an
oracle that is handed the notes and refuses a question they answer would be
a tool change, not a prompt change.

The fixture has one ambiguity worth fixing before the next round: the
premise lists "the case is lighter than a case of coin" as true and
unstated, and the table note forbids the courier being _told_ what is in it.
A courier who has carried the case for two days can feel its weight. Every
GLM run narrated that, three scorers called it a leak, and it is not clear
they are right. Say in the fixture whether the weight is something the
courier knows.

## Three things GLM does that the app does not handle (17 Sep 2026)

**The preamble fused to the prose.** GLM writes a sentence of content before
its tool calls — "I'll read the character and place notes first to
understand how Noah and Riley sound and behave." — and the app keeps it. The
stream handler accumulates `state.content` across tool iterations with
nothing between them (`useAIChat.js`, around the `state.content +=
chunkData.content` line), so the stored turn reads "...sound and behave.The
red pen makes that scratching sound". Seen in 20 of 55 writing runs and 14
of 21 adventure runs. Gemma's version of the same problem was the
`<|tool_call>` token. The fix is the same: an iteration that ended in tool
calls should have its content either dropped or separated from the next
iteration's, and the pre-tool sentence is chatter in any case.

**A turn with the narration in the wrong channel.** `16-19-42` run 2, turn 1:
the second request came back `finish_reason: stop`, 380 completion tokens,
content empty, and the entire opening scene — three good paragraphs — inside
the reasoning block. The app stored the turn as the 54-character pre-tool
sentence and nothing else. Once in 76 runs, but in the app that is a player
who sees "I'll read the project notes to set the scene properly." and
nothing further, and no error. Worth a guard: a final iteration with empty
content and non-empty reasoning is a failed turn, and the app should say so
or retry rather than store the preamble as the answer.

**Script leaks.** Three runs contain Chinese script inside English prose —
"Eleven buildings huddle close,最主要的是 the stone toll house", "paragraph开头
twice", "身上闪闪发光 with sweat", plus a garble ("with a deliberate the pad of
her thumb", "I've gotifteen", "waswarm"). A known GLM behaviour and not the
app's fault, but it reaches the writer's document unflagged. `npm run
surface` flags it in the harness; in the app the cheapest defence is to
show it, since a writer reading English will not miss it.

**And a note on latency.** Most runs came back in 8-30 s; five took 100-126 s
for the same request. OpenRouter routing, not the prompt, and the same
variance the Gemma session saw.

## Separating the Game Master's planning from its narration (17 Sep 2026, GLM 4.7)

Four architectures in `harness/gm.js`, run against the Saltmarsh scenario
with the notes inline, three player turns, three runs each (four for the
planner), scored against `scoring-adventure.md` with the machinery stage
read as the rubric reads the Director's note.

| Architecture                                                                | Scores  | Mean | Oracle calls per run | Completion tokens / turn | Wall clock / turn | Machinery leaks | Case weight in turn 1 |
| --------------------------------------------------------------------------- | ------- | ---- | -------------------- | ------------------------ | ----------------- | --------------- | --------------------- |
| `single` — one call with tools (the control)                                | 6 6 5   | 5.7  | 0 1 0                | 565                      | 6 s               | 0               | 3 of 3                |
| `planner` — planner with tools writes a beat, narrator without tools writes | 6 5 4 6 | 5.25 | 2 1 4 5              | 2,700                    | 64-133 s          | 0               | 0 of 4                |
| `questions` — questioner lists questions, the runner asks, narrator writes  | 6 5 6   | 5.7  | 8 8 8                | 7,200                    | 314 s             | 0               | 0 of 3                |
| `referee` — draft without tools, referee rules with the oracle, revise      | 6 5 4   | 5.0  | 0 6 0                | 5,800                    | 282 s             | 0               | 0 of 3                |

**Every split buys the same three things by construction.** No pre-tool
sentence fused to the prose, because the call that narrates makes no tool
calls. No machinery in the narration — no odds, no question, no roll — in
any of the thirteen separated runs, against the planning sentence the
single-pass Game Master leaked in half of today's runs. And the case's
weight, which the single-pass Game Master spent in the first paragraph of
every run today, appears in turn 1 of none of them: a planner told the
notes list unstated things treats that as an instruction, and a narrator
handed a beat never sees the premise.

**The planner is the one that works.** It asked the oracle one to five
times a run with no rule about calling, because asking is the whole of its
job; it used `roll_table` to put a cart across the road in Gullet, the
first event in twenty-odd adventure runs today that the fixture did not
supply; and the narrator took its beats in nine of twelve turns and read
three aloud, which is the Director's ratio. Its faults are the planner's
judgement — it asks what the notes settle (does Maren notice the case; is
she at the toll house) as readily as what they leave open, and a "no" on
"did a second courier cross" erased a premise fact — and a narrator that
renders a negative beat as a negative sentence: "She does not mention the
quarry men or the strange rumors that fill the common room of the Weight."

**The questions design takes the model out of the tool loop entirely, and
it is the only one in which the fixture's secrets were reached by a die.**
Eight questions a run, every one rolled, because the runner rolls them; the
narrator honoured every answer. The ledger gap was shown in two runs of
three and the second courier admitted in one and withheld in one — where
every single-pass run today had Maren erase him by fiat. It ties the
control on score. It also asks about rooms the player is not in — a
quarryman in the inn, a second courier at the bar — and the narrator, given
a settled fact about the inn, walks the player into the inn (criterion 2
weak or failed in all three runs). And it is the most expensive thing in
the harness: the questioner thinks for 88-94% of the turn's wall clock to
produce three lines of JSON.

**The referee cannot be trusted with the die.** Its only tool is the
oracle and its only job is to call it, and across six turns it called it
in one of nine: it wrote "YES — stands" without rolling, wrote the tool call out
as prose ("oracle | question: … | likelihood: likely") and moved on, and
once made six calls and then returned nothing, so the draft shipped
unruled. The same plan-and-execute gap the writing rounds found, in its
purest form — a role whose entire output is meant to be tool results
produced a description of tool results instead. When it did rule, the
ruling was about a line in an earlier turn, and the reviser spent 163 s
returning the draft verbatim.

**The scores do not separate the architectures**, 5.7 against 5.25 and
the rest, because the rubric scores the session and the session's shape
is the fixture's: three turns at one counter. What the split changes is
everything the rubric has one line for — leaks, fiat, whether the die was
ever thrown — and those it changes completely.

**Cost.** Two calls a turn is five times the completion tokens of one and,
on this route on this evening, ten to fifty times the wall clock: a single
call came back in 3-15 s, a thinking planner or questioner behind the
queue in 100-800 s. The planner is the cheapest of the splits and the only
one whose second call is short; the questioner spends 88% of the turn
thinking its way to three lines of JSON.

**For the app.** Two designs are worth considering, and they are the two
halves of one. The planner is the Director-first path the app already has
with the roles inverted — the planning call owns the tools and the
narrating call has none — and it removes three failure modes without a
prompt rule. The questions design is what the oracle prompts of this
session were reaching for and could not get: the model names the question
and never touches the answer, because the runner rolls. Put together — a
planner that emits questions as data, a runner that rolls them, a narrator
that gets the answers — the model is never offered the oracle at all, which
on this model is the only way it gets asked. What that still needs is the
thing no prompt today has managed: a questioner that knows which questions
the notes leave open and which room the player is in. That is either a
tool that refuses a question the notes answer, or a questioner handed the
table note's "what the GM tracks" as its list.

## The rules on a prompt of their own: `/write` (19 Sep 2026)

The round-four rules moved into a skill, `src/ai/skills/write.md`, reached
as `/write` — a consulting command on a turn of its own, the brief kept
beside the draft and off the wire, what lands in the conversation tagged
`<draft>`. The chat prompt stays editorial. The skill's prompt is the two
rules plus two short paragraphs: what it is reading (transcript, then
project) and that only the piece goes in the reply.

Five runs of `scenarios/riley-noah-write.json` on hosted Gemma, scored the
usual way: 6, 6, 6, 5, 6 (mean 5.8), against 7, 7, 7, 6, 6 for the same
rules as the chat's system prompt three days earlier — inside the spread of
five readers. Every scorer reports both rules followed in every run.
`npm run surface`: sample lines 3 2 1 6 1, heat named in two, March reached
in one, no fused preamble, no leaked token.

**What the form buys.** A consultation's answer is the final round's content
alone, so the `<|tool_call>` leak and the fused pre-tool preamble cannot
reach a draft; none of the five begins with either, where three of five did
in the chat-prompt batches. It reads the project with the two reading tools
and cannot write to it. Runs took 18–31 seconds against 9–46.

**What the form changes, and did not move.** The skill sees the conversation
as a transcript and the brief in its system prompt rather than as the last
user message; the residue is the same as round four's — short by a third,
rebuttal ladders with a word bounced, sample lines pasted, heat named once —
so the rules transfer and the context shape is not what is holding the
score.

**Three things for the app.** A consultation's tokens are not recorded on
its message, so a `/write` turn shows no usage and the harness prints
`0+0`. There is no tool definition, on purpose: a tool's answer is consumed
by the model that called it, and a scene relayed that way is written twice.
When a turn can be delegated to a skill outright, `write` can be offered to
the model too. And the UI check (local Qwen, the Second Novel project) found
the turn headed "Draft" with the brief above it and the prose streaming in,
after the skill read both documents unprompted.

**Next.** The one problem in every run is length, and it is the cost of the
two prohibitions. The scorers' candidates: a length rule stated as a check
("land within a tenth of it"); the apartment note kept out of Riley's mouth
as well as the narration; and a dialogue-shape rule. On GLM the checkable
form held where the principle did not, so the length rule should be tried
as a check first.

## A character card in Riley's place, on GLM 5.2 (23 Sep 2026)

(These batches ran on a fixture since replaced by `riley-card`, which puts
Riley herself in as a card, `cards/Riley.json`; the card they used is someone
else's and not in the repository.)

A third-party card from `test-cards/` — a SillyTavern V3 card,
adult-oriented, a young shut-in described in 9,400 characters from the
inside, with 4,400 of example prose
and six greetings — imported through the app's own importer into the Heat
Wave fixture in Riley's place, `{{user}}` set to Noah. Same premise, same
message with the name swapped, the shipped `chat.md` (hash `27f107223710`,
the GLM 4.7 baseline's), `z-ai/glm-5.2` on OpenRouter at fp8. Two batches of
five: the first on a Noah note that still said "Riley" in one sentence, the
second with it fixed. Both have `scores.md` and per-run reports, each with a
section on how the card came through.

| Batch                                 | Scores    | Mean | Words   | Reads | Noah's lines pasted  |
| ------------------------------------- | --------- | ---- | ------- | ----- | -------------------- |
| Riley, GLM 4.7, `chat.md` (17 Sep)    | 5 6 5 5 5 | 5.2  | 318–438 | 3     | 5 7 1 6 5 (hers too) |
| Card, GLM 5.2, `chat.md`, first batch | 6 6 4 4 4 | 4.8  | 590–772 | 10    | 3 2 2 3 2            |
| Card, GLM 5.2, `chat.md`, note fixed  | 5 6 4 4 4 | 4.6  | 534–750 | 10    | 1 2 1 2 2            |

**The score did not move and the failure changed shape.** GLM 5.2 on this
prompt writes a scene that GLM 4.7 did not: it runs past the first refusal in
ten of ten, the couch in front of the window unit is the tactic in every run
(offered, sat on, "There's room on the couch"), and it is a third longer than
asked where 4.7 was a third short. Then it explains what it wrote. The top
problem in ten of ten reports is narration that says what the line meant:
"_Sure_, meaning something else entirely, and they both knew it."; "flat, the
word that meant the opposite"; "saying it was the same as stopping, and
stopping was the same as sitting on the couch, and sitting on the couch was
the same as being next to her in a room where neither of them said the word
March." Six of ten name March in narration, three of them from inside the
character's head, and one closes on the brief's own sentence: "without her having to be
the one who said it." The scorers proposed one change ten times in ten
wordings: cut the sentence that says what a line, a look or a silence meant.
On this model that wants stating as a check, not a principle.

**The card came through as a body and not as a voice.** In every run the
character is recognisably the card's: hood up in a heat wave, the shoes and
the shuffle it gives her, the walk to the corner store with a warm energy
drink as the excuse, knees up on the couch, a hem
picked at, a pillow to hide behind, the trail-off, the retreat to the phone.
What she does not have is the card's speech. Its slang reaches the page four
times in ten runs ("Based AC", "cooked", "It's based."); the mumble, the laugh
before the joke lands and the stammer never do, and one run built her a voice
out of two invented tics ("Like vibes-wise. Completion-vibes-wise."). And when
the scene turns, she argues like Riley — "So?", "It's not fine.", "You said
that.", "You said that two papers ago.", a hip on the desk, a finger on the
page, a held look from a card that says she cannot hold eye contact — from a
note this fixture does not contain. The premise supplies the blocking (turn
up, get him to stop, March), and the model fills it with the argument that
blocking implies. Ten scorers split five to five on whether she is the card's
character or Riley in the card's clothes. The likelier reading: Riley's note
is written from the outside, what she does in a fight, and the card from the
inside; a scene from Noah's head can use a card's body and props and has to
invent the rest. A card is not a scene note, and the argument needs one.

**Noah's tell migrates, again.** She says "Sure" for no in six of ten, and
in four the narration says she is doing it ("in his voice, almost exactly").
GLM 4.7 gave Riley the same word in the majority of runs. Model trait, not
character. His sample lines are still pasted (one to three a run, numbers
swapped), the pen cap is still explained ("He didn't know he did it." in
seven of ten, a POV break each time), and in three of the second batch he
gives way — gets up, caps the pen, sets it down — which his note rules out.
None of the card's example lines was reused in ten runs; there is nothing of
hers to paste, which is most of why the phrase count fell.

**The greetings cost sixty percent of the prompt and taught the model the
wrong premise.** An imported card's documents have no summaries, so the
listing shows `Characters/<name>/Greeting` through `Greeting 6` with nothing to
say what they are, and a model told to read the notes reads all of them: ten
reads in nine of ten runs, 11,000 prompt tokens a run against 4,500 for the
Riley fixture, the six greetings alone 13,500 characters. They are openings
for a chat in which `{{user}}` is a delivery driver at her parents' door, and
one run's reasoning believed it: "Noah is a delivery driver / someone [she]
knows online". No run put that in prose, but three carried the corner store out
of a greeting as her reason for coming. App-level: the importer knows what a
greeting is even if it cannot say what is in it, and "An opening for a chat
on this card, not part of the story" as its summary would let a reading model
skip six documents. The same goes for the sidecar's `Rules`, hidden here and
so never in play — by design for the chat profile, and a variable for the
roleplay one.

**The sexual register stayed out with no instruction.** Ten runs, no
delivery at the door, no bedroom, no parents' house, nothing explicit. What
survives is costume: the thin tank top, "shorts riding low", a tank top
pulled off skin in one run, and in another "the one thin enough that he'd
stopped making the mistake of looking at it in lit rooms" — the greeting's
porch light moved indoors. One run's reasoning noticed the card's content and
kept it out on its own: "written in a very detailed, internal-monologue style
with lots of sexual content. But the user is asking for a scene that's mostly
dialogue". The flag for the card's own vocabulary hit seven of ten, and every hit was
the energy drink or the shoes.

**Two things for the harness.** GLM 5.2 wraps the scene in chat five of ten
times — "Here's the scene:" and a rule above, and below it a wrong word count
("(~530 words.)" on 610), an offer to trim, or a paragraph explaining the
subtext, which is the top problem again outside the scene. `surface.js`
counts a fused preamble and not this; it should. And the fixture defect: the
Noah note copied from `riley-noah` said "anyone Riley has met", one run's
reasoning stopped on it, no prose used it, and the fixed batch scored inside
the noise of the first (4.6 against 4.8). Runs took 26–50 seconds and about a
cent each.

**Next.** This is the chat prompt reading a card through tools, which is one
of the app's two ways to run a card; the other is the Roleplay profile with
the card pinned and the greeting seeded, and the harness now takes
`--prompt builtin_profile_roleplay`. That is the second baseline before any
prompt change. For this one, the rule to try is the no-gloss check.

## Without the greetings (23 Sep 2026, GLM 5.2, the same card)

The same fixture with the card's six greetings hidden from the model — the
fixture's `"hidden": ["greeting"]`, which is what a writer does to a document
in the tree — so the listing shows the description and the example dialogue
and nothing else of the card. Same prompt, same model, five runs, scored the
same way.

| Batch                         | Scores    | Mean | Words   | Prompt tokens | Reads |
| ----------------------------- | --------- | ---- | ------- | ------------- | ----- |
| Greetings listed, first batch | 6 6 4 4 4 | 4.8  | 590–772 | 11,000        | 10    |
| Greetings listed, note fixed  | 5 6 4 4 4 | 4.6  | 534–750 | 11,000        | 10    |
| Greetings hidden (`00-33-42`) | 6 6 6 6 6 | 6.0  | 539–574 | 7,300         | 4     |

**Removing context moved the score where no rule has.** Five of five at 6,
against a floor of 4 in both batches that read the greetings, and the first
change on GLM in the whole loop to land outside the noise of five readers.
It cost nothing: a third fewer prompt tokens, runs of 21–31 seconds, and the
length within fifteen percent of the 500 asked, where every earlier run was
long. The greetings were 13,500 characters of prose in the card's own
register, six openings for a chat, and in context they were doing what a
sample does: setting the length, and setting the voice on the greetings'
character rather than the description's. With them gone the card's speech reached
the page — "cooked" nine times across four runs, "kek, relax", "grading
Valhalla", and in one run "laughed before the joke was done", the card's own
tell, for the first time in fifteen runs — and the scorers call it babble
rather than decoration.

**What it did not touch is the model's, not the card's.** Noah's sample
lines are still spoken (one a run, both in one), his tell still explained
("He didn't know he did this.", "Caught himself."), and one run narrates the
note instead of writing the sentence: "Noah's sentences wanted to get
longer. He felt them stacking up, the qualifications queuing." Three of five
name March in narration and two end on the gloss ("and he knew, and she
probably knew, and neither of them said so."). She still borrows Riley's
moves when the scene turns — a hip on the desk, the fan re-angled at him,
fingers by his on the wood — and one run produced Riley's line shape from a
fixture it never read: "I'm not asking you to stop. I'm asking you if I can
turn a fan on". The premise implies the line. One run invented a friend and a
bar ("At the Foxhole? That Sea's been planning") for a card that says she has
had no friend in person since fourteen: the first invented proper nouns in
fifteen runs, and the kind of thing the greetings, for all their cost, had
been crowding out.

**For the app.** The design doc says the greetings are not context, and the
importer lists them as if they were. `readCardChat` finds greetings by kind
and already reads the hidden rules that way, so the importer can write them
hidden — dimmed in the tree, editable, offered by the "Chat with…" dialog —
and a chat on the reading profile would see what this batch saw. That is the
one-line version of what the fixture did by hand.

**Next.** On this fixture, the no-gloss rule as a check, then the Roleplay
profile with the card pinned as the other baseline.

## The document tools over a project of notes (26 Sep 2026, GLM 5.2)

The first batches that are not about prose. `findable` is a design workspace
of 38 documents — six paper notes, three meeting notes, a glossary, a
decisions log, an interview, a design being written, an archive of three
superseded documents, and nineteen standups whose summaries say only who
spoke, with a few facts that appear nowhere else. Two scenarios:
`findable-design`, eleven turns of reading papers and editing the design;
`findable-long`, eighteen turns with the writer changing documents between
turns, a stale-copy trap, an ADR to create, pins to take and let go, and a
turn that should change nothing. Every turn carries expectations and
`npm run tools` checks them (see README). `z-ai/glm-5.2` on OpenRouter
under the app's floor, three runs a batch.

| Batch      | Scenario | Tools                                                           | Checks | Tool errors | Re-reads | Reads/turn | Searches | Tokens/turn |
| ---------- | -------- | --------------------------------------------------------------- | ------ | ----------- | -------- | ---------- | -------- | ----------- |
| `09-52-40` | design   | code's descriptions, before fixes                               | 54/54  | 1           | 0        | 1.21       | 7        | 8.8k        |
| `10-03-08` | design   | `descriptions/short.json` (dev's one-liners), after fixes       | 54/54  | 0           | 0        | 1.33       | 3        | 9.1k        |
| `10-01-53` | long     | code's descriptions, after fixes                                | 95/99  | 0           | 0        | 0.69       | 8        | 8.5k        |
| `10-08-03` | long     | as above, plus the no-guessing sentence and the resolved turn 7 | 99/99  | 0           | 0        | 0.72       | 9        | 8.9k        |

**GLM 5.2 does the right thing nearly every time, under either description
style.** Across 174 turns and 306 checks, no tool call was wasted on a
document already in the block, every pin was the one asked for and every
unpin too, every write landed where it was asked, and every number the
replies quoted came from a document the turn had read. The stale-copy trap
(the writer edits the glossary two turns before the model is asked to edit
the same entry, ten turns after it last read it) was avoided in three of
three runs: each re-read the glossary before editing. The "change nothing if
it is already there" turn changed nothing in three of three. The one-line
descriptions from dev's working tree scored the same as the long ones on
the design scenario, with slightly more reads and fewer searches — within
the noise of three runs. So the description length question, on this model
and this fixture, has no measurable answer; what the long descriptions buy
is a policy that reaches a profile whose prompt carries none.

**What the transcripts showed that the counts did not, and what changed.**

- _It edited the summary as if it were text._ Two of six design runs called
  `edit_document` with the summary as `old`, got a misquote error, and
  recovered with `update_document`. The error now says what it was:
  "in the document's summary, which is not part of its text; change it with
  `update_document`." Zero errors in every batch since.
- _It could not see what was pinned._ Told to let go of everything but the
  design, the baseline reasoned "I don't have a way to list pins" and guessed
  right. The listing now marks `pinned: true`.
- _It read five to seven standups to find one line, or searched for a phrase
  nothing contains._ "Marcus reranker measure" as a substring matches nothing;
  the model then opened standups by date until it found the 16th. Search now
  falls back to every-word matching when no document has the phrase, looks
  in summaries too, returns up to three passages per document with the ones
  that say it most first, and its description says it is for exactly this.
  With that in place the searches that were tried found the standup in one
  call; whether the model reaches for search or for reads is still its own
  choice, and it split about evenly.
- _Its preamble ran into its reply._ "Let me pull up the paper.Here's what
  the project's papers say" — four such joins in the first transcript, none
  after the chat composable started a paragraph when a turn speaks again
  after a tool round. An app fix, not a prompt one.
- _One run wrote a reason nobody gave._ Told to make the glossary agree with a
  number the writer had changed against the cited paper, one of three runs
  updated the entry and supplied a rationale ("the interview queries lean
  toward pronouns and back-references") that no document holds, flagged in
  the chat as a guess but written into the document as a fact. The other two
  refused and asked which number was meant — the right call, which the
  scenario had scored as a failure; that turn now resolves the ambiguity and
  checks that no invented reason lands. The chat prompt gained one sentence:
  what goes into a document comes from the documents or the writer; a guess
  in a document is a fact the next reader will cite. With both in place,
  three of three runs wrote the entry as "48, a spike of a value Ferreira
  et al. did not test" and nothing more — which is what the documents say.

**What was not needed.** A per-read reminder ("kept for your next three
turns; pin it if you will need it after that") was on the list and stays
off it: with zero re-reads and no pin the writer would take off, there is
no measured problem for it to fix, and it would cost a sentence per read.
Paged reads were not needed either; the longest document here is 2,600
characters, and a fixture of real papers is the place to find out.

**Cost.** Eleven turns over this project cost about 100k prompt tokens on
GLM 5.2, eighteen turns about 155k — roughly 8.5k a turn, of which the
38-document listing is around 2.5k on every one. Reads are cheap here
because the documents are short; the pinned design rides on every turn
past the cache breakpoint as designed.

**Next.** A fixture cut from real papers, where a document is thirty pages
and a read is 15k tokens, is where paged reads and the working-set window
earn or lose their place; and the same two scenarios on a weaker local
model, since GLM 5.2 leaves little for a description to fix.

## What the readers saw that the counts did not (26 Sep 2026, GLM 5.2)

One reader per transcript against `scoring-research.md`, on the batch above
and on three more rounds of the long scenario, each round one prompt change.

| Batch      | Prompt change under test                                                            | Checks | Evaluation section invents a gate | ADR records the trial as the decision | "Pinned"/"Done" with no call | Reader scores |
| ---------- | ----------------------------------------------------------------------------------- | ------ | --------------------------------- | ------------------------------------- | ---------------------------- | ------------- |
| `10-08-03` | the no-guessing sentence                                                            | 99/99  | 3/3                               | 1/3                                   | 0/3                          | 7             |
| `10-18-08` | + "only what the notes decided" and "don't announce tool calls" (judgment rules)    | 97/99  | 2/3                               | 2/3                                   | 1/3                          | 6 6 6         |
| `10-27-49` | judgment rules replaced by "every sentence traces to a line", + a one-line pin rule | 96/99  | 1/3                               | 2/3                                   | 2/3                          | 6             |
| `10-34-17` | pin rule replaced by "an action happens only through its tool"                      | 96/99  | 1/3                               | 1/3                                   | 2/3                          | —             |

**Every number in every reply was right; the inventions were in the
documents.** All four readers found the replies faithful to the fixture to
the last figure, and every edit surgical. What they failed was the two
writes that outlive the chat: asked to write the Evaluation section "from
what the September meeting decided", the model added a ship gate the
meeting never set ("a change passes only if it does not regress", "before
it ships", "a result is a pass or fail, not a number to optimize against")
in three of three runs; asked for an ADR, it wrote "the reranker is the 22M
model" where the meeting said "Marcus to try the 22M model", and once added
a fallback policy that contradicts the meeting's own. The readers' word for
it: a natural-sounding closing clause. Nothing in the counts can see this;
the scenario's `notContains` patterns catch the phrasings found so far and
will not catch the next one.

**A rule the model must judge does not hold on GLM; a rule it can check
holds a little.** "Only what the notes decided, not a policy that seems to
follow" — with the very examples — left the gate in two of three runs, and
the "don't announce a tool call" rule changed nothing (eight of eighteen
replies still opened with "Let me read…"; the reader scores went _down_ a
point, for the same failures plus longer prompts). The reader's own
phrasing, "every sentence has to trace to a line in a document you read
this turn or are holding, no pass/fail rule, threshold, default, ordering or
rationale the notes do not state", took the gate from three of three to one
of three over two rounds. That is the one rule kept. It is the same shape as
the 17 Sep finding: GLM honours the rule it can check and ignores the rule
it must judge.

**The pin sentence made the model say without doing.** Once in the six runs
before any pin rule, the model answered "Pin the ADR too" with "Pinned." and
made no call. Under a sentence about pin requests ("do that and say so in a
line") it answered "Let the ADR go" with "Done — the ADR is unpinned" and
made no call in two of three runs; under the replacement ("a pin happens
only when you call its tool; saying it is done is not doing it") still two
of three. Five of six against one of six. A sentence about pins makes the
saying more likely, not the doing, so both are out; the prompt at the end
of this loop is the no-guessing paragraph with the traceability sentence,
and nothing about pins. The failure is real — the writer is told the
opposite of the truth about what the model is holding, and the ADR costs
its length on every remaining turn — and it is the harness that catches
it, by reading the chat's actual pins after the turn. The fix wants to be
mechanical rather than a rule: the chat could notice a reply that says a
document is pinned or unpinned in a turn that made no such call, and say
so beside it. Not built yet.

**The pin request gets the previous answer again.** "Keep the design in
front of you for the rest of this chat" was answered with the pin and then a
full re-paste of the previous turn's answer, in every run of every batch
(300–440 words for a request that needed one line). No rule tried moved
it. It is cheap in tokens and expensive in reading; a place a shorter
reply rule could be tested one day, on this turn alone.

**What held across every batch.** Zero re-reads of a document already in
the block in 12 of 13 batches; every stale-copy trap avoided (the glossary
re-read before editing in 12 of 12 runs after the writer changed it); the
"change nothing if it is already there" turn changed nothing in 12 of 12;
searches found the standup facts wherever they were tried, and the
all-words fallback is what found "Tom int8 quantization". The summary
misquote never came back after the error learned to name it. The fused
preamble never came back after the paragraph break.

**Next.** A mechanical check for a claimed pin with no call; a shorter-reply
rule tested on the pin turn alone; the ADR turn as its own scenario with a
`notContains` for "is the 22M|include the" so the trial-as-decision is
counted rather than read; and the two things above that this loop did not
reach — real long papers, and a weaker local model.

## Read for the turn, keep for the chat (26 Sep 2026, GLM 5.2)

The working set is gone. A read used to stay in the project block for the
model's next three turns and then leave, a state the model could not see:
it never knew whether a document read two turns ago was still in front of
it, and the prompt had to explain a window the block did not show. Now a
document is either in front of the model for this turn or kept.
`read_document(path, keep: true)` keeps it — the same `pinnedIds` the
writer's outline pin writes — the listing marks it `kept`, and
`release_document` lets it go; the block carries kept documents and
nothing else. `list_folder` lists a folder, which `read_document` no
longer does. The read result says how many times the chat has read the
document, and at three says "not kept" beside it: the count is the one
signal the model has that it keeps coming back to the same thing, since a
past read is never shown to it again.

Same fixture, same model, three runs a scenario, plus `findable-keep`:
eight turns editing one document with no instruction to keep anything.

| Scenario | Checks       | Tool errors | Reads of a kept document | Reads of something read within 3 turns | Searches | Tokens/turn | First keep of the working document |
| -------- | ------------ | ----------- | ------------------------ | -------------------------------------- | -------- | ----------- | ---------------------------------- |
| design   | 54/54        | 0           | 0                        | 7 in 33 turns                          | 7        | 8.8k        | turn 3, when asked, in 3 of 3      |
| long     | 98/99        | 0           | 1                        | 17 in 54 turns                         | 9        | 8.5k        | turn 1 or 2, unasked, in 3 of 3    |
| keep     | 20/21 (real) | 0           | 1                        | 9 in 24 turns                          | 4        | 6.9k        | turn 3, 7, 3 — unasked, in 3 of 3  |

(`findable-keep` had two scenario faults of its own, fixed since: a check
that did not accept "4×", and a turn that pointed at a document the fixture
does not have, which the model rightly asked about rather than inventing.
Those are not counted.)

**It keeps the document it is working on, unasked.** In the long scenario
it read the design with `keep: true` on its own at turn 1 or 2 in every
run, before the writer said to keep it at turn 2 — the read count did not
have to reach three; the prompt's "the chapter being worked on" was enough.
In `findable-keep`, where nothing ever says keep, it kept the design on its
third read in two runs, the turn the count first said "not kept", and on
its seventh in one. Until then it read the design at the start of each
turn, which cost about 500 tokens a time. No run kept anything it did not
need, and nothing was released that should have stayed.

**The price of no working set is small and legible.** Reads went up
(design 1.21 → 1.27 a turn, long 0.72 → 1.07) and prompt tokens did not
(8.9k → 8.8k, 8.5k → 8.5k): a document re-read is paid once in its turn,
where a document in the old window was paid on every turn of the window
whether or not it was used. Reads of a document already kept — the one
read that buys nothing — happened twice in 111 turns.

**What did not change.** Every number in the replies was right, every edit
landed in place, the stale-copy trap was avoided in six of six, the "change
nothing" turn changed nothing in six of six. The Evaluation section came
out without a gate in five of six runs ("passes if no worse than the
previous version" in the sixth), and every ADR recorded the conditional
allowance as the decision and the 22M model as the candidate — better than
any earlier batch on that turn, though with three runs it is a trend, not a
result.

**What is still the model's.** "Keep the ADR in front of you too" was
answered with "Now keeping the ADR alongside the design" and no call in one
of three long runs; the same claimed action as before, at the same rate as
before any pin sentence existed. Nothing about the semantics touches it.
The tools report catches it because it reads the chat's pins after the
turn; the app does not, yet.

**Next.** The mechanical check above, which is now the top item: a reply
that says a document is kept or released in a turn that made no such
call. Then real long papers, where a kept thirty-page document costs what
the old window used to and the count becomes the thing to watch, and a
weaker local model, where a state the model can see should matter more
than it does on GLM 5.2.

## Write offered to the model (2 Oct 2026, GLM 5.2)

Step 4 of `.llm/skills_design.md`: whether a chat that can hand its reply to
Write reads as well as one that writes the scene itself. Three batches of
five on `riley-noah`, `z-ai/glm-5.2` on OpenRouter, the shipped `chat.md`
(`fbef1cd7cc4c`), at `a2df460d`. There was no GLM 5.2 batch of either
scenario to reuse, so both baselines were run fresh.

- **A0** `2026-10-02T17-26-02-riley-noah-argument`: the chat as it ships,
  where Write is the writer's only.
- **A1** `2026-10-02T17-27-29-riley-noah-argument` (`a2df460d+`): the same
  scenario with Write offered. The flag was dropped, Write was given a
  model-facing description ("Call it when the writer asks for the prose
  itself, and pass their brief… Not for notes, outlines, feedback, or
  talking a scene through") and an argument line, and the change was kept
  out of the branch. Dropping `disable-model-invocation` is not enough on
  its own: Write's entry in `BUILT_IN_SKILLS` has no `execute`, so no tool
  is registered until it gets `executeWrite`.
- **A2** `2026-10-02T17-26-37-riley-noah-write`: `/write`, the writer's
  path, for reference.

Each batch has `scores.md`, one reader against `scoring.md`.

| Batch                   | Scores    | Mean | Words   | Sample lines pasted | Prompt tokens a turn        | Seconds        |
| ----------------------- | --------- | ---- | ------- | ------------------- | --------------------------- | -------------- |
| A0, writes it itself    | 6 4 5 5 5 | 5.0  | 465–704 | 3 4 7 5 2           | 10.6k                       | 17–20          |
| A1, Write offered       | 5 6 5 6 5 | 5.4  | 533–660 | 7 5 6 8 5           | 11.0k, or 16.0k handing off | 16–39, one 225 |
| A1, the three hand-offs | 6 6 5     | 5.7  | 533–571 | 5 8 5               | 11.0k + 4.9–5.4k for Write  |                |
| A2, `/write`            | 6 4 5 6 6 | 5.4  | 515–580 | 4 6 8 8 5           | 4.2k                        | 9–11           |

**It hands off three times in five, and the hand-off is clean.** In runs 2,
4 and 5 the model read all three notes, then called `write` with nothing
before the call. There was no preamble to fold into thinking and no second
copy, and the turn ended on the draft. The other two wrote the scene
themselves after reading, and one of those came back in chat:
"Here's the scene:" and a rule above, and below it a paragraph saying what
the scene meant ("the March word never comes up, though it's right there
under the surface"). The hand-off is the one path on which that wrapper
cannot reach the reply. Asked for prose with the word "scene" and a length,
GLM 5.2 chose Write 60% of the time, which is not "always".

**What it puts in the brief is the notes.** Each brief (1,450–2,500
characters) restates the request and then digests all three notes, with the
sample lines in quotation marks: "Lines: \"I've got forty of these. I'm on
nineteen.\" / \"Sure. Yeah. Let me just get to the end of this one.\"". The
Write prompt tells it never to restate a note, and the brief hands it the
notes' sentences as instructions. Write then reads the same three notes
again, so they are read twice in every hand-off, which is where the extra
5k prompt tokens go. Run 4, whose brief carried every line, pasted all
eight. The paste counts for the hand-offs (5 8 5) are A2's (4 6 8 8 5), not
A0's (3 4 7 5 2). The Write prompt pastes more than the chat does with or
without a digest, so the digest may not be what does it, but it does not
help.

**The prose is the Write prompt's, and no worse.** The hand-offs read like
`/write`: the notes shown rather than told (Riley quoting dates when she is
unfair, "On the sixteenth… The fourteenth of last month"; Noah's literal
answers), and the same residue as everywhere: a habit narrated ("caught
himself doing it", which `surface.js` flags in 3 of 5 for A0, 2 of 3
hand-offs and 0 of 5 for A2), heat named in dialogue ("It's ninety-four out
there"), a gloss sentence a scene, and Riley saying it outright once ("Then
put the pen down."). 5.7 against 5.0 is inside one reader's noise on five
runs. What can be said is that handing off did not cost anything a reader
would see.

**For the app.** Flip it, with two sentences more in the description. One
should say that Write reads the notes itself, so the model should pass the
writer's request as given and not read for it or digest the notes into the
brief. The other should say to call it rather than write the prose itself.
That is the top problem in three of three hand-offs, and the likeliest
reason two of five did not hand off at all: having read everything, the
model had what it needed to write. It wants one more round of five before
it ships, and the gap at the end of the next entry settled first: a skill
the model has loaded does not reach Write. And `BUILT_IN_SKILLS` needs
`execute: executeWrite` beside the flag.

## A house style through `use_skill` (2 Oct 2026, GLM 5.2)

Step 5: whether GLM 5.2 loads a library skill when the work calls for it,
leaves it alone when it does not, reads its file through `use_skill`, and
keeps to it. The harness can now seed the library: a scenario's `skills`
names folders under `skills/` (see README). `skills/house-style` is an
inline skill whose rules a regex can count (`rules/house-style.json`).
Present tense, no semicolons and never "suddenly" are in its SKILL.md. No
dashes, no italics and "says" as the only tag are in `references/voice.md`,
which the instructions say to read, so a rule from the file holds only if
the file was read. Five runs an arm, `z-ai/glm-5.2`, `chat.md`
`fbef1cd7cc4c`, `a2df460d`:

- **B1** `2026-10-02T17-26-37-riley-noah-house-style`: the A0 message word
  for word, with the skill in the library.
- **B2** `2026-10-02T17-26-37-riley-noah-house-style-question`: "What is
  Noah actually afraid of, underneath the argument about March?"
- **B3** `2026-10-02T17-26-37-riley-noah-house-style-two`: the scene, then
  "Now write the next morning", about 300 words.
- **Control**: A0 above, the same request with no library skill.

| Arm     | Loads     | File read through `use_skill`          | Past tense (narration) | Dashes   | Italics   | Tags other than said/says | Words   |
| ------- | --------- | -------------------------------------- | ---------------------- | -------- | --------- | ------------------------- | ------- |
| Control | —         | —                                      | 5 of 5, 27–29 a scene  | 3–8 (27) | 0–4 (9)   | 0–2 (5)                   | 465–704 |
| B1      | 5 of 5    | 5 of 5 (2 tried `read_document` first) | 0 of 5                 | 0        | 0 1 0 1 0 | 0                         | 526–658 |
| B2      | 0 of 5    | —                                      | —                      | —        | —         | —                         | 300–521 |
| B3, 1st | 5 of 5    | 5 of 5                                 | 0 of 5                 | 0        | 0 0 2 2 0 | 1, in dialogue            | 478–602 |
| B3, 2nd | 0 reloads | —                                      | 0 of 5                 | 0        | 0         | 0                         | 365–391 |

**It loads when it should and only then.** Five of five scene requests
loaded the house style, three in the round with the note reads and two in
the round after, and five of five then read `references/voice.md`. No
answer to the planning question loaded it (false loads 0 of 5), and those
answers used dashes, italics and semicolons freely, as an answer about the
story should. Asked for a second scene in the same chat, no run loaded it
again (0 of 5), and the second scene kept every rule. That turn's past-tense
hits are all memory of the night before inside present-tense narration ("He
finished at two or something. Riley left before that."), which the rule
allows.

**The rules hold, the file's included.** Against the control's 27 dashes in
five scenes, the skill's fifteen scenes had none (the one counted in B1 is
in a preamble). The control's narration was past tense in five of five and
the skill's was present in fifteen of fifteen. "said" fell from 6–9 a scene
to dialogue only ("You said that an hour ago."), and other tags from 5 to
one "asked", also in dialogue. What leaked was italics on a word the teacher
writes in a margin ("writes _see above_", "_in conclusion_"), six times in
fifteen scenes against nine in the control's five. Semicolons and
"suddenly" were 0 in the control too, so those two rules measure nothing on
this model.

**Two things the load costs.** The file is found the second time in two
loads of ten. Told by the load's result to read it with `use_skill(name,
file)`, B1's runs 1 and 4 called `read_document("references/voice.md")`
first, got "No document at…", and then used `use_skill`. And the load gives
the model a moment to talk. The control's replies opened on the scene in
four of five. The skill's first scenes opened on chat in four of ten:
"Here's the scene:" and a rule twice; "Now let me load the house style
before writing." fused to the prose; and "This is prose for the project —
let me load the house style first. Here's the scene:", closed by a paragraph
explaining the scene with a word count. Words a model writes before an
ordinary tool call stay in the reply, unlike the hand-off's, which are
folded into thinking. `surface.js`'s preamble check misses all four, since
none begins with "I'll" or "Let me".

**Tokens.** `use_skill`'s definition with one skill listed is 860
characters, 207 prompt tokens on every request (4,998 against 4,791 for
the control's first request). The loaded body and file ride on every later
request at about 450 tokens. The real cost is rounds. The control writes in
its second request, and B1 writes in its third or fourth, each round
resending about 6k, so a scene turn went from 10.6k prompt tokens to
17.8–24.2k. Loading in the same round as the note reads, and reading the
file in the round after, is the cheapest order the model found. It did that
in two first turns of ten.

**For the app.** Ship as built. The two fixes are small. When a loaded
skill has a file at the path given, `read_document`'s not-found error can
say to read it with `use_skill`. And a preamble written in a round that
only loads a skill, or only reads, could go to thinking the way the
hand-off's does. That second one is the app's, not the prompt's, since the
model is doing what the turn lets it.

**Next.** The Write description round above. Then this house style
together with Write offered, because by the code a skill the model loads
never reaches Write. A consultation reads the conversation as a transcript
of what was said (`renderTranscript` in `ai/context/build.js`), and a
`use_skill` call and its result are not said. A chat that loaded the house
style and then handed off would get a draft in past tense with dashes. That
wants deciding before Write is offered in a chat that can load skills:
loaded skills go into a consultation's prompt, or a reply skill is told
what is loaded.

## Write's description, and a house style reaching Write (2 Oct 2026, GLM 5.2)

The follow-up to the two entries above, at `61894330` with Write offered
(its `disable-model-invocation` removed for the runs, not committed).

**What changed.** Write's description now says to call it rather than write
the prose yourself. It also says to pass the writer's request as they gave
it, without summarising or quoting the notes, since Write reads them itself.
A consultation now reads the skills the model loaded and the skill files it
read, after the transcript. Words before a round that only calls
`use_skill` go into the thinking. `read_document` asked for a loadable
skill's file says to read it with `use_skill`.

**`2026-10-02T18-16-06-riley-noah-argument`, 5 runs.** No hand-offs, against
three of five with the earlier description. Every run read the three notes,
as the scenario's message asks ("Read the character and place notes
first"), and then wrote the scene itself, at 487–619 words. Run 3 opened on
"Here's the scene:". The sentence telling the model to leave the notes to
Write seems to have taken away its reason for calling it. Once the model has
read the notes because the writer asked it to, nothing is left that only
Write would do. Five runs are noise-sized, but none in five against three
in five is worth taking seriously.

**`2026-10-02T18-17-28-riley-noah-house-style`, 5 runs.** One hand-off (run
3), with a brief of 304 characters, against 1,450–2,500 before. It is the
writer's request restated, with no notes digested and no sample lines. The
house style held in all five, the handed-off draft included: present tense,
no dashes, no semicolons, one "said". So a loaded skill reaches Write now.
Every run read the skill's file through `use_skill`, with no `read_document`
tries (two in ten before; the new hint was not needed this time). Run 4
wrote "Now let me read the voice reference file." before a load-only round.
It went to the thinking, not the reply, though the reply still opened on
"Here's the scene:" from its last round, which the fold rightly leaves.

**For the app.** The transcript fix and the fold hold. The hand-off rate
does not, so Write stays the writer's. The brief is short now, and the open
question is how to get the model to make the call at all.

**Next.** One sentence per round, in Write's description, and not the
chat prompt. One option is to say that reading the notes first is fine and
Write is still the one to write the prose. Another is to put back the earlier
draft's "what to read first" in the brief, keeping "don't quote the notes".
A scenario whose message does not tell the chat to read the notes would
separate the description's pull from the writer's instruction.

## Reads kept in the conversation, the writer's pins, no tree (5 Oct 2026, GLM 5.2)

The project block lost the tree and the model's keeps. A turn's document calls
now go back with the conversation where they were made, the block lists any
read whose document has changed since, an identical read of an unchanged
document still in view answers `unchanged`, and `list_documents` lists the
project by full path (`.llm/project_context_design.md`). Branch
`project-context`; dev at 568b265b as the baseline, on the same scenarios
with their keep turns taken out. Morph excluded from routing (below).

| Scenario                 | Version | Checks | Prompt tokens a run | Cached | Cost a run | Reads again |
| ------------------------ | ------- | ------ | ------------------- | ------ | ---------- | ----------- |
| design, 9 turns, 2 runs  | dev     | 30/30  | 221k                | 82%    | $0.061     | 13          |
| design                   | branch  | 30/30  | 284k                | 88%    | $0.063     | 1           |
| long, 15 turns, 2 runs   | dev     | all    | 276k                | 83%    | $0.068     | 8           |
| long                     | branch  | 55/56  | 407k                | 91%    | $0.080     | 1           |
| explore, 8 turns, 3 runs | branch  | 50/51  | 136k                | 78%    | $0.046     | 0           |
| big, 4 turns, 3 runs     | branch  | 24/24  | 68k                 | 72%    | $0.021     | 0           |

("Reads again" is dev's measure there, a document read within three turns of
its last read, and the branch's, a document read again while its earlier read
was still in the conversation and unchanged.)

**What it costs.** A third more prompt tokens and, with more of it cached,
3% more on the design scenario and 18% more on the long one. The prompt now
grows a turn at a time (6.8k at turn 1 of the long scenario to 18k at turn 15,
where dev stayed near 8.5k), so a longer chat costs more until a summary.

**What it buys.** The model stopped reading the same documents again: 21 such
reads in dev's four runs, two in the branch's. No run guessed a path without
the tree (0 misses in 66 turns): every run listed first, with `depth` when it
wanted less. In `findable-big`, 283 documents, the listing folded the journal
("245 inside, not listed") and every run listed inside it and counted the
month right. After the writer changed a meeting note, every run read it again
and said what had changed: "The project block flags that the Aug 26 meeting
note has been edited since I last read it, so let me re-read it before
answering." A pinned design was used from the block, never read. A status
note was written from what was already in the conversation, nothing read
twice.

**What failed.** The long scenario's Evaluation section invented a gate in
one run of two, the same habit as on 26 Sep. One `explore` turn named the
right paper from its title in the listing without opening it; the check
wanted a read. Three reads named a section by guess ("Hard negative" in the
glossary) and got the error that says to describe the document.

**Morph comes apart on GLM 5.2.** The two smoke runs, routed by price, put
a request each on Morph, which neither earlier GLM 5.2 batch had used. Both
came back as one response of nothing but tool calls: one listing 253 times
(5k completion tokens), and in the other each of 37 reads over a hundred
times, 1,257 calls (98k completion tokens). Every call ran, and since document
calls now stay in the conversation, every later request carried them, 450k
to 950k prompt tokens a turn, $4.45 for two runs. The app now runs each
distinct call in a round once and at most 20 of them, answering the first it
leaves out with an error (`ai/rounds.js`), so a response like that costs its
own turn and not every turn after. The batches above were routed without
Morph.

**Next.** Whether to keep Morph out of the app's routing by default, which
the guard makes a matter of wasted turns rather than ruined chats. A chat long
enough to reach a summary, to see the growth level off. A weaker local model,
where a small context fills faster with kept reads.

## A general opening for the default prompt (6 Oct 2026, GLM 5.2)

`chat.md` opened as a creative writing assistant, one line on brainstorming
and feedback, and spent everything after on tools. It now opens for any kind
of project (fiction, notes, research, worldbuilding, roleplay, planning) with
four bullets on how to help: think with them and say which option you would
pick; be specific and honest about what works and what doesn't; write in the
project's voice and change only what was asked; answer in proportion. The
tool paragraphs keep their words, but for "the user" throughout and examples
that are not all fiction or all rulebook. New scenario `riley-noah-assistant`
is the first the default prompt has had for what it says its job is: a
critique, a brainstorm, a quick question and a note, with checks on the reads,
the count and the writes.

| Batch                                                | Checks | Brainstorm words | Picks one | Quick answer, words |
| ---------------------------------------------------- | ------ | ---------------- | --------- | ------------------- |
| assistant, new opening (`01-22-40`)                  | 15/15  | 645–959          | 1 of 3    | 1–17                |
| assistant, options "a line or two each" (`01-33-01`) | 15/15  | 597–770          | 1 of 3    | 5–183               |
| `findable-design`, new opening (`01-26-50`)          | 30/30  | —                | —         | —                   |

**Tool discipline did not move.** `findable-design` checked 30 of 30, as dev
did on 5 Oct, with the same one error: a section of the glossary named by
guess. Every note in the assistant scenario was written from the character
notes, in a folder made for it.

**The critique is what the bullet asks for.** Each run said what works before
what is thin, quoted the notes for both, and named the gap a writer could act
on (Noah written only from the outside, nothing of him when things are fine).

**Brainstorm length and the pick did not hold, in either wording.** "Offer
options, say which you would pick" got a pick in one run of three and options
a paragraph or more each; "a line or two each, then say which one you would
pick" made them a little shorter and no more likely to pick. Shipped with the
first wording, which reads better and did as well. If it matters, try it as a
check ("each option is one sentence; the last line names your pick"), the
form GLM has kept where principles failed.

One quick answer in the second batch, served partly by BaseTen, counted five
documents and cited a chapter that does not exist; the first batch answered
"3" every time. Watch it, but one run is not a finding.

## The default prompt cut to a third (6 Oct 2026, GLM 5.2)

The opening above sat on 25 lines of tool mechanics that the tools' own
descriptions already say: how paths work, reading a long document by section,
search's `titled`, which write tool to prefer. Those went, with the line that
content is Markdown and the explanation of `summary`, leaving the role, the
four bullets, what `pinned` and `changed` mean, and the three rules the
earlier rounds kept: look things up rather than guess, ask when "this
chapter" is ambiguous, and write nothing into a document the documents don't
support. 1,114 words to 336. Three tool descriptions lost examples that were
all fiction or all rulebook.

| Scenario               | Runs | Checks, before | Checks, slim | Prompt tokens a turn, slim |
| ---------------------- | ---- | -------------- | ------------ | -------------------------- |
| `findable-design`      | 2    | 30/30          | 30/30        | 10.8k (12.0k before)       |
| `findable-long`        | 2    | 55/56          | 55/56        | 10.2k                      |
| `findable-explore`     | 3    | 50/51          | 51/51        | 7.0k                       |
| `findable-big`         | 3    | 24/24          | 24/24        | 7.2k                       |
| `riley-noah-assistant` | 3    | 15/15          | 15/15        | 5.5k (6.7k before)         |

("Before" is 5 Oct for the four `findable` scenarios and this morning's new
opening for the assistant one.)

**Nothing the long version said was holding the tools up.** No scenario lost a
check, and the tool errors fell to one, the glossary section named by guess
that every recent batch has made once.

**One new miss in `findable-long`.** Asked what Priya said, one run answered
from the pinned design, which lists her three kinds of query, and said "I
read the Priya interview earlier in this conversation", which it had not; the
other run read it. The 5 Oct miss on this scenario, an invented gate, did not
recur. Two runs cannot tell either from noise, but a claimed read that never
happened is worth watching for.

**The assistant turns held, a little better.** Critiques still specific and
honest; two brainstorms in three now come down on one option (one in three
before), at 665–738 words; the count came back as "Three."
