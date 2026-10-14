# 57: Integration and policy settings

**What to build:** Migrate integration connect/disconnect and policy configuration/save/reset through typed admin handlers.
**Blocked by:** 56.
**Status:** resolved
**Owner:** Integration/policy settings handlers and panels.
**Contract:** [execution.md](../execution.md).

- [x] Allowed settings save/reset with validation and session persistence; unauthorized actions fail at the handler.
- [x] Secrets remain masked and connection outcomes explicitly simulated; no real provider call is introduced.
- [x] Destructive changes confirm reasons and record actor/timestamp/audit.
- [x] Policy settings never silently bypass the real operation/grant gates; compatibility settings state remains coherent.

## Evidence

Commit `feat(web-improve): settings integrations and tokens (ticket 57)` on `wi/57-integrations`.

- `src/features/settings/service.ts` (+145) — ticket 57 handlers on the `DbAuthority`: `getIntegrations`
  (staff-gated registry read; masked access keys are never unmasked; `siem` summary for cross-console
  indicators; `canEdit` hint), `setIntegrationConnection` (admin-only; disconnect is the audited revoke and
  requires a reason; connect refuses an already-connected source, disconnect a non-connected one; commits
  status + history entry + audit row with actor and clock instant; outcome explicitly simulated — no provider
  call), `updateIntegrationKey` (admin-only create-once token flow: ≥8 chars, stores only the masked tail,
  plaintext never enters state/audit/result, authfail source returns to connected), `getPolicies`
  (viewer-role refused with the tab's reason) and `setPolicyEnabled` (admin-only; disabling requires a reason;
  repeat toggles conflict; `updated` stays date-coherent with the seed; audits both directions). The handler
  only records configuration — it never bypasses the enforcement sites (preflight/grants read their own
  rules), keeping compatibility state coherent. `SettingsService`/`createSettingsService` extended; the
  factory wiring needed no change.
- `src/features/settings/query.ts` (+93) — `integrationKeys.registry` = `['integration', scope, 'registry']`
  and `policyKeys.list` = `['policy', scope, 'list']` (entity kind at position 0, so the ChangeSet bridge's
  kind-prefix invalidation refetches on every legacy or service integration/policy commit), `useIntegrations`,
  `usePolicies`, `useIntegrationWrites` (corr tags `integration-connect`/`integration-disconnect`/
  `integration-key`) and `usePolicyWrites` (corr `policy-toggle`); refusals resolve as explicit
  `ServiceResult`s for the panels to render.
- `src/screens/f-settings.tsx` (+46/−19) — Integrations and Policy switches panels migrated onto the typed
  reads/writes: loading/forbidden states, connect/disconnect/re-enter-key and policy toggles go through the
  typed writes with confirmation + reason for the destructive direction, refusal messages render as bad
  toasts, the SIEM banner derives from the read, non-admin actions stay disabled with the refusal reason.
  Simulated request buttons keep the legacy audited-request flow (audit-only, no state mutation), matching
  the ticket-56 screen pattern.
- Tests `src/features/settings/service.test.tsx` (+205, 10 cases): handler gating (non-admin forbidden,
  disconnect/disable reason-required, unknown ids not-found, repeat conflicts), audited disconnect with
  history entry and SIEM summary flip, create-once key re-entry (masked storage, plaintext absent from the
  whole committed dataset and from the response), policy toggle audit in both directions, legacy→new bridge
  (`A.toggleIntegration`/`A.togglePolicy` refetch the typed views without a reload), new→legacy bridge
  (a typed settings write is observed by the legacy store), cross-console indicator (a typed settings-side
  disconnect flips the analysis coverage screen to "Detection integration unavailable"), and rendered
  jsdom gating (reviewer buttons disabled with reasons; viewer refused; policy "Last change" line updates).

Checks (all in `apps/web-improve`, at 6906fc0): `npm run typecheck` 0 errors · `npm run lint` 217 warnings
(= pre-existing baseline, 0 new) · `npm test -- --run` 556 passed (546 baseline + 10 new) · `npm run build`
succeeds (pre-existing chunk-size warning only).

**Deviations/gaps:**
- The dispatch brief's "API token lifecycle (create/revoke)" maps to the baseline's only token surface: the
  integration access-key re-entry (create-once, masked) and the disconnect-as-revoke. The app has no separate
  API-token registry in the baseline; none was invented.
- The legacy `A.toggleIntegration`/`A.togglePolicy` store actions remain as compatibility wrappers (no
  remaining screen callers; the coverage tests still exercise them). Retiring them belongs to a later
  bounded batch per the execution contract.
- Browser/preview walkthrough (route `#/settings?tab=integrations|policies`, light/dark, 768–1440 widths)
  not performed per AGENTS.md § Windows Temporary Process Safety — the panels' states, gating, refusal
  reasons and the bridge/indicator updates are covered by the rendered jsdom cases instead. oxfmt `--check`
  flags pre-existing formatting in these files at the baseline too; reformatting was skipped to keep the
  shared-file edits append-style.
