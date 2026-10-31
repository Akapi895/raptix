# Raptix — Pre-release Verification & Development
#
# Purpose: dogfood and validate the OSS release flow before tagging. Every
# Docker target builds from the local checkout (never pulls from GHCR), so
# what you test is exactly what ships.
#
# Common workflows:
#   make dogfood      Full OSS UX (launcher → onboard → CLI) on local code
#   make smoke        Compose-only smoke (no launcher) — fast pre-release check
#   make quality      PR gate (Python + CLI + Web)
#   make dev          Backend hot-reload (compose watch) — daily dev loop
#   make help         List all targets

COMPOSE       := docker compose
# Dev override is now opt-in via an explicit ``-f`` chain — the file was
# renamed from ``docker-compose.override.yml`` to ``docker-compose.dev.yml``
# so it no longer auto-merges into every ``docker compose`` invocation.
# The launcher-driven OSS stack uses ``$(COMPOSE)`` (base only); local-dev
# targets that need the skills bind mount + workspace overlays chain
# ``$(COMPOSE_DEV)``. Closes #214.
COMPOSE_DEV   := docker compose -f docker-compose.yml -f docker-compose.dev.yml
COMPOSE_WATCH := docker compose -f docker-compose.yml -f docker-compose.dev.yml -f docker-compose.watch.yml
PROFILES_ALL  := --profile cli --profile c2-sliver
# apps/web (React UI + Fastify/Prisma server) was retired by ADR-0106 in
# favor of apps/ui-app + a new apps/api backend. apps/api has no compose
# service or Make targets yet — see
# docs/design/2026-10-31-ui-app-integration-implementation-plan.md for the
# sequencing that reintroduces them.

# Dogfood: isolated $RAPTIX_HOME so the launcher can onboard, write .env,
# and stand up the stack without touching the user's real ~/.raptix. The
# launcher resolves all relative paths against the compose file's directory,
# so docker-compose.yml + infra/config/ + infra/containers/ + .env.example are symlinked
# back to the repo. workspace/ stays a real directory (engagement bind mount).
DOGFOOD_HOME  := $(CURDIR)/.dogfood
LAUNCHER_BIN  := apps/launcher/bin/raptix

# Match the launcher's explicit Compose project without interpolating the
# environment-controlled stack/project name into Make's shell source.
define CLEAN_LAUNCHER_STACK
	@stack="$${RAPTIX_STACK_NAME:-}"; project="$${RAPTIX_COMPOSE_PROJECT:-}"; \
	case "$$stack" in *[!a-z0-9-]* ) echo "invalid RAPTIX_STACK_NAME: $$stack" >&2; exit 2;; esac; \
	if [ -z "$$project" ]; then project="raptix$${stack:+-$$stack}"; fi; \
	case "$$project" in ""|[!a-z0-9]*|*[!a-z0-9_-]* ) echo "invalid RAPTIX_COMPOSE_PROJECT: $$project" >&2; exit 2;; esac; \
	docker compose -p "$$project" $(PROFILES_ALL) down --volumes --remove-orphans 2>/dev/null; true
endef

# docker compose cannot expand ~ inside compose-file defaults, so resolve it
# here before any subprocess inherits the env.
export RAPTIX_HOME ?= $(HOME)/.raptix

# Host port the compose stack publishes LangGraph on. Compose reads .env
# directly; plain Make does not, so extract it here (CRLF-safe) and forward it
# in dev recipes. Keeps `make cli-dev` pointed at the started stack instead of
# silently dialing the 2024 default.
LANGGRAPH_HOST_PORT := $(or $(shell sed -n 's/^LANGGRAPH_PORT=[[:space:]]*//p' .env 2>/dev/null | tr -d '\r' | tail -1),2024)

# Mirror the launcher's start.go credential mount logic so `make dev` (and any
# other target that calls `docker compose`) populates the litellm container's
# Claude Code + Codex CLI OAuth tokens without requiring users to run
# `raptix onboard`. Existence check at make-time: real file when host has
# tokens, /dev/null otherwise so docker doesn't synthesize a bind directory.
export CLAUDE_CREDENTIALS_VOLUME ?= $(shell test -f $(HOME)/.claude/.credentials.json && echo $(HOME)/.claude/.credentials.json || echo /dev/null)
export CODEX_AUTH_VOLUME ?= $(shell test -f $(HOME)/.codex/auth.json && echo $(HOME)/.codex/auth.json || echo /dev/null)

.PHONY: help \
        dogfood launcher smoke \
        dev cli-dev infra \
        quality quality-strict quality-cli test test-local lint lint-fix \
        ci-lint ci-test ci-test-coverage ci-test-coverage-report \
        status logs health clean \
        node-install \
        benchmark recreate-litellm

# ── Help (default target) ────────────────────────────────────────

help:
	@echo "Raptix — Pre-release Verification & Development"
	@echo ""
	@echo "Pre-release verification (release readiness):"
	@echo "  make dogfood      Full OSS UX (launcher → onboard → CLI) on local code"
	@echo "  make smoke        Compose-only smoke (no launcher) — fast OSS-shape check"
	@echo "  make launcher     Build the Go launcher binary ($(LAUNCHER_BIN))"
	@echo ""
	@echo "Development (build the thing being released):"
	@echo "  make dev          Backend hot-reload (compose watch)"
	@echo "  make cli-dev      CLI locally + backend hot-reload"
	@echo ""
	@echo "Quality gates (PR readiness):"
	@echo "  make quality        PR gate — mirrors CI PR lane (fast, no slow tests, errors-only typecheck)"
	@echo "  make quality-strict Release gate — mirrors CI main-push lane + full basedpyright warning audit"
	@echo "  make ci-lint        Lint + format + basedpyright errors-only (CI mirror)"
	@echo "  make ci-test        pytest fast lane (-n auto -m \"not slow\", no coverage)"
	@echo "  make ci-test-coverage  pytest with coverage gate (--cov-fail-under=60)"
	@echo "  make ci-test-coverage-report  pytest fast lane with coverage report (no gate, PR-informational)"
	@echo "  make test           pytest in container"
	@echo "  make test-local     pytest locally (uv sync --dev; takes ARGS=)"
	@echo "  make lint           Python lint + format check + basedpyright (all levels, local exploratory)"
	@echo "  make lint-fix       Auto-fix Python lint + format"
	@echo ""
	@echo "Web (apps/ui-app + apps/api): no Make targets yet — ADR-0106 retired"
	@echo "the apps/web stack; see docs/design/2026-10-31-ui-app-integration-implementation-plan.md"
	@echo ""
	@echo "Ops:"
	@echo "  make status       docker compose ps"
	@echo "  make logs [SVC=]  Follow logs (default: langgraph)"
	@echo "  make health       KG + Neo4j; Web when running"
	@echo "  make clean        Full teardown (compose volumes + .dogfood/)"
	@echo ""
	@echo "Other:"
	@echo "  make benchmark [ARGS=\"--level 1\"]"

# ── Pre-release Verification (PRIMARY) ───────────────────────────

## End-to-end OSS dogfood: launcher onboard → engagement picker → compose up
## → CLI. Identical UX to a real `curl | bash` install, but every image and
## the launcher itself come from the current checkout (tag :dev). The
## launcher version is "dev" so auto-update + config-sync are skipped — the
## symlinked .dogfood/ tree is the source of truth.
dogfood: launcher
	@echo "[dogfood] Stopping any prior launcher and repo-root stacks..."
	$(CLEAN_LAUNCHER_STACK)
	@$(COMPOSE) $(PROFILES_ALL) down --remove-orphans 2>/dev/null; true
	@mkdir -p $(DOGFOOD_HOME)/workspace
	@ln -sfn $(CURDIR)/docker-compose.yml $(DOGFOOD_HOME)/docker-compose.yml
	@ln -sfn $(CURDIR)/infra/config              $(DOGFOOD_HOME)/config
	@ln -sfn $(CURDIR)/infra/containers          $(DOGFOOD_HOME)/containers
	@ln -sfn $(CURDIR)/.env.example        $(DOGFOOD_HOME)/.env.example
	@echo ""
	@echo "[dogfood] Building images from local code (tag :dev)..."
	RAPTIX_VERSION=dev $(COMPOSE) --profile cli build
	@echo ""
	@echo "[dogfood] Launching ./$(LAUNCHER_BIN) (RAPTIX_HOME=$(DOGFOOD_HOME))"
	@echo ""
	RAPTIX_VERSION=dev RAPTIX_HOME=$(DOGFOOD_HOME) ./$(LAUNCHER_BIN)

## Build the Go launcher binary (version=dev, gates auto-update + config sync).
launcher:
	cd apps/launcher && go build \
		-ldflags '-X github.com/Akapi895/raptix/apps/launcher/cmd.version=dev' \
		-o bin/raptix

## Compose-only smoke (no launcher, no onboard wizard) — fastest possible
## release-shape check. Replicates only the launcher's compose Up step:
##   1. Down + purge volumes (parity with `raptix remove`)
##   2. Build all images from local code (replaces `compose pull` from GHCR)
##   3. up -d --no-build --wait --wait-timeout  (identical to launcher Up)
##   4. Health checks (identical to `raptix health`)
## Use dogfood for the full release flow; use smoke when the compose stack
## is the only thing you've changed.
smoke:
	@echo "=== Raptix pre-release smoke (compose-only, no launcher) ==="
	@echo ""
	@echo "[1/4] Clean state (purging containers + volumes)..."
	$(CLEAN_LAUNCHER_STACK)
	@$(COMPOSE) $(PROFILES_ALL) down --volumes --remove-orphans 2>/dev/null; true
	@echo ""
	@echo "[2/4] Building images from local code..."
	$(COMPOSE) --profile cli build
	@echo ""
	@echo "[3/4] Starting services (--no-build --wait, OSS launcher flow)..."
	$(COMPOSE) --profile cli up -d --no-build --wait \
		--wait-timeout $${RAPTIX_STARTUP_TIMEOUT_SECONDS:-600}
	@echo ""
	@echo "[4/4] Health checks..."
	@$(MAKE) -s health
	@echo ""
	@echo "=== smoke OK — stack mirrors OSS user state ==="
	@echo "  Web:          optional (/web from CLI)"
	@echo "  LangGraph:    http://localhost:$${LANGGRAPH_PORT:-2024}"
	@echo "  Run dogfood:  make dogfood"
	@echo "  Teardown:     make clean"

# ── Development (build the thing being released) ─────────────────

## Build images and start with hot-reload (source changes auto-sync).
dev:
	$(COMPOSE_WATCH) watch

## CLI locally (Node) — backend stays in Docker with hot-reload sync.
##
## Build chain: shared/streaming dist → cli dist → run.
## `npm run dev` only watches tsc; `node --watch` re-execs on dist changes.
## Load the same .env as Compose so the local CLI receives the engagement pin.
## The CLI is an Ink app, so `node` MUST stay in the foreground — Ink needs a
## real TTY (raw mode) on stdin, which a backgrounded job does not get. So tsc
## watch runs in the background and a trap tears it down when the foreground
## `node` exits (Ctrl-C).
cli-dev: infra
	@$(COMPOSE_WATCH) watch --no-up --quiet langgraph &
	npm run build --workspace=@raptix/streaming
	cd apps/cli && npm run build
	cd apps/cli && npm run dev & TSC_PID=$$!; \
	  trap "kill $$TSC_PID 2>/dev/null" EXIT INT TERM; \
	  cd apps/cli && RAPTIX_API_URL=$${RAPTIX_API_URL:-http://localhost:$(LANGGRAPH_HOST_PORT)} node --env-file-if-exists=../../.env --watch dist/index.js

# Internal: bring up backend infra (built from local code).
# Chains the dev override so local-dev workflows (cli-dev) pick up
# the skills bind mount alongside the base stack. The OSS launcher path
# (smoke + dogfood) keeps ``$(COMPOSE)`` to mirror what end users run.
infra:
	@echo "[infra] Ensuring backend services are running..."
	@$(COMPOSE_DEV) up -d --build postgres neo4j litellm langgraph sandbox skillogy

# ── Quality gates ────────────────────────────────────────────────

test:
	$(COMPOSE) exec langgraph python -m pytest $(ARGS)

test-local:
	uv run pytest $(ARGS)

lint:
	uv run ruff check .
	uv run ruff format --check .
	uv run basedpyright

lint-fix:
	uv run ruff check --fix .
	uv run ruff format .

# ── CI mirror targets ─────────────────────────────────────────────
# These are the exact commands CI runs. .github/workflows/ci.yml
# dispatches via `make ci-lint` / `make ci-test{,-coverage}` so this
# Makefile stays the single source of truth — no drift between local
# and CI is possible by construction.

ci-lint:
	@echo "==> ruff check"
	uv run ruff check .
	@echo "==> ruff format --check"
	uv run ruff format --check .
	@echo "==> basedpyright (errors only — pre-existing warnings tracked but non-blocking)"
	uv run basedpyright --outputjson > bp.json || true
	uv run python scripts/check_basedpyright_errors.py bp.json

## PR lane: fast, no coverage, slow tests excluded.
ci-test:
	uv run pytest -n auto -q -m "not slow"

## SKILL.md schema validator (warn mode — Phase 0). Exit 0 even if violations found.
.PHONY: audit-skills
audit-skills:
	uv run python -m raptix.skills.audit --mode warn

## SKILL.md schema validator (strict mode — post-Phase-0 CI gate). Exit 1 on any violation.
.PHONY: audit-skills-strict
audit-skills-strict:
	uv run python -m raptix.skills.audit --mode strict

## Download and verify the immutable MITRE STIX bundle required by the
## Skillogy graph builder. The builder itself remains offline-only.
.PHONY: bootstrap-skill-graph
bootstrap-skill-graph:
	uv run python scripts/bootstrap_skillogy_stix.py

## Skill graph builder (Phase 1a) — compile SKILL.md + seeds + MITRE STIX
## into packages/raptix/raptix/skills/.graph/skills.cypher.
.PHONY: build-skill-graph
build-skill-graph: bootstrap-skill-graph
	uv run python -m raptix.skills.engine.builder --frozen-built-at

## CI gate — assert the checked-in skills.cypher matches what the
## builder produces from the current SKILL.md + seed YAML + pinned STIX.
.PHONY: check-skill-graph
check-skill-graph: bootstrap-skill-graph
	uv run python -m raptix.skills.engine.builder --frozen-built-at --check

## main-push lane: slow included, coverage 60% gate (ratcheted from 35% in #380).
ci-test-coverage:
	uv run pytest -n auto --cov --cov-report=xml --cov-report=term --cov-fail-under=60

## PR-informational lane: coverage without any threshold, fast subset
## (``-m "not slow"`` — matches the blocking PR ``ci-test`` lane so the
## reported coverage % is for the same test set authors actually run on a
## PR). Used by the non-blocking ``coverage-report`` job in ci.yml so PR
## authors see a coverage delta without blocking merge (the documented
## decision is to keep the blocking PR pytest step coverage-free — see
## ci.yml comment).
ci-test-coverage-report:
	uv run pytest -n auto --cov --cov-report=xml --cov-report=term --cov-fail-under=0 -m "not slow"

quality-cli: node-install
	# streaming workspace must be built first — its package.json main
	# resolves to dist/, which cli's typecheck + build consume.
	npm run build --workspace=@raptix/streaming
	npm run typecheck --workspace=@raptix/cli
	npm run build --workspace=@raptix/cli
	npm run test --workspace=@raptix/cli

## PR gate — mirrors CI PR lane (errors-only typecheck + fast pytest + CLI).
## Use before opening a PR; security/release/remote-run checks are separate gates.
## apps/ui-app / apps/api have no quality target yet (ADR-0106 migration in
## progress) — add one back here once apps/api exists.
quality: ci-lint ci-test quality-cli
	@echo ""
	@echo "OK — PR gates passed (mirrors CI PR lane)"

## Release gate — mirrors CI main-push lane (coverage 60%) + full basedpyright
## audit (warnings + info). Run before tagging a release.
quality-strict: ci-lint ci-test-coverage quality-cli
	@echo ""
	@echo "==> basedpyright (full — warning + info audit, non-blocking)"
	uv run basedpyright
	@echo ""
	@echo "OK — release gate passed (mirrors CI main lane + warning audit)"

# ── Web Dashboard ─────────────────────────────────────────────────
# apps/web (UI + Fastify/Prisma server) was retired by ADR-0106. There is no
# web Make target until apps/api is built out — see
# docs/design/2026-10-31-ui-app-integration-implementation-plan.md.

# ── Status / Logs / Health / Clean ───────────────────────────────

status:
	$(COMPOSE) ps

## Follow logs (usage: make logs or make logs SVC=langgraph)
logs:
	$(COMPOSE) logs -f $(or $(SVC),langgraph)

## Health checks: KG backend + Neo4j (parity with `raptix health`; web stack
## retired by ADR-0106, no health check until apps/api exists).
health:
	@$(COMPOSE) exec -T langgraph python -m raptix.execution.tools.research.health >/dev/null 2>&1 \
		&& echo "kg:    OK" || (echo "kg:    FAIL" && exit 1)
	@set -a; . ./.env; set +a; \
	$(COMPOSE) exec -T neo4j cypher-shell -u neo4j -p "$${NEO4J_PASSWORD:-raptix-graph}" "RETURN 1 AS ok;" >/dev/null 2>&1 \
		&& echo "neo4j: OK" || (echo "neo4j: FAIL" && exit 1)

## Hydrate the reference corpus (PayloadsAllTheThings, trickest/cve, HackerOne
## reports, ...) so research_cve / search_security_references return results
## instead of an empty cache. Nothing else in the stack does this
## automatically — run once per deployment, or after a reference repo moves.
hydrate-references:
	$(COMPOSE) exec -T langgraph python -m raptix.execution.tools.references.hydrate

## Full teardown: containers + volumes + .dogfood/. Destructive — also
## wipes the dogfood .env (API keys) so the next `make dogfood` starts
## with a fresh onboard wizard.
clean:
	$(CLEAN_LAUNCHER_STACK)
	$(COMPOSE) $(PROFILES_ALL) down --volumes --remove-orphans
	@rm -rf $(DOGFOOD_HOME)
	@echo "OK — compose volumes purged, .dogfood/ removed"

# ── Internal idempotent helpers ──────────────────────────────────

node-install:
	@test -d node_modules || npm install

# ── Benchmark ────────────────────────────────────────────────────

## Force-recreate the litellm container so it captures the host's CURRENT
## ~/.claude/.credentials.json inode. Workaround for the Docker single-file
## bind-mount limitation: the container's view is pinned to the inode at
## mount time; Claude Code CLI rotates credentials via atomic-rename which
## allocates a new inode that the container never sees. Force-recreate
## remounts and picks up the freshly written file. Intended to run as a
## per-cycle preamble in the benchmark loop so each cycle starts with a
## valid OAuth access token (token TTL ~8h ≫ cycle duration ~30m).
recreate-litellm:
	@$(COMPOSE) up -d --no-build --force-recreate litellm
	@docker exec raptix$${RAPTIX_STACK_NAME:+-$${RAPTIX_STACK_NAME}}-litellm sh -c 'test -s /root/.claude/.credentials.json' \
		&& echo "recreate-litellm: creds mount OK" \
		|| (echo "recreate-litellm: creds mount EMPTY — onboard first" && exit 1)

## Run benchmark suite (usage: make benchmark ARGS="--level 1")
benchmark:
	uv run python -m benchmarks.runner $(ARGS)

## CVE-Bench offline dry run (mocked LLM + sandbox, 3 fixtures, seed=0).
## Output: benchmarks/results/runs/cve-bench/<run-id>/report.jsonl
cve-bench-dry:
	CVE_BENCH_DRY_RUN_SEED=0 PYTHONHASHSEED=0 \
		uv run python -m benchmarks.suites.cve_bench.dry_run $(ARGS)
