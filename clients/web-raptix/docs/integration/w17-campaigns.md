# W17 — Campaign Persistence & Scoped C2 (accepted 2026-10-02)

## Scope

Guide §12.4 (Vector Campaigns) and §12.5 (C2 & Sessions) plus the W17
outcome: persisted jobs/sessions/commands with scope. The campaign provider
and the C2 session provider are not wired in this build, so every provider
outcome is stated truthfully instead of fabricated.

## Server

- `services/campaign-service.ts` — persistence-backed drafts plus truthful
  provider jobs. `POST /api/engagements/:id/campaigns` (name ≤120, vector
  `phishing|web|mobile`, optional scenario ≤200 → `spec`), `GET .../campaigns`
  (newest first, bounded 100, `truncated`), `GET .../campaigns/:campaignId`.
  Generate/deploy record a durable `CampaignJob` with status `unavailable` and
  error `campaign provider not configured`; the campaign row is intentionally
  never mutated — no code path can fabricate Generated/Delivered. Foreign
  engagements/campaigns answer 404; duplicate campaign names answer 409.
- `services/c2-service.ts` — the scoped session routes exist and enforce
  engagement ownership first (`GET .../c2/sessions`,
  `POST .../c2/sessions/:sessionId/commands`), then answer 503 with the
  explicit provider reason. Agent threads, a CLI PTY and C2 sessions stay
  distinct transports; no Docker/bash forwarding route exists. Session and
  command persistence lands with the provider adapter — no empty tables were
  fabricated to pretend otherwise.
- Capabilities: `campaigns` is DB-backed (draft persistence is real); `c2`
  reports `{ supported: true, available: false, reason: 'provider_unavailable' }`.

## Frontend

- `features/campaigns/` — real drafts list, create form (name/vector/scenario),
  per-campaign job history with `kind:status` badges and the unavailable
  outcome stated in amber; empty and truncated states are explicit.
- `features/c2/RealC2.tsx` — renders the server's own 503 answer live; no
  session rows, no whoami/hostname strings, no terminal theater.
- Reasons for `vector-campaigns`/`c2-sessions` removed from
  `real-capabilities.ts`; both pages are mounted real.

## Gates

- Contracts: 45 tests (campaign job/view/list validators additive).
- Server: 211 tests total, including `w17-campaigns.test.ts` (drafts CRUD,
  validation attribution, duplicate 409, truthful unavailable jobs with the
  draft never mutated, foreign 404s, scoped C2 503s, capabilities).
- Frontend: typecheck/lint/build clean, 80 unit tests, real lane 24/24 → now
  part of 29/29, mock lane 8/8 (legacy demo behaviour untouched).
- Verifier `--w17` (11 groups): real planning run then campaign create →
  generate (durable unavailable job) → reload persistence → deploy → scoped
  C2 503 → foreign 404 → capability asserts; evidence `w17-live.json`.

## Non-goals / next

Campaign generation and deployment require a chosen provider with versioned
drafts, wave ids and idempotency; C2 needs a real session registry. Both stay
capability-flagged absent until that contract exists.
