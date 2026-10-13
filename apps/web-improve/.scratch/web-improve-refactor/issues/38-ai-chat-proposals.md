# 38: AI chat and plan proposals

**What to build:** Migrate conversations, mode selection and simulated proposal generation to real shared services, preserving cancellation and project binding.
**Blocked by:** 13.
**Status:** ready-for-agent
**Owner:** Conversation/chat and draft-plan creation handlers.
**Contract:** [execution.md](../execution.md).

- [ ] Observe/Propose/Execution modes change assistance behavior but never grant permission or initiate tool/operation execution.
- [ ] Generated plans remain draft/proposed; out-of-scope requests produce blocked proposals without data leakage.
- [ ] Send/cancel/reset and late responses respect the captured actor/project and dispose timers.
- [ ] Chat cards and plan detail links work with legacy review until 39; new proposals update canonical history/notices.
