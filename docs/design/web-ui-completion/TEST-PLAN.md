# Web UI Completion — Testing and Acceptance Plan

**Status:** Proposed acceptance procedures. Không có live test nào được chạy trong phiên lập kế hoạch này.
**Coverage:** LOCAL-FULL, HITL-ON và TEAM-HOSTED như SPEC.

## 1. Test seams và evidence levels

| Lane | Boundary | Dùng để chứng minh | Không chứng minh |
|---|---|---|---|
| A — Unit/contracts | Validators/reducers/public projection | Contract, ordering, merge, invalid state, edge branches | Actual provider/runtime execution |
| B — API integration/fault | Real API + real test DB, controllable external environment | Ownership, conflicts, request ledger, lost ACK, retries | UI UX và native provider delivery |
| C — Browser fixture | Real-mode browser với API fixtures | UI contract/loading/error/keyboard regression | Full-stack inference/tool execution |
| D — Browser live | Browser → actual API → DB/runtime/sandbox | Business flow, generated docs, tools, persistence | Native providers absent from environment |
| E — Native provider | Browser/API → configured native lab provider | Campaign/C2/provider auth/reconcile/outcomes | Production inbox delivery, all platforms |
| F — Lifecycle/release | Actual deployed images/volumes/release assets | Supported restart/restore/install/update | Crash/HA unless specifically exercised |

Primary acceptance seam D/E/F; B supplies deterministic fault/concurrency checks. Browser fixtures never replace live acceptance. A mutation is not accepted solely because its HTTP ACK was 2xx.

## 2. Prerequisites và environments

### Local dev workflow

- UI 5273, API 5280, LangGraph 2400; DB/Neo4j/model proxy/sandbox configured by actual deployment inventory.
- Explicit `VITE_DATA_MODE=real`; API/workspace/runtime/sandbox resolve the same canonical engagement storage. Do not assume host NTFS is the container's named volume.
- Fresh engagement slug/request identities per case; dedicated test DB and workspace. Keep operator projects untouched.
- For evidence runs in a pinned stack, follow the existing mount/isolation protocol; verify actual mounts. Shared-development convenience is not evidence of filesystem isolation.

### Native provider lab

- GoPhish + mail sink + example.test lab recipients; evilginx2 + synthetic login origin and typed bridge; Sliver + owned isolated Linux target/session.
- Paired URL/token/secret refs configured; native provider unavailable cannot be recorded as a pass.
- Inspect provider native resource ID/outcome, not only Web DTO status. Bridges/tokens/captured credential data never appear in stored test output.

### Team/hosted

- At least two identities in different membership scopes plus owner/editor/reader permission fixtures.
- Accepted auth architecture, dedicated durable backend and crash-capable deployment. Record RPO/RTO agreed in the hosted ADR before acceptance.

### Cleanup

Use dedicated test resource IDs and explicit teardown. Existing graceful-stop backup procedure precedes lifecycle tests; no `down -v`, `make smoke` or global workspace purge against operator data. If a test cannot clean an uncertain owned resource, retain its identity and mark cleanup incomplete instead of redispatching/deleting blindly.

## 3. Existing verification commands

Run from repository root unless otherwise stated. These commands are existing entries, not new scripts created by this plan. Execute dependent commands only after prior success; PowerShell 5.1 does not support shell `&&`.

### Shared + Web deterministic gates

```powershell
npm run build --workspace=@raptix/streaming
npm run build --workspace=@raptix/web-contracts
npm run test --workspace=@raptix/streaming
npm run test --workspace=@raptix/web-contracts
npm run prisma:generate --workspace=@raptix/web-raptix-server
npm run typecheck --workspace=@raptix/web-raptix-server
npm run lint --workspace=@raptix/web-raptix-server
npm run build --workspace=@raptix/web-raptix-server
npm run test --workspace=@raptix/web-raptix-server
npm run typecheck --workspace=@raptix/web-raptix
npm run lint --workspace=@raptix/web-raptix
npm run build --workspace=@raptix/web-raptix
npm run test --workspace=@raptix/web-raptix
npm run test:e2e --workspace=@raptix/web-raptix
npm run test:e2e:real --workspace=@raptix/web-raptix
```

Expected: all exit 0; typecheck has no errors; lint has no errors and any retained warning is identified; no unexplained failed/skipped required test. Build must include typecheck. Historical 91/280 pass counts and earlier 27 real-fixture failures are re-measured, not fixed targets to reproduce.

### Runtime / structural changes

```powershell
uv run pytest packages/raptix/tests/unit/llm/test_factory.py
uv run pytest tests -m "not slow and not manual"
uv run pytest tests/test_compose_network_isolation.py
```

Run the owning runtime/mission/checkpointer focused suite discovered when implementing each slice. For Python PR full gates use repository CI commands (`make ci-lint`, `make ci-test`) through a POSIX shell or their underlying commands from Makefile. Compose edits require the network isolation test; skill/prompt changes require their owning checks and unchanged safety policy review.

### Existing live harnesses

```powershell
node apps/web/tools/verify-w06-live.mjs
node apps/web/tools/verify-w07-live.mjs
node apps/web/tools/verify-iw07-live.mjs
node apps/web/tools/verify-vault-deployed.mjs
node apps/web/tools/verify-runtime-durability.mjs --recreate
node apps/web/tools/verify-sliver-lab.mjs
```

Read each harness's required env/test DB checks before invocation. Some contain historical fixed DB names or port assumptions; adapt the stable harness in the owning ticket if incompatible with the new test environment. The existence of a harness is not a claim that all procedures below are automated today.

### Browser live configurations

```powershell
npm exec --workspace=@raptix/web-raptix -- playwright test --config playwright.core.config.ts
npm exec --workspace=@raptix/web-raptix -- playwright test --config playwright.deployed.config.ts
```

Core config currently requires a dedicated DB URL/name and workspace and starts API/UI on 5297/5296; deployed config targets existing Docker UI 3000. Verify topology first. The current core test's acknowledgement-only behavior must be extended to L01 before treating it as full core acceptance.

Migration deployment during later implementation, only for the intended test/deployment DB:

```powershell
npm run prisma:migrate --workspace=@raptix/web-raptix-server
```

No migration command is run during this planning delivery.

## 4. Live acceptance procedures

Each procedure has a fresh identity, UI steps, independently observable expected results and meaningful failures. An external provider/model outage is an honest blocked gate, not success through fixture fallback.

### L01 — Fresh full core flow (T02–T11)

1. Use production real-mode UI to create a fresh authorized lab engagement with a Vietnamese multiline brief.
2. Start planning with one click; observe real model output. Ask for an interview that produces at least two simultaneous questions; complete CONFIRM and submit once.
3. Let runtime write all eight documents; inspect Web validator state and the corresponding sandbox/file hashes. Do not write documents from the test runner.
4. Confirm the validated bundle; start execution. Require a benign owned-workspace tool operation and a runtime-written finding with a known marker.
5. Open Findings/Evidence/Reports; download JSON/Markdown containing that runtime finding.
6. Reload during run, during pending questions and after terminal completion.

**Expected:** one acknowledged project/thread/run per intent; resume maps correct interrupts; required readiness is 8/8 without OPPLAN; execution is denied before confirmation and accepted after; tool output/answers remain in history after reload; report contains the observed runtime marker. No page errors, fixture fallback, manual filesystem repair or contradictory completed/waiting display.

**Failure cases:** invalid brief/authorization, partial/invalid bundle, mismatched workspace, provider unavailable, runtime failure. Each retains actionable reason and no fabricated ready/success.

### L02 — Handoff consistency/concurrency (T03,T13)

1. On a ready but unconfirmed bundle attempt execution through UI and a direct owned API request.
2. Confirm revision A and start an execution attempt; concurrently edit/replace one required document to revision B.
3. Attempt replay of A's confirmation and submission against B. Inspect rejection reason and current snapshot.

**Expected:** UI/API enforce the same invariant; premature/stale execution refuses with domain conflict; revision B requires new validation/confirmation. Already accepted work has a recorded A snapshot under the chosen lifecycle policy. A stale client cannot accidentally authorize B. OPPLAN alone cannot substitute for RoE readiness.

### L03 — Multi-question answers and identity (T04,T07)

1. Produce two or more pending interrupts; select one multi-select and one free-text answer.
2. Navigate back/forward/CONFIRM; reload before submission.
3. Submit, reload during resume ACK recovery, then open history.

**Expected:** draft selection follows the documented persistence policy; accepted answer values remain attached to original question IDs; request replay yields the same resume operation, not another run. Pending questions disappear only when authoritative state permits; follow-up questions remain answerable. Duplicate/stale/missing-answer IDs are rejected explicitly.

### L04 — Transport loss, lost ACK and cancel (T05,T09)

1. Disconnect browser transport after dispatch but before ACK; reconnect/reload.
2. Retry same identity, then try same identity with changed message.
3. Cancel/interrupt an active run; reconnect and send follow-up where supported.

**Expected:** same-intent retry resolves original operation; changed intent conflicts; no additional dispatch. Uncertain outcome exposes reconciliation state and retains ownership until resolved. Cancel displays actual settled native/thread status; no false completed success.

### L05 — Tool and answer replay (T06,T07,T21)

1. Run consecutive tools around assistant messages, including a long/truncated result and a failing tool.
2. Navigate away, reload and reopen terminal thread; page older history.
3. Compare IDs/order/source/retained output with live observation and public event record.

**Expected:** same tool groups and boundaries, no duplicates, explicit caps/truncation, accurate failure markers and answer values. Thread-level source without observed run identity stays thread-level. Historical output is not dropped because the stream is no longer active.

### L06 — Clean reasoning/model compatibility (T08,T09,T15)

1. Build/start a clean runtime image, not a docker-copied process. Run a reasoning-capable model via default, model override and supported provider-key route.
2. Run a model that does not supply reasoning. Inspect stream and reload checkpoint history.
3. Render a Vietnamese answer with heading/list/table/link/inline code/fenced code block.

**Expected:** optional model trace preserved when supplied, absent without fake trace otherwise; public content and reasoning not mixed; Markdown semantic elements render; raw HTML/script does not execute. No private child-state bookkeeping is published.

### L07 — Planning edit/version/validation (T12–T14)

1. Open each of eight docs, edit a supported field, save and reload.
2. Open the same revision in a second browser and save competing edits.
3. Remove required scope/authorization field, revalidate, restore and confirm.

**Expected:** conflict instead of silent overwrite; invalid draft is visibly draft/invalid and cannot replace an approved executable revision silently. Revalidation reasons identify the actual document; changed approved content invalidates confirmation. Scope page and planner use the same canonical document.

### L08 — Settings/integration/Vault effects (T15–T19)

1. Store a test secret, create an integration referencing it, save and reload Settings.
2. Probe with valid/invalid credentials and with unreachable native service.
3. Select a supported model/fallback/language/budget, start a new run, inspect effective config identity and real behavior.
4. Reveal explicitly, revoke referenced secret, restart API and inspect audit.

**Expected:** no plaintext in config/list/log DTOs; probe distinguishes configured vs authenticated reachable; new run uses persisted snapshot. Revoked reference prevents new use with visible error; already-dispatched operations follow documented snapshot policy. Budget limit affects actual runtime, not only displayed value. Old run's effective config is unchanged by later settings edit.

### L09 — Graph and asset consistency (T20)

1. Generate a benign observation via actual tool/normalization pipeline for an owned test target.
2. Refresh graph and inventory; inspect host/service detail and provenance; apply search/filter.
3. Reload, switch engagement, then make KG unreachable.

**Expected:** same scoped asset identity and dedupe in both views; source/capture references truthful. No cross-project nodes; outage is unavailable, not “0 assets”. No invented mutation controls where ownership/API semantics are absent.

### L10 — Operations Log (T21)

1. Generate tool/question/run/provider events, filter by source/kind/time/thread and page through history.
2. Export the selected view, reload and compare stable event IDs/order.

**Expected:** exported rows match documented filter and snapshot, include provenance/cap flags, omit secrets and foreign events. Live refresh does not reorder or duplicate retained history. Invalid cursor gets bounded explicit error.

### L11 — Findings and retained evidence (T22–T24)

1. Open runtime finding, create analyst finding, edit both with write attribution.
2. Upload/link a retained test capture, download and compare digest, inspect producer lineage.
3. Compete edits, change lifecycle status and link a verification record.

**Expected:** no lost runtime finding, optimistic conflict on stale revision, retained bytes/identity stable. Marking a claim reviewed is distinct from corroborated/verified. Tampered capture fails integrity status; orphan/foreign/path-escape evidence links are rejected. Malformed finding stays inspectable with quality flag.

### L12 — Retest jobs (T25)

1. Submit a scoped benign retest from a finding with a validated/confirmed plan; double-click/replay.
2. Run a success case, nonzero/contradictory case, timeout and interrupted case.
3. Reload and inspect job, exact producer/capture and finding transition.

**Expected:** single dispatch; only observed qualifying verification may move to verified; timeout/error/contradiction never turns green automatically. Scope/authorization/stale plan rejection visible. Retest evidence can be retrieved independently of current agent memory.

### L13 — Reports/template/render/AI/signature (T26–T30)

1. Generate snapshot from actual finding/capture records; edit a source afterward and verify old snapshot remains unchanged.
2. Select a versioned template; preview and generate JSON/Markdown/PDF/DOCX; download all files.
3. Parse JSON, extract PDF text, unzip DOCX XML; check Vietnamese text, tables, report version and source finding IDs.
4. Compile AI draft, inspect source citations and unsupported assertions, approve reviewed content and generate final version.
5. Sign and verify artifact; change one downloaded byte and verify again. Reload/restart renderer/API, inspect jobs.

**Expected:** valid MIME/filename/content disposition, usable files, immutable source snapshot, matching template/preview. Renderer/AI failure produces failed or uncertain job with retry policy; never fake ready. AI prose without supporting reference remains flagged/reviewable and cannot manufacture verification. Signature validates original bytes and fails modified bytes; signature does not certify truth of claims.

### L14 — Notifications (T31)

1. Save event/channel preferences; trigger waiting-question, failed-job and completed-report events.
2. Inspect in-app inbox and native mail-sink delivery for enabled SMTP profile.
3. Disable preference, trigger again, interrupt provider and retry/reconcile.

**Expected:** one notification identity per eligible event/channel, persisted delivery outcome and timestamps; disabled events suppressed. Provider acceptance is not represented as inbox delivery beyond observed evidence. Failure/backlog visible; content omits secrets and foreign project data.

### L15 — Campaign native gates (T32,T33)

1. GoPhish: create draft, select native assets, prepare, deploy to isolated mail sink, reconcile counts.
2. Evilginx2: prepare synthetic lab profile, enable via typed bridge, inspect/reconcile native state.
3. Replay same request, change intent, restart API/bridge, reload and access from foreign engagement.

**Expected:** prepared version/native IDs persisted; exactly one observed lab dispatch or enable per intent; lost ACK is uncertain and reconciled, not redispatched. Native counts/enabled state match Web; GoPhish SMTP acceptance is not claimed as actual external delivery; no captured cookies/credentials or bridge tokens in outputs. Missing provider remains unavailable.

### L16 — C2 native gates (T34,T35)

1. Start owned lab listener and HTTP profile, enrol actual isolated Linux session through existing harness.
2. List session in owning engagement only; execute explicit benign path + argv; exercise nonzero exit and output cap.
3. Lose ACK/timeout, replay, restart bridge/API and reconcile recorded outcome.

**Expected:** session attribution validated; command identity/audit/exit/truncation survive reload. No implicit shell, duplicate execution or foreign session access; unknown outcome retains uncertainty/lock. Native profile/listener restart state matches UI. No browser implant-generation or interactive-shell expansion.

### L17 — Local Members/project lifecycle (T36,T37)

1. View local identity, save supported operator preferences, reload.
2. Archive/delete a project with active run/provider job/session; inspect rejection/pending cleanup.
3. Settle resources, choose retention policy, perform lifecycle transition and inspect artifacts/audit.

**Expected:** single real operator, no fake role enforcement. Active/uncertain work blocks destructive finalization where policy requires; resources cleaned or explicitly retained by choice. Artifact retention is not disguised as total deletion. IDs are not reused; lifecycle event is audited.

### L18 — HITL native on/off (T43,T44)

1. Configure HITL-on via supported settings and run an action that genuinely triggers actual middleware/producer policy in the lab.
2. Observe pending approval before execution; reload then deny. Run another case then allow once.
3. Duplicate decision, stale decision, foreign approval, lost ACK and runtime/API recreate.
4. Repeat a baseline in explicit HITL-off mode.

**Expected:** deny prevents the pending action; allow permits only authorized pending work once. Producer and Web consume the same approval identity/state. OFF remains explicit current policy, not a test bypass; ON cannot be marked ready from a fabricated approval file written by the runner.

### L19 — Team authentication/RBAC/isolation (T45–T47)

1. Log in two real users, invite/accept a member, set roles from the approved permission matrix.
2. Test every scoped read/mutation/export/probe/approval/provider command by owner/editor/reader/foreign identity.
3. Open stream and artifact download, revoke membership/session and attempt continued access.

**Expected:** backend enforces actual permission matrix; revoked identity loses subsequent access/stream according to defined policy; no private channel/artifact/history/secret leak. Invalid/expired invite and session cannot gain access; UI reacts to denial instead of trusting role dropdowns.

### L20 — Lifecycle, crash, CI and release (T10,T39–T42,T48–T52)

1. LOCAL: create pending Q&A/execution/report job, gracefully recreate intended services, restore paired backup in isolated environment.
2. HOSTED: kill runtime/API/job worker between reserve/dispatch/ACK/commit points; restart and inspect accepted operation identity and checkpoints.
3. CI: modify each relevant surface, verify required jobs run; inject controlled type/contract regression in temporary branch and observe failure; restore.
4. Install actual release assets in fresh environment; update from supported previous version, run migrations, verify data and providers; exercise documented compatible rollback/recovery.

**Expected:** local graceful gate retains pending/history/artifacts. Hosted gate meets ADR-defined RPO/RTO and reconciles rather than redispatching unknown work. CI failure not hidden by skipped jobs. UI/API/runtime/config/migrations align with exact release; unsupported DB downgrade is refused, not silently executed. Release evidence URLs and image/digest identities retained.

## 5. Cross-cutting UI scenarios (T09,T38)

- Keyboard-only: focus order, questions/CONFIRM, dialogs/close/Escape, multiline Enter/Shift+Enter policy, no accidental double-send, aria-expanded and status announcements.
- Mobile/desktop: test 390×844, 768×1024, 1440×900; sidebar navigation remains 13 entries; horizontal tables/code scroll without breaking composer or dialogs.
- Long content: at least 50 tool events, a capped long output and 100-question/history entries via protocol fixtures; one actual live long-run case. Pinned scroll follows new output; reading older output keeps position; Jump to latest resumes following.
- Route switch/late ACK: no navigation hijack or stale project content, no duplicate mutation on back/forward/reload.
- Every action: loading/empty/success/error/conflict/unavailable/recovery states and truthful disabled reason; no button with only toast/demo timer behind it.

## 6. Required completion evidence

Per ticket/live procedure record:

1. Exact git revision and dirty-tree state; UI/API/runtime/provider image IDs or local build identity; migration status.
2. Environment/topology/profile, redacted config versions and enabled provider scope.
3. Commands + exit codes, browser trace/screenshot, actual engagement/thread/run/job/provider resource IDs.
4. Before/failure/after observations, downloaded artifact digests and relevant audit/event IDs.
5. Test lanes used and lanes not exercised; skipped native provider gate = blocked, not completed.
6. Cleanup results and retained uncertain resources; never include raw secrets or unredacted native credentials.

Do not hardcode token values in fixture/source/evidence. Runtime artifacts stay in ignored local test-result directories; selected sanitized evidence can be referenced from readiness docs.

## 7. Program exit conditions

- **M1:** L01–L06 plus supported local lifecycle part of L20 pass on exact deployment.
- **LOCAL-FULL:** all local procedures L01–L17 and cross-cutting UI matrix pass; deterministic/real-fixture lanes green; production bootstrap/install/update portion L20 pass.
- **HITL-ON:** L18 pass with actual producer plus OFF regression.
- **TEAM-HOSTED:** L19 and hosted crash/restore part L20 pass, together with local/HITL gates.
- No profile is completed with an unexplained failing required test, absent native provider evidence, a manual repair required by normal workflow, or a fake success/verification state.
