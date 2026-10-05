# Web Dashboard

The web dashboard is an open-source (Apache 2.0) browser-based control plane for managing engagements. It runs alongside the terminal CLI — use whichever interface fits your workflow.

**Stack (web-raptix, since W16)**: Vite + React 19 UI with a same-origin nginx proxy · independent API server (Fastify) · PostgreSQL (Prisma) · Neo4j · deployed via `docker-compose.web-raptix.yml` on port 3000.

> **W20 note:** the legacy Next.js `web` compose service and its `make web-*` targets
> were retired. The `clients/web` folder remains in the checkout as reference-only;
> the archived `raptix-web` GHCR image is pull-only for emergency rollback. The
> commands below describe the active web-raptix stack.

---

## Running the Dashboard

**End users:**
```bash
raptix                    # starts the core stack + drops into the terminal CLI
```

Bring the web-raptix stack up from the host (it shares the core `postgres`/`langgraph` services but runs its own UI + API containers):

```bash
make webraptix-up         # or: docker compose -f docker-compose.web-raptix.yml up -d --wait
make webraptix-health     # same-origin acceptance checks through the proxy
```

Then open <http://localhost:3000>.

| CLI command | Effect (post-W20) |
|---|---|
| `/web` (or `/web url`) | prints `http://localhost:${WEB_PORT}` |
| `/dashboard` | alias for `/web` |
| lifecycle args (`up`/`down`) | point at `make webraptix-up` / `docker compose -f docker-compose.web-raptix.yml` — no docker call from the CLI |

**Desktop app (contributors):**
```bash
npm run desktop
```

The desktop app is an Electron shell for the product UI:

| Mode | When | Target |
|---|---|---|
| `auto` (default) | Local install present → local; otherwise cloud | `http://localhost:${WEB_PORT:-3000}` or `https://app.decepticon.red` |
| `cloud` | `RAPTIX_DESKTOP_MODE=cloud` | Hosted app (website login, Google/GitHub OAuth in-window) |
| `local` | `RAPTIX_DESKTOP_MODE=local` | Local dashboard; opens the web-raptix stack URL (`http://localhost:${WEB_PORT:-3000}`) |

Sessions use a persistent Electron partition (`persist:raptix-desktop`). Optional one-shot cookie import: drop a Cookie-Editor JSON or Netscape export at `~/.raptix/desktop-cookies.txt` (Windows: `%USERPROFILE%\.raptix\desktop-cookies.txt`) or set `RAPTIX_DESKTOP_COOKIES`. Prefer interactive sign-in; never commit session tokens.

Cross-platform notes (Linux / macOS / Windows):

| Concern | Behavior |
|---|---|
| Install copy-button | `install.sh` on Unix; `install.ps1` + winget Docker hint on Windows |
| Local stack start | `docker compose …` via argv spawn (`shell: false`); `windowsHide` on Windows |
| Login form edit keys | Application **Edit** menu roles (required for Cmd/Ctrl+C/V on all three) |
| Window lifecycle | macOS stays running after last window close (dock re-activate); others quit |
| CI | `Desktop (ubuntu/macOS/windows)` runs unit + syntax checks on every desktop change |

External links stay in the system browser; status UI matches the product branding when bootstrap is blocked.

Headless operators (no CLI, e.g. CI) can drive the same lifecycle from the host shell:
```bash
docker compose -f docker-compose.web-raptix.yml up -d --wait
```

**Contributors (full stack with hot-reload):**
```bash
make dev
```
Builds and starts every backend service with source-sync hot-reload. The web-raptix tier runs separately (`make webraptix-up`) or fully local (`make webraptix-dev`). Open <http://localhost:3000>.

**Contributors (local dev server):**
```bash
make webraptix-dev
```
Runs the web-raptix Vite dev server locally (`http://localhost:5173`, proxies `/api` to the API server on `:5280`) while infra (postgres, neo4j, litellm, langgraph, sandbox) stays in Docker. Faster web iteration than `make dev`.

---

## Features

### Engagement Setup

Create a new engagement by providing a target. Five input types:

| Type | Example |
|------|---------|
| IP range | `10.0.0.0/24` |
| Web URL | `https://app.example.com` |
| Git repository | `https://github.com/org/repo` |
| File upload | Binary, archive, or source tree |
| Local path | `/path/to/target` |

### Soundwave Interview

After creating an engagement, Soundwave interviews you to define the threat actor profile, scope, exclusions, and testing window. The interview streams in real time in the browser. When complete, Soundwave generates the full engagement document package (RoE, ConOps, Deconfliction Plan, OPPLAN).

### Execution Streaming

Once an engagement is running, the dashboard streams all agent events via Server-Sent Events (SSE) from LangGraph. You see tool calls, agent outputs, and objective status updates as they happen.

### Findings Viewer

Parses `FIND-NNN.md` reports from `workspace/findings/` and presents them in a structured view:
- Severity filter (CRITICAL / HIGH / MEDIUM / LOW / INFO)
- Per-finding detail: description, evidence, CVSS, CWE, MITRE technique
- Remediation recommendation

### Attack Graph Canvas

Interactive visualization of the Neo4j knowledge graph:
- Pan and zoom
- Click any node for full property detail
- Color-coded by node type (Host, Service, Vulnerability, Credential)
- Live — updates as the agent adds nodes and edges

Powered by [React Flow](https://reactflow.dev/) with `d3-force` for graph layout.

### OPPLAN Tracker

Per-objective progress board:
- Status badges: `pending` / `in-progress` / `completed` / `blocked` / `cancelled`
- MITRE ATT&CK technique IDs per objective
- OPSEC level indicator
- Dependency graph (which objectives must complete before this one starts)

---

## Database

The dashboard uses PostgreSQL (dedicated `raptix_web` database) with Prisma ORM.

**Migrations** run automatically at API container boot (`prisma migrate deploy`). For local development apply them manually:

```bash
cd apps/web/server && npx prisma migrate dev
```

Schema is at `apps/web/server/prisma/schema.prisma`. Key models: `Engagement`, `Project`, `Run`, `Finding`, `Campaign`, `VaultSecret`.

---

## API Routes

The dashboard exposes the Fastify API under `apps/web/server/src/http/routes/`, served same-origin through the nginx proxy (`/api/*` + `/projects/*` SPA fallback). These routes are not a public API — the surface area may change between versions.
