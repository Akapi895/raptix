# 56: Profile and organization settings

**What to build:** Migrate profile/organization settings and the six-tab settings shell using typed session-persistent services.
**Blocked by:** 13.
**Status:** ready-for-agent
**Owner:** Settings shell/profile/organization fields.
**Contract:** [execution.md](../execution.md).

- [ ] Save/reset/validation/dirty behavior works for profile and organization; successful changes persist for the demo session.
- [ ] Admin-only organization changes enforce permission in real handlers and expose refusal reasons.
- [ ] Existing secondary settings links remain compatible; excluded real SSO/MFA/backend behavior stays explicitly simulated.
- [ ] Other settings panels remain bridged until their owners migrate them; shared auth state does not fork.
