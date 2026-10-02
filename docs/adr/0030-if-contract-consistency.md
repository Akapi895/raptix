# 0030. IF contract consistency (Step 3 of control-plane fixes)

- **Status:** Accepted
- **Date:** 2026-10-02
- **Deciders:** @PurpleCHOIms
- **Related:** [ARCHITECTURE_AUDIT.md](../../ARCHITECTURE_AUDIT.md), [ARCHITECTURE_AUDIT_FIX.md](../../ARCHITECTURE_AUDIT_FIX.md), [ADR-0027](0027-baseline-freeze-for-control-plane-fixes.md), [ADR-0028](0028-typed-dispatch-failure-outcome.md), [ADR-0029](0029-kg-freshness-refresh.md)

## Context

The architecture audit identified P1-5: the recon→exploit
classification handoff is governed by three artifacts — the orchestrator
prompt (`decepticon.md`), the worker prompts (`exploit.md`,
`postexploit.md`, …), and the skill ACL in
`skills_sources_for()` — and those artifacts had drifted apart. The
contract violations, each producing tool-not-found bounces or wasted
coordination turns at runtime:

1. **Router outside the orchestrator's ACL.** `decepticon.md` §
   "Recon → Exploit escalation" instructs the orchestrator to
   `load_skill("/skills/standard/exploit/<domain>/SKILL.md")`, but
   `skills_sources_for("decepticon")` returned only
   `/skills/standard/decepticon/` + `/skills/shared/`. Every exploit
   router load the orchestrator was told to perform would fail ACL
   resolution.
2. **Dead startup path.** `decepticon.md` final-report section cited
   `/skills/standard/raptix/final-report/SKILL.md` — no such tree has
   ever existed on disk (the orchestrator's tree is `standard/decepticon/`).
3. **Worker instructed to update OPPLAN.** `exploit.md` handoff
   protocol included "Update OPPLAN status" — but `SLOTS_PER_ROLE`
   gives `MiddlewareSlot.OPPLAN` to the orchestrator only, so the
   exploit worker has no `update_objective` tool. The instruction can
   only produce a tool-not-found bounce. The same class appeared inside
   the self-rotation rule (`add_objective(...)`), where the worker was
   told to dispatch a focused recon turn — workers hold neither OPPLAN
   tools nor `task()` dispatch.
4. **Role ↔ skill-directory divergence.** `skills_sources_for` built
   `/skills/standard/{role}/` verbatim, but two roles' on-disk
   directories use different names (`postexploit` → `post-exploit`,
   `cloud_hunter` → `cloud`) and one role has no dedicated tree at all
   (`blue_cell`). Each emitted a dead ACL path; `cloud_hunter` could
   not load the cloud skills its own tool registration (`cve_lookup` ←
   `container-cve`) depends on.
5. **Orphaned shared skill.** Both `exploit.md` and `postexploit.md`
   cite `/skills/shared/defense-evasion/SKILL.md` before payload
   delivery, but that directory contained only `references/` — no
   `SKILL.md` entry point, so `load_skill` on the cited path failed.

The follow-up review (`ARCHITECTURE_AUDIT_FIX.md` §3) fixed the pass
condition:

> "Static check skill/tool refs + replay một recon→exploit handoff →
> Không còn skill/tool path invalid; không tăng số coordination turns."

And the regression principle: horizontal tightening is allowed for
*when a usable foothold may be claimed* and *when propagation starts*,
but the exploit worker's freedom to self-rotate **inside** the IF loop
must not be reduced. This step changes only *who* is allowed to perform
an action (dispatch/OPPLAN = orchestrator), never *what the worker may
infer* inside its own loop.

## Decision

Four changes plus a static contract test suite:

### 1. Role → skill-directory mapping in `skills_sources_for`

A `skill_dir_for_role` mapping now wins over the verbatim role name
when they diverge: `postexploit` → `post-exploit`,
`cloud_hunter` → `cloud`. Roles with no dedicated standard tree
(`blue_cell`) emit the shared tree only instead of a dead
`/skills/standard/blue_cell/` path. Adding a divergence is now a
mapping entry, not a rename.

### 2. Exploit router tree appended to the orchestrator ACL

`skills_sources_for("decepticon")` appends `/skills/standard/exploit/`
after the role's own tree. Append (not replace) keeps the
orchestrator's own skills primary; the exploit tree is read-mostly for
the orchestrator (router Decision Flows), while sub-skill execution
stays with the exploit worker.

### 3. Worker prompts own no OPPLAN actions

- `exploit.md` handoff protocol: removed "Update OPPLAN status";
  OPPLAN status updates are the orchestrator's responsibility.
- `exploit.md` self-rotation rule: the
  `add_objective(...)` dispatch branch now closes the dispatch with
  `exploit/EXIT_REPORT.md` naming the untested angles, so the
  **orchestrator** dispatches the focused recon turn. The worker's
  in-loop rotation freedom (re-load the domain router, pick an
  alternative sub-skill) is unchanged.

### 4. `defense-evasion/SKILL.md` restored

The shared skill directory contained orphaned `references/` (whose own
header says "Supplements `defense-evasion/SKILL.md`") with no entry
point. A minimal router `SKILL.md` (frontmatter per the house
convention, reference index, RoE gate note) restores the cited path.

### 5. Static contract tests (`test_if_contract_static.py`)

The pass condition is pinned statically — no agent construction:

- every fallback `skills_sources_for(role)` path resolves to a real
  directory under `skills/defs/` (the fallback-reliant roles are
  *derived* from the factories, so a new role with a dead ACL path
  cannot slip past),
- the orchestrator ACL includes the exploit tree and the divergences
  map correctly,
- every concrete `/skills/.../*.md` path cited in any prompt exists on
  disk **and** sits inside that role's ACL,
- worker prompts never instruct OPPLAN tool calls (regex built from
  `OPPLAN_TOOL_NAMES`, so new tools are covered automatically).

## Consequences

- **Easier:** orchestrator→exploit router loads now resolve; exploit
  and postexploit workers no longer receive instructions whose tools
  they do not hold; `load_skill` on every prompt-cited path succeeds.
- **Easier:** the contract is enforced by tests, not convention.
  Drift between prompts, ACL, and the skills tree fails CI instead of
  surfacing as runtime coordination bounces.
- **Neutral:** no change to the exploit worker's in-loop freedom —
  sub-skill selection, router-guided self-rotation, and pivot rules
  are untouched. Only cross-boundary actions (dispatch, OPPLAN) moved
  to their rightful owner.
- **Harder:** new roles must either match their on-disk skill
  directory name or add a `skill_dir_for_role` entry — the static
  test fails otherwise. This is the intended guard.
- **Migration:** none. Skill paths already cited in delegation prompts
  become resolvable; no persisted state changes.

## Alternatives considered

- **Rename the roles or directories** (`postexploit` → `post-exploit`)
  to remove the divergence. Rejected: touches graph registry, agent
  factories, OPPLAN phase routing, and downstream consumers for a
  cosmetic win; the mapping is a one-line fix.
- **Give workers OPPLAN tools instead of editing prompts.** Rejected:
  violates the orchestration boundary — `OPPLANMiddleware` is
  deliberately orchestrator-only (`SLOTS_PER_ROLE`); granting workers
  write access to plan state re-opens the strategic-loop problem the
  audit records under P1-6.
- **Grant every role the full skill tree** instead of targeted
  cross-role appends. Rejected: the ACL is also a prompt-injection
  containment boundary — widening it wholesale would let any worker
  load any playbook, defeating per-role scoping.
- **Point the prompts at the orphan references directly**
  (`references/amsi-bypass-techniques.md`) instead of restoring a
  `SKILL.md`. Rejected: the cited path is the skill entry point; a
  router that indexes its references matches the house skill shape
  and keeps prompts stable.
