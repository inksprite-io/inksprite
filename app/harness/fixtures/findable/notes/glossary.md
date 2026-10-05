# Glossary

Terms as this project uses them. Where a paper uses one differently, the paper's note says so.

- **Chunk** — the unit the index holds and retrieval returns: a run of tokens cut from a note. Ours are 256 tokens with 32 of overlap.
- **Bi-encoder** — a model that embeds the query and each chunk separately, so chunk vectors can be computed ahead of time and compared by distance.
- **Cross-encoder** — a model that reads the query and a chunk together and scores the pair. Better, and cannot be precomputed, so it only runs over a shortlist.
- **First stage** — the retriever that produces the shortlist from the whole index: BM25, the bi-encoder, or both fused.
- **Reranker** — a cross-encoder run over the first stage's shortlist to reorder it.
- **Hard negative** — a training example taken from the same note as the positive chunk but not itself relevant to the query. Used so the model learns to tell chunks of one note apart rather than just notes from each other.
- **Recall at k** — of the chunks that are relevant to a query, the fraction that appear in the top k results. The number we optimise for the first stage.
- **nDCG at k** — a ranking measure that rewards putting the most relevant chunks highest. The number we optimise for the reranker.
- **RRF** — reciprocal rank fusion: combining two ranked lists by summing 1 / (k + rank) for each item across the lists.
- **Exact query** — a query the user remembers verbatim from a note. Must be served by exact match; never rewritten.
- **Budget** — the end-to-end latency allowed per keystroke. See the decisions log for the current number.
