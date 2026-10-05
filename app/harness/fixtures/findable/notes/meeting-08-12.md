# Meeting 2026-08-12

Kickoff. Present: Dana, Marcus, Ines, Tom.

## Scope

Search over the user's own notes inside the app. Not web search, not search over shared workspaces; those are later. The corpus is one person's notes, typically two to ten thousand of them.

## The rule

**No server.** The app runs on the user's laptop and their notes never leave it. Anything search needs — models, indexes — ships with the app or is built locally. Tom raised cloud embeddings as a shortcut for the first version; rejected, because the first version is what sets expectations and a search that phones home is not the product.

## Latency

Dana proposed a budget of **200 ms end to end** from query submitted to results shown. Agreed for now. Ines pointed out that if search runs as the user types, the budget has to cover every keystroke, not just submit; parked until we know whether we are doing search-as-you-type.

## Index

Marcus to prototype BM25 over chunks to have something running. Chunk size to be taken from the Ferreira paper once Ines has read it.

## Actions

- Ines: read Ferreira, Okonkwo. Summarize into Papers/.
- Marcus: BM25 prototype over the test corpus.
- Dana: user interviews, two or three heavy note-takers.
- Tom: measure embedding model load times on the lowest-spec laptop we support.

Next meeting in two weeks.
