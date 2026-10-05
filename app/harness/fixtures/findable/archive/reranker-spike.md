# Reranker spike

2026-08-24, Tom. Superseded by the Lindqvist read; see Meeting 2026-09-09.

## What I tried

A stock 340M cross-encoder, float32, over the top 50 candidates from Marcus's BM25 prototype, on the low-spec laptop.

## Result

**190 ms** to rerank 50 candidates, cold model already loaded. That is nearly the whole 200 ms budget by itself, before retrieval and rendering.

Quality was clearly better: on the twenty queries I tried by hand, the right note moved into the top three in fourteen cases where BM25 alone had it lower.

## Conclusion at the time

Reranking is too slow for us. Park it.

## Note added 2026-09-10

This measured one large model in float32. Lindqvist et al. get 38 ms from a 22M model in int8, and 16 ms over 20 candidates. The conclusion above is withdrawn; the decision is in the 2026-09-09 meeting note.
