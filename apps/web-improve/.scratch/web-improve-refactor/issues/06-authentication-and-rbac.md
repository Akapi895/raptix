# 06: Login and permission policy

**What to build:** Port persona login/logout and RBAC into the shared auth authority/permissions interface, with a service-backed project membership view. Preserve the 19-action role model and explanatory gating.
**Blocked by:** 05.
**Status:** ready-for-agent
**Owner:** Auth feature and permission policy.
**Contract:** [execution.md](../execution.md).

- [ ] Login selects persona/organization; logout and persona switch update legacy and migrated surfaces consistently.
- [ ] Matrix regressions preserve 6 × 19 decisions plus viewer/member/nonmember and closed/cancelled cases.
- [ ] New action handlers have an explicit actor/project context; UI modes never grant authorization.
- [ ] Existing login remains wired during router migration; baseline adapters change without weakening assertions.
