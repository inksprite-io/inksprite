# Open questions

Things nobody has decided. Move a line to the decisions log when it is.

- Does late chunking (Ferreira) pay for itself on a personal corpus, where indexing time may not matter? Needs a spike.
- Query rewriting as a refinement pass after first results: is the complexity worth four points on ambiguous queries?
- What happens to the cap when a user has 80,000 chunks of notes? Oldest notes silently unsearchable is not acceptable; a "search older notes" fallback to BM25 only?
- Which local model judges the regression set, and does it fit on the low-spec laptop alongside the retriever?
- Do we ever fine-tune the bi-encoder on the user's own notes? The false-negative problem in Sato and Brennan says not without denoising.
- Should the glossary's definition of hard negative be changed to match the literature, or kept as a term of our own?
