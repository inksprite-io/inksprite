# Hard negatives in contrastive training

Sato, K. and Brennan, L. (2023). Notes from a read on 2026-08-21.

## Definition

The paper defines a **hard negative** as a negative passage that the current model ranks above the positive passage for the same query. The definition is relative to the model being trained: as the retriever improves, what counts as hard changes, and the paper re-mines every epoch for that reason.

This is not how our glossary uses the term. Worth reconciling before anyone reads both.

## What they asked

Contrastive training for a bi-encoder needs negatives. Random negatives are easy and teach little. The paper asks how much mining hard negatives helps, and whether there is a point past which it hurts.

## Setup

A 110M bi-encoder trained on a public passage-ranking set. Negatives per positive fixed at 15. The fraction of those that are mined hard negatives (the rest random) swept from 0% to 100% in steps of 20. Hard negatives mined from the model's own top 100 at the start of each epoch, excluding anything labelled positive.

## Results

Recall at 10 relative to all-random negatives:

| Hard fraction | Gain |
| ------------- | ---- |
| 0%            | 0.0  |
| 20%           | +2.4 |
| 40%           | +3.1 |
| 60%           | +2.6 |
| 80%           | +1.2 |
| 100%          | −0.9 |

The gain peaks at 40% hard and falls past it; at 100% the model is worse than with random negatives. The paper attributes the fall to false negatives: at high mining rates the "hard negatives" are increasingly unlabelled positives, and the model is being taught to push away passages that are relevant.

## What they note

- Re-mining each epoch mattered: static hard negatives mined once gave +1.8 at the 40% point.
- A denoising step (dropping mined negatives the teacher cross-encoder scores above the positive) recovered most of the loss at 80% and 100%.
- Small corpora had more false negatives, since near-duplicate notes are common.

## For us

We are not training a retriever in the first version, so this is background. If we ever fine-tune on a user's own notes, the false-negative problem is severe there: a personal corpus is full of near-duplicates, and the paper's denoising step would be required, not optional.
