# Browser Execution and Challenge-Conversion Research — Juice Shop Benchmark Gaps

- **Date:** 2026-10-15
- **Researcher:** research agent (background)
- **Purpose:** Primary-source grounding for two implementation decisions blocking Juice Shop benchmark effectiveness: (A) no headless-browser execution path for client-side/DOM proof, (B) no challenge/win-condition conversion step after a cell confirms a vulnerability class.
- **Feeds into:** `docs/exploitation-effectiveness-diagnosis-2026-10-15.md` (NC-2, NC-3 — this doc is the primary-source backing for that diagnosis's P0-2/P0-3 and P1-1 recommendations) and `.raptix/workspace/juice-shop-v2/` (the live run both gaps were observed in).
- **Prior art:** `docs/exploitation-effectiveness-diagnosis-2026-10-15.md` already names both gaps from run evidence; this doc verifies the repo claims independently and adds primary-source research for the two open questions (A1/A2, B1/B2) that diagnosis doc did not resolve.

---

## Gap A — no headless-browser execution path

### Repo verification (claims from the task, checked directly)

- `BROWSER_TOOLS = [browser_action]` is defined at `packages/raptix/raptix/execution/tools/browser/tools.py:375`. The tool is built on **Python** Playwright (`from playwright import async_api`, `tools.py:129`) via a persistent `BrowserSessionManager` singleton (`tools.py:109-274`) — a multi-turn session design (`launch` → `goto`/`click`/`type` → `eval_js`/`console_logs` → `close`), not a one-shot call.
- Grepping `packages/raptix/raptix/intelligence/agents/standard/*.py` and `plugins/*.py` for `BROWSER_TOOLS`/`browser_action`: the only hits in the whole `packages/raptix/raptix` tree are the tool module itself and its re-export in `execution/tools/browser/__init__.py:18,21,25,28`. **Confirmed dead code** — no agent graph imports it.
- `packages/raptix/raptix/middleware/roe.py:84` lists `"browser_action"` in `GATED_TOOL_NAMES`, and `roe.py:109-119,137` define and wire a real host-extractor (`_hosts_from_browser_action`) into `NETWORK_TARGET_EXTRACTORS`. RoE scope-gating for this tool is fully implemented and unreachable — it is correct, dead plumbing, not a stub.
- Grepping `packages/raptix/raptix/intelligence/prompts/**/*.md` for `browser_action`/`chromium`/`headless`: the only hit is `standard/raptix.md:125`, which is about routing to the `reverser` role for "headless decompilation" (Ghidra MCP) — unrelated to web browsing. **Confirmed**: no prompt mentions the browser tool or a browser-based workflow.
- `infra/containers/sandbox.Dockerfile:66` installs `nodejs`; `:167` installs `chromium` via apt (not `playwright install --with-deps`, which the Dockerfile's own comment at `:160-165` says fails on Kali's package set); `:169` sets `ENV INSANE_CHROMIUM_PATH=/usr/bin/chromium`.

**Correction to the task's framing — Node Playwright already exists in the sandbox, just scoped to one directory.** The task's verification (`python3 -c "import playwright"` → `ModuleNotFoundError`) only checked the **Python** package. The sandbox image separately runs `npm install` **inside** `packages/raptix/raptix/execution/sandbox/web/templates/` at build time (`sandbox.Dockerfile:417-424`), and that directory's `package.json` lists `playwright@^1.58.2`, `playwright-extra`, `puppeteer-extra-plugin-stealth` (`execution/sandbox/web/templates/package.json:6-11`). This whole `execution/sandbox/web/` Python package (kernel-adjacent `executor.py` + the JS templates) is `COPY`'d into the sandbox image at `/opt/raptix/execution/sandbox/web` (`sandbox.Dockerfile:399`), i.e. it runs **inside** the sandbox container, not the orchestrator. So: **Node Playwright is already installed and working in the sandbox**, just not globally and not exposed to any agent tool.

That installation is a real, exercised, one-shot CLI pattern — not a theoretical option:

- `execution/sandbox/web/templates/playwright_real_chrome.js` (full file read) is a self-contained Node script: `echo '{"url":"...", "waitSelector":"..."}' | node playwright_real_chrome.js` → one JSON envelope `{html, finalUrl, status, cookies, userAgent, automation}` on stdout (`:6,41`). It launches the **system** Chromium via `executablePath: process.env.INSANE_CHROMIUM_PATH` (`:155-156`), falls back to `playwright-extra`+stealth or plain `playwright` if `patchright` isn't present (`:123-144`), and is driven entirely by generic JSON parameters — no site-specific branching (`:10`, the file's own "NO-SITE-NAME RULE").
- `execution/sandbox/web/executor.py:80-102` (`_run_node_template`) is the Python caller: `subprocess.run(["node", path], input=json.dumps(args), cwd=TEMPLATES_DIR, ...)`. `run_playwright_fallback` (`:128-230`) is its only entry point, invoked by the `web_fetch`/`detect_tech_stack` research-tool anti-bot escalation chain (`execution/sandbox/web/fetch_chain.py:90,693`; `waf_detector.py:42`; `waf_profiles.yaml`) — i.e. it is real, load-bearing, currently-running code, just scoped to OSINT fetching, never to `surface_exploit`/`exploit`.

This is the closest thing Raptix has to a "convergence point": the OSINT/research tool chain already solved "drive a real browser from a disposable sandbox with one bounded CLI call" for a different purpose (anti-bot bypass), and the solution looks exactly like what Question A1 asks for.

### A1 — flags-only vs. CDP vs. Playwright, for a bash-only bounded agent

**1. Raw Chromium CLI flags only.** Per Google's own headless-mode docs (primary source, fetched):
- `--dump-dom`: *"prints `document.body.innerHTML` to stdout"* — [Chrome Headless Chrome blog post](https://developer.chrome.com/blog/headless-chrome) (accessed 2026-10-15; the page itself is marked deprecated in favor of `--headless=new`, documented at [developer.chrome.com/docs/chromium/new-headless](https://developer.chrome.com/docs/chromium/new-headless), which states that as of Chrome 112 "all other functions, existing and future, are available with no limitations" relative to headful).
- `--screenshot` / `--print-to-pdf`: passive capture to a file, no return channel for JS results.
- `--virtual-time-budget=<ms>`: fast-forwards timers (`setTimeout`/`setInterval`) so time-dependent script finishes before the page is captured — confirmed via the current [Chrome Headless command-line reference](https://developer.chrome.com/docs/automation-and-testing/headless-cli) (accessed 2026-10-15 via search snippet), example: `chrome --headless --print-to-pdf --virtual-time-budget=42000 <url>`.
- `--repl`: *"runs Headless in a mode where you can evaluate JS expressions in the browser, right from the command line"* — the **only** flag-only path that can run arbitrary injected JS, but it's an interactive read-eval-print loop over stdin, not a single bounded request/response, and it has no built-in structured console/DOM capture.

**Verdict on flags-only:** `--dump-dom` + `--virtual-time-budget` *can* prove a payload executed, indirectly — e.g. an `onerror="document.title='PWNED'"` payload shows up in the dumped DOM's `<title>` after the virtual-time budget lets it run — but there is no flag that returns "did my JS execute" as structured, parseable output, and no flag performs an interaction (click/type) at all. This rules out flags-only for anything beyond "does this render," confirming the task's premise.

**2. CDP directly (WebSocket, short script).** The protocol's own spec (fetched from the canonical source, `https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/pdl/js_protocol.pdl`) defines exactly the two primitives Question A2 needs:
- `Runtime.evaluate(expression, ...)` → returns `RemoteObject result` + `optional ExceptionDetails exceptionDetails` — run injected JS, get the result or the thrown error back, synchronously, in one call.
- `Runtime.consoleAPICalled(type, args, executionContextId, timestamp, ...)` — an event fired for every `console.*` call, with the console method name and its serialized arguments.
- `Page.navigate` / `Page.captureScreenshot` are the companion domains for load + visual capture.

This is a complete, one-session, bounded-script-friendly API — but it requires a WebSocket client (Node's built-in nothing does this for free; you need either a raw `ws` dependency or a thin wrapper). Node is present in the sandbox (`sandbox.Dockerfile:66`), confirming the task's premise that this path is available.

**3. Installing Playwright.** Per Playwright's own docs (fetched):
- [playwright.dev/docs/browsers](https://playwright.dev/docs/browsers): *"You will need to use the Playwright CLI to install these browsers"* (`playwright install`) — each Playwright version pins specific browser builds.
- System Chrome/Edge *can* be used instead of the bundled binary via the `channel` launch option (`"chrome"`, `"msedge"`, etc.), but this only covers **branded** Chrome/Edge, not an arbitrary system Chromium.
- For an arbitrary binary via `executablePath`, [playwright.dev/docs/api/class-browsertype#browser-type-launch](https://playwright.dev/docs/api/class-browsertype#browser-type-launch) explicitly warns: *"Playwright only works with the bundled Chromium, Firefox or WebKit, use at your own risk."* Raptix's own `playwright_real_chrome.js:152-156` already takes this risk deliberately and successfully (comment: *"Decepticon: launch the sandbox's system Chromium by executablePath when provided"*).

**Convergence check (XSStrike, Dalfox — fetched their actual source, not blog summaries):**
- **XSStrike** (`s0md3v/XSStrike`, `requirements.txt` fetched from GitHub raw): dependencies are `tld`, `fuzzywuzzy`, `requests` only. **No Selenium, no Playwright, no browser at all.** Verification is static response-context analysis, not rendering.
- **Dalfox**: the *current* release (v3.2.4, `Cargo.toml` fetched via `gh api repos/hahwul/dalfox/contents/Cargo.toml`) has **no browser-automation crate whatsoever** — its "DOM/AST verification" runs on `oxc_parser`/`oxc_ast`/`oxc_allocator` (static JS AST parsing) plus `scraper` (HTML parsing), confirming the v3 README's claim of a from-scratch Rust rewrite. This contradicts a secondary blog's claim that Dalfox "loads the payload in a real browser" for every finding — that is **not true of the current release**. The **prior** Go release did use a real browser, though: `go.mod` at tag `v2.9.2` (fetched) pins `github.com/chromedp/chromedp v0.9.3` — i.e. when Dalfox *did* drive a browser, it used **raw CDP via `chromedp`**, not Selenium or a Playwright-equivalent wrapper.

**Convergence point:** the two most-cited open-source XSS tools either (a) never touch a browser (XSStrike, and Dalfox's current rewrite), or (b) when they did (Dalfox v2), drove CDP directly rather than adopting a full automation framework. Nobody in this space runs a persistent Playwright/Selenium session for routine verification.

#### Recommendation A1

**Do not install Playwright or Selenium.** Add one new one-shot Node script as a sibling of the existing `execution/sandbox/web/templates/playwright_real_chrome.js`, reusing the `playwright` package already `npm install`-ed into that directory at image build time (`sandbox.Dockerfile:417-424`) — zero new dependencies, zero image rebuild risk. The new script should:
- read `{url, method?, body?, waitSelector?, evalMarker?}` from stdin (same convention as the existing templates),
- launch via `executablePath: process.env.INSANE_CHROMIUM_PATH` exactly as `playwright_real_chrome.js:155-156` already does,
- attach a `page.on('console', ...)` listener before navigating (Playwright's thin wrapper over `Runtime.consoleAPICalled`),
- navigate once, optionally run one `page.evaluate()` (wraps `Runtime.evaluate`) against a caller-supplied marker expression,
- emit one JSON envelope `{html, consoleLines, evalResult, finalUrl, status}` and exit.

Expose it to the agent as a plain `bash` invocation (`node /opt/raptix/execution/sandbox/web/templates/xss_probe.js <<< '{"url": "..."}'`) documented by a new skill, **not** by reviving `browser_action`. `browser_action`'s persistent multi-tab session design is the wrong shape for a cell that is supposed to make "one or a few bounded tool calls" (per `surface_exploit.md` Rule 4) — it would also require installing Python Playwright, which nothing else in the sandbox needs. Leave it dead; this is consistent with the tool-optimization plan's framing that "tool exposure is a UX optimization" (`docs/tool-optimization-implementation-plan.md`) — a new deterministic, single-purpose script is lower-exposure-risk than wiring a 13-action multiplex tool into a cell's toolset.

### A2 — one-shot "did my payload execute" pattern

CDP's own `Runtime.evaluate` + `Runtime.consoleAPICalled` (above) are exactly the "single bounded request/response" primitives the question asks about — there is no separate named pattern for this in the spec; it's just evaluate-then-read-events in one WebSocket session. Since Playwright is already vendored in `execution/sandbox/web/templates/node_modules`, the lowest-effort concrete artifact is a trimmed variant of the existing template rather than a raw CDP client:

```js
#!/usr/bin/env node
// xss_probe.js — one-shot render + payload-execution check.
// Usage: echo '{"url":"http://target/vuln?x=<payload>"}' | node xss_probe.js
// Reuses execution/sandbox/web/templates/node_modules (playwright already installed).
const { chromium } = require('playwright');

async function main() {
  const { url, waitMs = 3000 } = JSON.parse(await readStdin());
  const consoleLines = [];
  const browser = await chromium.launch({
    executablePath: process.env.INSANE_CHROMIUM_PATH, // sandbox's system Chromium
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  page.on('console', (msg) => consoleLines.push(`[${msg.type()}] ${msg.text()}`));
  const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(waitMs); // let onerror/onload payloads fire
  const domMarker = await page.evaluate(() => document.title); // or a payload-set global
  const html = await page.content();
  await browser.close();
  process.stdout.write(JSON.stringify({ status: resp && resp.status(), consoleLines, domMarker, html }));
}
function readStdin() {
  return new Promise((res) => { let d = ''; process.stdin.on('data', c => d += c); process.stdin.on('end', () => res(d)); });
}
main();
```

To cover "POST the payload via the app's own API first, then render," the agent issues the `http_request` tool call it already has (storing the XSS payload server-side), then runs this script against the page that reflects it — two bounded tool calls total, matching the task's "one or a few" constraint.

---

## Gap B — no challenge/win-condition conversion step

### Repo verification

- `packages/raptix/raptix/intelligence/prompts/standard/surface_exploit.md` (full read): Rule 4 — *"stop after a bounded proof. Do not continue into post-exploitation"* (`:21-22`); Rule 2 — *"test only the assigned vulnerability class on the assigned surface... Report a proof gap instead of wandering"* (`:15-17`); Rule 6 — *"Do not call OPPLAN tools; the orchestrator owns matrix state"* (`:26`); CELL_PROTOCOL step 5 — *"A successful exploit is a finding, not permission to pursue unrelated impact"* (`:67`). There is **no** mention of `/api/Challenges`, "scoreboard," or "challenge" anywhere in the file. Confirmed.
- `packages/raptix/raptix/intelligence/agents/standard/_surface_dispatch.py:11-15` — `SURFACE_EXPLOIT_OUTCOME_STATUS = {"confirmed": "completed", "ruled_out": "completed", "open_proof_gap": "in-progress"}`. This is a **deterministic, non-LLM** dict lookup: the orchestrator's own dispatch code marks an objective `completed` the instant a cell reports `confirmed`, with no further check. `_surface_exploit_payload` (`:44-73`) builds the per-cell task purely by regex-extracting `vuln_class`/`surface_key`/`session_name`/`skill_path` from the objective's title/notes/description — **no challenge or oracle context is in the payload shape at all.**

**Correction to the task's framing — this specific run is not using the "benchmark mode" the task assumes, and the oracle is already expressed in prose today.** The task frames the fix as "attach only when `roe.json`/`conops.json` says there's such an oracle." Reading the live engagement documents:
- `.raptix/workspace/juice-shop-v2/plan/roe.json:31` (`notes` field): *"OPERATOR RE-PRIORITIZATION (2026-10-15): the engagement objective is now to maximize the number of solved challenges on the application's scoreboard. GET /api/Challenges lists every challenge... and is the authoritative target list and progress meter."*
- `.raptix/workspace/juice-shop-v2/plan/conops.json:6-7` (`success_criteria`): *"Maximize the count of solved=true challenges returned by GET /api/Challenges..."* / *"After each exploit attempt, confirm the solve via GET /api/Challenges..."*

So the oracle is **already named in this engagement's own mission documents**, in freeform prose, and the orchestrator (which reads `roe.json`/`conops.json` at startup per `intelligence/prompts/standard/raptix.md`) already has it. The gap is not "no field exists to name the oracle" — it's that **nothing propagates that already-known fact down into the per-cell dispatch payload or the deterministic outcome-status table**, and the cell-level prompt (`surface_exploit.md`) is deliberately kept ignorant of mission state by Rule 6. Separately, there is a second, narrower mechanism in the codebase for CTF-style benchmarks — `BENCHMARK_MODE=1` (env var, container-wide) → `intelligence/agents/_benchmark_mode.py:4-8` (`benchmark_skill_sources()`) adds `/skills/benchmark/` as an extra skill source, and `orchestration/mission/engagement.py:120-122,468-477` (`_benchmark_mode_active()` gating `_build_benchmark_injection`) injects flag-format/vulnerability-tags/target-URL context every model call via `EngagementContextMiddleware.wrap_model_call` (`:406-477`). **This run does not use that path** — `plan/roe.json`/`plan/conops.json`/`plan/deconfliction.json`/`plan/opplan.json` all exist in the workspace (verified by listing), which `packages/raptix-skills/raptix_skills/defs/benchmark/SKILL.md:20-21` says is explicitly what BENCHMARK_MODE's Rule 8 suspension *skips* ("flag IS the deliverable; no roe/conops/deconfliction"). So two independent CTF-adjacent mechanisms already exist in Raptix, and the operator correctly chose the generic RoE/ConOps path over the flag-capture BENCHMARK_MODE path for a scoreboard-style target — this matches the task's framing better than the codebase's own "benchmark mode" does.
- `orchestration/mission/engagement.py:280-308` (`_load_deconfliction`) is a directly reusable precedent: it reads `<workspace>/plan/deconfliction.json` with an mtime cache, and `:310-325` (`_build_deconfliction_injection`) renders it into a short text block that `_inject` (`:454-459`) conditionally appends to every model call **only when the file is present** — i.e. Raptix already has the exact "per-engagement JSON file → conditional prompt addendum, absent for engagements that don't opt in" pattern this question asks for, just applied to deconfliction, not to a challenge oracle.
- `packages/raptix-skills/raptix_skills/defs/benchmark/SKILL.md` (full read) is the one file in the `benchmark/` skill category — a CTF-mode marker skill with a flag-string sweep (`:43-67`) and a tag→skill routing table (`:86-109`). It is flag-string-shaped (looks for `FLAG{...}`/`flag{...}`/`CTF{...}` in command output), which does not fit Juice Shop's boolean per-challenge `solved` scoreboard model — confirming the operator's choice not to use it here was correct, not an oversight.
- `packages/raptix-core/raptix_core/types/engagement.py:257-274` (`RoE`) and `:359-378` (`CONOPS`) are strict Pydantic models. `RoE` is flagged in `CLAUDE.md` as a security guard rail ("Treat anything touching... RoE... as a security guard rail"); `CONOPS` is the non-safety-critical "strategic overview" document and already carries a `methodology: str` field, making it the natural, lower-risk place for a new optional field.

### B1 — how published designs separate generic finding from benchmark win-condition

- **OWASP Juice Shop itself** ([help.owasp-juice.shop/appendix/integration.html](https://help.owasp-juice.shop/appendix/integration.html), fetched): `/api/Challenges` returns each challenge with an `id`, `key`, `name`, `category`, `difficulty`, and a boolean `solved` field (example shown as `"solved": false`). The docs **do not** specify what internally flips `solved` to `true` — that logic is fully internal to the target, which is itself evidence that "vulnerability exists" and "this named challenge's trigger fired" are treated as different layers even by the target's own author: the API is a black-box oracle you poll or subscribe to (`SOLUTIONS_WEBHOOK` env var — *"whenever one of its 102 hacking challenges is solved"*, POSTs a payload keyed by the challenge's `key`), not something your exploit code can derive analytically from the vulnerability class alone.
- **CTF-Dojo / CTFJudge** (arXiv 2508.05674, "Towards Effective Offensive Security LLM Agents," fetched): CTFJudge is described in the abstract as *"a framework leveraging LLM as a judge to analyze agent trajectories"* — i.e. a **post-hoc, trajectory-level evaluator**, architecturally outside the solving agent's own loop, scoring partial correctness against "human-crafted gold standards" via a separate "CTF Competency Index" metric. Win-condition verification is explicitly a layer bolted on top of, not embedded in, the exploitation reasoning.
- **DARPA AIxCC** (SoK paper, arXiv 2602.07666, and the contemporaneous Trail of Bits rules summary, both surfaced via search): competitors must submit a structured **Proof of Vulnerability (PoV)** that names the exact sanitizer and triggering harness, separately from a **Proof of Understanding (PoU)** that names the vulnerable lines, scored independently from any patch submitted. Even DARPA's flagship benchmark treats "a vulnerability was triggered" (PoV) and "the system understood/located it precisely" (PoU) as two distinct, separately-scored artifacts rather than one undifferentiated "confirmed" state — directly supporting a generic-confirmation vs. specific-trigger-verification split as the field's norm, not an oversight unique to Raptix.
- No primary source found draws a bright architectural line of "(b) is only ever a plugin a scored harness injects" vs. "(b) is baked into the core loop" as an explicit design choice; the closest statements (CTFJudge, AIxCC's PoV/PoU split) consistently put win-condition verification **outside** the core exploitation reasoning, as a harness/evaluator layer — supporting "plugin/adapter, not baked into the core loop" as the dominant pattern, though no source frames it in exactly those words.

#### B1 takeaway
Treat specific win-condition verification (scoreboard polling, flag matching) as a harness-/engagement-level concern that *reads* the result of generic vulnerability confirmation, never as logic inside the generic confirmation step itself. This matches both the external evidence above and Raptix's own `surface_exploit.md` Rule 6 ("the orchestrator owns matrix state").

### B2 — the cleanest attachment point in Raptix's own architecture

Given the corrected picture above (the oracle is already nameable in `conops.json` prose today; the gap is propagation, not a missing field), the fix has three small, independently-reviewable pieces, none of which touch `RoE` (guard rail) or the shared cell prompt beyond one generic sentence:

1. **`raptix_core/types/engagement.py`** — add one optional field to `CONOPS` (not `RoE`): e.g.
   ```python
   class SuccessOracle(BaseModel):
       endpoint: str  # e.g. "/api/Challenges"
       poll_field: str = "solved"
       mode: Literal["scoreboard"] = "scoreboard"

   class CONOPS(BaseModel):
       ...
       success_oracle: SuccessOracle | None = None
   ```
   This is additive and optional — existing `conops.json` documents (including ones with extra freeform keys like the live `success_criteria`/`methodology` list, which already don't strictly match the current schema) keep working.

2. **`orchestration/mission/engagement.py`** — add `_load_success_oracle(workspace)` / a small accessor mirroring the existing `_load_deconfliction` (`:280-308`) exactly: read `<workspace>/plan/conops.json`, pull `success_oracle`, mtime-cache it. This is **not** wired into `EngagementContextMiddleware._inject`'s per-model-call injection (that channel is for prose context to the orchestrator LLM, already working via the operator's own `notes`/`success_criteria` text); instead it's called once by the orchestrator's cell-dispatch path.

3. **`intelligence/agents/standard/_surface_dispatch.py`** — thread the oracle through the *existing* deterministic dispatch, not the prompt:
   - `_surface_exploit_payload` gains an `oracle: SuccessOracle | None` parameter; when present, append one line to `task_description`: `f"Oracle: after 'confirmed', GET {oracle.endpoint} once and report confirmed_solved/confirmed_unsolved (field: {oracle.poll_field})."`
   - Extend `SURFACE_EXPLOIT_OUTCOME_STATUS` (`:11-15`) with `"confirmed_solved": "completed"` and `"confirmed_unsolved": "in-progress"` so a scoreboard-unmoved cell does **not** silently get marked done — this is the direct fix for the diagnosis doc's NC-3 (objectives "completed" while XSS stayed 0/9).

4. **`intelligence/prompts/standard/surface_exploit.md`** — one generic, non-CTF-specific sentence added to `RESPONSE_FORMAT`/`CELL_PROTOCOL` step 4: *"If the task names an Oracle, after a `confirmed` result request it once and report `confirmed_solved` or `confirmed_unsolved` instead of `confirmed`."* Real engagements never see this trigger because their dispatch payload never carries an `oracle` field — the prompt line is a dead conditional for them, not a CTF leak. This satisfies "without duplicating the entire prompt per scenario" literally: one sentence, shared file, unconditionally present, conditionally actionable.

5. **Optional, for the "how to poll and diff" procedural detail**: a new skill, `packages/raptix-skills/raptix_skills/defs/benchmark/scoreboard-oracle/SKILL.md`, referenced by path from the injected `task_description` line in (3) — reusing `surface_exploit.md` Rule 1's existing "load the exact skill path named by the task" mechanism (`:11-14`), not `_benchmark_mode.py`'s env-gated `benchmark_skill_sources()`. This keeps the oracle methodology out of the shared prompt body entirely, consistent with how vuln-class methodology already lives in skills, not in `surface_exploit.md` itself.

**Why not reuse `BENCHMARK_MODE`/`EngagementContextMiddleware`'s existing "benchmark path"?** That channel is global (container-env-gated, `_benchmark_mode_active()` at `engagement.py:120-122`), flag-string-shaped (`flag_format`, the `benchmark/SKILL.md` grep-for-`FLAG{...}` sweep), and explicitly bypasses `roe.json`/`conops.json` (`benchmark/SKILL.md:20-21`). Juice Shop's boolean per-challenge scoreboard is a different shape than a single flag string, and this run already correctly chose the RoE/ConOps-driven path over it. Generalizing `BENCHMARK_MODE` to also understand scoreboards would conflate two different oracle shapes behind one env var; a typed `success_oracle` field on `CONOPS`, read per-workspace, is the smaller, more precise change and fits a RoE/ConOps-authored engagement (real or gamified) uniformly.

#### Recommendation B2
Implement points 1–4 above as one PR (small, additive, no guard-rail files touched, comfortably within the ≤400-line/≤10-file diff budget); treat point 5 as a fast-follow once the dispatch plumbing lands. Do not extend `BENCHMARK_MODE`/`benchmark/SKILL.md` for this — they solve a different (flag-capture) shape of benchmark and this run deliberately isn't using that path.

---

## Summary of disagreements with the task's framing

1. **Gap A**: Node Playwright is *already installed* in the sandbox image (`execution/sandbox/web/templates/node_modules`, via `sandbox.Dockerfile:417-424`) and already drives the system Chromium successfully for a different tool chain (`web_fetch`'s anti-bot escalation). The task's "no playwright installed" check only tested the Python package and the wrong invocation surface. The fix is a new sibling script reusing that existing installation, not a new dependency.
2. **Gap B**: this specific engagement is not running in Raptix's "benchmark mode" (`BENCHMARK_MODE=1`) at all — it has full `roe.json`/`conops.json`/`deconfliction.json`/`opplan.json`, and the operator already wrote the scoreboard-oracle instruction into `conops.json`'s prose. The missing piece is propagation from orchestrator-level mission context into the deterministic per-cell dispatch code (`_surface_dispatch.py`) and outcome table, not the absence of a place to declare the oracle.
