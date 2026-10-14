# SKILL.md Body Audit Progress — Phase 1.5

Tracks the batched body review against `docs/skill-body-contract.md`,
mirroring the Phase 0 process in `docs/skill-cleanup-process.md` but
scoped to body content instead of frontmatter. One row per subdomain
batch.

| Subdomain batch | Files | Findings | Fixes applied | Status |
|---|---:|---|---|---|
| `standard/wireless/` | 8 | (1) `krack-fragattacks` missing `## Prerequisites`. (2) Contract itself needed 3 corrections after reading the real files — see below. No other structural gaps; all 8 files already follow Evidence → ZFP → OPSEC → References consistently. | Added `## Prerequisites` to `krack-fragattacks/SKILL.md`. Revised `docs/skill-body-contract.md` to stop mandating a single `## Phase N` heading label (corpus actually uses `Phase`/`Step`/`Path`/bare-name depending on content shape), to document the "RoE gate / HARD STOP" callout as its own required pattern (more common in this batch than the technical decision-rule table the contract previously treated as the only kind), and to add the `## ZFP` section (present in all 8 files, absent from the first contract draft). | **DONE** |
| `standard/{dfir,osint,ics,supply-chain}/` (top-level catalogs) | 4 | Discovered a **third skill shape** — "inline catalog" (one file, many techniques in a table, explicitly not meant to have child files). The 7-section skeleton doesn't apply to this shape at all. Within the shape, found the real, checkable failure mode: a catalog's "not separately loadable" claim going stale once a deep skill for that technique is later added elsewhere **in the same role-visible subdomain**. `ics` catalog: 5/8 rows stale (real matches in `exploit/ics-ot/*`, confirmed same `ics-ot` subdomain as the `ics_operator` role via `skillogy.py`). `supply-chain` catalog: 1/8 rows stale (`exploit/supplychain/dep-confusion`, confirmed same `supply-chain` subdomain as `supply_chain_operator`). `dfir` and `osint` catalogs: checked, no stale rows — a tempting `dfir`-vs-`reverser`/`analyst` yara-hunting match turned out to be a different, role-invisible subdomain, so the catalog's claim is correct for that role. | Added a "Deeper skill" column to the `ics` and `supply-chain` tables, marking the 6 stale rows with the real path. Left `dfir`/`osint` untouched (nothing to fix). Added the "Three skill shapes" section + the subdomain-matching check method to `docs/skill-body-contract.md`. | **DONE** |

## How to read the "Findings" column

A body-audit batch's job is **not** to force existing good content into
an under-evidenced template — it's to find (a) real structural gaps in
the files, and (b) places where the contract itself doesn't match the
corpus's actual, consistent conventions. The wireless batch found far
more of (b) than (a): 7 of 8 files were already well-structured, and
the contract was the thing that needed correcting. Expect this ratio to
shift as later batches cover subdomains written by different authors —
don't assume every batch will be this clean.

## Next batch

Not yet scheduled. Pick the next subdomain per the same process as
`docs/skill-cleanup-process.md` (`/agent skill-cleanup-batch
subdomain=<name>`, scoped to body-only this time) whenever someone wants
to continue — there's no dependency ordering between subdomain batches.
