# 16: Persist settings and expose authoritative audit

**What to build:** Authorized users manage the approved real settings surface and
inspect consequential action history with actor, scope, reason and timestamps.

**Blocked by:** 07 (identity, roles and team).
**Status:** ready-for-agent
**Requirements:** R03-R05, R08-R10.
**Contract:** [execution.md](../execution.md).

## Acceptance

- [ ] Profile/organization/integrations/policies/retention/audit tabs distinguish
  UI-only preferences, engagement settings and workspace-level configuration.
  Supported settings read/write through persisted server contracts.
- [ ] Roles, provider secrets, policy enforcement and retention cannot be changed
  by browser authority commits. Secrets remain server-side/redacted; unsupported
  integrations or retention operations disclose their actual capability.
- [ ] Required policy/retention writes have version/conflict/authorization checks
  and the approved real semantics; a simulated delete is not legal-hold or
  retention enforcement. Settings changes propagate to their actual consumers.
- [ ] Audit projects existing runtime/workspace/provider/Web records with truthful
  source attribution. Missing timestamps/actors are not fabricated; sensitive
  arguments and credentials are not exposed through logs or search/export.
- [ ] Required settings mutations and audit records survive refresh/API restart;
  foreign/unauthorized writes refuse without changing state.
- [ ] Preserve the required vault/credential-management placement approved under
  D5 in 01, including redacted metadata, controlled reveal and audit, or record
  its approved UI exclusion while retaining the existing backend/data.

## Verification selection

Select settings validation/persistence/conflict, audit-redaction/filter and changed
settings UI tests. Exercise a supported setting save plus denied/conflicting save
and inspect its actual audit outcome. Recheck only policy/retention consumers
whose behavior changed; do not rerun every feature for an unrelated preference.
Build/type/lint affected packages as needed. No full suite.

## Scope boundary

No unsolicited new identity/provider integration. Required six-tab parity vs
explicit exclusions must come from 01, not from the existence of a read endpoint.
