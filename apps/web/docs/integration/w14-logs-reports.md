# W14 — Operations Log & Reports (accepted 2026-10-02)

## Scope

Guide §12.10 (Operations Log) and §12.11 (Reports): a merged, labeled
operations timeline and real report preview/export without synthetic
telemetry or fake deliverables.

## Server

- `services/timeline-service.ts` — engagement-scoped merged timeline from three
  explicitly-labeled sources, one entry per fact:
  - `runtime`: one entry per owned run (from the W10 ledger), id `run:<runId>`,
    carries the run's actual status.
  - `checkpoint`: durable thread-level transcripts (W09 projection), runId
    intentionally unattributed — replay context, never duplicated as run events.
  - `workspace`: artifact-mtime presence markers over the W12 allowlisted
    folders; the timestamp is a presence marker, never presented as an exact
    tool execution time.
  - Bounded: ≤5 threads, ≤25 runs/thread (scoped run-page parser limit),
    ≤50 transcripts/thread, ≤100 artifacts, ≤250 entries; newest-first;
    `truncated` is truthful and covers every hidden remainder.
- `services/export-service.ts` — `GET /api/engagements/:id/export?format=`
  supports exactly `json` and `markdown`; any other format (or a missing one)
  answers 400 with the supported list — the legacy silent Markdown fallback is
  gone. The payload is the actual engagement identity, actual plan documents
  (`plan/{roe,conops,deconfliction,opplan}.json` when present) and the raw
  `FIND-*.md` contents (≤100 files, >256 KB counted as unreadable and never
  fabricated). Attachments carry `Content-Disposition` with the
  `<slug>-export.json|.md` filename and correct content types.
- Routes `timeline.routes.ts`; capabilities `timeline` and `reports`
  implemented (timeline follows the runs capability's availability).

## Frontend

- `features/operations-log/` — real Operations Log: table of merged entries
  with source badges (Run / Checkpoint / Workspace), payload-derived filter
  options (agent/tool/status come from the loaded entries, never hardcoded
  lists), search, entry-detail modal with per-source provenance notes, a
  truthful bounded-history banner and a truthful empty state. No "Live"
  indicator, no terminal streaming theater, no synthetic telemetry.
- `features/reports/` — real Reports: preview from actual DTOs (engagement
  identity, parsed findings with severity counts, allowlisted artifact count)
  plus real JSON/Markdown export buttons. Success is claimed only after the
  response arrived, with the filename parsed from `Content-Disposition` and the
  byte size shown. No dummy deliverable rows, authors, page counts, PDF/DOCX,
  AI-compile, sign/share/template controls — the absence is stated in copy.

## Contracts

- `TimelineEntryView` / `TimelineView` (+ validators) with `source` limited to
  `runtime | checkpoint | workspace` and `source: 'mixed'` on the view; entry
  timestamps must parse as dates.

## Gates

- Server: 190 tests (7 new W14), typecheck/lint/build clean.
- Contracts: 41 tests (timeline validators additive).
- Frontend: typecheck, lint (0 errors), build, 80 unit tests (new
  `logs-view.test.ts` covers payload-derived filters, bounded summary,
  provenance text), real-mode browser lane 17/17 (4 new logs + 3 new reports
  specs), mock lane 8/8 unchanged.
- W14 live gate (`playwright.logs.config.ts`, vite 5294 / API 5295,
  dedicated `W14_TEST_*` DB + workspace): real capabilities, workspace markers
  in the timeline UI, provenance modal, real JSON export download with correct
  filename, unsupported format rejected, foreign 404, cleanup leaves the
  timeline truthfully empty — 1/1.
- Verifier `--w14`: 9 groups against API 5284 + PostgreSQL 5433 + LangGraph
  2400, including a real planning run surfacing as the timeline's runtime
  entry and the export round trip; evidence `w14-live.json`.
- Regression: verifier lanes w07 (4), w08 (6), w09 (7), w10 (7), w11 (10),
  w12 (9), w13 (9) all pass.

## Non-goals honored

No fabricated log export (the engagement export covers actual data only), no
fake live/streaming indicators, no report authorship or page-count fixtures,
no cross-project report data.
