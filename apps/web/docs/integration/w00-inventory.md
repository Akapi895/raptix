# W00 inventory — independent web integration

Source guide: `summary/impl-guide-web-raptix-integration.md`. This inventory is
reference/capture evidence; the new server package is not implemented in W00.

## Contract baseline

- Legacy API source has project list/create/detail/PATCH/DELETE, agent catalog,
  health, threads GET, plan-docs/opplan, findings/timeline/graph, file listing/text
  content, approvals GET/POST and JSON/Markdown export.
- Projects require slug (3–64 lowercase/digits/internal-hyphens), targetType
  web_url/ip_range, targetValue and authorizationConfirmed=true. DB statuses are
  draft/planning/running/completed/failed; UI paused is not an engagement status.
- GET list auto-imports directories and has read/create races; imported records
  use placeholder target metadata and authorization=false. New API must not present
  those records as verified ready-to-run state.
- PATCH allows name/status/targetType/targetValue/threadId, but no filesystem rename,
  thread ownership or authorization confirmation update. DELETE is DB-only.
- Agent catalog falls back static when runtime fails; threads may return a synthetic
  stored-pointer object. Registry/readability must remain distinct from reachability.
- plan-docs supports four JSON docs; invalid/missing files are both omitted; opplan
  failure is an empty objective list. New contract needs explicit quality/status.
- Findings parser defaults medium/placeholder text on malformed input. Preserve raw
  source/provenance, not false analyst confidence.
- Graph is engagement scoped but returns raw properties; sanitize server DTOs before
  real browser use. Missing Neo4j password yields503, not an empty successful graph.
- Files are fixed allowlist, non-recursive, UTF-8, lexical path containment; no binary
  size limit/realpath/symlink protection. New API keeps ownership and tightens boundary.
- Approval created_at/decided_at are epoch seconds; request_id is the identity.
  Read-then-append duplicates are not atomic across tabs/processes.
- Legacy export silently falls back every non-json format to Markdown; new API must
  validate formats instead of reproducing this behavior as a supported capability.

## Runtime baseline

- Production Python emitters supply type, created_at ISO UTC, agent, session_id.
  Tool call/result share id; null tool id and orphan unknown-tool cases are possible.
- elapsed is seconds; CLI formatter dividing1000 and missing propagation of session_id
  are source gaps to fix additively in the shared contract/normalizer phase.
- Parallel same-agent invocations need distinct session IDs, not grouping by name.
- subagent_transcripts persist event copies; live result is full while checkpoint
  result is capped8000 chars + `…[truncated]`. In-flight parent checkpoint timing and
  per-run attribution need actual integration verification; history is not a global
  durable total-order log for every root/system event.
- Graph question interrupt/resume and file-backed tool HITL are separate mechanisms.
- CLI submission config carries trusted engagement_name/workspace_path/target type/
  target value/authorization; web-native server resolves those fields, not browser.
- Current observed runtime catalog includes soundwave/decepticon but not the source
  raptix alias. Server assistant resolution must use observed reachable registry.

## Data/migration baseline

Schema currently owns only Engagement; no thread-binding/request-ledger/vault/member/
campaign/C2 persistence yet. Existing production DB was queried read-only for history:

| Migration | Checksum | Finished |
|---|---|---|
| 20260412164158_init | cbbff3ee345e285c0edf912110e10e714fc620edc60ac33669dd59300986822b | yes |
| 20260826090000_engagement_authorization_confirmation | cd3a33fe8e33ec7c1210cdd1b5c9903db98d442cab94a99175d0352939bb2f3c | yes |

New owner must preserve this history/IDs/artifacts/thread links. A separate database
is used for W00 testing; it is not a requirement to discard/rename production data.
Before W02 applies any changes to existing data: logical pg_dump, verified restore
to a controlled DB, schema parity and single migration-owner decision. A plain live
PostgreSQL volume file copy is not a verified consistent backup.

## Deployment references / no-legacy gate

- Root package workspaces broad clients/* includes legacy; scripts dev/build/start/
  prisma currently target clients/web. W01 explicit active workspaces/default scripts
  must make new package self-contained (do not retain a missing active old workspace).
- Makefile WEB_DIR/web-dev/build/lint/migrate/quality targets, compose web profile,
  containers/web.Dockerfile/web-entrypoint.sh, CLI commands/web.ts, launcher health
  DefaultWebPort, desktop config/main auto-start, CI/release and web watch profiles
  are references to inventory/port/retire; no live cutover done in W00.
- Old web entrypoint auto-migrates on startup; new owner must coordinate migration
  execution, not add another auto-migrating replica against shared production data.
- Never run web-hotswap/make clean/compose down --volumes during this capture lane.
- Active observed ports: oldweb3000/3003, LangGraph2400, PG5433, Neo4j7688/7475.
  New API5280 is proposed; controlled legacy capture5290 is temporary/reference only.

## Controlled evidence and scope

- HTTP fixtures: `tests/fixtures/w00/http`, 22 actual captured outcomes. Dedicated
  database `raptix_web_w00_capture_20261001` and test role, temporary host workspace
  bound at container `/workspace`; no production workspace or user target contacted.
- Capture image: sha256:2976d5f1d443a4c069aae75b24452609705e032f49ab9fc052f949ffd64bdc61.
  Next16.3.5 with two migrations. Image capture is not claimed source-HEAD exact.
- Runtime emitter fixture: `tests/fixtures/w00/runtime/runtime-emitter-capture.json`,
  actual repository source loaded in an isolated no-network container. Only emission
  methods were called, no graph runs/tools; raw live/checkpoint channels both retained.
- Runtime catalog fixture: only info and assistant discovery on port2400; no threads
  or runs created. API version0.10.0, LangGraph Python1.2.4 were observed.
- Synthetic documents/artifacts are inputs for API-shape capture, not a validated
  runtime planning bundle or evidence of an executed assessment.

One agent's validation raced with the capture server startup and hit the isolated
test instance with the wrong host bind root, stopping at file404. HEAD repeated the
entire guarded capture against the correct bind:22/22 passed. Only the owned W00
slug/test database were involved; these successful HEAD artifacts are authoritative.

## W00 gate

HEAD must inspect the fixtures and run capture-contract tests plus existing frontend
type/lint/build/mock-browser gates. No W01 code can start before recorded acceptance.
Live graph success/provider-driven campaigns/C2/vault/RBAC and actual model execution
are later scoped integration gates, not fabricated here to satisfy W00.
