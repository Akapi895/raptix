# ADR-0100: Let a single operator decide their own workflow items when the deployment says so

- **Status:** Proposed — 2026-10-24. The direction was chosen by the operator on 2026-10-24 in a working session; the record stays Proposed until the repository owner accepts it in writing.
- **Date:** 2026-10-24
- **Deciders:** repository owner (pending)
- **Related:** ADR-0099 (C2 dispatch ledger), `server/src/auth/membership-policy.ts` (four-eyes guard), `CONTRIBUTING_AGENT.md` (guard-rail changes need a threat model), `docs/audits/web-ux-audit-2026-10-23/pre-c-acceptance/` (the acceptance record that exposed the constraint)

## Context

Nine server decision paths refuse a decision by the same actor who submitted the item: plan decisions, scope revision decisions, finding review and content review, closure decisions, C2 grant decisions, library proposal decisions, and report review. A report also requires that a named reviewer, if any, is the one who decides. The guard (`requireIndependentActor`) was written so a local identity cannot approve its own work.

A deployment run by one person cannot complete these flows: the only actor who can submit an item is also the only actor who can decide it. The acceptance pass on 2026-10-24 showed the guard refusing a same-actor decision on a proposed plan (the author's decision answered 403 with the independence message), and the source shows the same check on every path listed above. The operator asked for a single-user product, so the guard has to be configurable for that deployment.

## Decision

Add a deployment setting `RAPTIX_WEB_SINGLE_OPERATOR=1`, read once at startup. It defaults to off.

When the setting is on:

- `requireIndependentActor` returns without refusing. All nine decision paths accept a decision by the submitter, and each decision is still recorded with its actor.
- A report's named reviewer may be the report's author. Readiness accepts that choice as well (the report service has its own "differs from the author" rule, which is part of the same four-eyes principle).
- The server advertises `independentReview: "single-operator"` on the capabilities document. The web console reads it and stops hiding the decision controls from the submitter. When the setting is off, the document advertises `"required"`, and the console keeps the current behaviour.
- The server writes a startup warning.

Unchanged in both modes: the author-only rules (for example, only the original author can amend a library proposal, and only the requester can cancel a closure), the rule that only a report's named reviewer decides its review, role floors, session and CSRF checks, and every RoE and time-window check.

Also changed in both modes, as a correction: the engagement owner is an eligible named reviewer for a report. The owner holds the owner role by ownership and has no membership row, so before this change the owner could not be named at all, and a report could not be approved by the person who owns the engagement.

## Threat model

Assets: the integrity of approvals that gate planning, scope, findings, reports, closure and C2 grants.

Threat that the four-eyes rule addresses: a single session, or a single careless action, approves work that someone else should check. A client-facing report or a C2 grant approved without a second person is the most serious case.

What single-operator mode changes: any account with a decider role can approve its own plan, scope revision, finding, report, closure or C2 grant. Nothing in the server checks that a second person looked. A stolen owner session can therefore approve its own items.

Mitigations: the setting is off by default and must be set explicitly in the environment. The server logs a warning at startup. The capabilities document advertises the mode, so the console shows it. Multi-user sessions with CSRF and origin checks still apply, so the setting does not weaken authentication. The actor is recorded on every decision, so the audit trail still shows who approved what. A multi-user deployment must not set the variable; this record recommends that engagements which need an independent approval by the client keep it off.

Residual risk: accepted by the deployment owner when the setting is turned on. Not mitigated by the server: the approval of a single person is not evidence of an independent review, and reports or C2 grants that were approved this way should not be presented to a client as having been independently reviewed.

## Consequences

- **Easier:** one person can run a full workflow (plan, scope, finding, report, export) without a second account.
- **Harder:** the deployment owner must remember that approvals by a single person are not independent reviews; any report that goes to a client under single-operator mode must say so.
- **Given up:** the server-enforced independence of the decision for every deployment that turns the setting on.
- **Migration:** none for existing deployments. The default is off, so behaviour is unchanged unless the variable is set. The acceptance stack starts with the variable only when `stack.mjs --single-operator` is passed.

Files that implement the decision: `server/src/auth/membership-policy.ts`, `server/src/config/env.ts`, `server/src/main.ts`, `server/src/app.ts`, `server/src/http/routes/capabilities.routes.ts`, `server/src/services/reports-service.ts`, `apps/shared/web-contracts/src/capabilities.ts`, `apps/web/src/state/real-context.tsx`, `apps/web/src/features/governance/tab.tsx`, `apps/web/src/features/findings/presentation-context.ts`, `apps/web/src/features/findings/detail.tsx`, and the tests named in the pull request.

## Alternatives considered

- **Use a second account for the decision:** Rejected. One person with two accounts defeats the rule in the same way a single account does, and it hides the fact that no second person looked.
- **Keep the rule and accept that approvals are blocked:** Rejected by the operator, because the product must be usable by one person.
- **A per-engagement switch:** Rejected for now. It adds configuration to every engagement and to the client-facing report, and the operator asked for a deployment-wide setting.
