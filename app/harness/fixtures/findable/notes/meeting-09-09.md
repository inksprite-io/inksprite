# Meeting 2026-09-09

Present: Dana, Marcus, Ines, Tom.

## Search as you type

Dana's interviews settled it: every heavy note-taker expected results to appear while typing, the way the app's title search already does. **Decided: search-as-you-type**, results refreshed on every keystroke after the second character.

That changes the budget. A 200 ms round trip on every keystroke feels laggy at typing speed, and Marcus measured the app's own title search at 90 ms per keystroke, which people call instant. **Decided: the latency budget is 150 ms end to end per keystroke**, replacing the 200 ms from the kickoff. Anything that cannot fit runs after the first results are shown and refines them.

## Reranking

Ines presented Lindqvist: a 22M cross-encoder reranks 50 candidates in 38 ms on a laptop CPU, or 20 candidates in 16 ms, for a gain of about six points. That is not the 190 ms Tom's spike measured; the spike used a 340M model in float32. **Decided: a reranker is allowed if it costs under 40 ms** and the first stage stays under 100 ms, so the pair fits the budget. Marcus to try the 22M model over the top 20.

## Query rewriting

Adeyemi's numbers only hold with routing, and a rewriter cannot sit in the keystroke path. Parked: if we do it, it is a refinement pass after first results.

## Evaluation

Zhou: a model judge is good enough for regression testing. **Decided: a fixed query set of 200 queries** from the interviews, judged by a local model with note titles as context, run on every change to the pipeline.

## Actions

- Marcus: reranker over top 20; measure end to end.
- Ines: update the design doc's latency and ranking sections (not yet done as of writing).
- Dana: assemble the 200-query set.
- Tom: retire the spike doc or mark it superseded.
