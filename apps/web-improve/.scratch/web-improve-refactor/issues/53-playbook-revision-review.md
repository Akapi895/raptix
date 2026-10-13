# 53: Independent playbook revision review

**What to build:** Migrate revision submit/approve/return to real handlers enforcing author independence and pinned active versions.
**Blocked by:** 52.
**Status:** ready-for-agent
**Owner:** Playbook version/review policy.
**Contract:** [execution.md](../execution.md).

- [ ] Submitting a revision preserves the approved active version and shows pending-review metadata.
- [ ] Real handlers reject author self-review, wrong role/state and invalid decisions; return records actionable notes.
- [ ] Independent approval activates the reviewed version; pending revisions are never executable selections.
- [ ] Operation wizard/preflight consumers observe canonical version eligibility and baseline UI checks migrate to actual enforcement tests.
