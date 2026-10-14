# 33: Standalone evidence inspector

**What to build:** Migrate both evidence route aliases to a typed inspector showing metadata, producer links and simulated capture integrity.
**Blocked by:** 32b.
**Status:** resolved
**Owner:** Evidence inspector/read/download policy; sequenced after shared findings-source migration.
**Contract:** [execution.md](../execution.md).

- [x] Finding/asset/session/analysis evidence links open the same scoped record; legacy source links remain supported.
- [x] Missing/cross-project evidence reveals no content; switching scope requires access and an explicit prompt.
- [x] Sensitive display/download gates are enforced independently of the link's originating screen.
- [x] Simulated hashes describe retained-capture integrity, not proof of findings; both route aliases and producer references are verified.

## Evidence

- **Handlers** (`src/features/findings/service.ts`, ticket-33 section): `listEvidence` (scope semantics mirror the findings list — a non-member's specific-project read is `not-found` with no existence leak, `'all'` folds in accessible projects only; masking is the handler's decision and a masked row's search haystack excludes the withheld name so a query can never unmask it) and `getEvidence` (refusal order mirrors the finding detail: missing/out-of-scope → `not-found` indistinguishable from a missing record, accessible project outside the active context → `forbidden` with `entity.projectId` and no content). Producer lineage (`EvidenceProducer`) is resolved from real record links — the capture's `opId`, the step that carries the reference (`Step.evidence`), the tool event that recorded it (`ToolEvent.evidence` → invocation/producer) and the op+agent session — never by parsing the display source string. `CaptureIntegrity` (from `src/domain/evidence.ts`) carries a deterministic simulated digest per capture; the read returns `canViewSensitive`/`canViewOriginal` (the simulated unmask additionally needs a role above Analyst) so display/download gates are handler decisions identical whichever screen linked the capture.
- **Query binding** (`src/features/findings/query.ts`): `evidenceKeys` (`['evidence', scope, 'list', query]` / `['evidence', scope, id]`), `EvidenceReadError`, `useEvidenceList`/`useEvidenceDetail` with per-request actor/project/corr and superseded-scope cancellation. Keys are invalidated by `evidence` ChangeSets — an evidence attach/upload (ticket 32's handlers) refetches the inspector without a reload.
- **Screen** (`src/screens/e-findings.tsx`): `EvidenceList` reads `useEvidenceList` (scoped rows, type options from the read, opaque refs in every row, masked name for low-privilege roles, loading/error/empty states) and `EvidenceInspector` reads `useEvidenceDetail` (both `evidence` and `evidence-inspector` aliases render the same typed read; metadata, producer links, chain of custody and integrity render from the read; the forbidden state offers an explicit, access-checked switch; the masked view withholds the name, masks content and disables download; the integrity line states the hash "describes the retained capture — not proof that any finding is true"). The screen-side `source.split(' / ')` parsing and `fakeHash` are gone. Ticket 54's noted gap — `EvidenceList` reading the store's evidence collection — is closed.
- **Tests** (15 new in `src/features/findings/evidence.test.tsx`): list renders opaque refs with masked names (and never leaks a withheld name through search), not-found indistinguishability (missing vs non-member), cross-project refusal + explicit switch, both route aliases with producer links (op/step/agent/session), ChangeSet-driven refetch after `attachEvidence`, non-member list error without content; handler tests for masking/gates (`canViewSensitive`/`canViewOriginal` per role), producer lineage, integrity determinism and the no-exploitability copy.
- **Verification:** `npm run typecheck` clean (0 new), `npm run lint` 217 warnings / 0 errors (baseline 218 — one fewer from a removed unused import), `npm test -- --run` 432/432 (417 baseline + 15 new), `npm run build` green.
- **Budget:** ~301 net runtime lines (service 165, query 58, screen net +78); 4 files touched; one concern.

## Gaps

- Browser walkthrough of the real app route not performed (process-safety rule: preview HTTP check is optional; skipped and recorded as a gap). Route-level behavior is covered by the mounted-route tests above.
