# Dense versus sparse retrieval on personal corpora

Okonkwo, A., Halvorsen, M. and Reyes, D. (2024). Notes from a read on 2026-08-19.

## What they asked

Most retrieval benchmarks are web-scale: millions of passages, queries written by strangers. A personal corpus is the opposite: a few thousand notes, written and queried by the same person, full of private shorthand. The paper asks whether the results that hold at web scale hold here.

## Setup

Eleven corpora donated by volunteers, 1,200 to 9,800 notes each, chunked at 256 tokens. Three retrievers:

- **Sparse**: BM25 over the chunks, default parameters.
- **Dense**: a 110M-parameter bi-encoder, off the shelf, no fine-tuning.
- **Hybrid**: reciprocal rank fusion of the two lists, k = 60.

Queries were collected from the owners over two weeks and split by length: **short** (one to three words, typically a name or a keyword) and **long** (a phrase or a question, four words or more).

## Results

Recall at 10, averaged over corpora:

| Query type    | BM25 | Dense | Hybrid |
| ------------- | ---- | ----- | ------ |
| Long queries  | 0.63 | 0.71  | 0.78   |
| Short queries | 0.69 | 0.61  | 0.72   |

On long queries dense beats sparse by eight points and hybrid adds seven more. On short queries sparse wins outright: a name or a project codeword is a token the bi-encoder has never seen, and BM25 matches it exactly. Hybrid is within three points of the best retriever on both query types, which is the paper's headline: for a personal corpus, fuse and stop worrying about which is better.

## What they note

- Owners' queries were far shorter than benchmark queries: the median was two words.
- The dense model's failures on short queries were almost all proper nouns and coined terms.
- Fusion weight barely mattered between k = 30 and k = 100.
- Index build for the largest corpus took four minutes on a laptop; query time was under 20 ms for either retriever alone.

## For us

Our users write the way these owners do. Short queries dominate, and they are exactly where dense retrieval is weakest. Hybrid is the safe default, and the exact-match path has to stay, whatever else we add.
