# P1 release and local web lifecycle

## Current scope (2026-10-03)

The source implements release/install/update wiring for the independent UI/API.
Local tests and an absence-of-legacy deployment have been executed. GHCR publish,
cosign attestations, stable promotion and release recovery still need an actual
tagged release run; no images were pushed or channel tags moved in this work.

## Images and configuration assets

- UI: `ghcr.io/akapi895/raptix-web-raptix-ui:<version>`.
- API: `ghcr.io/akapi895/raptix-web-raptix-api:<version>`.
- Both runtime images carry `org.opencontainers.image.version`, stamped using
  `--build-arg VERSION=<version>`. Release/recover/stable preflight checks this
  label and all required manifests before promotion.
- Both images participate in sign/SBOM/provenance and digest-manifest generation.
- The release `config-checksums.txt` covers `docker-compose.yml`,
  `docker-compose.web-raptix.yml`, `config/litellm.yaml`, `.env.example`.
- Install scripts stage and verify downloaded configs before installing them.
  Launcher update verifies every new config before replacing installed files.
  The real `.env` (including the Vault key) is not replaced by config sync.

Older manifests without the new Compose asset are not a new-stack release.
Use a release produced by the updated pipeline; do not bypass verification to
compensate for a missing asset.

## Host entrypoint

After installing/updating a launcher containing IW-06:

```text
raptix web start
raptix web status
raptix web stop
```

`start` selects the installed version marker, pulls images, starts base infra,
ensures only the dedicated `raptix_web_raptix` database exists, then starts the
separate web project with health waiting. The API owns `prisma migrate deploy`.
The base and web Compose projects are never merged. `stop` uses plain `down`
for the web project; it does not remove PostgreSQL/workspace/runtime volumes.

For already-running infrastructure and locally built images:

```text
raptix web start --pull=false --start-infra=false
```

The terminal client's `/web` and desktop entrypoints remain URL/reporting-only;
the Go host entrypoint supplies the lifecycle. This is local single-user mode,
not a hosted authentication or RBAC deployment.

## Readiness interpretation

- `/api/health`: process liveness; integration probes are `not_checked`.
- `/api/health/ready`: database and runtime-catalog wiring, not model inference.
- `scope` and `notProbed` explicitly name what each health endpoint checked.
- Capabilities indicate contract wiring/feature availability. They are not a
  successful tool run, provider connection test or assessment report.
- Use the live core/Vault/durability gates for operations those probes omit.

## Update and rollback

Back up the dedicated web DB, runtime state and canonical workspace together,
and retain the Vault key privately. Use version-tagged images and verified config
assets. Config/image-pull errors stop launcher update before the binary/version
marker is changed. An image/config rollback does not reverse database migrations;
restore a compatible DB backup when the schema is not backward-compatible.
Never use `down -v` as an update/rollback operation.

Local evidence is recorded in `interactive-web-readiness-backlog.md` and
`test-results-deployed/iw07/`. CI remote acceptance remains separate.
