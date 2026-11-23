# Tài liệu Raptix

Raptix là agent red-team tự động: các agent LLM thực thi chuỗi tấn công
thật (recon → exploit → privesc → lateral movement → C2) chống lại
testbed đã được cấp phép, cách ly, dưới 1 engagement package (RoE,
ConOps, Deconfliction, OPPLAN). Runtime gồm 1 orchestrator điều phối
nhiều chuyên gia theo domain, chạy lệnh trong sandbox Kali, lưu quan sát
vào Neo4j và finding đã duyệt vào PostgreSQL, với nhiều lớp an toàn
(RoE machine-enforcement, HITL, audit ledger, phòng vệ prompt-injection)
chạy độc lập với việc model có "nghe lời" hay không.

## Kiến trúc

- [Kiến trúc repo](architecture/repo-architecture.md) — cấu trúc thư mục, luật import giữa package, phân loại tool.
- [Dữ liệu, graph & ranh giới dịch vụ](architecture/data-and-graph.md) — 3 graph dùng chung 1 Neo4j (Reference/Attack-Chain/Skillogy), schema node/edge thật, vì sao Postgres giữ finding đã duyệt.
- [Skills & Skillogy](architecture/skills-and-skillogy.md) — corpus kỹ năng, schema frontmatter, cơ chế tra cứu graph-backed (hybrid lexical+semantic).
- [Chọn model](model-settings.md) — resolver Tier×AuthMethod×Profile, fallback OAuth/API/local.
- [MCP tool server](mcp-servers.md) — gắn thêm tool ngoài qua Model Context Protocol.

## Bảo mật

- [Mô hình mối đe dọa](security/threat-model.md) — STRIDE theo 3 mặt tin cậy, các chuỗi xâm nhập nguy hiểm nhất.
- [Kiểm soát hệ thống](security/security-controls.md) — bảng control/knob/cách-kiểm-chứng, hardening container sandbox.
- [Kiểm soát & trách nhiệm](security/enforcement-and-accountability.md) — RoE machine-enforcement, audit ledger, HITL approval — 1 vòng đời của 1 lệnh bị gate.
- [Phòng vệ prompt-injection](security/prompt-injection-defense.md) — quarantine envelope, heuristic risk-tagging, policy tĩnh.
- [Neo4j hardening](security/neo4j-hardening.md) — allowlist APOC, runbook thêm hàm mới.
- [Blue Cell](security/blue-cell.md) — kiểm chứng rule phát hiện của blue team bằng chính hoạt động của Red Cell.

## Quyết định thiết kế quan trọng (ADR)

Toàn bộ 99 ADR gốc của dự án nằm trong lịch sử Git (bị gỡ khỏi cây docs
khi dọn repo, khôi phục bằng `git show <commit>^:docs/adr/<file>.md`).
Dưới đây là ~10 quyết định nền tảng nhất, giữ nguyên văn (tiếng Anh) tại
`docs/decisions/`:

| ADR | Quyết định |
| --- | --- |
| [1](decisions/01-bloodhound-via-bhce-rest-client.md) | Dùng BloodHound CE thật qua REST API thay vì tự xây lại logic ADCS/BloodHound — và vì sao BHCE có Neo4j riêng. |
| [2](decisions/02-ai-surface-technology-node.md) | Thêm node kind `Technology` để một cổng như Ollama 11434 trở thành dữ liệu graph có thể truy vấn, không chỉ là `Service{unknown}`. |
| [3](decisions/03-ukc-phase-is-runtime-state.md) | Phase tấn công là state runtime, không phải cấu trúc thư mục — một capability hợp lệ trải qua nhiều phase. |
| [4](decisions/04-enforce-dispatch-concurrency-ceiling.md) + [5](decisions/05-generic-fanout-admission.md) | Từ 1 incident tự-DoS (1 worker bị kẹt làm nghẽn mọi probe sau nó) tới 1 policy admission tổng quát, không hardcode theo domain. |
| [6](decisions/06-asset-identity-authority.md) | PostgreSQL là nguồn chân lý danh tính asset; Neo4j chỉ giữ quan hệ quan sát được gắn theo ID đó. |
| [7](decisions/07-single-operator-mode.md) | Cho phép 1 operator đơn lẻ tự quyết định thay vì kẹt ở guard four-eyes thiết kế cho team. |
| [8](decisions/08-project-files-only-through-the-project-sandbox.md) | Sửa 1 lỗ hổng đọc chéo file giữa project; mọi truy cập file phải qua đúng sandbox của project, fail-closed khi RoE không đọc được. |
| [9](decisions/09-verified-poc-gate-for-workspace-findings.md) | Verdict của 1 finding chỉ đến từ tool chạy lại PoC đã seal, không bao giờ từ model tự khẳng định (có incident thật `FIND-001`). |
| [10](decisions/10-retire-apps-web-for-ui-app-and-api.md) | Vì sao `apps/web` bị retire, thay bằng `apps/ui-app` (frontend nhập từ sản phẩm khác) + `apps/api` (lớp dịch BFF mới). |
| [11](decisions/11-project-scoped-graph-retrieval-and-promotion.md) | Vì sao 3 graph (Reference/Attack-Chain/Skillogy) dùng chung 1 Neo4j; promotion finding chỉ qua Postgres, không bao giờ qua Neo4j. |

Mỗi ADR theo format Context → Decision → Consequences → Alternatives
considered — đọc trực tiếp file để có đầy đủ lý do và các phương án đã
loại bỏ, không chỉ dòng tóm tắt ở trên.
