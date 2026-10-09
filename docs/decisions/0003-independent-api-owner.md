# 0003. Independent API owner from day one (web-raptix-server)

- **Status:** Proposed
- **Date:** 2026-10-01
- **Deciders:** Raptix maintainers
- **Related:** `docs/adr/0001-record-architecture-decisions.md` (ADR process), `summary/impl-guide-web-raptix-integration.md` (§4.2 root workspaces/scripts, §4.3 browser vs server config, §13.4 Prisma/data ownership, §14 cutover/rollback inventory), `clients/web-raptix/server/package.json`, `clients/shared/web-contracts/package.json`

## Context

The legacy `clients/web` stack is simultaneously the visual UI and the API
owner: root workspaces use the broad `clients/*` wildcard, root
`dev`/`build`/`start`/`prisma:*` scripts point at it, and its Next server is
the only live HTTP upstream. The corrected visual baseline lives in
`clients/web-raptix`, which must never import legacy code or route through the
legacy server, and W01 boots a real backend for it. npm workspaces does not
auto-discover nested packages, so `clients/web-raptix/server` must be
registered explicitly; a wildcard plus an unverified negation pattern is not
an acceptable substitute. The framework question was settled alongside the W01
bootstrap (guide §3): the server needs request validation, scoped middleware,
SSE streaming and lifecycle control, and it must not need Next or React to
run — Fastify 5 on Node/TypeScript ESM (Node ≥ 22.12) is the default choice.

## Decision

1. **Independent API owner from day one.** `@raptix/web-raptix-server`
   (nested at `clients/web-raptix/server`) owns the HTTP API starting in W01:
   own manifest, tsconfigs, eslint, build (`tsc -p tsconfig.build.json` →
   `dist/`) and run scripts (`dev` = `tsx watch`, `start` =
   `node dist/main.js`). No Next, no React, no imports from `clients/web` or
   any legacy upstream; Node ESM relative specifiers use `.js` extensions.
   Root `dev`/`dev:api`, `build`/`build:api` and `start`/`start:web` keep the
   frontend and API lanes separate so each side builds and runs
   independently.
2. **Shared contracts.** Wire DTOs and boundary validators live in
   `@raptix/web-contracts` (`clients/shared/web-contracts`, pure ESM `dist`
   build, peer `@raptix/streaming`). Browser and server both consume it; the
   UI must not re-declare event or DTO shapes. The HTTP event envelope
   belongs to web-contracts; raw runtime event types stay in
   `@raptix/streaming`.
3. **Explicit root boundary.** Root workspaces become the explicit active
   list `clients/cli`, `clients/desktop`, `clients/web-raptix`,
   `clients/web-raptix/server`, `clients/shared/*`. `clients/web` leaves the
   active workspaces (it is not a lockfile/install participant anymore) but
   the folder stays on disk as reference for the rollback window. Frontend
   tsconfig keeps `include: ["src"]` with an explicit `server` exclude, the
   frontend eslint ignores `server/**`, and Tailwind 4 excludes the server
   tree via `@source not '../server'` so Node code and the generated Prisma
   client never enter browser scanning.
4. **Direct-run transport now, same-origin later.** In W01 the server runs
   standalone on its own port (guide §4.3 local target `127.0.0.1:5280`);
   same-origin proxying, compose/launcher/CLI cutover and deployment are
   gated at W16 — this decision adds no Docker, Makefile, CLI or launcher
   change.
5. **Single Prisma migration owner, declared now.** The Prisma owner becomes
   `clients/web-raptix/server` (`server/prisma`, server scripts), but W01 adds
   no schema or migrations: root `prisma:*` scripts point at the new owner's
   planned commands and fail cleanly (missing script) until W02 ports the
   schema plus existing migration history with filenames/checksums preserved
   (no squash to a fresh init, no reset/drop/volume recreation, existing
   database name and data preserved). From W02 there is exactly one migration
   owner; the legacy auto-migrate-on-startup path must be stopped before the
   new owner applies migrations.
6. **Rollback window and legacy-reference sweep.** The legacy stack remains
   in the tree as an archived reference/rollback source during the rollback
   window; all legacy references (root scripts, lockfile, compose, CLI
   `/web`, launcher, Makefile/CI copy paths) are inventoried and swept at the
   W16 cutover gate, and final folder/workspace retirement happens at W20
   behind a clean-checkout independence verification.

## Consequences

- **Easier:** the frontend stays standalone (mock mode needs no DB, Prisma or
  runtime); the API is developed, typechecked, linted and built
  independently; a clean-checkout independence gate (no `clients/web`
  participation) becomes verifiable before the W16 cutover.
- **Harder:** nested packages require explicit workspace registration from
  now on — future client packages must edit the root list; until W02, root
  `prisma:*` intentionally fail with a missing-script error (documented
  gating, not silent breakage); no single full-stack run command exists until
  integration work lands.
- **Given up:** the convenience of the broad `clients/*` wildcard; keeping
  the legacy Next API as a live upstream for the new UI (parity comparisons
  may still read captured fixtures, but never production traffic).
- **Migration:** root manifest re-points in the W01 bootstrap changeset
  (lockfile regenerated by the install that follows); schema/history port in
  W02; deployment/proxy/launcher cutover in W16; legacy retirement in W20.

## Alternatives considered

- **Keep `clients/*` wildcard with a negation pattern for `clients/web`:**
  rejected — npm glob negation here is unverified, and the nested
  `clients/web-raptix/server` package would not be picked up at all.
- **Repurpose `clients/web` as an API-only Next backend:** permitted by guide
  §13.5 but rejected — it keeps the legacy folder as the live code owner and
  upstream, which defeats independence from day one and complicates the W16
  cutover.
- **Vite dev proxy to the legacy Next API as an interim transport:**
  rejected — it makes the legacy server the real upstream of the new UI and
  would produce integration evidence that is not backed by the new stack.
- **Move Prisma ownership together with the W16 deployment cutover:**
  rejected — two live migration owners between W01 and W16 risk migration
  races and checksum mismatches against the existing database; ownership must
  transfer once, early (W02), with history preserved.
