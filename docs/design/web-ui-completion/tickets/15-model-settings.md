# 15: Model và fallback settings applied to runs

**What to build:** Chọn model/fallback qua Settings thực sự thay đổi inference của new runs, với config history inspectable.
**Blocked by:** None (can start immediately).
**Priority / Profile:** P1 / LOCAL-FULL.
**Status:** draft-awaiting-review.

## Steps
1. Proposed ADR defines configuration ownership/precedence, supported catalog and per-run snapshot; no arbitrary configurable dictionary from browser.
2. Expose validated model/fallback choices and persisted versioned selection; preserve env/operator bootstrap compatibility.
3. Apply effective selection through owning runtime model interface for new runs; active run cannot silently change halfway.
4. Add save/reload/validation/effective-version UI; invalid/unavailable selection yields actionable error.
5. Exercise actual primary/fallback inference and supported override callers; bounded failure transition records used model.

## Acceptance criteria
- [ ] New run's observed provider/model agrees with saved config snapshot.
- [ ] Active/old run retains original config identity after later edit.
- [ ] Unsupported model or fallback failure is explicit; no fake inference success.

## Test / expected result
L08/L06 using two supported model identities and controllable primary outage. Verify actual fallback invocation and result source, not only API saved fields.

## Completion evidence
Config decision/version, runtime call identity, fallback failure/success trace and reload results.
