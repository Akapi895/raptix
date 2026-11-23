# Kiến trúc repo

## Cấu trúc tổng quan

- `apps/` — Web console (`ui-app`), Web API (`api`), launcher Go, package TypeScript dùng chung.
- `packages/` — runtime Python, contract core, SDK plugin, corpus skill.
- `plugins/` — package theo domain (AD, cloud, mobile...), chỉ phụ thuộc SDK/core.
- `infra/` — định nghĩa container, cấu hình provider.
- `tests/` — kiểm tra xuyên package.

## Luật import (chiều phụ thuộc)

```text
Apps  →  Runtime  →  Core
          ↑
         SDK ←→ Core
          ↑
        Plugins → chỉ SDK/Core
          ↑
        Skills (chỉ Markdown/YAML, không import Python)
```

| Package | Được import | Không được import |
| --- | --- | --- |
| `raptix-core` | stdlib, Pydantic | LangChain, FastAPI, Neo4j, HTTPX, Docker, Playwright |
| `raptix-sdk` | `raptix-core` | nội bộ runtime `raptix` |
| `raptix` (runtime) | `raptix-core`, thư viện ngoài | — |
| Plugins | `raptix-sdk`, `raptix-core`, stdlib | nội bộ runtime `raptix` |
| Skills | không gì cả | bất kỳ package Python |
| Apps | API dịch vụ công khai | nội bộ runtime Python |

4 bài test cấu trúc ép buộc đúng các luật trên (AST-walk kiểm import SDK,
apps, skill corpus, và việc UKC phase không rò vào cấu trúc thư mục).
Ngoại lệ duy nhất: `infra/config/` (handler LLM provider) chủ đích không
phụ thuộc `raptix` gì cả — mounted riêng, không phải phần runtime.

## Các subsystem trong `packages/raptix/raptix/`

```text
raptix/
├── orchestration/
│   ├── phases/             # máy trạng thái macro-phase UKC — trạng thái runtime, không phải cấu trúc thư mục
│   └── mission/            # vòng đời engagement + theo dõi mục tiêu OPPLAN
├── knowledge/
│   ├── graph/              # Attack Chain Graph (Neo4j) — xem [Dữ liệu & graph](data-and-graph.md)
│   └── ingest/              # registry parser: output scanner → Observation[]
├── intelligence/
│   ├── agents/             # định nghĩa agent (standard/ + plugins/ + build.py)
│   ├── prompts/            # template prompt theo role/workflow
│   └── llm/                # model factory, router provider
├── capabilities/           # catalog capability, đánh giá availability/eligibility — WHAT, song song với execution/, không nằm trong nó
├── execution/
│   ├── tools/              # tool theo domain (bash, AD, cloud, web, opplan...)
│   ├── adapters/           # adapter capability dựa trên binary (nmap, sqlmap, netexec...)
│   ├── workers/            # runner/spec cho capability mở, giới hạn bước
│   ├── session/            # event log, ghi/replay lệnh, shutdown, task spec
│   ├── sandbox/             # backend sandbox: kernel, server, web
│   └── backends/           # cài đặt backend protocol
├── middleware/              # CHỈ adapter xuyên-cắt (budget, RoE, HITL, KG, skills...)
├── interfaces/
│   ├── mcp/                 # MCP server
│   └── api/                 # API HTTP LangGraph + checkpointer
├── skills/                  # loader/registry/selector/engine skill lúc runtime
└── specialist_contracts/    # contract capability của plugin/specialist, evidence gate, scorecard
```

**Luật sở hữu:**

1. Mỗi subsystem giữ state của mình, chỉ lộ ra qua protocol/hàm công khai.
2. Middleware chỉ được là adapter xuyên-cắt — không giữ state subsystem (từng vi phạm ở `middleware/engagement.py`/`opplan.py`, đã sửa thành shim mỏng redirect sang `orchestration/mission/`).
3. Phase UKC là state runtime (máy trạng thái), không phải cấu trúc thư mục — một capability như credential-access hợp lệ trải qua nhiều phase, nhốt nó vào 1 thư mục phase sẽ sai; xem [quyết định 3](../decisions/03-ukc-phase-is-runtime-state.md).
4. Hook middleware sau-tool phải giới hạn công việc, bắt lỗi im lặng, trả nguyên kết quả gốc.
5. `capabilities/` giải quyết WHAT (capability ngữ nghĩa → cài đặt); `execution/` giải quyết HOW. Không lồng cái này vào cái kia.

## Phân loại và sở hữu tool

Core contract định nghĩa capability (phân biệt rõ 3 khái niệm:
**Availability** — hệ thống có chạy được kỹ thuật không, **Eligibility**
— trạng thái hiện tại có cho phép dùng không, **Authorization** — lần
gọi cụ thể này có được phép không, ranh giới bảo mật thật kiểm tra lúc
gọi). Runtime giải quyết capability thành tool cụ thể theo role, thực
thi qua adapter, chuẩn hóa kết quả qua lớp ingest. An toàn (scope/approval)
kiểm tra lúc gọi, xem [Kiểm soát & trách nhiệm](../security/enforcement-and-accountability.md).

6 lớp phân loại tool: **Semantic capability** (mục tiêu theo contract
Core) · **Worker primitive** (1 phép toán trong 1 capability) ·
**Control-plane tool** (plan/engagement/approval/dispatch) ·
**Execution primitive** (thực thi chung cho role đã được cấp quyền) ·
**Adapter** (cài đặt cụ thể runtime chọn) · **Internal service** (parse,
ghi sổ, render — hỗ trợ, không phải capability).

## Dịch vụ domain riêng

BloodHound CE dùng API HMAC chính thức và **Neo4j riêng** (khác Attack
Chain Graph — xem [Dữ liệu & graph](data-and-graph.md) để biết vì sao).
Host controller (launcher Go) sở hữu vòng đời container cho các workload
được phép; mọi lệnh runtime đi qua ranh giới controller này, không gọi
Docker trực tiếp.
