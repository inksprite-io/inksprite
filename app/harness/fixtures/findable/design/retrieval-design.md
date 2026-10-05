# Retrieval design

Draft. Sections marked TODO are not written yet.

## Goals

Search over the user's own notes, on the laptop, with results appearing as they type. Three kinds of query have to work: an exact phrase the user remembers, a name or codeword, and a topic the user cannot name precisely. The first two are served by exact match; the third is why there is a dense retriever at all.

## Indexing

Every note is cut into chunks of 256 tokens with 32 tokens of overlap, following Ferreira et al. Each chunk is indexed twice: in a BM25 index over its tokens, and as a vector from a local 110M bi-encoder, quantized to int8. The bi-encoder stays resident after the app starts.

The index is capped at 50,000 chunks, filling from the most recently edited notes. Notes beyond the cap are not searchable in the first version.

## Query

The raw query goes to both indexes. BM25 returns its top 100 by score; the bi-encoder returns its top 100 by cosine distance. The two lists are fused by reciprocal rank fusion with k = 60. No query rewriting in the first version.

## Ranking

The fused list is the result list, ordered by fused score, with recency as a tiebreak. Results are grouped by note, so a note that matches on three chunks appears once, at the position of its best chunk.

TODO: reranking. Deferred until the Lindqvist numbers are in.

## Latency

The budget is 200 ms end to end from query to results shown. BM25 is 12 ms on the test corpus and the bi-encoder query is under 20 ms; fusion is negligible. The remainder is rendering.

## Evaluation

TODO: how a change is judged. Zhou et al. suggest a model judge is enough for regression testing.
