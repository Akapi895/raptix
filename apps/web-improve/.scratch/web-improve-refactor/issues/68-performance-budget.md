# 68: Initial-load and lazy-chunk verification

**What to build:** Verify the production initial-load budget after contraction; correct bounded import/chunk regressions rather than adding speculative memoization.
**Blocked by:** 67.
**Status:** ready-for-agent
**Owner:** Build/performance audit.
**Contract:** [execution.md](../execution.md).

- [ ] Measure all JS/CSS assets required for initial authenticated navigation, not only the entry filename; initial transfer is under 200 KB gzipped.
- [ ] Lazy route chunks do not eagerly pull retired screens/store or the entire demo dataset into unrelated routes.
- [ ] Record cold-load route/device/4G throttling/cache conditions and verify the plan's <3s interactive target with an explicit measurement method.
- [ ] Smoke routes still work in production preview, including configured base path; browser verification gaps are reported instead of fabricated passes.
