# Retrieval design v0

Superseded. Kept for the record; do not build from this.

## Approach

Pure BM25 over whole notes, no chunking, no vectors. Every note is one document in the inverted index. Simple, fast, and it handles the exact-phrase case the interviews keep bringing up.

## Embeddings

If we need semantic search later, the plan is to call a hosted embedding API for each note at index time and store the vectors. The API costs are small at our scale and it avoids shipping a model with the app. Queries would be embedded by the same API on submit.

## Latency

A budget of 500 ms from submit to results. Search runs on submit, not while typing; a search button in the UI.

## Ranking

BM25 score only. Newest note wins ties.

## Known gaps

- Topic queries where the note uses different words will not match.
- Long notes score oddly under BM25 with no chunking; a term buried in a long note is diluted.
