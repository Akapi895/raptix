# Raptix

Raptix là 1 nền tảng agent AI tự động thực hiện red-team: nhiều agent
LLM thực thi chuỗi tấn công thật (recon → exploit → privesc → lateral
movement → C2) chống lại testbed đã được cấp phép, cách ly - dưới 1
engagement package (RoE, ConOps, Deconfliction, OPPLAN). Mọi hành động
đi qua lớp an toàn runtime (RoE machine-enforcement, HITL approval,
audit ledger ký HMAC, phòng vệ prompt-injection), hoạt động độc lập,
không phụ thuộc vào việc model có tuân theo chỉ dẫn hay không.

## Thành phần hệ thống

- **Runtime Python** (`packages/raptix/`) - orchestrator điều phối
  ~20 agent chuyên biệt theo domain (recon, exploit, AD, cloud, mobile,
  wireless, reversing, smart-contract, phishing, blue-cell...), chạy
  lệnh qua sandbox Kali, lưu quan sát vào Neo4j và finding đã duyệt vào
  PostgreSQL.
- **Web console** (`apps/ui-app/` + `apps/api/`) - giao diện theo dõi
  project, conversation và finding; `apps/api` là lớp backend-for-frontend
  (BFF), dịch domain model của Raptix sang hợp đồng API mà frontend
  yêu cầu.
- **Launcher** (`apps/launcher/`, Go) - CLI `raptix` quản lý vòng đời
  stack: `raptix onboard`, `raptix start`/`stop`/`status`, `raptix web`.
- **Plugin theo domain** (`plugins/`) - mỗi domain (AD, cloud, mobile,
  IoT, ICS, wireless, phishing, reversing, smart-contract, web,
  network) là 1 package riêng, chỉ phụ thuộc SDK/core, đăng ký agent +
  skill + domain pack qua entry point.
- **Corpus kỹ năng** (`packages/raptix-skills/`) - hàng trăm file
  `SKILL.md` làm tài liệu kỹ thuật tham chiếu cho agent, truy xuất qua
  Skillogy (graph Neo4j, kết hợp tìm kiếm lexical và semantic).
- **Hạ tầng** (`infra/`, `docker-compose.yml`) - LiteLLM proxy
  (thống nhất API nhiều provider LLM), PostgreSQL, Neo4j, LangGraph,
  sandbox Kali, tùy chọn BloodHound CE (AD) và Sliver C2.

Chi tiết đầy đủ về kiến trúc, cách dùng graph/database, và các quyết
định thiết kế quan trọng: [docs/README.md](docs/README.md).

## Bắt đầu nhanh

**Yêu cầu**: Docker + Docker Compose, Python 3.13 (qua
[uv](https://github.com/astral-sh/uv)), Node.js ≥ 22.12, Go 1.25 (chỉ
để build launcher).

```bash
# 1. Build launcher và chạy wizard cấu hình lần đầu (viết .env, chọn provider LLM)
make launcher
./raptix onboard

# 2. Chạy toàn bộ stack từ code local (build image, khởi động qua launcher)
make dogfood

# Hoặc, nếu chỉ phát triển backend hằng ngày:
make dev          # hot-reload backend qua compose watch
make infra        # chỉ bật postgres/neo4j/litellm/langgraph/sandbox
```

Chạy web console cục bộ (không cần backend thật, dùng dữ liệu mẫu):

```bash
npm ci
npm run build --workspace=@raptix/web-contracts
npm run dev --workspace=@raptix/ui-app -- --mode demo
```

Các lệnh Make khác: `make status` (trạng thái container), `make logs`
(theo log), `make health` (kiểm tra KG + Neo4j), `make quality` (lint +
test trước khi mở PR), `make clean` (dọn toàn bộ). Chạy `make help` để
xem đầy đủ.

## Tài liệu

- [Mục lục tài liệu](docs/README.md) - kiến trúc, dữ liệu/graph,
  skills, mô hình bảo mật, và các ADR nền tảng.
- [Thiết lập Web console](apps/ui-app/README.md) · [Web API](apps/api/README.md)
- [Chọn model LLM](docs/model-settings.md) · [MCP tool server](docs/mcp-servers.md)
- Báo lỗi bảo mật riêng tư: xem phần cuối
  [mô hình mối đe dọa](docs/security/threat-model.md).

## Nguồn gốc

Raptix phát triển trên nền runtime Decepticon, và dùng lại 1 frontend
ban đầu được tách ra từ CyberStrikeAI (xem
[quyết định 10](docs/decisions/10-retire-apps-web-for-ui-app-and-api.md)
để biết vì sao có 2 thế hệ frontend trong repo). Các package Python
dưới `packages/` khai license Apache-2.0.
