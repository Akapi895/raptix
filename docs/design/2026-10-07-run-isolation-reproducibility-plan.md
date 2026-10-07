# Run Isolation & Reproducibility — Fix Plan

- **Date:** 2026-10-07
- **Status:** Proposed
- **Scope:** enforce run isolation (workspace, KG, images) and run
  reproducibility (clean baseline per run, auditable injections) with
  mechanism-level controls — env, code, daemon, entrypoint — never prompt-only.
- **Prereqs:** PR-A/B/C of the observability plan are landed (`d2c395b`,
  `d6f610d`, `3939ba0`). The observability plan's §I5 (record path) is closed.
- **Verification method:** every claim below was re-checked against the
  working tree on 2026-10-07 (file:line cites). Three items from the original
  incident report were **corrected** after verification — see §2 before
  implementing anything.

---

## 1. Verified current state (evidence, not the report's memory)

| ID | Claim | Verified state | Verdict |
|----|-------|----------------|---------|
| I1 | Workspace volume shared across runs | `docker-compose.yml:752-753` defines `workspace_data` but **zero services mount it** (dead config). Real mounts: `:274` (sandbox) and `:429` (langgraph) bind `${RAPTIX_ENGAGEMENT_WORKSPACE:-${RAPTIX_WORKSPACE_PATH:-...}}:/workspace`. Launcher **already scopes**: `apps/launcher/cmd/start.go:270` sets `RAPTIX_ENGAGEMENT_WORKSPACE` per engagement. Web runtime sends the **root**: `apps/web/.../useAgent.ts:775-776` (`RAPTIX_WORKSPACE_PATH ?? "/workspace"`). Harness passes a per-run container path via config (`lab_run.py:340`). | Partially fixed; two real gaps (web, dead volume) |
| I2 | Agent can read other labs via bash | `execution/tools/bash/bash.py:305-339` resolves workspace through `SandboxBase._normalize_workspace_path` (traversal-guarded) from: explicit arg → `RAPTIX_WORKSPACE_PATH` env (`:315`) → `RAPTIX_ENGAGEMENT` slug env (`:321`). **No fence** ties the chosen path to the current engagement: `/workspace/<other-lab>` is accepted, and root `/workspace` (shared tree) is the default cwd. Kernel lazily `mkdir -p`s any requested path (`execution/sandbox/kernel/tmux.py:462-472`). | Real — no enforcement |
| I3 | `RAPTIX_PER_ENGAGEMENT_SANDBOX` unimplemented | 0 code references; described in `docs/security/sandbox-isolation.md` only. | Docs-only; decide, don't half-implement |
| I4 | `chmod -R 777 /workspace` + `umask 0000` | `infra/containers/sandbox-entrypoint.sh:7-10`, runs **once at container start** (later-created engagement dirs are never chmod'ed — the loop is also ineffective for its stated goal). Containers run as root (no `user:` in compose for sandbox/langgraph, no `USER` in `sandbox.Dockerfile`); harness/launcher only **read** workspace files back via `docker cp`. | Real, and the 777 is wider than its purpose needs |
| I5 | Record path pinning / silent mkdir | **Closed by PR-A**: fail-fast pre-flight naming the env var + startup log + per-path sink registry. | No further work |
| E1 | KG keeps old labs' data between runs | `knowledge/graph/store.py:1-13,168-180` — KGStore is **engagement-scoped by construction**: every public method requires a valid `engagement` label; label resolves from state `kg_engagement`/`engagement_name` (`middleware/kg.py:145`). Reads cannot cross labels. Gap is (a) storage grows forever, (b) **no reset tooling** (only `delete_stale(engagement, before_unix)` bounded sweep, `store.py:546`). skillogy is a **read-only** MITRE/seed corpus in the Neo4j-backed skillogy container (`middleware/skillogy.py:61,187-382` — load/find/traverse only, no per-run writes; per-instance loaded-keys cache is in-memory). | Re-scoped — see §2 |
| E2 | Manifest records `repo_dirty` but nothing enforces | `tests/local/harnesses/lab_run.py` writes `repo_head`/`repo_dirty` into the manifest. Docker images carry **no revision label** (only `ARG VERSION` → `LABEL ...version` in `infra/containers/*.Dockerfile`), so "which code is in the image" is unverifiable post-hoc. | Real — make it enforced |
| E3 | Silentium needed 7 manual ad-hoc hints | Lab flow has exactly one structured injection: `--proceed-file` (standing-approval message, `lab_run.py:309-311`). Benchmarks already model this properly: `benchmarks/schemas.py` `context_mode: hinted|blind` + `init_prompt_hint` + flag-format hint. Labs have nothing equivalent. | Real — reuse the benchmark shape |
| E4 | "2/5 runs mất capture chính" | Root cause found: the container workspace dir `/workspace/<slug>` is created **lazily by the first bash tool call** (`tmux.py:462-472`); capture flows (`docker cp`) run at teardown and can even run **before** any bash call — when the dir doesn't exist, `docker cp` fails and the channel silently reports missing. Not a missing manifest field. | Re-diagnosed — see D2 |

---

## 2. Non-mechanical corrections (read before implementing)

The original item list contained four requests that verification **rejects or
re-scopes**. Implementing them as literally stated would add dead machinery or
destroy correct behavior:

1. **"Reset skillogy state lúc launch" is void.** skillogy holds a pinned,
   read-only skills corpus (MITRE ATT&CK + seed skills). It has no per-run
   state to reset; the only mutable bit is an in-memory loaded-keys set that
   dies with the agent process. Resetting it would either be a no-op or would
   wipe a shared corpus every run costs us nothing to keep. **Do nothing to
   skillogy.** What the report called "skillogy state" is actually KG
   engagement data — handled by D5.
2. **"KG giữ data lab cũ giữa các run" is not a read-leak.** KG reads are
   engagement-scoped at the store boundary (`store.py:_check_engagement`); a
   run with `engagement_name=lab-silentium-02` cannot read
   `lab-silentium-01`'s nodes. The real problems are (a) no way to **reset**
   an engagement's slice for a fresh run, and (b) unbounded growth. Fix is a
   scoped delete + opt-in reset (D5), **not** a graph-wide wipe (which would
   be a data-loss hazard for real engagements).
3. **"2/5 run mất capture" is a timing bug, not a manifest-field bug.** Adding
   manifest fields (the literal ask) would have documented the loss better
   without preventing it. The fix is an eager workspace ensure before turn 1
   (D2), which also removes the dependence on "first tool call happens to be
   bash".
4. **"Workspace riêng per run + prune tự động" needs a boundary.** Per-run
   *scoping* is already the launcher's mechanism; what's missing is
   enforcement for non-launcher entry points (D1/D2). "Prune tự động"
   (automatic deletion of old engagement dirs) is **rejected as automatic** —
   engagement workspaces are user data and the blast radius of an aggressive
   auto-prune includes real engagements sharing `$RAPTIX_HOME`. Prune ships as
   an explicit, opt-in command (D1c).

One dead-config item found while verifying I1: the `workspace_data` volume is
referenced by no service (compose `:752-753`) — remove it (part of PR-D) so
nobody re-attaches a shared root by accident.

---

## 3. Design decisions

Each decision names its **enforcement layer**. Prompt text changes are
permitted only as documentation of an enforced behavior, never as the control.

### D1 — Workspace isolation: scope every entry point (env + compose)

**Mechanism, not prompt.** Three entry points, one rule: the container's
`/workspace` is either the engagement dir or fenced to it.

- **Launcher** — already correct (`start.go:270`). No change.
- **Web/desktop path:** `useAgent.ts:775-776` sends the workspace **root**.
  Change the server/web contract so the effective `workspace_path` for a run
  is `<runtime workspace>/<engagement slug>` once `engagement_ready` delivers
  the slug (the slug already travels independently — `useAgent.ts:334`).
  Files: `apps/web/.../useAgent.ts`, the web contracts package
  (`@raptix/web-contracts` consumer), and wherever `configurable.workspace_path`
  is re-derived server-side. The web app must never send a bare `/workspace`
  as a run's workspace once an engagement slug is known.
- **Compose cleanup:** remove the dead `workspace_data` volume block
  (`docker-compose.yml:752-753`).

**Prune (explicit):** add `tests/local/harnesses`-adjacent operator command —
`lab_run.py --prune-old N` deletes the N-oldest `lab-*` dirs under the runtime
workspace **after** a successful capture, printing what it deletes; default off.
Never wired into any automatic path.

### D2 — Cross-engagement fence + eager workspace ensure (code + daemon)

**The fence (bash tool, hard error):** when `RAPTIX_ENGAGEMENT` is set in the
agent container, `bash` and every sandbox-path-taking tool must reject a
resolved workspace outside `/workspace/<RAPTIX_ENGAGEMENT>/` with an actionable
error ("workspace <path> is outside engagement <slug>; pass a path under
/workspace/<slug>/"). Implementation point: the resolution chain at
`bash.py:305-339` — after `SandboxBase._normalize_workspace_path`, compare the
result against the engagement prefix. This is env-based enforcement: the
launcher already sets engagement env; PR-D adds `RAPTIX_ENGAGEMENT` to the
sandbox/langgraph services' environment in compose (from the same var the
launcher exports) and the harness passes it per run. When the env is unset
(legacy/dev), behavior is unchanged — the fence appears exactly when an
engagement is known.

**Eager ensure (daemon + harness):** add `POST /workspace/ensure` to the
sandbox daemon (`execution/sandbox/daemon.py`): body `{"path": ...}`, same
`_normalize_workspace_path` guard, `mkdir -p`, idempotent, fenced by D2's rule
when `RAPTIX_ENGAGEMENT` is set. `lab_run.py` calls it in pre-flight right
after the `/ok` probe (extends PR-C's `_probe_api`), so `/workspace/<slug>`
exists before turn 1 regardless of which tool fires first. This removes the
"capture-before-first-bash" failure mode (§1 E4).

**tmux lazy mkdir stays** as a belt-and-suspenders fallback; it is no longer
load-bearing.

### D3 — Entrypoint permissions: read access without world-write (entrypoint)

`chmod -R 777 /workspace` exists so the host user can read findings without
sudo. Host tooling only **reads**; therefore:

- Replace `umask 0000` with `umask 022` (world-readable, group/other write off).
- Replace the recursive loop with a single `chmod` on the mount root at start
  (the `-R` pass is both over-broad on shared roots and useless for
  later-created dirs — §1 I4).
- Update the entrypoint comment to state the real invariant: *container
  boundary + world-readable bind mount; host never needs write into a live
  engagement*.

Guardrail note: `sandbox-entrypoint.sh` is listed under container hardening;
this change **tightens** it (777 → 022), which is the allowed direction, and
still gets a line in the PR referencing this plan.

### D4 — `RAPTIX_PER_ENGAGEMENT_SANDBOX`: correct the docs, don't implement (docs)

The var has no code path. Implementing per-engagement sandbox containers now
would duplicate the mount-scoping mechanism (D1) behind a second flag with
real resource cost. Decision: rewrite the `docs/security/sandbox-isolation.md`
section to state (a) isolation today = engagement-scoped bind mount (launcher)
+ env fence (D2) + scoped KG (D5); (b) per-engagement sandbox containers are a
future design, intentionally not implemented; (c) the env var name is
reserved but currently a no-op — or drop the name entirely if the doc rewrite
reads cleaner without it. The PR picks one and deletes the other; no
half-state.

### D5 — KG: engagement-scoped reset, opt-in (store + CLI + harness)

- **Store:** add `delete_engagement(*, engagement: str) -> int` to `KGStore`
  (`knowledge/graph/store.py`): engagement-scoped `MATCH (n {engagement: $e})
  DETACH DELETE n` in bounded sweeps (reuse the `delete_stale` LIMIT/loop
  pattern, `store.py:546`), returning nodes deleted. Scoped exactly like every
  other method — no graph-wide wipe API is added.
- **CLI:** `raptix kg reset --engagement <slug> --yes` (new subcommand in
  `packages/raptix/raptix/cli/`), which only calls `delete_engagement`.
  Operator-invoked; refuses without `--yes`; never called automatically at
  agent startup (an automatic reset on launch is a real-engagement data-loss
  hazard — rejected).
- **Harness:** `lab_run.py --fresh-kg` runs the equivalent reset in pre-flight
  (via the CLI module import, not subprocess), reporting `kg_reset: ok|failed`
  in `summary`/manifest. Default off: reruns of the same engagement slug
  intentionally start from a clean graph only when asked.
- **skillogy:** untouched (read-only corpus — §2.1).

### D6 — Image provenance: label at build, enforce at run (Dockerfile + harness)

- **Dockerfiles:** add to `langgraph.Dockerfile` and `sandbox.Dockerfile`
  (the two images whose behavior defines a run):
  `ARG RAPTIX_REPO_HEAD=` + `LABEL org.opencontainers.image.revision="${RAPTIX_REPO_HEAD}"`.
  Build scripts (`Makefile` image targets, release workflow) pass
  `--build-arg RAPTIX_REPO_HEAD=$(git rev-parse HEAD)`; same `ARG VERSION`
  pattern as `cli.Dockerfile:10`.
- **Enforcement:** `lab_run.py` pre-flight (extends PR-C) inspects both images:
  `docker image inspect --format '{{index .Config.Labels
  "org.opencontainers.image.revision"}}'` vs current `git rev-parse HEAD`.
  Mismatch or missing label → **refuse to run** with the rebuild command in
  the message. `--allow-dirty` (explicit) downgrades to a loud warning +
  manifest record. `repo_dirty` stays recorded; the *default* becomes
  enforced, with the escape hatch explicit — a harness for evidence runs
  should fail closed, and the dev loop uses `--allow-dirty` knowingly.

### D7 — Injection protocol: one auditable file (harness)

Reuse the benchmark shape (`benchmarks/schemas.py` `context_mode`,
`init_prompt_hint`) for the lab flow:

- `input/protocol.jsonl` — one record per operator injection:
  `{"turn": <int>, "kind": "hint"|"interference"|"proceed", "text": str,
  "source": str}`. `turn: 0` = appended to the kickoff; `turn: N>0` = delivered
  as an interruption/proceed message before turn N+1; `kind: proceed` with
  `turn: -1` = the standing-approval message (exact current `--proceed-file`
  semantics).
- `lab_run.py` gains `--protocol-file` (JSONL); `--proceed-file` is kept and
  normalized into a single `kind: proceed, turn: -1` record so old invocations
  keep working and land in the same accounting.
- The harness applies records deterministically, **refuses** duplicate turns
  or unknown kinds, and reports `injections: {hint: n, interference: n,
  proceed: n}` in `summary` + manifest. The protocol file itself is the audit
  record — copied into the run dir like the other inputs.

---

## 4. PR staging (one concern each, in order)

### PR-D — Workspace isolation mechanics (D1 + D2 + D3 + compose cleanup)
Files: `execution/tools/bash/bash.py` (fence), `execution/sandbox/daemon.py`
(ensure endpoint), `execution/sandbox/kernel/tmux.py` (comment only),
`infra/containers/sandbox-entrypoint.sh` (umask 022, single chmod),
`docker-compose.yml` (env + drop dead volume), `apps/web/.../useAgent.ts`
(+ web contracts), `tests/local/harnesses/lab_run.py` (pre-flight ensure call),
`docs/security/sandbox-isolation.md` (D4 rewrite).
Tests: fence unit tests (inside/outside/unset-env), daemon ensure (happy +
traversal + idempotent), web contract test, entrypoint lint. Boundary rule:
no guardrail weakens — the fence is additive.

### PR-E — KG scoped reset (D5)
Files: `knowledge/graph/store.py` (`delete_engagement`), new CLI subcommand,
`tests/local/harnesses/lab_run.py` (`--fresh-kg`), tests (scoped delete only
touches the named engagement; CLI refuses without `--yes`; harness manifest
fields).

### PR-F — Image provenance enforcement (D6)
Files: `infra/containers/langgraph.Dockerfile`, `infra/containers/sandbox.Dockerfile`,
Makefile/release build args, `tests/local/harnesses/lab_run.py` (inspect +
refuse/`--allow-dirty`), tests (label present → match ok; missing → refuse;
`--allow-dirty` warns).

### PR-G — Injection protocol accounting (D7)
Files: `tests/local/harnesses/lab_run.py` (`--protocol-file`, summary counts),
tests (apply at turns, duplicate-turn refusal, legacy `--proceed-file`
normalization, summary counters).

Each PR: ≤400 behavior LOC target, its own tests, CHANGELOG entry where
user-facing (`kg reset`).

---

## 5. Acceptance criteria (whole initiative)

1. With `RAPTIX_ENGAGEMENT` set, a bash `workspace` arg resolving outside the
   engagement prefix errors before any command runs (unit-provable, not
   prompt-dependent).
2. A harness run's `/workspace/<slug>` exists before turn 1 (daemon ensure),
   and `docker cp` capture cannot fail for "dir missing" again.
3. `sandbox-entrypoint.sh` creates no world-writable path (`umask 022`); host
   user can still read captured workspaces.
4. `raptix kg reset --engagement X --yes` leaves other engagements' nodes
   untouched (test with two labels populated).
5. A lab run with images whose revision label ≠ HEAD refuses to start without
   `--allow-dirty`; manifest carries both revisions.
6. Every operator injection in a lab run appears in exactly one place:
   `input/protocol.jsonl`, counted in the summary.
7. No code references `RAPTIX_PER_ENGAGEMENT_SANDBOX` remain ambiguous: the
   doc says exactly what isolation is and isn't.
8. `workspace_data` volume no longer exists in compose.

---

## 6. Out of scope (explicit)

- Per-engagement sandbox **containers** (D4 records it as future design).
- Automatic prune of old engagement workspaces (explicit operator command
  only, D1).
- Graph-wide KG wipe or startup-time automatic KG reset (D5 is scoped +
  opt-in).
- Any change to `events.jsonl` content policy or telemetry redaction (governed
  by the observability plan).
- Benchmarks (`benchmarks/`) injection plumbing — `context_mode` already
  exists there; PR-G only aligns the *lab* flow with it.
