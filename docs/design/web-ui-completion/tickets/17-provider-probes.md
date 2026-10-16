# 17: Authenticated provider connection probes

**What to build:** Web phân biệt configured, authenticated reachable và actually exercised provider, với probe time/reason rõ.
**Blocked by:** 16 — Integration registry với Vault references.
**Priority / Profile:** P1 / LOCAL-FULL.
**Status:** draft-awaiting-review.

## Steps
1. Define per-connector bounded read-only authentication/connectivity probe and result freshness contract.
2. Resolve selected integration version/secret ref; preserve credential redaction and route ownership.
3. Execute native authenticated read, persist observed outcome/error class/time; do not mutate provider resources to probe.
4. Expose Test connection/retry/stale/unavailable UI and derived capability reasons without equating probes with delivery/execution.
5. Handle timeout/TLS/auth/malformed/oversized response and integration edit races explicitly.

## Acceptance criteria
- [ ] Bad credentials, stopped provider and configured reachable provider show distinct observed results.
- [ ] Probe identifies tested integration version and becomes stale after edit.
- [ ] Connection pass is not labeled successful campaign delivery/C2 execution.

## Test / expected result
L08 native services: success, auth-denied, unreachable and bounded timeout; fixture environment covers TLS/malformed response branches. No secrets in failure DTOs.

## Completion evidence
Native probe identity/status, timing/freshness/version records and UI error/retry trace.
