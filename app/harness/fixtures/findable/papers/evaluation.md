# Evaluating retrieval without labels

Zhou, M., Petrov, I. and Lindgren, E. (2024). Notes from a read on 2026-09-05.

## What they asked

A retriever over someone's private notes cannot be evaluated on public benchmarks, and asking the owner to label relevance for hundreds of queries does not scale. The paper asks whether a language model can stand in for the human judge, and where it fails.

## Setup

Four collections with human relevance labels. A language model is shown the query and a candidate passage and asked for a graded judgement (0 to 3). Agreement with the human labels measured by Cohen's kappa, and the ranking of retrievers by the model judge compared with their ranking by the human labels.

## Results

- Agreement with human labels: κ = 0.62 overall, which the paper calls substantial. It was highest on factual queries (0.71) and lowest on queries about the owner's own intentions (0.44), where the judge had no way to know what the owner meant.
- Ranking of retrievers: the model judge ranked five retrievers in the same order as the human labels on three of four collections. On the fourth it swapped the middle two.
- Bias: the judge scored passages that quoted the query's words more highly than humans did, by 0.3 on the four-point scale. This favours sparse retrieval in a comparison.

## What they note

- Absolute scores from the model judge are not comparable across collections; only rankings within one.
- The judge was reliable for regression testing: a change that lost two points by human labels lost two by the model judge, every time.
- Prompting the judge with the owner's own note titles as context raised κ on the intention queries to 0.58.

## For us

Enough to catch regressions, not enough to make claims. We can use a model judge over a fixed query set to see whether a change helped or hurt, and we should give it the note titles as context. The bias toward lexical overlap means a judged comparison of BM25 against dense retrieval is tilted toward BM25, so that particular comparison wants human labels.
