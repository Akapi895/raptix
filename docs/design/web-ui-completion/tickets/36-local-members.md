# 36: Local Members và operator preferences

**What to build:** Members/identity UI phản ánh đúng local operator và persisted supported preferences, không giả team roles.
**Blocked by:** None (can start immediately).
**Priority / Profile:** P1 / LOCAL-FULL.
**Status:** draft-awaiting-review.

## Steps
1. Inventory local identity provider/current Members contract and profile preferences actually needed by active UI.
2. Persist supported display/preferences through scoped API; keep identity source and local-mode semantics explicit.
3. Wire view/edit/save/reload and effective shell identity; remove no-op invitation/role controls in local profile.
4. Show configuration/auth errors without falling back to demo people.
5. Preserve extensibility for later team identity without inventing memberships now.

## Acceptance criteria
- [ ] One real local operator row/identity agrees with backend ownership.
- [ ] Supported preferences persist after restart and affect visible UI.
- [ ] Local mode never claims invite/role enforcement or silently grants hosted identity.

## Test / expected result
L17 local half, actual API identity/preferences round-trip, invalid edit and server unavailable. Fixture regression checks no fake member rows in real mode.

## Completion evidence
Identity/preferences record, shell/Members agreement and failure/reload trace.
