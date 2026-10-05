# Query rewriting with small models

Adeyemi, F., Kowalczyk, P. and Tan, W. (2025). Notes from a read on 2026-09-04.

## What they asked

Users type short, ambiguous queries. A language model can expand a query into what the user probably meant before it reaches the retriever. Large models do this well and cost too much to run per keystroke; the paper asks whether a small local model does enough of it to be worth having.

## Setup

Three rewriters: a 0.5B, a 1.5B and a 3B instruction-tuned model, each prompted to write a one-sentence hypothetical answer to the query, which is then embedded in place of the query (the HyDE recipe, scaled down). Retrieval is hybrid. Queries split into **ambiguous** (judged by annotators to have more than one plausible intent) and **exact** (a phrase the user remembered verbatim).

## Results

Change in recall at 10 over the unrewritten query, and rewriter latency on a laptop CPU:

| Rewriter | Ambiguous | Exact | Latency |
| -------- | --------- | ----- | ------- |
| 0.5B     | +1.9      | −3.8  | 120 ms  |
| 1.5B     | +4.0      | −4.1  | 310 ms  |
| 3B       | +4.6      | −4.4  | 640 ms  |

Rewriting helps ambiguous queries by four points at 1.5B and hurts exact-phrase queries by about the same at every size: the rewriter paraphrases away the phrase the user was searching for. The paper's answer is to route: detect an exact query (quotation marks, or a high BM25 score on the raw query) and skip the rewriter for it.

## What they note

- The 0.5B model's rewrites were often wrong in a way that still retrieved well; the embedding was in the right region.
- Latency is per query, not per keystroke; the paper assumes rewriting runs on submit, not while typing.
- Routing recovered the exact-query loss entirely and kept 90% of the ambiguous gain.

## For us

Only with routing, and only on submit. Our budget is set by search-as-you-type, so a rewriter cannot sit in the typing path at all; it would have to be a second pass that refines results after the first ones are shown. Open question whether that is worth the complexity.
