"""Classify all 2540 file-level nodes into architectural layers (deterministic prefix rules)."""
import json
import os
import sys

UA = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOT = os.path.dirname(UA)
NODES = os.path.join(UA, "tmp", "arch-compact-nodes.json")
OUT = os.path.join(UA, "intermediate", "layers.json")

L = []  # (id, name, description, match_fn)

def layer(id_, name, desc):
    L.append({"id": id_, "name": name, "description": desc})

layer("layer:agents-orchestration", "Agents & Orchestration (LangGraph)",
      "Các LangGraph agent red-team: standard agent, sub-agent, planning/attack flow và graph registry điều phối vòng lặp tác vụ.")
layer("layer:middleware-safety", "Middleware & Safety",
      "Middleware an toàn và guardrail: SafeCommand, RoE, HITL, EngagementContext, KG internal store và các hook post-tool.")
layer("layer:skills-library", "Skills Library",
      "Thư viện skill (SKILL.md, schema, engine proto, skill graph) cung cấp quy trình tấn công chuyên biệt cho agent, kể cả agent-skills tích hợp ngoài.")
layer("layer:tools-capabilities", "Tools & Capabilities",
      "Công cụ tác chiến của agent: tool bash/cloud/interaction, sandbox (web, kernel, server), backends thực thi, capabilities và blue_cell.")
layer("layer:runtime-core", "Runtime & Core Services",
      "Runtime chính của raptix: khởi động graph, LLM client, telemetry, MCP server, CLI entrypoint, server nội bộ và plugin loader.")
layer("layer:contracts-core", "Contracts Layer (raptix-core)",
      "Hợp đồng dùng chung (contracts, types, interfaces) của package raptix-core — không phụ thuộc framework, mọi tầng khác import vào.")
layer("layer:sdk-plugins", "SDK & Plugins (raptix-sdk)",
      "API công khai cho tác giả plugin: raptix-sdk, ví dụ plugin và loader tích hợp bên ngoài.")
layer("layer:launcher-go", "Launcher (Go)",
      "Launcher viết bằng Go: khởi động/stop stack Docker, health check, logs, quản lý model Ollama cho môi trường engagement.")
layer("layer:cli-client", "CLI Client",
      "Ứng dụng CLI tương tác agent (clients/cli) và thư viện streaming SSE dùng chung cho client terminal.")
layer("layer:web-dashboard", "Web Dashboard & Telemetry",
      "Web dashboard hiện hành (web-raptix: React app, server Prisma, runtime ownership), web-contracts dùng chung và telemetry-gateway Cloudflare Worker.")
layer("layer:legacy-web-desktop", "Legacy Web & Desktop",
      "Client web thế hệ cũ (Next.js, đã retired) và desktop client — chỉ còn giá trị tham chiếu.")
layer("layer:benchmark-harness", "Benchmark Harness",
      "Khung benchmark & bộ dữ liệu: harness, runner, scorer, providers, dreadgoad, cve_bench, cấu hình — đo hiệu năng agent trên các challenge.")
layer("layer:benchmark-results", "Benchmark Results",
      "Kết quả chạy benchmark đã lưu (logs, reports, outputs) — dữ liệu phân tích, không phải code runtime.")
layer("layer:tests", "Tests",
      "Bộ kiểm thử: unit/integration của package raptix và các test CI gốc repo (compose, web CI, loader/scorer benchmark).")
layer("layer:docs-adrs", "Documentation & ADRs",
      "Tài liệu dự án: ADR, thiết kế kiến trúc, bảo mật, hướng dẫn plugin/skill, README và quyết định kỹ thuật ở gốc repo.")
layer("layer:infra-ci", "Infrastructure & CI",
      "Hạ tầng vận hành: Docker Compose, containers, GitHub Actions, config LiteLLM proxy, scripts, Makefile và các file cấu hình gốc.")

def classify(p):
    # benchmark
    if p.startswith("benchmark/results"):
        return "layer:benchmark-results"
    if p.startswith("benchmark"):
        return "layer:benchmark-harness"
    # tests
    if p.startswith("tests") or p.startswith("packages/raptix/tests"):
        return "layer:tests"
    # packages
    if p.startswith("packages/raptix-core"):
        return "layer:contracts-core"
    if p.startswith("packages/raptix-sdk"):
        return "layer:sdk-plugins"
    if p.startswith("packages/raptix"):
        seg = p.split("/")
        sub = seg[3] if len(seg) > 3 and seg[2] == "raptix" else ""
        if sub == "agents":
            return "layer:agents-orchestration"
        if sub == "middleware":
            return "layer:middleware-safety"
        if sub == "skills":
            return "layer:skills-library"
        if sub in ("tools", "sandbox_web", "sandbox_kernel", "sandbox_server",
                   "backends", "capabilities", "blue_cell"):
            return "layer:tools-capabilities"
        return "layer:runtime-core"
    # clients
    if p.startswith("clients/launcher"):
        return "layer:launcher-go"
    if p.startswith("clients/cli"):
        return "layer:cli-client"
    if p.startswith("clients/shared/streaming"):
        return "layer:cli-client"
    if p.startswith("clients/web-raptix") or p.startswith("telemetry-gateway") or p.startswith("clients/shared"):
        return "layer:web-dashboard"
    if p.startswith("clients"):
        return "layer:legacy-web-desktop"
    if p.startswith("integrations/agent-skills"):
        return "layer:skills-library"
    # docs
    if p.startswith("docs"):
        return "layer:docs-adrs"
    if p.endswith(".md") or p in ("prompt.txt",):
        return "layer:docs-adrs"
    # infra
    if (p.startswith("containers") or p.startswith(".github") or p.startswith("config")
            or p.startswith("scripts") or p.startswith(".ua")
            or p.startswith("docker-compose") or p.startswith(".semgrep")):
        return "layer:infra-ci"
    if p in ("Makefile", "langgraph.json", "package.json", "pyproject.toml",
             ".dockerignore", ".gitattributes", ".gitmodules", ".markdownlintignore",
             ".pip-audit-ignore", ".python-version", ".shellcheckrc", ".env.example",
             ".golangci.yml", ".hadolint.yaml", ".markdownlint.yaml", ".migrations.json",
             ".pre-commit-config.yaml", ".typos.toml", ".yamllint.yaml"):
        return "layer:infra-ci"
    return None

nodes = json.load(open(NODES, encoding="utf-8"))
assign = {}
unmatched = []
for n in nodes:
    lid = classify(n["p"])
    if lid is None:
        unmatched.append(n["p"])
    else:
        assign[n["id"]] = lid

if unmatched:
    print("UNMATCHED (%d):" % len(unmatched))
    for u in unmatched:
        print("  ", u)
    sys.exit(1)

by_layer = {}
for nid, lid in assign.items():
    by_layer.setdefault(lid, []).append(nid)

assert len(assign) == len(nodes) == 2540, "coverage mismatch: %d" % len(assign)
assert len(assign) == len(set(assign)), "duplicate node ids"

out = []
for spec in L:
    ids = sorted(by_layer.pop(spec["id"], []))
    out.append({"id": spec["id"], "name": spec["name"],
                "description": spec["description"], "nodeIds": ids})
assert not by_layer, "unknown layer ids: %s" % list(by_layer)

os.makedirs(os.path.dirname(OUT), exist_ok=True)
json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

total = 0
for o in out:
    total += len(o["nodeIds"])
    print(f"{len(o['nodeIds']):5d}  {o['name']}")
print(f"{total:5d}  TOTAL ({len(out)} layers)")
