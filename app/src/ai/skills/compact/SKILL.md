---
name: compact
description: >-
  Folds a long conversation into a summary it can carry on from.
disable-model-invocation: true
context: fork
argument-hint: '[instructions]'
metadata:
  inksprite-output: summary
  inksprite-summary: Fold the conversation so far into a summary to carry on from.
---

Summarize this chat so that it can be continued in another session. Summarize it so that it can be continued later without the transcript itself.

Your summary should incorporate any previous summaries. Only this summary will be available in the new session.
