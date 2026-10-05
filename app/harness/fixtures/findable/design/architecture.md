# Architecture overview

The pieces, and what talks to what. Everything runs in the app process on the user's laptop.

## Indexer

Watches the note store for edits. On a change it re-chunks the note, drops the old chunks from both indexes, and inserts the new ones. Runs in a background worker so typing is never blocked by indexing. On first launch it indexes the corpus from most recent note backward until the chunk cap is reached.

## Store

Two indexes side by side, both on disk under the app's data directory:

- The **lexical index**: an inverted index over chunk tokens, for BM25. Small; a few megabytes for a large corpus.
- The **vector index**: int8 vectors from the bi-encoder with a flat index (brute force) for the first version. At 50,000 chunks and 384 dimensions that is under 20 MB and a brute-force scan is under 20 ms.

## Query pipeline

Runs on the UI thread's request, off the UI thread. Takes the query string, fans out to both indexes, fuses, groups by note, applies the recency tiebreak, and returns the list. Every stage is timed and the timings are logged, so a slow keystroke can be explained after the fact.

## Models

The bi-encoder is loaded once at startup and kept resident. Any further model (a reranker, a rewriter) follows the same rule: loaded once, resident, or not used.

## Evaluator

A separate command that runs the regression query set through the pipeline and asks a local judge model to score the results. Not part of the app; run by us, on every change.
