# 16: Persist settings and expose authoritative audit

**What to build:** Authorized users manage the approved real settings surface and
inspect consequential action history with actor, scope, reason and timestamps.

**Blocked by:** 07 (identity, roles and team).
**Status:** complete (2026-10-15)
**Requirements:** R03-R05, R08-R10.
**Contract:** [execution.md](../execution.md).

## Acceptance

- [x] Profile/organization/integrations/policies/retention/audit tabs distinguish
  UI-only preferences, engagement settings and workspace-level configuration.
  Supported settings read/write through persisted server contracts.
  (`apps/web/src/real/screens/settings.tsx` — each tab states its data class:
  profile labels theme/preferences browser-local, organization records that
  membership administration is engagement-scoped (Team tab, ticket 07),
  engagement settings link to the per-project Settings tab, policies/retention
  render the versioned `WorkspaceSetting` rows via `WorkspaceSettingsService`
  + `workspace.routes.ts`.)
- [x] Roles, provider secrets, policy enforcement and retention cannot be changed
  by browser authority commits. Secrets remain server-side/redacted; unsupported
  integrations or retention operations disclose their actual capability.
  (Workspace writes are server-authorized — engagement owners are deployment
  operators, 403 otherwise; the Integrations tab renders the server capability
  document with its real reasons and no simulated connect/disconnect; the
  retention tab states explicitly that no scheduled enforcement or deletion
  exists; the vault keeps AES-256-GCM server-side storage with redacted list
  metadata, `apps/web/src/real/screens/vault-panel.tsx`.)
- [x] Required policy/retention writes have version/conflict/authorization checks
  and the approved real semantics; a simulated delete is not legal-hold or
  retention enforcement. Settings changes propagate to their actual consumers.
  (`policy.c2_grant_max_hours` is consumed by `C2GrantsService` — the loaded
  policy bounds every grant request and the grants view reports it; retention
  is configuration-only with `consumer: null` disclosed, no delete offered.)
- [x] Audit projects existing runtime/workspace/provider/Web records with truthful
  source attribution. Missing timestamps/actors are not fabricated; sensitive
  arguments and credentials are not exposed through logs or search/export.
  (`AuditService` + `/api/audit` and `/api/engagements/:id/audit`; web records
  carry `source: 'web'`, vault lifecycle rows `source: 'vault'` with
  `actorId: null` rendered "not recorded"; `detail` is never projected; the
  workspace view only includes engagements the actor owns or holds a
  membership on, foreign engagements 404.)
- [x] Required settings mutations and audit records survive refresh/API restart;
  foreign/unauthorized writes refuse without changing state.
  (Settings persist in the `WorkspaceSetting` table — read back after write,
  never held in memory; audit rows persist in `WebAuditEntry`/`VaultAudit`;
  conflicting `expectedVersion` answers 409 without state change; the
  reviewer-membership write is refused 403 and the audit view verifies the
  value is unchanged.)
- [x] Preserve the required vault/credential-management placement approved under
  D5 in 01, including redacted metadata, controlled reveal and audit, or record
  its approved UI exclusion while retaining the existing backend/data.
  (Placed as the engagement detail **Vault** tab reusing the existing W18
  routes/contracts unchanged; reveal is an explicit per-secret action whose
  plaintext exists only in the browser session, and reveal counts/last-reveal
  timestamps come from the server's vault audit.)

## Verification (selected per ticket)

- `apps/web/server/tests/t16-settings-audit.test.ts` (3 tests): versioned
  lifecycle with conflict/authorization/unknown-key/invalid-value/no-reason
  refusals plus the audited workspace row; C2 policy propagation (grants view
  reports the new window, an over-long request is refused naming the setting,
  an in-window request succeeds); audit attribution, foreign leakage,
  viewer-membership scope, prefix/text filters, truncation.
- `apps/web/src/real/screens/settings.test.tsx` (4 tests): data-class
  separation on Profile, persisted value + consumer truth with a versioned
  save carrying the audited reason, the server conflict message surfaced
  instead of a fake save, audit truthful attribution ("not recorded" for
  vault rows) with filter re-queries.
- `npm run typecheck/lint --workspace=@raptix/web-raptix(-server)` clean;
  server suite 37 files / 324 tests, web real suite 18 files / 102 tests.

## Named gap

- No live multi-user deployment was exercised (this environment has no
  running Postgres/API); the multi-user authorization paths are covered by
  the session-authenticated test harness as in tickets 07-15.
