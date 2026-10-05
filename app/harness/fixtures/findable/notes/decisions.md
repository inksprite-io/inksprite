# Decisions log

One line per decision, newest last. The meeting note has the reasoning.

| Date       | Decision                                                      | Where              |
| ---------- | ------------------------------------------------------------- | ------------------ |
| 2026-08-12 | No server: models and indexes live on the laptop              | Meeting 2026-08-12 |
| 2026-08-12 | Latency budget 200 ms end to end                              | Meeting 2026-08-12 |
| 2026-08-26 | Hybrid retrieval: BM25 + local bi-encoder, RRF fusion         | Meeting 2026-08-26 |
| 2026-08-26 | Reranking deferred pending Lindqvist                          | Meeting 2026-08-26 |
| 2026-08-26 | Index capped at 50,000 chunks, most recently edited first     | Meeting 2026-08-26 |
| 2026-09-09 | Search as you type, from the second character                 | Meeting 2026-09-09 |
| 2026-09-09 | Latency budget revised to 150 ms per keystroke                | Meeting 2026-09-09 |
| 2026-09-09 | Reranker allowed if under 40 ms with first stage under 100 ms | Meeting 2026-09-09 |
| 2026-09-09 | Regression set of 200 queries, model-judged                   | Meeting 2026-09-09 |
