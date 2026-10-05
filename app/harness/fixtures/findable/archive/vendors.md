# Embedding vendor comparison

August 2026, Tom. Superseded by the no-server decision; nothing here applies.

Three hosted embedding APIs compared on the test corpus for the v0 plan.

| Vendor | Dimensions | Price per million tokens | Latency per call |
| ------ | ---------- | ------------------------ | ---------------- |
| A      | 1536       | $0.02                    | 180 ms           |
| B      | 1024       | $0.01                    | 140 ms           |
| C      | 768        | $0.005                   | 220 ms           |

Retrieval quality was within two points of recall at 10 across the three. B was the pick on price and latency.

Indexing eight thousand notes would cost under a dollar with any of them. The per-query call is the problem: 140 ms of network before anything else happens, and nothing at all offline.

Dropped when the kickoff ruled out any server.
