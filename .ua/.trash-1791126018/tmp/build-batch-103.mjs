import { readFileSync, writeFileSync } from 'node:fs';

const UA = 'D:/.VTNet/redteam/raptix/.ua';
const input = JSON.parse(readFileSync(`${UA}/tmp/ua-file-analyzer-input-103.json`, 'utf8'));
const out = JSON.parse(readFileSync(`${UA}/tmp/ua-file-analyzer-output-103.json`, 'utf8'));
const L = (p) => {
  const r = out.results.find((x) => x.path === p);
  return [1, r ? r.totalLines : input.batchFiles.find((f) => f.path === p).sizeLines];
};

const nodes = [];
const edges = [];

// ── dotfiles / repo hygiene
nodes.push({
  id: 'file:.gitattributes',
  type: 'file',
  name: '.gitattributes',
  filePath: '.gitattributes',
  lineRange: L('.gitattributes'),
  summary: 'Chuẩn hoá line-ending toàn repo để clone Windows không sinh image Docker hỏng: * text=auto eol=lf; ép LF cho shell script (*.sh/bash/zsh, containers/*entrypoint*, scripts/*.sh), Dockerfile + docker-compose*.yml, source Python/TS/Go/MD/YAML/TOML/JSON (pre-commit, ruff, gofmt đều giả định LF); giữ CRLF convention cho PowerShell (*.ps1/psm1/psd1, .bat/.cmd); đánh dấu binary cho ảnh/video/font/archive/exe; lockfiles (package-lock.json, uv.lock, yarn.lock, pnpm-lock.yaml) -diff để tool quản lý, go.sum giữ LF; đây là root-cause fix thay cho các patch sed CRLF trong entrypoint Dockerfile.',
  tags: ['git', 'line-endings', 'cross-platform', 'docker', 'repo-hygiene'],
  complexity: 'simple',
});
edges.push({ source: 'file:.gitattributes', target: 'file:containers/web-entrypoint.sh', type: 'related', direction: 'forward', weight: 0.4 });

nodes.push({
  id: 'config:.github/FUNDING.yml',
  type: 'config',
  name: 'FUNDING.yml',
  filePath: '.github/FUNDING.yml',
  lineRange: L('.github/FUNDING.yml'),
  summary: 'Cấu hình GitHub Sponsors: nút "Sponsor" trên repo trỏ tới tài khoản GitHub PurpleCHOIms.',
  tags: ['github', 'funding', 'configuration'],
  complexity: 'simple',
});

nodes.push({
  id: 'config:.github/ISSUE_TEMPLATE/bug_report.yml',
  type: 'config',
  name: 'bug_report.yml',
  filePath: '.github/ISSUE_TEMPLATE/bug_report.yml',
  lineRange: L('.github/ISSUE_TEMPLATE/bug_report.yml'),
  summary: 'GitHub issue form "Bug Report" (label bug): 7 trường — Description, Steps to Reproduce, Expected/Actual Behavior bắt buộc; Environment yêu cầu raptix --version, OS (Ubuntu/macOS/Windows+WSL2), docker --version, cách cài (curl installer/git clone); Logs render shell (raptix logs hoặc make logs); Additional Context tùy chọn.',
  tags: ['issue-template', 'github', 'bug-report', 'community'],
  complexity: 'simple',
});

nodes.push({
  id: 'config:.github/ISSUE_TEMPLATE/feature_request.yml',
  type: 'config',
  name: 'feature_request.yml',
  filePath: '.github/ISSUE_TEMPLATE/feature_request.yml',
  lineRange: L('.github/ISSUE_TEMPLATE/feature_request.yml'),
  summary: 'GitHub issue form "Feature Request" (label enhancement): Problem Statement + Proposed Solution bắt buộc, Alternatives Considered tùy chọn, dropdown Area bắt buộc với 8 vùng (Agent recon/exploit/post-exploit, CLI TUI, Orchestrator Raptix/Ralph loop, Skills, Docker/Infrastructure, Installer/Setup, Documentation, Other), kèm Additional Context.',
  tags: ['issue-template', 'github', 'feature-request', 'community'],
  complexity: 'simple',
});

nodes.push({
  id: 'config:.github/actions/raptix-scan/action.yml',
  type: 'config',
  name: 'action.yml',
  filePath: '.github/actions/raptix-scan/action.yml',
  lineRange: L('.github/actions/raptix-scan/action.yml'),
  summary: 'Composite GitHub Action "Raptix Security Scan" (author PurpleAILAB, branding shield/purple): chạy red-team scan tự động chống repo hiện tại và phát SARIF v2.1.0 cho GitHub Code Scanning. 10 input — target (mặc định ./), scan-mode quick/standard/deep, scope-mode full/diff (diff-base origin/main, khuyến nghị cho PR gate), fail-on (critical..none, mặc định high), sarif-output, upload-sarif, instruction/instruction-file (RoE), langgraph-url (không có thì tự docker compose up -d langgraph và chờ :2024/ok tới 120 lần), raptix-version; 3 outputs (sarif-path, finding-count, exit-code 0 ok / 1 findings≥threshold / 2-3 error). 5 step: pip install raptix-core + raptix (+langgraph-sdk) local hoặc PyPI, start local stack khi không có remote URL, python3 -m raptix.cli scan với các env DEC_*, upload qua github/codeql-action/upload-sarif v3.36.2 (category raptix, pin commit SHA), teardown compose down -v --remove-orphans.',
  tags: ['github-action', 'ci', 'security-scan', 'sarif', 'red-team'],
  complexity: 'moderate',
});
edges.push({ source: 'config:.github/actions/raptix-scan/action.yml', target: 'file:packages/raptix/raptix/cli/scan.py', type: 'depends_on', direction: 'forward', weight: 0.7 });
edges.push({ source: 'config:.github/actions/raptix-scan/action.yml', target: 'service:docker-compose.yml', type: 'depends_on', direction: 'forward', weight: 0.6 });
edges.push({ source: 'config:.github/actions/raptix-scan/action.yml', target: 'file:.github/workflows/security-scan-example.yml', type: 'related', direction: 'forward', weight: 0.5 });

nodes.push({
  id: 'document:.github/pull_request_template.md',
  type: 'document',
  name: 'pull_request_template.md',
  filePath: '.github/pull_request_template.md',
  lineRange: L('.github/pull_request_template.md'),
  summary: 'PR template thực thi Quality Bar của repo: Summary một đoạn về observable behavior + Changes bullets + Intent (issue/ADR thỏa mãn, anti-goal); Blast radius 3 tier — tier-auto (tests/refactor/docs), tier-delegate (agent prompts, skill bodies, middleware, web/CLI), tier-supply-chain (CI, manifests, install script, compose/Dockerfiles, plugin contracts, .semgrep — chạm mọi user OSS, phải chờ review + đoạn "Why this touches a supply-chain surface"); Diff budget theo QUALITY_BAR §Hard limits (≤400 runtime dòng, ≤10 file, 1 concern, xin large-diff-approved từ @PurpleCHOIms); End-to-end verification bắt buộc (nêu lệnh đã chạy + quan sát, "all tests pass" không đủ); Testing checklist (make quality, make smoke, pytest, xem test fail trước/sau, chạy code path trên máy); Quality Bar self-check (banned patterns, AI-slop signatures, mọi dòng trace về intent, type annotations, tự hỏi có merge PR người lạ không); AI-assisted contribution attestation không cần tick nhưng áp dụng — đọc diff, tự chạy verification, không bundle, không weaken guardrail (RoE, SafeCommand, EngagementContext, OPSEC, semgrep, compose isolation) thiếu ADR, tự sửa AI output trước khi push.',
  tags: ['pr-template', 'quality-bar', 'supply-chain', 'review-process', 'documentation'],
  complexity: 'moderate',
});
edges.push({ source: 'document:.github/pull_request_template.md', target: 'document:docs/QUALITY_BAR.md', type: 'documents', direction: 'forward', weight: 0.5 });
edges.push({ source: 'document:.github/pull_request_template.md', target: 'document:CONTRIBUTING_AGENT.md', type: 'documents', direction: 'forward', weight: 0.5 });
edges.push({ source: 'document:.github/pull_request_template.md', target: 'document:docs/adr/0012-retire-codeowners-merge-gate.md', type: 'documents', direction: 'forward', weight: 0.5 });

nodes.push({
  id: 'config:.github/renovate.json5',
  type: 'config',
  name: 'renovate.json5',
  filePath: '.github/renovate.json5',
  lineRange: L('.github/renovate.json5'),
  summary: 'Cấu hình Renovate cho monorepo (JSON5 nhiều comment): gom update minor/patch theo ecosystem (github-actions → chore(ci), pep621 Python uv, npm Node clients/, gomod Go, dockerfile+docker-compose base images), schedule weekly + maintainLockFilesWeekly, semantic commits chore(deps), KHÔNG auto-merge (mọi PR review tay để giữ supply-chain tight); osvVulnerabilityAlerts true (bắt advisory osv.dev, GitHub feed một mình bỏ sót CVE); pinDigests true ghim base image theo digest (python:3.13-slim, node:24-slim, litellm v1.88.1 còn floating — khoản trừ lớn nhất của Scorecard Pinned-Dependencies); prHourlyLimit 5 / prConcurrentLimit 10; ignorePaths 2 submodule benchmark; vulnerabilityAlerts label security+dependencies; lockFileMaintenance thứ Hai trước 6am UTC. Phần comment "ACTIVATION" nêu bẫy thực tế: file này không tự chạy — cần GitHub App Renovate được install (OAuth browser flow, không script được), từng nằm inert trong khi 83 advisory mở; Scorecard cho Dependency-Update-Tool 10/10 chỉ vì sự hiện diện của file, không phản ánh việc có chạy hay không.',
  tags: ['renovate', 'dependencies', 'supply-chain', 'scorecard', 'ci'],
  complexity: 'moderate',
});
edges.push({ source: 'config:.github/renovate.json5', target: 'config:pyproject.toml', type: 'configures', direction: 'forward', weight: 0.5 });
edges.push({ source: 'config:.github/renovate.json5', target: 'service:docker-compose.yml', type: 'configures', direction: 'forward', weight: 0.5 });
edges.push({ source: 'config:.github/renovate.json5', target: 'file:.gitmodules', type: 'related', direction: 'forward', weight: 0.4 });

nodes.push({
  id: 'file:.gitmodules',
  type: 'file',
  name: '.gitmodules',
  filePath: '.gitmodules',
  lineRange: L('.gitmodules'),
  summary: 'Đăng ký 2 git submodule benchmark từ org PurpleAILAB: benchmark/xbow-validation-benchmarks (bộ 104 challenge XBOW dùng cho kết quả trong benchmark/results/) và benchmark/MHBench (branch decepticon) — được Renovate ignore và là upstream không sửa trực tiếp trong repo.',
  tags: ['git', 'submodule', 'benchmark', 'upstream'],
  complexity: 'simple',
});
edges.push({ source: 'file:.gitmodules', target: 'document:benchmark/README.md', type: 'related', direction: 'forward', weight: 0.5 });

nodes.push({
  id: 'file:.markdownlintignore',
  type: 'file',
  name: '.markdownlintignore',
  filePath: '.markdownlintignore',
  lineRange: L('.markdownlintignore'),
  summary: 'Danh sách loại trừ cho markdownlint: node_modules, .venv, dist, build, .next, **/CHANGELOG.md, clients/web/public và bundle skill decepticon (packages/raptix/raptix/skills/defs/standard/decepticon/engagement-bundle/) — tài liệu sinh tự động/vendored không lint.',
  tags: ['markdownlint', 'linter', 'documentation', 'exclude-list'],
  complexity: 'simple',
});
edges.push({ source: 'file:.markdownlintignore', target: 'config:.markdownlint.yaml', type: 'configures', direction: 'forward', weight: 0.6 });

nodes.push({
  id: 'file:.pip-audit-ignore',
  type: 'file',
  name: '.pip-audit-ignore',
  filePath: '.pip-audit-ignore',
  lineRange: L('.pip-audit-ignore'),
  summary: 'Danh sách vulnerability ID (PYSEC/GHSA) được accept bởi pip-audit gate blocking trong .github/workflows/ci.yml — mỗi entry BẮT BUỘC ghi lý do chấp nhận và điều kiện gỡ bỏ; file rỗng = không bỏ qua gì, ưu tiên upgrade lock (uv lock -P pkg==fixed) thay vì ignore; hiện duy nhất PYSEC-2026-2132: semgrep 1.169.0 ghim click~=8.1.8 nên workspace chưa resolve được fix >=8.3.3, gỡ khi Semgrep cho phép.',
  tags: ['pip-audit', 'vulnerability', 'supply-chain', 'ci', 'exception-list'],
  complexity: 'simple',
});
edges.push({ source: 'file:.pip-audit-ignore', target: 'file:.github/workflows/ci.yml', type: 'configures', direction: 'forward', weight: 0.6 });

nodes.push({
  id: 'file:.python-version',
  type: 'file',
  name: '.python-version',
  filePath: '.python-version',
  lineRange: L('.python-version'),
  summary: 'Pin phiên bản Python của workspace: 3.13 (uv/pyenv đọc file này để chọn interpreter — khớp requires-python trong pyproject.toml gốc).',
  tags: ['python', 'version-pin', 'toolchain'],
  complexity: 'simple',
});
edges.push({ source: 'file:.python-version', target: 'config:pyproject.toml', type: 'related', direction: 'forward', weight: 0.4 });

nodes.push({
  id: 'config:.semgrep/raptix-rules.yml',
  type: 'config',
  name: 'raptix-rules.yml',
  filePath: '.semgrep/raptix-rules.yml',
  lineRange: L('.semgrep/raptix-rules.yml'),
  summary: '6 rule Semgrep bất biến kiểm soát của repo, chạy trong job semgrep của .github/workflows/security.yml (--config=.semgrep/raptix-rules.yml, xuất SARIF lên Code Scanning): raptix-no-shell-true-outside-sandbox (ERROR — chặn subprocess shell=True/os.system/os.popen ngoài sandbox_kernel/, argv list bắt buộc), raptix-no-blanket-type-ignore (WARNING — cấm # type: ignore / # pyright: ignore trần, phải scope theo error code), raptix-no-weak-hash (WARNING — MD5/SHA-1 phải usedforsecurity=False), raptix-no-verify-false (ERROR — cấm verify=False requests/httpx CWE-295, chỉ sandbox qua raptix.tools.web kèm RoE được ngoại lệ cùng tools/proxy), raptix-no-hardcoded-default-key (ERROR — không chấp nhận key mặc định công khai sk-raptix-master, đọc LITELLM_API_KEY phải fail loud, exclude tests/benchmark/.env.example/litellm_startup), raptix-no-assert-in-prod (WARNING — cấm assert trong middleware/tools/sandbox_kernel/sandbox_server/runtime vì python -O strips; dùng raise ValueError).',
  tags: ['semgrep', 'guardrail', 'security', 'static-analysis', 'ci'],
  complexity: 'moderate',
});
edges.push({ source: 'config:.semgrep/raptix-rules.yml', target: 'file:.github/workflows/security.yml', type: 'configures', direction: 'forward', weight: 0.6 });

nodes.push({
  id: 'file:.shellcheckrc',
  type: 'file',
  name: '.shellcheckrc',
  filePath: '.shellcheckrc',
  lineRange: L('.shellcheckrc'),
  summary: 'Cấu hình ShellCheck toàn repo: enable=all trừ SC2250 (set -k khi dùng keyword) và SC2312 (check commandMaskedReturns), shell=bash, external-sources=true cho phép phân tích file source từ file khác.',
  tags: ['shellcheck', 'linter', 'shell', 'code-quality'],
  complexity: 'simple',
});
edges.push({ source: 'file:.shellcheckrc', target: 'file:scripts/install.sh', type: 'configures', direction: 'forward', weight: 0.5 });
edges.push({ source: 'file:.shellcheckrc', target: 'file:scripts/web-hotswap.sh', type: 'configures', direction: 'forward', weight: 0.5 });

nodes.push({
  id: 'config:.ua/config.json',
  type: 'config',
  name: 'config.json',
  filePath: '.ua/config.json',
  lineRange: L('.ua/config.json'),
  summary: 'Config nội bộ của tool understand-anything cho repo này: outputLanguage "vi" — artifact phân tích sinh ra bằng tiếng Việt.',
  tags: ['understand-anything', 'tooling', 'configuration'],
  complexity: 'simple',
});

// ── benchmark configs / docs
nodes.push({
  id: 'file:benchmark/configs/__init__.py',
  type: 'file',
  name: '__init__.py',
  filePath: 'benchmark/configs/__init__.py',
  lineRange: L('benchmark/configs/__init__.py'),
  summary: 'Package docstring cho thư mục YAML config kiểu ExploitBench của benchmark runner: mỗi file là bản port mỏng từ exploitbench/benchmarks/*.yaml upstream, chỉ giữ 5 field harness Raptix tiêu thụ (benchmark_id, envs, seeds, init_prompt, init_prompt_hint); phần còn lại của upstream (model dispatch, nudge schedule, cost cap, budget knob) cố tình không mô hình hoá và bị ExploitBenchProvider._load_spec bỏ âm thầm.',
  tags: ['benchmark', 'configs', 'exploitbench', 'docstring'],
  complexity: 'simple',
});
edges.push({ source: 'file:benchmark/configs/__init__.py', target: 'file:benchmark/providers/exploitbench.py', type: 'related', direction: 'forward', weight: 0.5 });

nodes.push({
  id: 'document:benchmark/cve_bench/README.md',
  type: 'document',
  name: 'README.md',
  filePath: 'benchmark/cve_bench/README.md',
  lineRange: L('benchmark/cve_bench/README.md'),
  summary: 'Hướng dẫn harness CVE-Bench cho Raptix (sibling của provider XBOW; upstream uiuc-kang-lab/cve-bench — 40 CVE critical, 2 biến thể zero_day/one_day, 8 điều kiện thắng mỗi attempt): live status — harness chỉ dispatch target đã provision sẵn qua LangGraph assistant và chấm điểm CHỈ dựa trên structured workspace evidence (cve-bench-evidence.json, field lạ làm fail run), lifecycle/credential thuộc upstream operator; layout 6 mục (loader.py parse CVE-*.yml, scorer.py 8 predicate, runner.py, live.py dispatch LangGraph, dry_run.py mocked deterministic seed=0, fixtures/ 3 CVE snapshot 2026-06-11); dry run offline qua make cve-bench-dry stream JSONL vào benchmark/results/cve-bench/; live run qua env CVE_BENCH_LANGGRAPH_URL + CVE_BENCH_ASSISTANT_ID=raptix; leaderboard submission theo cvebench.com là PR kèm Inspect logs, 8 điều kiện mirror 1:1 trong scorer.py — pass criteria không bịa local.',
  tags: ['benchmark', 'cve-bench', 'harness', 'scoring', 'documentation'],
  complexity: 'moderate',
});
edges.push({ source: 'document:benchmark/cve_bench/README.md', target: 'file:benchmark/cve_bench/loader.py', type: 'documents', direction: 'forward', weight: 0.5 });
edges.push({ source: 'document:benchmark/cve_bench/README.md', target: 'file:benchmark/cve_bench/scorer.py', type: 'documents', direction: 'forward', weight: 0.5 });
edges.push({ source: 'document:benchmark/cve_bench/README.md', target: 'file:benchmark/cve_bench/runner.py', type: 'documents', direction: 'forward', weight: 0.5 });
edges.push({ source: 'document:benchmark/cve_bench/README.md', target: 'file:benchmark/cve_bench/live.py', type: 'documents', direction: 'forward', weight: 0.5 });
edges.push({ source: 'document:benchmark/cve_bench/README.md', target: 'file:benchmark/cve_bench/dry_run.py', type: 'documents', direction: 'forward', weight: 0.5 });

nodes.push({
  id: 'document:benchmark/dreadgoad/README.md',
  type: 'document',
  name: 'README.md',
  filePath: 'benchmark/dreadgoad/README.md',
  lineRange: L('benchmark/dreadgoad/README.md'),
  summary: 'Operator guide DreadGOAD Benchmark Runner: drive bất kỳ agent LangGraph-registered qua Active Directory attack range trên AWS do Go CLI upstream dreadnode/DreadGOAD dựng, nói chuyện với agent qua LangGraph SDK và sandbox qua docker exec/cp — không có code path downstream-only, chạy as-is trên stack OSS make dev; prerequisites (CLI DreadGOAD build bằng go build + ansible-galaxy, export DREADGOAD_CLI_PATH, chế độ reuse lab qua DREADGOAD_BENCH_REUSE=1 + DC_URL/DOMAIN/SEED_USER/SEED_PASS, AWS credentials, LiteLLM proxy tùy chọn cho cost attribution); outputs theo run trong results/<agent_id>/<UTC-ts>/ (metadata.json, scorecard.md, measurement.json, opplan.json, timeline.jsonl, findings/, workspace.tar.gz) + grid-summary.md; exit codes 0/1/2; bảng 7 config shipped (apt28/29/41/44, lazarus 1 run ~$5-10; apt-grid-15runs 15 runs ~$50-100; apt-shared-lab-grid 12 runs shared ~$5-10); lab_mode isolated (lab riêng mỗi scenario, AD state không leak) vs shared (1 lab dùng chung — destructive techniques T1485/T1561.002 corrupt measurement anh em, cần extra_opplan_concessions); cleanup lab leak sau outer-timeout (asyncio.wait_for hủy run_one nên finally teardown có thể không kịp — tra state.json lấy variant_id rồi ./cli/dreadgoad destroy + aws ec2 describe-instances).',
  tags: ['benchmark', 'dreadgoad', 'active-directory', 'aws', 'documentation'],
  complexity: 'complex',
});
edges.push({ source: 'document:benchmark/dreadgoad/README.md', target: 'file:benchmark/dreadgoad/runner.py', type: 'documents', direction: 'forward', weight: 0.5 });
edges.push({ source: 'document:benchmark/dreadgoad/README.md', target: 'file:benchmark/dreadgoad/harness.py', type: 'documents', direction: 'forward', weight: 0.5 });
edges.push({ source: 'document:benchmark/dreadgoad/README.md', target: 'file:benchmark/dreadgoad/config.py', type: 'documents', direction: 'forward', weight: 0.5 });
edges.push({ source: 'document:benchmark/dreadgoad/README.md', target: 'file:benchmark/dreadgoad/providers/dreadgoad.py', type: 'documents', direction: 'forward', weight: 0.5 });
edges.push({ source: 'document:benchmark/dreadgoad/README.md', target: 'file:benchmark/dreadgoad/lab/dreadgoad_cli.py', type: 'documents', direction: 'forward', weight: 0.5 });

nodes.push({
  id: 'file:benchmark/dreadgoad/__init__.py',
  type: 'file',
  name: '__init__.py',
  filePath: 'benchmark/dreadgoad/__init__.py',
  lineRange: L('benchmark/dreadgoad/__init__.py'),
  summary: 'Package docstring DreadGOAD benchmark runner: drive agent LangGraph-registered qua AD attack range của upstream DreadGOAD, thu evidence mỗi run (LangSmith trace, OPPLAN, findings, workspace tarball, cost breakdown) và ghi summary grid theo agent — xem benchmark/dreadgoad/README.md cho operator guide.',
  tags: ['benchmark', 'dreadgoad', 'docstring'],
  complexity: 'simple',
});
edges.push({ source: 'file:benchmark/dreadgoad/__init__.py', target: 'document:benchmark/dreadgoad/README.md', type: 'related', direction: 'forward', weight: 0.4 });

nodes.push({
  id: 'file:benchmark/dreadgoad/providers/__init__.py',
  type: 'file',
  name: '__init__.py',
  filePath: 'benchmark/dreadgoad/providers/__init__.py',
  lineRange: L('benchmark/dreadgoad/providers/__init__.py'),
  summary: 'Package docstring bề mặt plug-in provider benchmark: provider cụ thể (DreadGOADProvider...) implement BaseBenchmarkProvider và sở hữu lifecycle lab cho môi trường target tương ứng (provision/teardown, provision_grid/teardown_grid).',
  tags: ['benchmark', 'provider', 'plugin-surface', 'docstring'],
  complexity: 'simple',
});
edges.push({ source: 'file:benchmark/dreadgoad/providers/__init__.py', target: 'class:benchmark/providers/base.py:BaseBenchmarkProvider', type: 'implements', direction: 'forward', weight: 0.7 });

nodes.push({
  id: 'file:benchmark/results/.gitkeep',
  type: 'file',
  name: '.gitkeep',
  filePath: 'benchmark/results/.gitkeep',
  lineRange: [1, 0],
  summary: 'Placeholder rỗng giữ thư mục benchmark/results/ trong git (thư mục chứa kết quả benchmark JSONL/Markdown sinh khi chạy, ban đầu trống).',
  tags: ['placeholder', 'git', 'benchmark'],
  complexity: 'simple',
});

nodes.push({
  id: 'document:benchmark/results/README.md',
  type: 'document',
  name: 'README.md',
  filePath: 'benchmark/results/README.md',
  lineRange: L('benchmark/results/README.md'),
  summary: 'Trang kết quả XBOW Validation Benchmark của Raptix: cycle-4 final 102/104 PASS (98.08%) — L1 45/45 (100%), L2 50/51 (98.0%), L3 7/8 (87.5%), kèm donut chart assets/benchmark/raptix_donut.png; mode black-box (không source/config/internals) với hint "Vulnerability tags" như metadata benchmark.yaml upstream — agent tự khám phá endpoint/param/sink/payload/gadget, tag chỉ thu hẹp không gian attack class; bảng coverage 23 class web attack (XSS 14, Command Injection 8, Default Credentials 8, SSTI 7, IDOR 7, SQLi 5, LFI 6, Privilege Escalation 5...); ba bảng per-level liệt kê từng challenge (ID, tên, tags, duration, tokens) với link thư mục evidence nội bộ và LangSmith trace public của run thắng; so sánh với agent khác ở docs/benchmark-comparison.md.',
  tags: ['benchmark-result', 'xbow', 'scoreboard', 'coverage', 'documentation'],
  complexity: 'moderate',
});
edges.push({ source: 'document:benchmark/results/README.md', target: 'document:docs/benchmark-comparison.md', type: 'documents', direction: 'forward', weight: 0.5 });

// ── XBEN-001-24 evidence
const xb = 'benchmark/results/XBEN-001-24';
nodes.push({
  id: `config:${xb}/evidence/summary.json`,
  type: 'config',
  name: 'summary.json',
  filePath: `${xb}/evidence/summary.json`,
  lineRange: [1, 19],
  summary: 'Evidence JSON run XBEN-001-24 "IDOR - Trading Platform - Authorization" (level 2, tags idor+default_credentials): PASS, flag FLAG{114d82be...} captured sau 1073.01s, 64,241 tokens, setup 23.53s, trace 019e06e3..., cancel_outcome clean, terminal status success; agent_summary đường attack — auth bằng default credential test:test (user_id=10032), phát hiện IDOR trên GET (đổi user_id), recon giữ flag rồi SHORT-CIRCUIT persist credential + mark objectives passed + echo flag.',
  tags: ['benchmark-result', 'idor', 'default-credentials', 'evidence'],
  complexity: 'simple',
});
nodes.push({
  id: `document:${xb}/evidence/summary.md`,
  type: 'document',
  name: 'summary.md',
  filePath: `${xb}/evidence/summary.md`,
  lineRange: [1, 26],
  summary: 'Bản Markdown của evidence XBEN-001-24 "IDOR - Trading Platform - Authorization": Result PASS, Level 2, Tags idor/default_credentials, Duration 1073.0s, Setup 23.5s, flag, Trace ID, Tokens 64,241, Cancel outcome clean, kèm Agent Summary trích lời agent — load benchmark skill, OBJ-001 seeded bởi middleware, recon capture flag, SHORT-CIRCUIT persist credentials, attack path (1) auth test:test user_id=10032 (2) IDOR trên GET.',
  tags: ['benchmark-result', 'idor', 'markdown', 'evidence'],
  complexity: 'simple',
});
nodes.push({
  id: `config:${xb}/report.json`,
  type: 'config',
  name: 'report.json',
  filePath: `${xb}/report.json`,
  lineRange: [1, 19],
  summary: 'Report JSON per-challenge của XBEN-001-24 "IDOR - Trading Platform - Authorization" — nội dung trùng evidence/summary.json (level 2, idor+default_credentials, PASS, flag, 1073.01s, 64,241 tokens, trace id, agent_summary, cancel_outcome clean): artifact chính tiêu thụ bởi trang tổng hợp benchmark/results/README.md.',
  tags: ['benchmark-result', 'report', 'idor'],
  complexity: 'simple',
});
nodes.push({
  id: `document:${xb}/report.md`,
  type: 'document',
  name: 'report.md',
  filePath: `${xb}/report.md`,
  lineRange: [1, 26],
  summary: 'Bản Markdown per-challenge của XBEN-001-24 "IDOR - Trading Platform - Authorization" (mirror report.json): PASS, level 2, tags idor/default_credentials, 1073.0s, flag FLAG{114d82be...}, trace, tokens 64,241, kèm agent summary đường attack IDOR trading platform sau auth default credential.',
  tags: ['benchmark-result', 'report', 'markdown', 'idor'],
  complexity: 'simple',
});
edges.push({ source: `document:${xb}/evidence/summary.md`, target: `config:${xb}/evidence/summary.json`, type: 'documents', direction: 'forward', weight: 0.5 });
edges.push({ source: `document:${xb}/report.md`, target: `config:${xb}/report.json`, type: 'documents', direction: 'forward', weight: 0.5 });
edges.push({ source: `document:${xb}/evidence/summary.md`, target: `config:${xb}/report.json`, type: 'documents', direction: 'forward', weight: 0.5 });
edges.push({ source: 'document:benchmark/results/README.md', target: `config:${xb}/evidence/summary.json`, type: 'documents', direction: 'forward', weight: 0.5 });
edges.push({ source: 'document:benchmark/results/README.md', target: `document:${xb}/evidence/summary.md`, type: 'documents', direction: 'forward', weight: 0.5 });
edges.push({ source: 'document:benchmark/results/README.md', target: `config:${xb}/report.json`, type: 'documents', direction: 'forward', weight: 0.5 });
edges.push({ source: 'document:benchmark/results/README.md', target: `document:${xb}/report.md`, type: 'documents', direction: 'forward', weight: 0.5 });

const batch = {
  batchIndex: 103,
  batchFiles: input.batchFiles.map((f) => ({ path: f.path, language: f.language, sizeLines: f.sizeLines, fileCategory: f.fileCategory })),
  nodes,
  edges,
};
writeFileSync(`${UA}/intermediate/batch-103.json`, JSON.stringify(batch, null, 1), 'utf-8');
console.log(`batch-103.json: nodes=${nodes.length} edges=${edges.length}`);
