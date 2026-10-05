# Cross-encoder reranking at the edge

Lindqvist, S., Abara, T. and Weiss, J. (2025). Notes from a read on 2026-09-02.

## What they asked

Cross-encoder rerankers are the standard second stage in retrieval pipelines, and the standard objection to them on a laptop is cost: a cross-encoder scores every candidate against the query, one forward pass each. The paper asks how small a reranker can get before it stops helping, and what the survivors cost on consumer hardware.

## Setup

A 340M-parameter teacher cross-encoder distilled into students of 110M, 66M, 22M and 11M parameters. Each student reranks the top 50 candidates from a hybrid first stage (BM25 plus a bi-encoder, fused). Evaluated on three collections, including one personal-notes collection built the way Okonkwo et al. built theirs. Hardware: a 2023 laptop CPU, eight cores, no GPU, batch of 50, int8 quantization.

## Results

Gain in nDCG at 10 over the unreranked hybrid list, and latency to rerank 50 candidates:

| Student | nDCG@10 gain | Latency |
| ------- | ------------ | ------- |
| 110M    | +7.4         | 162 ms  |
| 66M     | +6.9         | 97 ms   |
| 22M     | +6.2         | 38 ms   |
| 11M     | +3.1         | 21 ms   |

The 22M model keeps most of the gain at under a quarter of the 110M model's cost. Below it the gain halves. The paper's recommendation is the 22M student for anything interactive, and it notes that reranking 20 candidates instead of 50 cuts the 22M model to 16 ms with a loss of 0.4 points.

## What they note

- Gains were largest on long, question-shaped queries and smallest on single keywords, where the first stage was already right.
- Quantization to int8 cost 0.2 points and halved latency; they did not try int4.
- The first-stage recall bounds everything: a reranker cannot surface what the first stage did not retrieve.
- Cold start matters: loading the 22M model took 140 ms from disk, so it has to be resident.

## For us

This is the number we were waiting for. Reranking the top 20 with the 22M student is 16 ms, which fits inside any budget we have discussed, and it pays six points on the queries our users struggle with. The earlier spike (Archive/Reranker spike) measured a 340M model in float32 and concluded reranking was too slow; that conclusion is about the model it tried, not about reranking.
