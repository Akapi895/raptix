# 41: Feature-sensitive CI và negative canary

**What to build:** Required quality jobs thật sự chạy cho Web/runtime/provider changes và fail khi có regression có kiểm soát.
**Blocked by:** 01 — Baseline contracts và regression lane.
**Priority / Profile:** P1 / Distribution.
**Status:** draft-awaiting-review.

## Steps
1. Inspect current actual workflow filters/outputs/aggregate dependencies và owning runtime/bridge lanes; ignore stale prose status.
2. Ensure clean shared build/Prisma generation/server/UI checks and required test selection are wired.
3. Split CI manifest changes from unrelated runtime features per supply-chain rule; retain least existing required permissions.
4. Test each relevant change surface matches actual quality lane; controlled temporary type/contract regression must fail required aggregate.
5. Restore canary, run remote PR workflow on exact revision and retain run URL/logs; separate known unrelated baseline failures honestly.

## Acceptance criteria
- [ ] Relevant jobs are executed, not skipped-success through missing output.
- [ ] Deliberate regression makes required gate fail, restored candidate passes owning lanes.
- [ ] Clean install/generated dependencies do not rely on local artifacts.

## Test / expected result
L20 CI portion: change filters, fresh checkout build and negative canary; actual GitHub Actions evidence required, local YAML parse alone insufficient.

## Completion evidence
Remote run URLs/job logs, positive/negative canary results and exact revision/filter matrix.
