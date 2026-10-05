# API sketch

What the UI calls. Rough.

```
search(query: string, options?: { limit?: number; after?: Date }): SearchResult[]

SearchResult {
  noteId: string
  title: string
  snippet: string        // the best-matching chunk, trimmed to a line or two
  score: number          // fused score; only meaningful within one result list
  matchedExactly: boolean // true when the query appears verbatim in the note
  editedAt: Date
}
```

- `search` is called on every keystroke after the second character. It must return within the budget or the UI shows the previous results.
- `limit` defaults to 20.
- `matchedExactly` is what lets the UI badge an exact hit, which Priya's interview says matters.
- No pagination in the first version; twenty results and a "show more" that raises the limit.

```
reindex(noteId?: string): void   // one note, or everything when omitted
indexStatus(): { chunks: number; cap: number; pending: number }
```

`indexStatus` is for a settings screen that says how much of the corpus is searchable, which the cap makes necessary.
