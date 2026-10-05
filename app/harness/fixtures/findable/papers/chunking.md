# Chunking strategies for long documents

Ferreira, R., Nakamura, H. and Osei, B. (2024). Notes from a read on 2026-08-20.

## What they asked

A retriever indexes chunks, not documents, and how a document is cut decides what can be found. The paper compares three ways of cutting long documents and asks which retrieves best, and at what index size.

## Strategies

- **Fixed windows**: N tokens per chunk with an overlap of M. Swept N over 128, 256, 512 and 1024 and M over 0, 32 and 64.
- **Sentence windows**: one sentence per chunk for scoring, with the two sentences either side returned as context.
- **Late chunking**: embed the whole document (up to the model's limit of 8,192 tokens), then pool the token embeddings into chunk embeddings after the fact, so each chunk's vector has seen the whole document.

## Results

Recall at 10 on a collection of long technical documents, dense retrieval only:

| Strategy           | Recall@10 | Chunks per document |
| ------------------ | --------- | ------------------- |
| Fixed 128 / 32     | 0.58      | 61                  |
| Fixed 256 / 32     | 0.66      | 30                  |
| Fixed 512 / 32     | 0.64      | 15                  |
| Fixed 1024 / 64    | 0.57      | 8                   |
| Sentence windows   | 0.65      | 190                 |
| Late chunking, 256 | 0.71      | 30                  |

Fixed 256 with 32 overlap is the best of the plain strategies and the paper's recommended default. Overlap of 32 beat 0 by two points at every size; 64 added nothing over 32. Late chunking is best by five points but needs a long-context embedding model and embeds every document whole, which cost 3.4 times the indexing time.

## What they note

- Chunks under 200 tokens lost context for pronouns and back-references; chunks over 500 diluted the match.
- Sentence windows retrieved well but the index was six times larger.
- Late chunking's gain was largest on documents with a lot of cross-reference, smallest on lists.

## For us

Fixed 256 with 32 overlap is where we start; it is what Okonkwo used too, which keeps the two papers comparable. Late chunking is worth a spike if indexing time turns out not to matter, which for a personal corpus it may not.
