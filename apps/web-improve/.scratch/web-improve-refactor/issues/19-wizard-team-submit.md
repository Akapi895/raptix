# 19: Wizard team, review and submission

**What to build:** Complete the five-step wizard with team assignment, review and typed create/save-draft/submit handlers.
**Blocked by:** 18.
**Status:** ready-for-agent
**Owner:** Wizard completion and project-create transaction.
**Contract:** [execution.md](../execution.md).

- [ ] All five steps plus review run on one schema/draft with validation, dirty guard and submit/error state.
- [ ] Creation transaction publishes project/assets/members/approval/notices together; the portfolio and legacy inbox observe it.
- [ ] Unauthorized creation or invalid submission is rejected by real handlers as well as UI gating.
- [ ] Create → portfolio → detail works; failed submission keeps the draft and permits retry without duplicate entities.
