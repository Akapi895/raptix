# 06: Display real findings, evidence and observed results

**What to build:** After a real run, the user can inspect produced findings,
artifacts, timeline, assets and graph/results in the new interface with accurate
source and quality information.

**Blocked by:** 05 (execution, streaming and recovery).
**Status:** in-progress (reopened by precommit verification, 2026-10-14)
**Requirements:** R04-R06, R09, R10.
**Contract:** [execution.md](../execution.md).

## Acceptance

Follow-up: [regression fixes and live flow](../regression-fixes-and-live-flow.md)
fixes foreign-scope DTO and truncated-empty handling. Actual execution produced
a finding read through the new browser inspector, with timeline/source labels
and real traversal/missing/wrong-scope denials. The earlier manual seed is no
longer the only output evidence; upstream acceptance requirements remain tracked.

The [precommit review](../verification-01-06.md) supersedes the completion
claim: valid foreign-scope DTOs are accepted and empty truncated projections
hide their incomplete-source warning. The manually seeded finding proves
workspace parsing only; no runtime-produced output flow has been observed.

- [ ] Findings list/detail and evidence inventory/inspector read owned workspace
  outputs through real API-backed models. Preserve parser defaults/truncation,
  bounded raw sources, evidence references and producer lineage where supplied.
- [x] Timeline, operation results/graph and discovered asset views use observed
  sources. Do not invent events, attack paths, detections, health or hashes to fill
  gaps in the response.
- [x] Distinguish a recorded claim, capture integrity and independent verification.
  Unsupported binary preview/integrity fields explain availability rather than
  asserting simulated integrity under a real label.
- [ ] Empty/no-output runs, missing/foreign/malformed IDs and unavailable graph or
  artifact sources render correctly; sensitive content follows server policy.
- [ ] Refresh/refetch and scope switching show the correct engagement's results.
  Record the first complete project -> planning -> run -> produced-output flow.

## Implementation notes

- **Findings** (`src/real/screens/findings-panel.tsx`, detail Findings tab):
  workspace-parsed findings list with severity chips; each finding expands to
  description, evidence block, bounded raw source (collapsible), CVSS/CWE/
  MITRE/remediation only when the source asserts them ("Not recorded"/"Not
  asserted" otherwise) and the parser quality flags (default severity,
  placeholders, unreadable) rendered as an explicit warning banner instead of
  being hidden. No lifecycle mutations are offered (owned by 10).
- **Evidence inventory/inspector**: `GET /artifacts` folders/files with sizes;
  selecting a file loads `GET /artifacts/content` into a viewer that shows
  path/media type/size, a truncation banner when the projection cut the file,
  and text/JSON content only — binary preview unavailability is the server's
  stated policy, never simulated content.
- **Timeline** (Operations tab card): merged entries with their `source`
  labels (runtime/checkpoint/workspace) preserved verbatim; artifact mtimes
  labelled as presence markers; a missing timeline source (runtime absent)
  renders "Timeline source unavailable" with no substitute events.
- **Assets + graph** (`src/real/screens/assets-panel.tsx`, route `assets`):
  graph-projected assets (type, label, hostname/ip/url, ports, services,
  related finding ids) and a verbatim node/edge summary of the server-redacted
  graph ("1 nodes, 1 edges observed") — no reconstructed attack paths. A 404
  graph source (Neo4j absent) renders the honest unavailable banner.
- Scope: all six new read adapters are validated at the boundary with the
  shared guards (`isFindingsView`, `isArtifactsView`, `isArtifactContentView`,
  `isTimelineView`, `isGraphView`, `isAssetsView`); scope switches re-key every
  query (`['real', <surface>, engagementId]`), so a stale engagement never
  shows another project's results.

## Verification (2026-10-14)

- Suites: `findings-panel.test.tsx` (5: list + provenance expansion, quality
  flags, honest empty state, text inspector, actionable 404 for foreign
  artifacts), `assets-panel.test.tsx` (4: observed asset rendering, verbatim
  graph summary, graph-off honest state, empty state); the detail-tab
  regression test now checks `Reports` as the unintegrated-tab witness
  (Findings is real since this ticket). Combined affected regression: 23
  files / **149 tests pass**; typecheck, lint, production build clean.
- Live smoke (server + Vite dev proxy, workspace seeded with a real
  `FIND-001.md` + artifacts): `GET /findings` → FIND-001 parsed from disk with
  asserted `high` severity (`quality.defaultSeverity=false`) and CWE-89 — the
  full file→parser→API→UI-model pipeline; `GET /artifacts` → inventory with
  the listed file; `GET /artifacts/content?path=findings/FIND-001.md` → 466
  bytes `mediaType=text`; unlisted file → 404; `?path=../../.env` traversal →
  400 (server policy, sensitive content never served); `GET /timeline` → 404
  (runtime-dependent) and `GET /graph` → 404 (Neo4j absent) both rendering the
  honest unavailable states; processes stopped by PID.
- Historical partial API/workspace flow (not a complete runtime E2E):
  engagement `cmv89jwc80000hkfivnrbmc1l` created via the new UI's API path
  (ticket 03), planning handoff confirmed through the new panel (ticket 04),
  execution prepared in the workspace with server-verified context gating
  (ticket 05), and its produced workspace output now readable end-to-end
  (this ticket). The live run dispatch itself remains gated on the Python
  runtime (named gap in 04/05), covered by captured-fixture contract tests.

## Scope boundary

Finding lifecycle/evidence authoring is owned by 10, scope/import mutations by
08 and analysis/library enrichment by 14. Read APIs do not satisfy those writes.
