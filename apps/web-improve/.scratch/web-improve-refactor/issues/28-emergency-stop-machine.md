# 28: Emergency-stop state machine and propagation

**What to build:** Move the existing stop machine to canonical domain/service logic for operation/project/workspace scope, with fake-clock acknowledgements and explicit failure/unknown/manual-confirm outcomes.
**Blocked by:** 27.
**Status:** resolved
**Owner:** Stop protocol and atomic cross-entity propagation.
**Contract:** [execution.md](../execution.md).

- [x] Authorized request with mandatory reason advances requested → acknowledged → stopped; fail/unknown/retry/manual-confirm behavior never reports fabricated success.
- [x] Only affected operations/sessions/reservations change; out-of-scope records remain unchanged, including concurrent stop outcomes.
- [x] Successful stop terminates sessions/revokes access and leaves execution halted; automatic callbacks cannot restart it.
- [x] Real-handler regressions cover all scopes/outcomes; legacy C2 observes propagation before its migration, without a second database.

## Machine / orchestration split

- `src/features/estop/service.ts` (ticket 22's typed transactions, hardened here) — the machine's transitions stay the only execution sites. Ticket-28 hardening, both inside the existing handlers:
  - `resolveStopTransaction('confirmed-stopped')` (ledger G-10): the ONE commit now completes the machine coherently — in-scope operations still active join the halted state (running steps Unknown, queued not run), their linked sessions terminate, their reserved agents release — so a confirmed stop leaves execution halted and audited Success instead of a fabricated one the demo ticker kept progressing.
  - `finalizeEmergencyStopTransaction` sweeps revoking sessions and releases reservations scope-matched, so a concurrent stop on another scope never touches out-of-scope records.
- `src/features/estop/ui.tsx` (new, feature-local) — the machine UI: `EmergencyStopDialog` (request), `StopStatePanel` (phase banner), `StopProgress` (progress strip), driven by a scope-matched machine derivation. Every phase renders an actionable control (invariant 1): requested → "Acknowledge now (demo)", acknowledged → "Finalize now (demo)", failed → "Retry Stop", unknown → "Confirm Manually Stopped", stopped → "Dismiss"; the demo-outcome switch and audit link render in every phase. State-changing controls are role-gated with a visible reason (`estop` permission); the request dialog gates role + mandatory reason + impact acknowledgement and surfaces the disabling reason inline.
- Demo outcome orchestration stays clearly simulated: the store keeps `stopOutcome`/`setStopOutcome` and the tracked delays (disposed on reset), running ONLY the typed handlers; the panel's "(demo)" affordances call `acknowledge`/`finalize`/`resolve` directly through `useServices` — the same transactions the delayed orchestration runs — and label themselves `Demo data` + "demo", so no surface can show success that did not happen through a commit.
- `src/screens/c-console.tsx` composes the feature components (−103 lines of duplicated machine UI); the shell ribbon (`StopBanner`, `EmergencyStop` modal) remains a legacy consumer of the same delegating actions — one bridge, no second database.

## Evidence

- `npm run typecheck` — clean (0 errors; 0 new diagnostics).
- `npm run lint` — 0 new findings: 6 errors / 203 warnings, identical to the pre-change baseline measured via `git stash` (the 6 errors sit in gitignored `.ua/.trash-*` tooling files that pre-date this ticket; `src/features/estop/*` contributes 0).
- `npm test -- --run` — **748/748 passed** (737 baseline + 12: 11 new in `src/features/estop/ui.test.tsx`, 1 new concurrent-scope regression in `src/features/estop/service.test.tsx`). Baseline `src/safety/emergency-stop.test.tsx` (6) stays green unmodified. Two unrelated files flaked once under parallel load (`shell.test.tsx`, `agents/writes.test.tsx`) and pass in isolation — the documented pre-existing flakiness (ticket 52), reproduced here and re-verified green.
- `npm run build` — green.
- Required cases, in `src/features/estop/ui.test.tsx` + `service.test.tsx`:
  - every machine phase renders an actionable control (requested/acknowledged/stopped via the real orchestration timers; failed/unknown via the demo outcome switch);
  - the panel's acknowledge/finalize/manual-confirm controls commit the typed handler effects (ops estop, sessions revoking→terminated, audit rows) and the refusal path holds — a role without `estop` cannot drive the machine and nothing commits;
  - the request dialog gates role/reason/impact-acknowledgement and lands the immediate requested state (Pending audit) through the delegating action;
  - simulated outcomes are labeled (`Demo data` tag, "demo" affordances, demo-outcome switch) in every phase;
  - a machine-driven stop commit refetches a Query consumer through the ChangeSet bridge (fetch count + phase text, no reload);
  - bridge both directions at UI level: the legacy `A.emergencyStop`/`A.resolveStop` actions drive the panel and the typed controls are observed in the legacy store context; handler-level both-directions proof remains from ticket 22's suite;
  - concurrent stops on different scopes leave out-of-scope operations, sessions and reservations exactly as seeded (new regression for the scope-matched finalize).
- Browser preview of the real routes was not run — skipped per AGENTS.md § Windows Temporary Process Safety (preview HTTP lifecycle check optional); recorded as a gap, covered structurally by the 23 estop tests and the production build.
