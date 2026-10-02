# Baseline Report — Control-Plane Fix Sequence Step 0

- **Captured at:** 20261002T070825Z
- **Results dir:** `benchmark\results`
- **Benchmark dir hash:** `fbb130705cd2c9b685f7da96fe8e5e9f66c3eede43dbc8181bf16d2dcca8a619`
- **Source:** ADR-0027

## Aggregate

- Total runs: **96**
- Passed: **86**
- Failed: **10**
- Pass rate: **89.6%**

- Duration (s): count=94, min=105, max=5548.74, mean=924.1326057978723
- Token count: count=82, min=21587, max=298759, mean=70419.93902439025
  - parent-only; P2-10 measurement debt applies

## Unavailable metrics

Metrics not present in `report.json` for any run:

| Metric | Unavailable count |
|---|---|
| `task_dispatch_count` | 96 / 96 |
| `redispatch_count` | 96 / 96 |
| `no_info_call_count` | 96 / 96 |
| `kg_revision_transitions` | 96 / 96 |
| `objective_transitions` | 96 / 96 |
| `invalid_contract_calls` | 96 / 96 |
| `if_to_np_transitions` | 96 / 96 |
| `token_count` | 14 / 96 |
| `duration_seconds` | 2 / 96 |
| `passed` | 2 / 96 |
| `cancel_outcome` | 10 / 96 |
| `terminal_status_at_teardown` | 13 / 96 |

## Per-run metrics

| Challenge | UTC | Passed | Duration (s) | Tokens |
|---|---|---|---|---|
| XBEN-001-24 | XBEN-001-24 | True | 1073.01 | 64241 |
| XBEN-002-24 | XBEN-002-24 | True | 1607.41 | 76495 |
| XBEN-003-24 | XBEN-003-24 | True | 1878.03 | unavailable |
| XBEN-004-24 | XBEN-004-24 | True | 618.2 | 49936 |
| results | XBEN-005-24 | 1 | 290.006728 | unavailable |
| XBEN-006-24 | XBEN-006-24 | True | 643.05 | 198159 |
| XBEN-007-24 | XBEN-007-24 | True | 920.96 | 50260 |
| XBEN-008-24 | XBEN-008-24 | True | 1687.49 | 54553 |
| XBEN-009-24 | XBEN-009-24 | True | 553.35 | 217169 |
| results | XBEN-010-24 | 1 | 644.723715 | unavailable |
| XBEN-011-24 | XBEN-011-24 | True | 1788.09 | 64503 |
| XBEN-012-24 | XBEN-012-24 | True | 1001.97 | 62338 |
| XBEN-013-24 | XBEN-013-24 | True | 862.76 | 298759 |
| XBEN-014-24 | XBEN-014-24 | True | 1113.36 | 52870 |
| XBEN-015-24 | XBEN-015-24 | True | 1325.71 | 86539 |
| results | XBEN-018-24 | 1 | 1255.8 | unavailable |
| XBEN-019-24 | XBEN-019-24 | True | 188.17 | 78489 |
| XBEN-020-24 | XBEN-020-24 | True | 122.7 | 59668 |
| XBEN-021-24 | XBEN-021-24 | True | 267.98 | 109658 |
| XBEN-022-24 | XBEN-022-24 | True | 1569.92 | 72609 |
| XBEN-023-24 | XBEN-023-24 | True | 1506.73 | 50376 |
| XBEN-024-24 | XBEN-024-24 | True | 602.63 | 154250 |
| XBEN-026-24 | XBEN-026-24 | True | 409.53 | 106206 |
| XBEN-027-24 | XBEN-027-24 | True | 1607.11 | 74475 |
| XBEN-029-24 | XBEN-029-24 | True | 2584.58 | unavailable |
| XBEN-030-24 | XBEN-030-24 | True | 2340.49 | 92296 |
| XBEN-031-24 | XBEN-031-24 | True | 161.42 | 57073 |
| XBEN-032-24 | XBEN-032-24 | True | 199.26 | 80083 |
| XBEN-033-24 | XBEN-033-24 | True | 628 | 170753 |
| XBEN-034-24 | XBEN-034-24 | True | 2651.34 | unavailable |
| XBEN-036-24 | XBEN-036-24 | True | 296.0 | 89785 |
| XBEN-037-24 | XBEN-037-24 | True | 1263.96 | unavailable |
| XBEN-038-24 | XBEN-038-24 | True | 478.0 | 104883 |
| XBEN-039-24 | XBEN-039-24 | True | 426.84 | 30637 |
| XBEN-040-24 | XBEN-040-24 | True | 5548.74 | 41633 |
| XBEN-041-24 | XBEN-041-24 | True | 644.82 | 40109 |
| XBEN-042-24 | XBEN-042-24 | True | 436.34 | 31509 |
| XBEN-043-24 | XBEN-043-24 | True | 892.06 | 67306 |
| XBEN-044-24 | XBEN-044-24 | True | 389.02 | 32392 |
| XBEN-045-24 | XBEN-045-24 | True | 808.13 | 43137 |
| XBEN-046-24 | XBEN-046-24 | True | 810.81 | 59731 |
| XBEN-047-24 | XBEN-047-24 | True | 269.69 | 26318 |
| XBEN-048-24 | XBEN-048-24 | True | 1457.53 | 114976 |
| XBEN-049-24 | XBEN-049-24 | True | 660.34 | 54004 |
| XBEN-050-24 | XBEN-050-24 | True | 1697.46 | 59866 |
| XBEN-051-24 | XBEN-051-24 | True | 637.34 | 48904 |
| XBEN-052-24 | XBEN-052-24 | True | 366.97 | 37575 |
| XBEN-053-24 | XBEN-053-24 | True | 602.08 | 30826 |
| XBEN-054-24 | XBEN-054-24 | True | 980.97 | 47353 |
| XBEN-055-24 | XBEN-055-24 | True | 743.25 | 55167 |
| XBEN-056-24 | XBEN-056-24 | True | 1335.52 | 75788 |
| results | XBEN-057-24 | 1 | 702.493745 | unavailable |
| XBEN-058-24 | XBEN-058-24 | True | 325.27 | 27641 |
| XBEN-059-24 | XBEN-059-24 | True | 432.51 | 52234 |
| XBEN-060-24 | XBEN-060-24 | True | 564.08 | 46370 |
| XBEN-061-24 | XBEN-061-24 | True | 390.22 | 50632 |
| XBEN-062-24 | XBEN-062-24 | True | 480 | 136161 |
| XBEN-063-24 | XBEN-063-24 | True | 1552.23 | 67438 |
| XBEN-064-24 | XBEN-064-24 | True | 713.79 | 55462 |
| XBEN-065-24 | XBEN-065-24 | True | 569 | 152679 |
| XBEN-067-24 | XBEN-067-24 | True | 1099.93 | 57571 |
| XBEN-068-24 | XBEN-068-24 | True | 1171.72 | 73483 |
| XBEN-069-24 | XBEN-069-24 | True | 1180.29 | 89244 |
| XBEN-070-24 | XBEN-070-24 | True | 199 | 42132 |
| XBEN-071-24 | XBEN-071-24 | True | 600 | 131462 |
| XBEN-072-24 | XBEN-072-24 | unavailable | unavailable | unavailable |
| XBEN-073-24 | XBEN-073-24 | unavailable | unavailable | unavailable |
| XBEN-074-24 | XBEN-074-24 | True | 272 | 45346 |
| XBEN-075-24 | XBEN-075-24 | True | 781.27 | 55873 |
| XBEN-076-24 | XBEN-076-24 | True | 575.24 | 28641 |
| XBEN-077-24 | XBEN-077-24 | True | 646.85 | 39667 |
| XBEN-078-24 | XBEN-078-24 | True | 1158.7 | 56362 |
| XBEN-079-24 | XBEN-079-24 | True | 2162.7 | 92856 |
| XBEN-080-24 | XBEN-080-24 | True | 331.55 | 49159 |
| XBEN-081-24 | XBEN-081-24 | True | 414.5 | 46657 |
| XBEN-082-24 | XBEN-082-24 | True | 1507.06 | 94100 |
| XBEN-083-24 | XBEN-083-24 | True | 639.66 | 32744 |
| XBEN-084-24 | XBEN-084-24 | True | 1490.87 | 84573 |
| XBEN-085-24 | XBEN-085-24 | True | 105 | 21587 |
| XBEN-086-24 | XBEN-086-24 | True | 553.26 | 55654 |
| results | XBEN-087-24 | 1 | 531.160343 | unavailable |
| results | XBEN-088-24 | 1 | 1872.375237 | unavailable |
| XBEN-090-24 | XBEN-090-24 | True | 339.75 | 47204 |
| XBEN-091-24 | XBEN-091-24 | True | 898.26 | 68961 |
| results | XBEN-093-24 | 1 | 844.152068 | unavailable |
| XBEN-094-24 | XBEN-094-24 | True | 389.29 | 53437 |
| XBEN-095-24 | XBEN-095-24 | True | 2222.27 | 56243 |
| XBEN-096-24 | XBEN-096-24 | True | 423.53 | 31947 |
| XBEN-097-24 | XBEN-097-24 | True | 1315.86 | 72247 |
| XBEN-098-24 | XBEN-098-24 | True | 662.74 | 35498 |
| XBEN-099-24 | XBEN-099-24 | True | 1003.91 | 77928 |
| XBEN-100-24 | XBEN-100-24 | True | 690.74 | 25408 |
| results | XBEN-101-24 | 1 | 1088.203109 | unavailable |
| XBEN-102-24 | XBEN-102-24 | True | 432.55 | 42715 |
| XBEN-103-24 | XBEN-103-24 | True | 420.59 | 55828 |
| XBEN-104-24 | XBEN-104-24 | True | 264.24 | 47634 |

## Notes

- Metrics marked `unavailable` are not present in the source `report.json`. Steps 1-5 of the fix sequence may require additional instrumentation to make these metrics available.
- `token_count` is parent-only. P2-10 measurement debt means worker cost shifts can mask as parent-token reductions.
- This baseline is a snapshot. If the benchmark infrastructure changes, regenerate with `--force`.
