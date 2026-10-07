# Scoring an adventure run

For transcripts written by `run.js` on an `adventure-*` scenario: three player
turns against `harness/prompts/adventure.md`, with the Saltmarsh fixture behind
it. The variants differ only in what the chat allows — the Director before the
turn, the dice and oracle group, the skills group — so score each run on its
own and the comparison falls out.

Quote for every judgement. The transcript shows tool calls and results under
**Tools**, and the Director's note under **Director** when the chat ran it.

## The turn as a turn

1. **Length.** A paragraph or two. Quote the longest turn's first line and give
   its word count.
2. **Never acts for the player.** The GM may narrate what the world does and
   what the courier's body is doing, but may not decide what they say, choose,
   or feel. Quote any breach.
3. **Stops where the player can act.** Each turn ends at a decision or a line
   of dialogue aimed at them, not after resolving the next three beats.
4. **Answers what was asked.** Turn 2 asks Maren a direct question and turn 3
   asks to see the ledger. Say what the GM did with each.

## The project behind it

5. **Notes used, not recited.** The fixture holds four things the GM can spend:
   Maren's ledger and its gap, the brother she will not discuss, the nineteen
   days nobody has crossed, the second courier a day ahead. Say which were
   used, which were dumped whole, and which never appeared.
6. **Nothing contradicted.** The notes say the courier was never told what is
   in the case and that nobody explains the plot to them. Quote any line that
   breaks either.
7. **Reads before answering.** The tool list shows whether it opened the
   documents. Note how many `read_document` calls and whether it read the
   person it was about to play.

## The resolution tools

8. **Oracle used where it belongs.** For questions the fiction has not settled
   and that matter now. Quote each `oracle` call, say whether the question was
   worth asking, and whether the answer changed what happened.
9. **Result never narrated as a result.** No "exceptional yes", no mention of
   odds or of having consulted anything.
10. **Names.** Whether `generate_names` was called before naming someone, and
    whether the name fits the place.
11. **When the tools are gone** (the `no-oracle` variant): does the GM decide
    the same questions itself, decline to decide them, or stop asking them?
    This is the measurement that says what the oracle is buying.

## The Director

12. **What it changed.** Quote the Director's note and the turn that followed.
    Did the turn take the beat, ignore it, or read it aloud?
13. **Cost.** The Director is a whole extra inference before the player sees
    anything. Give its share of the turn's wall clock from the timings.
14. **Narration seams.** A direction written as critique ("this scene is
    dragging") tends to surface as throat-clearing or an abrupt gear change.
    Quote any.

## Report

- PASS / WEAK / FAIL with a quote for 2, 3, 6, 9.
- A sentence each for 1, 4, 5, 7, 8, 10, and for 11 to 14 where they apply.
- **Best turn in the run**, quoted.
- **Worst moment**, quoted.
- A 1-10 for the run as a session someone would want to keep playing.
- One change to `adventure.md`, stated as the sentence to add or remove.
