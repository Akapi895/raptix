# Makefile Reference

The Makefile is for **local development and pre-release verification**. Every Docker target builds from your local checkout. End users install via `curl | bash` and run `raptix` — they don't use `make`.

Run `make help` for a quick summary. Full reference below.

---

## Pre-release Verification

The primary purpose of this Makefile. Run these before tagging a release.

| Target | Description |
|--------|-------------|
| `make dogfood` | Full OSS UX on local code: builds the Go launcher + every service image (`:dev` tag), wires up an isolated `$RAPTIX_HOME` under `.dogfood/`, then runs the launcher. The onboard wizard, engagement picker, `compose up`, health checks, and CLI all execute exactly as a `curl \| bash` install. |
| `make smoke` | Compose-only smoke (no launcher, no onboard wizard) — fastest possible release-shape check. Replicates only the launcher's `compose up` step: clean → build images locally → `up -d --no-build --wait` → health checks. Use when you only changed the compose stack. |
| `make launcher` | Build the Go launcher binary at `clients/launcher/bin/raptix`. Embedded version is `dev`, which skips release update notices and versioned config sync inside the launcher. Invoked automatically by `make dogfood`. |

`make dogfood` runs against an isolated `.dogfood/` directory so the user's real `~/.raptix` is never touched. `make clean` purges both the compose volumes and `.dogfood/` when you want a fresh onboard.

---

## Development

| Target | Description |
|--------|-------------|
| `make dev` | Build all Docker images and start with hot-reload (`docker compose watch`) — source changes sync into containers automatically |
| `make cli-dev` | Open the interactive terminal UI locally with hot-reload (Node) — backend stays in Docker |
| `make webraptix-dev` | Run the web-raptix Vite dev server locally (`http://localhost:5173`, proxies `/api` to the API on `:5280`) |

Typical contributor workflow:

```bash
# Day-to-day iteration: hot-reload
make dev

# Before opening a PR
make quality

# Before tagging a release
make smoke      # fast check
make dogfood    # full OSS UX
```

The web dashboard is optional. In Docker deployments start it from the CLI with `/web` (prints the URL); it is reachable at <http://localhost:3000> when the web-raptix stack is up (`make webraptix-up`).

---

## Quality Gates

| Target | Description |
|--------|-------------|
| `make quality` | Run all quality gates: Python lint + tests + CLI typecheck/build/test + web-raptix lint/test/build |
| `make lint` | Python lint + type-check (`ruff check` + `ruff format --check` + `basedpyright`) |
| `make lint-fix` | Auto-fix Python lint and formatting |
| `make quality-cli` | CLI typecheck + build + test (`vitest`) |

---

## Testing

| Target | Description |
|--------|-------------|
| `make test [ARGS=...]` | Run Python tests (`pytest`) inside the Docker container |
| `make test-local [ARGS=...]` | Run Python tests locally (requires `uv sync --dev`) |

CLI tests are part of `make quality-cli`. To run them in isolation: `npm run test --workspace=@raptix/cli`.

---

## Web Dashboard (web-raptix stack)

| Target | Description |
|--------|-------------|
| `make webraptix-dev` | Run the web-raptix Vite dev server + API locally (W20 replaced the retired legacy `web-*` targets) |
| `make webraptix-quality` | New UI + server lint/typecheck/test/build |
| `make webraptix-build` | Build the two new-stack images (UI proxy + API server) |
| `make webraptix-up` | Start the web-raptix stack (migrations run at API boot) |
| `make webraptix-health` | Same-origin acceptance checks through the proxy |

The legacy Next.js `web-*` targets were retired in W20; `clients/web` remains in the
checkout as reference-only.

---

## Operations

| Target | Description |
|--------|-------------|
| `make status` | Show running service status (`docker compose ps`) |
| `make logs [SVC=service]` | Follow logs (default: `langgraph`). Override: `make logs SVC=litellm` |
| `make health` | KG backend + Neo4j health checks, plus the web dashboard when the web-raptix stack is running (broader than `raptix kg-health`, which only checks the KG) |
| `make clean` | Full teardown: stop services, remove volumes, **and remove `.dogfood/`**. Use this when you want the next `make dogfood` to start from a fresh onboard wizard. |

---

## Benchmark

| Target | Description |
|--------|-------------|
| `make benchmark [ARGS="--level 1"]` | Run the benchmark suite locally |

---

## Versioning (no manual step)

There is no `make sync-version` or pre-tag commit. Source-tree version fields carry a `"0.0.0"` sentinel in `pyproject.toml` and `clients/cli/package.json`. The release workflow stamps the real tag into the images at Docker build time via `--build-arg VERSION=<tag>`. The Go launcher is similarly stamped via GoReleaser ldflags.

Release channel policy (see [update-channels.md](./update-channels.md) for the user-facing view):

- `vX.Y.Z` Git tags are the source of truth for releases.
- GHCR version tags (`X.Y.Z`) are immutable release artifacts and should be used by installed deployments.
- Two moving channel tags (Claude-Code-style soak model — both **final-only**):
  - GHCR `latest` → moved to the newest **final** release **immediately**, by the `publish-release` job (after all version-tagged images exist and the GitHub release is undrafted).
  - GHCR `stable` → moved to the newest final release **baked ≥ the soak window** (default 7 days), by the **scheduled** `promote-stable.yml` workflow — *not* on release. The conservative default; the `${RAPTIX_VERSION:-stable}` compose fallback resolves here.
- Pre-releases use SemVer suffixes such as `v1.1.0-rc.1`, stay marked as GitHub pre-releases, and move **neither** channel tag (the channels never auto-select them).
- Bug fixes ship as new patch releases. Do not rebuild or rewrite an existing version tag.

To cut a release:

```bash
make quality && make smoke && make dogfood
git tag v1.0.16 && git push origin v1.0.16
```
