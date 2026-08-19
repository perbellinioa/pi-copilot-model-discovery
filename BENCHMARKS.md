# Benchmarks

Measured on 2026-08-19 under WSL2 Linux x86_64 with Node.js 24.19.0. Results are machine-specific; run `npm run benchmark` for local numbers.

The benchmark converts a synthetic 250-model provider catalog 2,000 times after warm-up. Values below are medians from three sequential runs.

| Metric | Result |
| --- | ---: |
| Mean conversion | 0.1940 ms |
| p50 | 0.1509 ms |
| p95 | 0.4508 ms |
| p99 | 0.9192 ms |
| Throughput | 1,288,574 models/sec |

Network latency, not catalog conversion, dominates refresh cost. The runtime therefore uses a credential-partitioned raw-catalog cache, a five-minute freshness window, and HTTP ETag/Last-Modified revalidation. A fresh cache performs no network request during startup.

These are observability baselines, not hard CI thresholds; timing assertions are intentionally avoided because shared CI runners are noisy. Cache behavior and conditional requests are enforced by deterministic tests.
