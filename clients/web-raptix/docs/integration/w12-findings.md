# W12 — Findings & Evidence (parsed workspace findings + tightened artifact browser)

## Delivered

- **Server findings projection** (`server/src/services/findings-service.ts`): parses `FIND-*.md` from `<workspace>/<slug>/findings/` with legacy parser semantics preserved. Every projection carries explicit parser-quality flags (`defaultSeverity`, `placeholderDescription`, `placeholderEvidence`) so a parsed default (medium severity, placeholder text) is never presented as analyst-confirmed. Malformed findings stay viewable through their bounded raw source (≤64 KB); ≤100 files per listing, ≤256 KB per file; oversized/missing entries set `truncated` truthfully. Engagement-scoped by owned id, no legacy imports.
- **Server artifact browser** (`server/src/services/artifacts-service.ts`): allowlisted folders `recon|exploit|post-exploit|findings|report`, non-recursive listing with sizes, realpath/symlink containment on every folder and file, strict UTF-8 decoding (binary content rejected, never guessed), 256 KB read cap with truthful `truncated`, JSON detection for `mediaType`. Path traversal (`.`/`..`) is rejected outright (400) rather than normalized; unknown paths 404; foreign engagement 404. Fixes the legacy API's missing size cap and missing symlink protection and routes by engagement **id** instead of name.
- **Routes** (`server/src/http/routes/findings.routes.ts`): `GET /api/engagements/:id/findings`, `GET /api/engagements/:id/artifacts`, `GET /api/engagements/:id/artifacts/content?path=…` (all `Cache-Control: no-store`).
- **Capabilities**: `findings` and `artifacts` move from `missing` to `supported/available` (database-backed, workspace-file projection).
- **Contracts** (`@raptix/web-contracts`): `FindingView`/`FindingsView` (severity `informational`, quality flags, `rawSource`, `sizeBytes`), `ArtifactsView`, `ArtifactContentView` + validators.
- **Frontend** (`src/features/findings-evidence/`): real Findings & Evidence page keeps the source screen's visual language (severity summary bar with counts/filters, findings table, detail modal) bound to real data only. No demo workflow states: status/report/assign columns, Run-PoC timer, Mark Verified/Assign Review and dummy exports are not rendered (persistence/execution services do not exist). Rows show parser-quality provenance ("parsed from file" vs "parsed defaults — not analyst-confirmed"); modal shows description/evidence/attack vector/assets/CWE/MITRE/remediation, bounded raw source and the artifact browser preview. Mounted in `RealApp` for the `findings` screen; unavailable-reason removed.
- **Verifier** (`tools/verify-w07-live.mjs --w12`): full findings/artifact round trip against the real engagement workspace (parse + quality flags + malformed raw viewability + allowlisted listing + JSON content + traversal 400 + foreign 404), capabilities assertions, plus the shared W07–W11 planning-run/restart/dedup pipeline.

## Gates

- Server: typecheck/lint/build + **178 vitest** (W12: parser semantics, quality flags, bounds/`truncated`, scoping, allowlist, non-recursive listing, realpath containment, traversal/binary rejection, content truncation, foreign 404).
- Contracts: **39 tests**.
- Frontend: typecheck clean, lint 0 errors/38 warnings, build ok, **74 vitest** (mapping: `informational→info`, quality flags → row provenance, severity counts, search, size/path/content header).
- Browser: mock 13-tab lane **8/8**; real-mode lane **8/8** (incl. 2 new intercepted findings specs); **W12 live browser gate 1/1** (real project + real workspace files: parse → quality provenance → modal → artifact preview `recon/probe.txt • TEXT • 11 B` → foreign 404 → cleanup → empty truthful state).
- Verifier: `--w07` (4), `--w08` (6), `--w09` (7), `--w10` (7), `--w11` (10), `--w12` (9) all pass against API 5284 + PostgreSQL 5433 + LangGraph 2400.

## Evidence

- `docs/integration/w12-live.json` — verifier lane output (`checks`, provenance).
- W12 live gate: test-results-findings (local run output), project + workspace artifacts created/removed inside the dedicated test DB and workspace.

## Not rendered (no real backend)

- Finding review workflow (status/assign/report state, Mark Verified), Run-PoC execution, finding export buttons — persistence/execution services do not exist; rendering them would fabricate outcome data.
- Screenshot/binary/nested evidence-folder previews — require an explicit server extension (text/JSON/Markdown only today).
