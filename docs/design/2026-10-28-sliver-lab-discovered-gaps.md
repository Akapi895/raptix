# Sliver lab walkthrough surfaced two C2 product gaps

- **Date:** 2026-10-28
- **Status:** Recorded — follow-up candidates, no decision made here.
- **Evidence:** `benchmarks/target-lab/httpd-2.4.49/README.md` (disposable lab;
  both gaps reproduced live on the real stack).

## Gap 1 — `ops_start("c2-sliver")` never delivers the operator config the skill reads

The `c2-sliver` entrypoint writes the auto-generated operator config to
`/workspace/.sliver-configs/decepticon.cfg` *inside the C2 container*
(`infra/containers/c2-sliver-entrypoint.sh:9-10,38-43`). The production
compose gives the `c2-sliver` service no workspace mount
(`docker-compose.yml` — only `sliver_data:/home/sliver/.sliver`), and
opscontrol spawns the workload with labels only
(`apps/launcher/internal/opscontrol/docker_compose_backend.go:85-113`), so
the file never reaches the shared workspace.

Meanwhile every consumer expects it in the sandbox at
`/workspace/.sliver-configs/raptix.cfg`
(`packages/raptix-skills/raptix_skills/defs/standard/post-exploit/c2-sliver/SKILL.md`,
`engagement-lifecycle` pre-flight, exploit prompt). Note also the filename
mismatch: `decepticon.cfg` vs `raptix.cfg`.

Net effect: the documented agent flow fails at the first `sliver-client
import` on a real engagement. The lab runbook papers over it with a manual
`docker cp` step (README Phase 1, step 5); that step must not be baked into
product code as-is — the fix belongs in the workload spawn path (mount or
post-start provisioning that places a correctly-named config in the shared
workspace), with a skill/prompt check that fails explicitly when it is
absent.

## Gap 2 — agent-driven C2 commands are invisible to the web command ledger (ADR-0099, still Proposed)

Agents drive Sliver through the sandbox `bash` tool — `sliver-client console`
in tmux per the `c2-sliver` skill. Those commands bypass the web dispatch
route entirely, so the durable ledger (`C2Command`, recorded with status and
output by `apps/web/server/src/services/c2-service.ts`) only ever holds
operator-dispatched commands. A session an agent created has no record of the
run that created it.

[ADR-0099](../adr/0099-runtime-c2-dispatch-through-web-ledger.md) (Proposed
2026-10-23, not implemented) specifies the fix: typed `c2_execute` through the
web boundary, run admission + ephemeral credentials, grant-gated dispatch with
attribution. Until it is implemented, the web console shows real sessions
(live Sliver read via the bridge) but cannot attribute agent C2 activity to
runs. The lab's Phase 1 sessions (production `c2-sliver`, `c2-sliver:8888`)
are also invisible to the web UI by design — the bridge's ownership filter
only accepts its own listeners — which is correct behaviour today, not a bug.

## Why this note exists

Both gaps were hit while building the disposable target lab, not inferred
from code reading. They are prerequisites for an honest end-to-end claim of
"agent exploits target → C2 session traceable in the web console". Track them
separately from the lab itself; the lab must stay a throwaway harness.
