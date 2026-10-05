# Meeting 2026-08-26

Present: Dana, Marcus, Ines, Tom.

## Retrieval

Ines presented Okonkwo: hybrid is within three points of the best retriever on both short and long queries, and short queries are most of what real owners type. **Decided: hybrid retrieval**, BM25 plus a local bi-encoder, fused with reciprocal rank fusion. The exact-match path stays whatever else changes; Priya's interview made that concrete.

Marcus's BM25 prototype searches the 6,000-note test corpus in 12 ms. Tom measured the 110M bi-encoder loading in 900 ms on the low-spec laptop, which is fine once at startup and not fine per query; the model stays resident.

## Reranking

Tom's spike (Archive/Reranker spike) put a cross-encoder at 190 ms for 50 candidates, which is the whole budget on its own. Ines has the Lindqvist paper on the pile, which is about small rerankers. **Deferred**: no reranker in the design until the Lindqvist numbers are in, and only then if it fits the budget with room to spare.

## Index size

A user with ten thousand long notes at 256-token chunks is on the order of 150,000 chunks, and the vector index for that is over a gigabyte in float32. **Decided: cap the index at 50,000 chunks** for the first version, indexing the most recently edited notes first, and quantize the vectors. Dana to check how many users are over the cap.

## Actions

- Ines: Lindqvist, Adeyemi, Zhou.
- Marcus: add the bi-encoder to the prototype and fuse.
- Dana: cap analysis; write up the Priya interview.
- Tom: vector quantization options.
