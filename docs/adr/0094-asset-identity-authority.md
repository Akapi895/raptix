# 0094. Asset identity authority and deterministic asset IDs

- **Status:** Accepted (owner decision recorded in the Asset Map implementation plan, 2026-10-20)
- **Date:** 2026-10-20
- **Deciders:** Akapi895 (repository owner)
- **Related:** [Asset Map proposal](../proposals/2026-10-20-asset-map-canvas-and-graph.md), [implementation plan](../design/2026-10-20-asset-map-implementation-plan.md), [ADR-0084](0084-real-service-adapter-boundary.md)

## Context

Assets are identified three different ways today: the Web inventory uses `WebAsset.id` (a cuid), the Web graph uses Neo4j `elementId`, and the runtime knowledge graph uses `sha1(kind::key)` over whatever label the writer supplied. Two writers describing the same host can therefore produce two assets, and a Neo4j `elementId` changes when the graph is rebuilt. The runtime must keep writing observations while the Web server is down, so identity cannot depend on a synchronous Web call.

## Decision

1. **Authority.** PostgreSQL (Prisma, owned by the Fastify server) holds the asset catalog: identity metadata, display name, lifecycle and scope binding. Neo4j holds observed relations and the evidence references that point at catalog IDs. Artifacts keep raw bytes.
2. **Deterministic `assetId`.** `assetId` is computed by one function in `raptix_core` from `(engagement, kind, namespace, canonicalKey, keyVersion)`, where `engagement` is the KG partition key (the workspace slug the runtime writes as `engagement`), not the Web `Engagement.id`. The runtime writes that ID and its parts (`asset_kind`, `asset_namespace`, `asset_canonical`, `asset_key_version`) onto every asset-bearing KG node, so the Web side never parses the joined key. The Web catalog accepts the ID after recomputing it and never reissues it, so neither side needs a round trip to agree on identity.
3. **Canonical keys are normalized by kind.** IP addresses use the compressed form. DNS names are lowercased with no trailing dot. Web origins keep scheme, host and effective port; they are separate assets from their host. Namespace carries the context that makes a key unique (network context for IPs, provider/account for cloud, platform/package for mobile).
4. **Reconciliation is idempotent upsert.** The Web server reads KG nodes that carry an `assetId`, upserts the catalog keyed by that ID, and records what it could not match. Replaying the same input creates no new rows. No distributed transaction spans PostgreSQL and Neo4j; a failed reconcile is retried from the graph.
5. **Versioning.** `ASSET_KEY_VERSION` is part of the key. Changing normalization bumps the version and adds an alias from the old ID, instead of silently changing identities.

## Consequences

- No identity service, message broker, or Web-synchronous KG write is introduced.
- Two writers that normalize the same locator agree on the ID without coordination.
- `WebAsset` stays as is. Migration is additive and mapping is reported, not guessed (see plan phase 2).
- Changing the derivation or `ASSET_KEY_VERSION` is a breaking change to every stored `assetId` and must go through a new ADR.

## Alternatives considered

- **Runtime-issued random IDs reconciled into the catalog.** Rejected: two writers for the same asset would need a merge step before they can agree.
- **Neo4j as the identity authority.** Rejected: Web business ownership and scope bindings must live in the relational store that owns them.
- **Synchronous Web call before every KG write.** Rejected: observations must be recorded while the Web server is unavailable.

## Amendment: key version 2 (2026-10-20)

Version 1 joined fields with `:` and `\x1f`, so `(namespace="a:b", canonicalKey="c")` and
`(namespace="a", canonicalKey="b:c")` produced the same identity. Version 2 writes every field as
`<utf-8 byte length>:<value>` before hashing, in both `raptix_core.types.asset.asset_id` and
`assetIdFor` in the Web server, and `ASSET_KEY_VERSION` becomes 2. No version-1 identity reached a
persisted catalog outside development engagements, which were removed, so no identity migration is
needed. Future changes follow the same rule: bump the version and record the change here.

## Amendment: identity at the KG write boundary (2026-10-21)

Writers reached the graph by four paths: the legacy adapters (`knowledge/graph/ingest.py`), the
parser registry (`knowledge/ingest/parsers`, used by auto-ingest for subfinder, dnsx, ffuf, masscan
and gobuster), the agent tools (`kg_record`, `kg_ingest`), and the legacy graph shim
(`research/_state.py`). Only the first path stamped identity, so decision 2 was not met for the other
three. The rule now lives in `KGStore.record_observations`, the one entry point every writer uses:

- A Host or Entrypoint node without `asset_id` receives the identity of its locator: the key suffix
  first (`host::`, `entrypoint::`), then the `ip` or `url` property. A node whose locator does not
  resolve is written without identity and counted in the result as `unidentified`.
- Entrypoint keys, labels, `url` properties and edge targets that name an entrypoint are redacted with
  `redact_url` before the write. A key never keeps userinfo, a fragment or a sensitive query value.
- A node that already carries `asset_id` keeps it. Ingest stamps the same identity, so nothing changes
  for the adapters.
- The canonical rule is the one in `asset_identity.py` (IPv4 compressed; DNS names lowercase, without a
  trailing dot; origins with the default port explicit). The Web catalog mirrors it for WebAsset
  identifiers of kind `host` only (`catalogIdForWebAsset`); other kinds stay unlinked.

**Why:** decision 2 requires the runtime to write the identity onto every asset-bearing node, and the
registry and agent paths did not. **Alternative rejected:** refusing Host and Entrypoint from
`kg_record`. That loses agent observations, and the rule belongs in code, not in the agent's prompt.
**Consequence:** AD labels (AD_USER, AD_COMPUTER and the rest) stay outside the catalog until the
phase 7 mapping; the coverage matrix says so.
