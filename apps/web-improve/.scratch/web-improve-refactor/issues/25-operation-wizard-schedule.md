# 25: Operation creation and scheduling

**What to build:** Migrate configured operation creation/edit/schedule using validated forms and canonical services; approval/gate computation belongs to 26.
**Blocked by:** 24.
**Status:** ready-for-agent
**Owner:** Operation draft/create/update/schedule handlers.
**Contract:** [execution.md](../execution.md).

- [ ] Project/playbook/agent/asset selections are scoped; pending/out-of-scope assets and unapproved revisions are unavailable.
- [ ] Creation saves a draft with correct linkage; updates invalidate stale preflight and preserve unsupported-in-flight edit refusal.
- [ ] Scheduling has explicit timezone/window input and direct-link coverage; invalid input cannot submit.
- [ ] Legacy consumers observe the created/updated draft; failure preserves form data and does not duplicate operations.
