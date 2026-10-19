# 0093. Packaging of the environment controller and its images

- **Status:** Accepted (packaging decision, scope: Windows with Docker Desktop). Written 2026-10-19, accepted by the repository owner.
- **Date:** 2026-10-19
- **Deciders:** repository owner (accepted the direction and conditions). Maintainer review pending.
- **Related:** [ADR-0092](0092-single-active-project-environments.md) (Proposed). Runbook: [`docs/design/2026-10-19-single-active-runbook.md`](../design/2026-10-19-single-active-runbook.md).

## Context

ADR-0092 runs one project's runtime and sandbox as containers that the host controller creates. The controller is a
launcher subcommand (`environment-controller`) that runs on the host and listens on loopback. Today it is started by
hand, and the environment images are passed as digest references on the command line. Nothing in the compose stack
packages it, pins the images for it, or bootstraps its token and workspace root. Installers exist for Windows and
Linux paths but have not been exercised for the controller.

Changing the compose file touches container hardening (`cap_drop`, `no-new-privileges`, `mem_limit`, `pids_limit`,
network membership). CLAUDE.md requires an ADR and a threat-model paragraph for such changes. This document is that
ADR draft. It does not change the compose file.

## Decision (proposed)

1. **Controller bootstrap.** The controller stays a launcher subcommand. It is not a compose service. The launcher
   generates a token of at least 32 bytes into a file readable only by the operator, and mounts it only into the API
   container. The token never goes into an environment variable or a log.
2. **Image pinning.** Runtime and sandbox images are referenced by digest only. The launcher keeps the allowlist; a tag
   or an unpinned reference is refused at configuration time (already enforced by `NewImagePolicy`).
3. **Workspace root.** A single host directory holds every project workspace. The controller creates a project
   directory on first use, one level under that root, and refuses any path outside it.
4. **Update and rollback.** A new image digest is added to the allowlist before any project uses it. Active projects
   keep the digest their containers were created with until they are recreated by an explicit action. Rollback is
   restoring the previous allowlist and recreating the container.
5. **Platforms.** Scope of this decision is Windows with Docker Desktop, verified on the owner's machine. WSL and Linux are
   out of scope for this release (gate exclusion E2).

## Threat model

- The controller listens on loopback only, with a bearer token and six allowlisted operations. A compromised API
  container could call the controller, so the token is scoped to one deployment and the operations are limited to
  the environment labels.
- Environment containers get the same hardening as the compose services they replace: no privileged flag, no Docker
  socket, `cap_drop ALL`, `no-new-privileges`, memory and process limits.
- Runtime environment variables come only from the allowlist in the launcher. Other keys are refused at start.
- Open risk, not solved by this ADR: a sandbox can still reach the runtime API and the host controller over the
  shared network. This is the residual isolation gap recorded in ADR-0092 and needs its own decision.

## Consequences

- No compose change is needed for the environment layer. The compose stack keeps its current hardening.
- Installer work for WSL and Linux is deferred until those platforms can be tested.
- Retiring the shared project runtime and sandbox routes is a separate decision, taken after the parity pass.

## Not decided here

- Whether the environment controller should eventually be a compose service (that would need its own ADR).
- The offline image cache and the image profile sizes.
- The retirement date of the shared runtime and sandbox routes.
