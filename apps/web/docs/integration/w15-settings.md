# W15 — Supported Settings & Core E2E (accepted 2026-10-02)

## Scope

Guide §12.13 (Settings) plus the W15 outcome: a web-native core E2E covering
create → planning → run execution → report, entirely through the real UI
against the real API, database and runtime.

## Server

- `services/settings-service.ts` + `GET /api/engagements/:id/settings` — the
  persisted view over the fields the server actually stores today
  (displayName, immutable slug, targetType/targetValue, authorization, lifecycle)
  with the target-change policy stated up front (`targetChange.allowed` +
  reason: draft-only lifecycle, no linked thread, no locked runtime context) so
  a locked target fails before the form does.
- Saving reuses the existing `PATCH /api/engagements/:id` — same strict field
  parsing, same lifecycle policy, no parallel write path.
- `DELETE /api/engagements/:id` — the explicit danger action. It refuses with
  a truthful 409 while run/resume requests still hold `activeThreadId`
  (a steady-state bound thread hold does not block), then removes the DB
  record, its bound threads and the request ledger in one transaction and
  answers `{ ok: true, workspaceRetained: true }` — the response itself names
  that workspace artifacts are retained. This is a DB delete, not an archive;
  it does not claim artifact-retention or C2 cleanup semantics.
- Settings are DB-backed only: no secrets, no provider/model/integration/
  notification/template settings contract exists, so none is exposed.

## Frontend

- `features/settings/` — real Settings page: General card (display name,
  read-only slug, target fields disabled with the server's lock reason), Save
  that sends only editable fields (locked targets patch the display name only)
  and reports "Saved" only after the PATCH was acknowledged **and** the GET
  reload returned the persisted values; invalid fields surface the server's
  field-attributed errors. A "not available in this build" section states the
  absent feature areas with their owning work packages — no "Test Connected"
  buttons. Danger zone states exactly what deletion removes and what is
  retained, with a confirm step, truthful 409 errors and navigation home on
  acknowledgement.
- Mounted on the `project-settings` screen; its unavailable reason is removed.

## Contracts

- `EngagementSettingsView` (+ validator) with `source: 'db'` and the explicit
  `targetChange` policy object.

## Gates

- Server: 194 tests (4 new W15), typecheck/lint/build clean.
- Contracts: 42 tests.
- Frontend: typecheck, lint (0 errors), build, 80 unit tests; real-mode
  browser lane **21/21** (4 new settings specs), mock lane 8/8 unchanged.
- **Core E2E live gate** (`playwright.core.config.ts`, vite 5296 / API 5297,
  dedicated `W15_TEST_*` DB + workspace, real LangGraph runtime): the
  web-native loop — New Project form → charter → console "New planning chat" →
  real planning run reaching RUN SUCCESS → Operations Log shows the run →
  workspace findings flow into Reports preview → JSON export download →
  Settings save/reload → danger delete → empty home. 1/1.
- Verifier `--w15`: 11 groups — settings view with the lock reason after a
  real bound run, displayName save/reload round trip, invalid/locked PATCH
  rejections with field attribution, danger delete after the hold settled
  (repeat delete 404, foreign 404); evidence `w15-live.json`.
- Regression: verifier lanes w07 (4), w08 (6), w09 (7), w10 (7), w11 (10),
  w12 (9), w13 (9), w14 (9) all pass.

## Non-goals honored

No secrets display or masked-placeholder echo (no secret settings exist), no
unacknowledged "Saved"/"Test Connected" toasts, no archive-vs-delete
conflation, no fake provider/model/runtime toggles.
