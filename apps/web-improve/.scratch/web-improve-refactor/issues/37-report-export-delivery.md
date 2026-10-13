# 37: Report export and delivery records

**What to build:** Migrate simulated PDF/DOCX export and recipient handover to separate canonical audited actions bound to approved report versions.
**Blocked by:** 36.
**Status:** ready-for-agent
**Owner:** Export/delivery service and UI.
**Contract:** [execution.md](../execution.md).

- [ ] Export requires an eligible approved version; existing simulated export checksums remain on export records, not preview content.
- [ ] Delivery requires a valid export of that exact version, recipient and confirmation; export alone is not delivery.
- [ ] Actor/reason/timestamp/version and handover history persist; unauthorized/stale-version attempts are refused.
- [ ] Project closure consumers observe delivery through the shared authority; full reporting routes no longer need legacy state.
