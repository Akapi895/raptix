# 63: Dark-theme parity audit

**What to build:** Audit existing per-feature dark-mode evidence and make bounded shared token/chart/overlay contrast fixes.
**Blocked by:** 62.
**Status:** ready-for-agent
**Owner:** Theme token/contrast audit; shared-style writes sequenced after 62.
**Contract:** [execution.md](../execution.md).

- [ ] Every route group, dialog and graph is inspected in both themes with readable states/labels and no overlap artifacts.
- [ ] Shared token fixes preserve the visual baseline and contrast; feature-local failures get separate leaves.
- [ ] Toggle/persistence/reset behavior stays coherent across all consumers.
- [ ] Audit closes only after linked defects and missing verification are resolved, not by asserting unobserved pixel parity.
