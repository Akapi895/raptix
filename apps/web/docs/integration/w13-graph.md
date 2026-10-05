# W13 — Graph projection, redaction & Assets inventory

## Delivered

- **Server graph service** (`server/src/services/graph-service.ts`): engagement-scoped Cypher over Neo4j's HTTP transaction endpoint (`n.engagement = $name`, edges filtered to in-scope endpoints) — no driver dependency. **Public projection before the response**: property key allowlist + credential-like key removal (`password|secret|token|api_key|credential|ntlm|hash|cookie|authorization|bearer|…` keys are dropped entirely, never forwarded) + credential-looking value redaction under allowed keys (48+ char base64 runs, JWT shapes → `[REDACTED]`), values bounded to 300 chars, ≤24 props/node. Bounded payloads: ≤400 nodes, ≤1200 edges, `truncated` reflects only bound truncation (scoping/dedup filtering does not count). Neo4j failure → `GraphUnavailableError` → HTTP 503; scoped empty graph stays a truthful 200-empty.
- **Server assets projection**: `AssetSummaryView` derived from the same graph read — id/type (`Host|Web|API|Identity|Mobile` from labels+properties)/label/hostname/ip/url/os/ports/services/related finding ids. Dedup by `type|hostname|ip|url` domain key with merged ports/findings — same hostname+ip collapses into one asset, distinct IPs never merge.
- **Routes** (`server/src/http/routes/graph.routes.ts`): `GET /api/engagements/:id/graph`, `GET /api/engagements/:id/assets` — both engagement-scoped by owned id, foreign → 404, `Cache-Control: no-store`.
- **Env** (`server/src/config/env.ts`): optional `NEO4J_HTTP_URI`/`NEO4J_USER`/`NEO4J_HTTP_PORT`/`NEO4J_PASSWORD`. The documented public default password is rejected outright (graph data is refused entirely) and the password is never logged/echoed. `capabilities.graphs` reflects wiring only; per-request availability stays 503-vs-200.
- **Contracts**: `GraphView`/`GraphNodeView`/`GraphEdgeView` (public property values are `string|number|boolean|null` only), `AssetsView`/`AssetSummaryView` + validators.
- **Frontend** (`src/features/infrastructure/`): `RealInfrastructure.tsx` (node table + relations summary + node detail modal showing only server-redacted public properties with a provenance note) and `RealAssets.tsx` (source-screen visual language: metric counters, All/Hosts/Web&API/Identities/Mobile tabs, search, table, inspect modal). Counters derive from the same projection — no 134/47/68 source constants. No Tag/Update Scope/Export CSV/multi-select dock, no compromised/objective decorations, no pivot claims. Both mounted in `RealApp`; unavailable reasons removed.
- **Verifier** (`tools/verify-w07-live.mjs --w13`): seeds real Neo4j nodes (password read from repo `.env`, never the default), proves redaction (`verifier-secret-DO-NOT-LEAK` never leaves the server), cross-engagement isolation, asset dedupe and foreign 404 against the real graph store.

## Gates

- Server: typecheck/lint/build + **183 tests** (+5: scoped projection + redaction + dedupe + routes 503/404 + env graph config).
- Contracts: **40 tests**; frontend typecheck/lint (0 errors, 38 warnings)/build + **77 vitest**.
- Browser: mock lane **8/8**; real-mode lane **10/10** (incl. 2 new intercepted graph/assets specs); **W13 live gate 1/1** (vite 5292 + API 5293, real Neo4j at 7475).
- Verifier: `--w07` (4), `--w08` (6), `--w09` (7), `--w10` (7), `--w11` (10), `--w12` (9), `--w13` (9) — all pass against API 5284 + PostgreSQL 5433 + LangGraph 2400 + Neo4j 7475.

## Evidence

- `docs/integration/w13-live.json` — verifier lane output (`checks`, provenance).

## Not rendered (no real backend)

- Tag Selected / Update Scope / Push-to-Queue / Export CSV and the multi-select dock — separate mutations without a backend; navigation to Scope does not update machine RoE.
- Topology status decorations (Compromised/Objective), pivot/C2 links and credential rows — actual relations stay actual relations; the credentials surface stays W18.
