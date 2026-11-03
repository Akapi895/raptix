# 18: Language, budget và runtime settings

**What to build:** Supported language/budget/runtime preferences persist và ảnh hưởng thực tế đến new run, không chỉ form state.
**Blocked by:** 15 — Model và fallback settings applied to runs.
**Priority / Profile:** P1 / LOCAL-FULL.
**Status:** draft-awaiting-review.

## Steps
1. Enumerate supported runtime controls from existing configuration/middleware contracts; define precedence and bounds.
2. Add versioned settings for output language and supported budget limits; separately mark settings that require restart versus next-run activation.
3. Propagate trusted effective snapshot via actual runtime interface; preserve context/RoE/egress/HITL invariant ownership.
4. Show actual effective values/version per run and settings validation/application failures.
5. Test language behavior and enforce a low deterministic budget through actual work path, including fallback consumption accounting.

## Acceptance criteria
- [ ] Saved language used in observed supported output; saved budget constrains actual runtime.
- [ ] Unsafe or unsupported arbitrary config rejected, not silently ignored.
- [ ] Prior run snapshot does not change after new preference save.

## Test / expected result
L08 actual run with low budget and explicit language; over-limit work ends with truthful policy reason. Disabled/unlimited semantics remain documented and test both sides of the supported setting.

## Completion evidence
Allowed control inventory, persisted/effective snapshot and real behavior/error observations.
