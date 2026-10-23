# ADR-0099: Dispatch agent C2 commands through the web command ledger so each command names its run

- **Status:** Proposed — 2026-10-23. Direction confirmed by the operator on 2026-10-23; the record stays Proposed until the
  repository owner accepts it in writing.
- **Date:** 2026-10-23
- **Deciders:** repository owner (pending)
- **Related:** ADR-0036 (typed Sliver bridge; the command ledger), ADR-0095 (interactive console), ADR-0098 (controller lease),
  `packages/raptix-skills/.../post-exploit/c2-sliver/SKILL.md`, `CONTRIBUTING_AGENT.md` (guard-rail changes need a threat model)

## Context

Agents drive Sliver through the sandbox `bash` tool: the `c2-sliver` skill starts `sliver-client console` in a tmux session
and sends commands to it. Those commands never reach the web server. The command ledger therefore holds only commands an
operator dispatched from the console, and a session created or used by an agent has no record of the run that did it.

The web dispatch route `POST /api/engagements/:id/c2/sessions/:sessionId/commands` already authorizes by the operator's
identity and an approved, unexpired grant, and records each command with its status and output. The `C2Command` row has
no run column. The runtime process joins `raptix-net`, which reaches the web API; the sandbox joins `sandbox-net`, and the
web API joins `raptix-net` only. Runs are identified by their runtime run id, which the web console already reads.

## Decision

1. **A typed runtime tool replaces the console for agent execution.** A `c2_execute` tool in the runtime takes a session id,
   a command path and its arguments, and calls the web dispatch route. The run id is taken from the runtime context, never
   from the model's arguments.
2. **The ledger records the run.** `C2Command` gains a nullable `runId` with an index on `(engagementId, runId)`. Commands
   the operator dispatches from the console keep `runId = null`. Commands that agents dispatch carry the run id, so a session
   and its output can be read back from the run and the other way round.
3. **A per-run credential, not a shared secret.** When a run starts, the web server issues a credential bound to the
   engagement and the run id. It is accepted only by the dispatch route, and it expires when the run ends. A shared
   service secret is rejected because it cannot be scoped to one run or revoked at the run's end.
4. **The grant belongs to the acting operator.** The dispatch is authorized by an approved, unexpired interactive grant held
   by the operator who started the run. Agents hold no grants of their own. If that grant expires during a run, the next
   dispatch is refused and the run records the refusal.
5. **The console is no longer an execution path for agents.** The `c2-sliver` skill stops instructing agents to use
   `sliver-client console` for execution. Whether the `sliver-client` binary stays in the sandbox image is a separate
   decision, listed as open below.

## Threat model

- **Assets:** sessions on lab targets, the operator's grant, and the outputs recorded in the ledger.
- **Actors:** a prompt-injected model that issues commands outside its task; a leaked run credential; an operator without a
  grant; a replay of an old dispatch.
- **Controls:** the run credential is scoped to one engagement and one run and expires with the run. The grant is checked at
  dispatch and again at completion, as today. The existing command validator bounds the path and arguments. Every dispatch
  writes a ledger row, so a command that was not recorded is the exception rather than the rule. `requestId` stays unique per
  engagement, so a replayed dispatch cannot run twice.
- **Residual risk:** a run credential that leaks lets its holder dispatch within the engagement until the run ends, but only
  against sessions under an approved operator grant. A model that is prompt-injected can still issue commands within the
  grant; the grant and the ledger bound the damage and make it visible.
- **Guard-rail change:** this ADR changes the `c2-sliver` skill's execution instructions and adds a new network path from
  the runtime to the web API. Both need the threat model above in the pull request that implements them.

## Consequences

- **Easier:** each session and each command is traceable to a run; output is retained in the ledger; grant checks happen in
  one place for every command.
- **Harder:** the runtime now depends on the web API being reachable and on a credential-issuing step at run start; runs that
  started before this change have no attribution and show it as unknown.
- **Given up:** free-form use of the `sliver-client` console by agents. Interactive use moves to the controller lease
  (ADR-0098) and the interactive console (ADR-0095).
- **Migration:** a nullable column and index on `C2Command`; a new runtime tool; a changed skill; a credential path for runs.

## Alternatives considered

- **Keep agents on `sliver-client` and reconcile logs afterwards:** rejected because log reconciliation cannot reliably link
  a command to its run, and the output would not be in the ledger.
- **Give the runtime a shared service secret:** rejected because a shared secret cannot be scoped to one run or revoked when
  the run ends.
- **Write agent activity back into the graph store:** rejected because it records claims about commands, not an authorized
  dispatch that the grant gates.

## Open

- How the credential is minted, stored and rotated, and which component issues it.
- Whether the `sliver-client` binary stays in the sandbox image. Keeping it leaves a path that bypasses the ledger.
- How runs that started before this change are shown. The proposal is "attribution unknown", not a guess.

## Verification

Required before acceptance: a dispatch from a run appears in the ledger with its run id and the output; a dispatch under an
expired grant is refused and recorded; a credential from one run is refused for another run's engagement; and the console
path is not used by any skill in the standard set.
