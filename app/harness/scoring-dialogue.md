# Scoring a dialogue run

How to read a file in `runs/<batch>/run-N.md` written by `dialogue.js`. It has
four parts: the **Exchange** (the committed lines), the **Director**'s
objective updates, the **Bids not taken**, and the **Narrated** prose.

This architecture exists to fix one thing: a single model writing both sides
of an argument knows everything both people know, and the design note argues
every dialogue failure follows from that. So score the exchange for what the
split is supposed to buy, and score the prose the way any scene is scored.

Quote the line for every judgement.

## The exchange

1. **Talking past.** Count the lines that do not address what was just said —
   answering the line before last, asking a different question, answering the
   tone rather than the words. The design note wants two in six. Report the
   count and the ratio, and quote the best instance.
2. **Lexical echo.** Any content word carried from one speaker's line into the
   next speaker's. Quote every instance; this is the cheapest failure and the
   easiest to count.
3. **Self-explanation.** Anyone explaining their own position or reasoning to
   someone who has heard it before.
4. **Names in address.** Anyone using the other's name for emphasis rather
   than to get their attention.
5. **Objectives visible.** Can you state, from the lines alone, what each
   person was trying to get? If both objectives are legible the split is
   working; if one person is simply reacting, that speaker's calls are not
   pursuing anything.
6. **Asymmetry.** Does either speaker say something that implies knowledge of
   the other's objective or interior state? They were not given it, so an
   apparent leak is either a coincidence or the model inferring, and either is
   worth quoting.
7. **Silence.** Did any round produce passes, and did a pass read as a real
   beat (someone declining to speak) or as a failure to generate? Note the
   pass count from the summary line.

## The Director

8. **Did it change anything?** For each run, say what it rewrote and whether
   the following lines show it. A Director that only restates the objective is
   costing a call for nothing.
9. **Staleness caught or missed.** If the scene circles — the same want
   pursued after the scene settled it — say at which line it started and
   whether a Director run followed.

## The bids not taken

10. **Was the wrong line committed?** For each round, compare the winning line
    with the discarded bid. Say how often the loser was better, and quote the
    worst case. This is the one measurement that says whether the problem is
    the speakers or the arbiter.

## The narrated prose

11. Score it 1–10 against `scoring.md` criteria 2, 7, 8, 9 (tags, summary and
    abstraction, setting as physics, stock gestures), with quotes.
12. **Fidelity.** The narration pass was told to keep every line, in order,
    with its wording, and invent no dialogue. Quote anything added, cut, or
    reworded.

## Report

- Counts for criteria 1, 2, 7, 10 up front, as numbers.
- PASS / WEAK / FAIL with a quote for 3, 4, 5, 6, 8, 9, 12.
- A 1–10 for the narrated prose.
- **The one thing this architecture bought** over a single pass, quoted.
- **The one thing it cost**, quoted.
