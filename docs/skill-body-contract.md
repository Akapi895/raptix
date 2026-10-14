# SKILL.md Body Contract (Phase 1.5 proposal)

## Status

**Proposal — not yet CI-enforced.** `docs/skill-schema.md` (Phase 0) covers
only the YAML frontmatter; `docs/skill-cleanup-process.md` explicitly
deferred the body — "body rewrites are out of scope for Phase 0" — and
the "Body audit flags" log in `docs/skill-cleanup-progress.md` has been
empty since Phase 0 closed. This document fills that gap: it crystallizes
the section skeleton already used, inconsistently, by the corpus's
deepest skills, so future authoring and the eventual Phase 1.5 cleanup
batch have one contract to check against instead of each author
reinventing the shape.

**Calibration note (2026-10-14):** the section skeleton below was
revised after running it against a real pilot batch — the full
`standard/wireless/*` subdomain (8 files) — against the version first
drafted from only 2 sample files. Three things changed as a result
(heading-label flexibility, the RoE-gate callout, the `## ZFP` section);
see `docs/skill-body-audit-progress.md` for the batch log. Treat this
contract as still evidence-correctable: the next batch may surface
another pattern this one hasn't seen yet.

## Why a body contract, and why not just copy Claude-Red's

`claude-red`'s `CONTRIBUTING.md` defines a body template (Quick Workflow
→ technique clusters → Detection/Defender View → Engagement Cheatsheet →
Key References) written for a **human operator** reading Claude's output
inside a conversation. Raptix skills are read by an **autonomous agent**
that turns them directly into `bash` calls — see the comparative analysis
at `../comparative-analysis-skills-raptix-vs-claude-red.md` (F1, F6) for
the full argument. This contract keeps Claude-Red's section-skeleton idea
where it transfers, and keeps the **directive voice** the corpus's best
skills already use (`standard/exploit/web/sqli`, `standard/wireless/wpa2-psk`,
`standard/iot/ble-gatt`) instead of adopting a second-person conversational
voice that doesn't fit an agent audience.

## Three skill shapes — the contract below applies to only one of them

Checked against `standard/{wireless,dfir,osint,ics,supply-chain}/*`
(2026-10-14): the corpus has (at least) three distinct skill shapes, not
one. Applying the section skeleton below to the wrong shape produces
false findings.

1. **Deep technique skill** — one attack/technique, full depth, commands.
   The skeleton below is for this shape. Examples: `wpa2-psk`,
   `exploit/web/sqli`, `iot/ble-gatt`.
2. **Router overview** — an index that points to real child skill files
   (`standard/wireless/SKILL.md` → `wpa2-psk/SKILL.md` etc.). No
   Prerequisites/Phase/Evidence of its own; a routing/decision-tree
   section instead. Already covered by the "omit Prerequisites for
   overview skills" note below.
3. **Inline catalog** — a *third* shape, distinct from both: one file
   listing many techniques in a table, explicitly **not** meant to have
   per-technique child files (`standard/{dfir,osint,ics,supply-chain}/SKILL.md`
   all state this directly: "inline technique reference... Do NOT call
   the skill loader on them"). No Prerequisites/Phase/Evidence/ZFP/OPSEC
   section structure applies — don't flag a catalog for "missing"
   sections the shape doesn't use.

**The one real check a catalog needs:** its "not separately loadable"
claim can go stale. A catalog's table entry can start out correctly
inline-only, then a later PR adds a genuine deep skill for that same
technique elsewhere in the corpus — in the *same* canonical subdomain
(so the catalog's own consuming role would actually see it), leaving
the catalog's blanket disclaimer wrong for that one row. Found and fixed
twice on first check: `standard/ics/SKILL.md` (5 of 8 rows had a real
match in `standard/exploit/ics-ot/*`, same `ics-ot` subdomain as the
`ics_operator` role) and `standard/supply-chain/SKILL.md` (1 of 8 rows
matched `standard/exploit/supplychain/dep-confusion`, same `supply-chain`
subdomain as `supply_chain_operator`). How to check: read the role's
subdomain in `packages/raptix/raptix/middleware/skillogy.py`'s role dict,
then grep the whole corpus's `name:`/`when_to_use` fields for each
catalog row's technique name, filtered to files in that same canonical
subdomain (after alias resolution) — a hit in a *different* subdomain
the role doesn't see (e.g. `dfir`'s "yara-scan" vs `reverser`'s
`yara-hunting`) is not a false disclaimer, the role genuinely can't load
it.

## Required section skeleton (deep technique skills only — see above)

1. **Title + framing blockquote** — `# <Short Skill Title>` then a `>`
   blockquote: why this technique, what's distinct, and a cross-reference
   to a sibling skill if scope overlaps. Pattern reference:
   `standard/wireless/SKILL.md`'s BLE/Bluetooth-Classic/Zigbee pointer.
2. **`## Prerequisites`** — tools, access, hardware. Omit only for pure
   routing/overview skills (`*-overview` / index files). Checked against
   the full `standard/wireless/*` batch (2026-10-14): 7 of 8 files had
   it; `krack-fragattacks` was missing it and was fixed in that pass —
   this is a real, worth-checking gap, not a hypothetical one.
3. **One clearly delineated section per technique cluster**, ordered by
   escalation, with concrete copy-paste commands in language-tagged code
   blocks — not prose description of what a tool does. The **heading
   label is not fixed** — use whichever the content's actual shape calls
   for, matching existing corpus usage:
   - `## Phase N: <name>` — a sequential procedure with distinct stages
     (`standard/iot/ble-gatt`, `standard/iot/bluetooth-classic`).
   - `## Step N — <name>` — a sequential procedure, same intent,
     different house style in `standard/wireless/*`
     (`wps-pixie-dust`, `evil-twin-karma`, `deauth-pmf`).
   - `## Path A/B/C — <name>` — **mutually exclusive** branches chosen by
     target state, not sequential (`wpa2-psk`'s PMKID-vs-handshake
     paths, `wpa3-sae`'s four downgrade paths).
   - A bare named section per technique/CVE family, no numbering, when
     the clusters aren't ordered or branched at all
     (`krack-fragattacks`'s "KRACK Family" / "FragAttacks Family").
   Don't force a skill's natural shape into the wrong label.
4. **Decision-rule callouts**, where they exist — **two distinct kinds,
   both real and both worth keeping separate:**
   - **Technical escalation/decision rules** — "once X is confirmed, do
     Y next," as an explicit table or a **Hard rule** / **MANDATORY**
     callout. Canonical examples: `standard/exploit/web/sqli`'s
     "Manual-vs-Tool Decision Rule" table; `standard/wireless/deauth-pmf`'s
     PMF-state decision table.
   - **RoE/authorization gate callouts** — a `HARD STOP:` block stating
     exactly which `plan/roe.json` `permitted_actions` / `posture` value
     a specific action requires before it may run. This is the *more*
     common pattern of the two in practice (5 of 7 content skills in the
     `standard/wireless/*` batch have one; only some have a technical
     decision table). Canonical examples:
     `wpa-enterprise-eap`'s "## RoE gate", `wps-pixie-dust`'s and
     `deauth-pmf`'s "RoE gate for \<action\>" callouts.
5. **`## Evidence`** — where artifacts persist
   (`/workspace/evidence/<skill>/...`), **then (when the finding needs
   proof beyond the raw evidence) a `## ZFP` section** listing the
   specific 2+ pieces of evidence that distinguish a confirmed finding
   from a false positive (e.g. `wpa2-psk`'s "the .hc22000 file" +
   "a `hashcat --show` line proving the PSK matches the hash" — every
   `standard/wireless/*` content skill has one). The write-target inside
   Evidence has **two real sub-patterns depending on the consuming
   role's tool grant**, not one — check which applies, don't default to
   either:
   - Role has a direct KG write tool: a literal `kg_record(...)` Python
     call (`standard/iot/ble-gatt`, `standard/iot/bluetooth-classic`).
   - Role has **no** KG write tool (writes go through the orchestrator):
     a plain pipe-delimited "findings record" block, with the skill
     stating that constraint explicitly — the exact phrasing "your role
     has no KG write tool — the orchestrator owns graph writes" repeats
     verbatim across every `standard/wireless/*` skill and is worth
     reusing rather than re-wording per skill.
6. **`## OPSEC Notes`** (capitalization varies by subdomain in practice —
   `standard/iot/*` capitalizes "Notes", `standard/wireless/*` doesn't;
   harmless, not worth a corpus-wide pass on its own) — what's loud,
   what's logged, what to do about it. Cross-reference `shared/opsec` /
   `shared/stealth-infra` / `shared/defense-evasion`; don't restate their
   content per skill.
7. **`## References`** — CVE/MITRE IDs, upstream tool docs, canonical
   research, **and cross-references to sibling skills this one hands off
   to or receives from** (every `standard/wireless/*` skill does this —
   e.g. `wpa3-sae` references `wpa2-psk`, `evil-twin-karma`, and
   `deauth-pmf` by name). Complements, never duplicates,
   `metadata.mitre_attack`: that field is the machine-readable claim,
   this section is the human-readable citation for it.

## Length guidance

No fixed line-count target (unlike Claude-Red's 200–800 lines), because
`standard/surface_exploit/*` bounded-cell skills are legitimately 14–15
lines by design (see ADR-0019, ADR-0022, ADR-0023, ADR-0025, ADR-0026).
Instead: a skill under ~20 lines with no `## Phase` section **must** name
the deeper skill it delegates to (the pattern every `surface_exploit/*`
file already follows). An unexplained stub that isn't a documented
delegation is a body-audit flag, not a style choice.

## What NOT to port from Claude-Red

- **Second-person conversational voice.** Raptix skills are instructions
  the agent executes, not reference text an operator reads before typing
  a command. Keep the imperative/"HARD RULE" voice already in use.
- **A per-skill "Detection / Defender View" section as a universal
  requirement.** Raptix centralizes detection-evasion guidance in
  `shared/opsec`, `shared/stealth-infra`, `shared/defense-evasion`
  specifically to avoid restating it across 300+ files. Cross-reference
  those three, don't inline a Defender View per technique skill.
- **The 200–800 line target as a hard rule.** See Length guidance above.

## Adoption path

Additive to Phase 0, not a replacement. Recommended rollout: the same
batched, sub-agent-per-subdomain review process already documented in
`docs/skill-cleanup-process.md`, scoped to body-only changes. Progress is
tracked in `docs/skill-body-audit-progress.md` (first batch —
`standard/wireless/` — done 2026-10-14). Pick any subdomain next; there's
no dependency ordering between batches.
