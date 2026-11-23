# Kiểm soát hệ thống

## Middleware an toàn

Mỗi agent dựng middleware stack theo `MiddlewareSlot` đã khai (chỉ các
slot trong `SLOTS_PER_ROLE` của role đó được tạo). 5 slot dưới đây là
guard an toàn runtime; 2 trong số đó **always-on và `SAFETY_CRITICAL`**
(không plugin nào tắt được trừ khi set
`RAPTIX_ALLOW_SAFETY_OVERRIDES=1`).

| Control | Mặc định | Biến điều khiển | Cách kiểm chứng |
| --- | --- | --- | --- |
| **RoE guardrail** | Chỉ audit, không chặn. Safety-critical. | `mode` trong `<workspace>/plan/roe.json:machine_enforcement` (`audit`/`warn`/`enforce`) | Thêm 1 target ngoài phạm vi ở mode `enforce` → nhận `ToolMessage` `[ROE_REFUSED]` + dòng `OUT_OF_SCOPE` trong audit ledger |
| **RoE egress guardrail** (network) | Bật mặc định khi `enforce`; đây là ranh giới scope thật sự | Tự động khi `machine_enforcement.mode=enforce` (dịch thành nftables + DNS allowlist trong sandbox); tắt bằng `RAPTIX_EGRESS_DISABLE=1` | Ở mode `enforce`, kết nối ra ngoài phạm vi bằng IP trực tiếp bị chặn ở tầng network dù command parser bị vượt qua |
| **Untrusted-output quarantine** | Luôn bật, mọi role. Safety-critical. | Không có — nằm trong `_BASE_SLOTS` | Đọc 1 banner độc hại → tool output được bọc trong `<UNTRUSTED_TOOL_OUTPUT>` |
| **Prompt-injection shield** | Luôn bật, mọi role. Safety-critical. | Không có — cùng cổng override như trên | Payload bị deny-list trong tool output bị bọc trước khi tới lượt gọi model kế tiếp |
| **HITL approval** | Tắt mặc định — opt-in | `RAPTIX_HITL__ENABLED` | Bật, kích hoạt mục tiêu `T1003` hoặc tool `sliver_*` → run tạm dừng, chờ ghi vào `<workspace>/approvals/requests.jsonl` |
| **Budget enforcement** | No-op trừ khi đặt cap | `RAPTIX_BUDGET__ENGAGEMENT_USD` / `RAPTIX_BUDGET__PER_AGENT_USD` | Đặt cap thấp → nhận event `budget_warning` ở ngưỡng mềm, `BudgetExceeded` (dừng run) ở 100% |

**"Safety-critical" nghĩa là gì**: `SAFETY_CRITICAL_SLOTS` liệt kê các
slot mà plugin chỉ được thay/tắt khi có
`RAPTIX_ALLOW_SAFETY_OVERRIDES=1` — gồm engagement context, RoE
enforcement, untrusted-output, prompt-injection shield, sandbox
notification, HITL approval. Cổng này tồn tại để một plugin cài nhầm
không thể âm thầm phá vỡ toàn bộ câu chuyện an toàn. Mọi thay đổi vào
các control này phải đối chiếu lại [mô hình mối đe dọa](threat-model.md).

### Biến môi trường

**Budget**: `RAPTIX_BUDGET__ENGAGEMENT_USD`/`RAPTIX_BUDGET__PER_AGENT_USD`
(mặc định `0.0` = tắt), `RAPTIX_BUDGET__SOFT_WARN_AT_PCT` (mặc định
`0.7`), `RAPTIX_BUDGET__POLL_SECONDS` (mặc định `5.0`). Middleware chỉ
chặn lệnh gọi LLM, không chặn tool call — 1 vòng tool đang chạy và câu
tổng hợp cuối vẫn có thể hoàn tất trước khi lần inference kế tiếp bị
chặn. Dữ liệu chi tiêu lấy từ bảng `spend_logs` của LiteLLM; lỗi
provider được coi là "chưa có dữ liệu lượt này, không chặn" chứ không
dừng cứng.

**Audit ledger**: `RAPTIX_AUDIT_HMAC_KEY` (secret của operator để ký
HMAC-SHA-256 chuỗi audit), `RAPTIX_ROE_AUDIT_PATH` (mặc định
`<workspace>/audit/roe-decisions.jsonl`). Chi tiết định dạng chain và
cách verify: [enforcement-and-accountability.md](enforcement-and-accountability.md).

**HITL**: `RAPTIX_HITL__ENABLED` (mặc định tắt; các giá trị
`""`/`0`/`false`/`no`/`off` đều coi là tắt).

## Sandbox — ranh giới workspace và container

Compose service cơ bản mount workspace ở `/workspace`; mỗi engagement
có thể bị pin vào đúng workspace của nó — một prefix đường dẫn trên
mount chung là 1 kiểm tra scope ở tầng runtime, nên khi đánh giá mức
cách ly thực tế phải xem đúng mount đang chạy, không suy đoán từ tên
biến. Ở luồng Web, `apps/api` tự resolve project→workspace và dùng
sandbox controller khi đã cấu hình URL+credential; file và bản ghi phê
duyệt đều đi qua sandbox gắn với project đó.

**Container**: drop toàn bộ capability trước khi thêm lại đúng tập đã
khai, bật `no-new-privileges`, **giới hạn 4 GiB RAM, tối đa 4096
process** (`docker-compose.yml`). Host controller (launcher Go) sở hữu
vòng đời container được phép chạy, giữ credential phía service, không
lộ ra runtime.

**Kiểm chứng hardening**: so sánh mount/capability/security-opt/resource
limit đã deploy với cấu hình mong đợi; xác nhận workspace có tên không
nhìn thấy thư mục project khác; test cách ly network bằng
`tests/test_compose_network_isolation.py` (HTTP test cục bộ — còn mount
và limit thật phải kiểm tra trực tiếp trên deployment).
