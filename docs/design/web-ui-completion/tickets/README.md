# Ticket index — Web UI Completion

Mọi ticket dưới đây **draft-awaiting-review**. Xem dependency/deliverable table trong [Implementation Plan](../IMPLEMENTATION-PLAN.md); test procedures trong [Test Plan](../TEST-PLAN.md).

## Reliable core

1. [Baseline contracts và regression lane](01-baseline-contracts.md)
2. [Canonical workspace cho planning và tools](02-canonical-workspace.md)
3. [Backend-enforced versioned handoff](03-versioned-handoff.md)
4. [Planning Q&A và effective waiting status](04-planning-questions-status.md)
5. [Run reconnect, lost ACK và idempotent recovery](05-run-recovery.md)
6. [Durable tool activity replay](06-durable-tool-replay.md)
7. [Durable question-answer history](07-answer-history.md)
8. [Production reasoning transport](08-reasoning-production.md)
9. [Console interaction completion](09-console-interactions.md)
10. [Local backup, restore và recreate recovery](10-local-durability.md)
11. [Fresh deployed core acceptance](11-core-live-acceptance.md)

## Planning và configuration

12. [Versioned planning document editor](12-plan-editor.md)
13. [Revalidation và approval invalidation](13-plan-reapproval.md)
14. [Brief revision và project workflow lifecycle](14-project-workflow.md)
15. [Model và fallback settings applied to runs](15-model-settings.md)
16. [Integration registry với Vault references](16-integration-registry.md)
17. [Authenticated provider connection probes](17-provider-probes.md)
18. [Language, budget và runtime settings](18-runtime-settings.md)
19. [Vault dependency/revoke/audit UX](19-vault-lifecycle.md)

## Data và outcomes

20. [Graph và asset inventory live consistency](20-graph-assets.md)
21. [Operations Log pagination/export/provenance](21-operations-log.md)
22. [Analyst finding create/edit/revision](22-finding-editor.md)
23. [Evidence upload/link/retained integrity](23-evidence-retention.md)
24. [Finding workflow và verification records](24-finding-workflow.md)
25. [Controlled retest job through Web](25-retest-jobs.md)
26. [Immutable report snapshot jobs](26-report-snapshots.md)
27. [Report templates và matching preview](27-report-templates.md)
28. [PDF/DOCX rendering và downloads](28-document-rendering.md)
29. [Evidence-grounded AI compilation](29-ai-compilation.md)
30. [Report signing và integrity verification](30-report-signing.md)
31. [Notification preferences và real delivery](31-notifications.md)

## Native providers và local product

32. [GoPhish normal-deployment cutover](32-gophish-cutover.md)
33. [Evilginx2 typed-bridge cutover](33-evilginx-cutover.md)
34. [Sliver listeners/profiles/sessions cutover](34-c2-registry-cutover.md)
35. [C2 command outcomes/replay/reconciliation](35-c2-command-recovery.md)
36. [Local Members và operator preferences](36-local-members.md)
37. [Archive/delete/retention/provider cleanup](37-project-retention.md)
38. [All-page accessibility/responsive acceptance](38-all-page-ux.md)
39. [Reproducible production bootstrap](39-production-bootstrap.md)
40. [Complete 13-page LOCAL-FULL acceptance](40-local-full-acceptance.md)
41. [Feature-sensitive CI và negative canary](41-ci-quality.md)
42. [Release/install/update/rollback gate](42-release-lifecycle.md)

## HITL-ON

43. [HITL mode configuration/readiness](43-hitl-mode.md)
44. [Native HITL allow/deny/recovery](44-hitl-native.md)

## TEAM-HOSTED (scope activation required)

45. [Team authentication/session slice](45-team-auth.md)
46. [Membership/invite/server RBAC](46-team-membership.md)
47. [HTTP/stream/artifact cross-user isolation](47-team-transport-isolation.md)
48. [Hosted crash-durable runtime/control plane](48-hosted-durability.md)
49. [Hosted quotas/observability/recovery drills](49-hosted-operations.md)
50. [TEAM-HOSTED full-stack acceptance](50-team-acceptance.md)

## Readiness closure

51. [Local/HITL release readiness ledger](51-local-readiness-ledger.md)
52. [Team release/readiness ledger](52-team-release-ledger.md)
