# Mô hình mối đe dọa (threat model)

Phân tích STRIDE trên đường xâm nhập xuyên qua 3 mặt tin cậy.

## 3 mặt tin cậy

1. **Operator** — người chạy Raptix, máy của họ, token OAuth
   Claude/OpenAI/Codex, file `.env` chứa API key.
2. **Management** (`raptix-net`) — LangGraph, LiteLLM, PostgreSQL, Neo4j.
3. **Operational** (`sandbox-net`) — sandbox Kali, server Sliver C2 (khi
   bật), hạ tầng target.

Cầu nối giữa các mặt là đường xâm nhập nguy hiểm nhất.

## 4 cầu nối, xếp theo mức độ thiệt hại

| Cầu nối | Mang theo | Nếu bị chiếm |
| --- | --- | --- |
| Neo4j dual-homed | Cypher/APOC | RCE từ sandbox sang management nếu APOC không giới hạn |
| LiteLLM | File OAuth + API key provider | Chiếm toàn bộ LLM provider, tốn chi phí engagement, lộ credential chéo khách hàng |
| Plugin entry-point | Python chạy tùy ý lúc `import raptix` | 1 bundle độc hại `pip install` → RCE lúc agent khởi động |
| Web dashboard | Sửa OPPLAN, override của operator, trạng thái engagement | Chiếm toàn quyền agent nếu web expose không auth |

## STRIDE theo từng tài nguyên (tóm tắt — chỉ các mục còn mở hoặc đáng chú ý)

**Neo4j**: rủi ro lớn nhất đã đóng — allowlist APOC + tắt file-I/O chặn
`apoc.cypher.runFile('file:///proc/self/environ')` đọc env management
(xem [neo4j-hardening.md](neo4j-hardening.md)). Còn mở: user Cypher dùng
chung giữa sandbox và management (chưa tách theo engagement); chưa có
timeout riêng cho truy vấn nặng ngoài transaction timeout mặc định của
Neo4j.

**LiteLLM**: OAuth/API key giữ phía server, không lộ ra sandbox. Rủi ro
còn mở: master key mặc định (`sk-raptix-master`) cần operator tự đổi.
Chi tiêu theo engagement được chặn bởi `BudgetEnforcementMiddleware`
(xem [security-controls.md](security-controls.md)).

**Sandbox**: `UntrustedOutputMiddleware` + detector injection chặn lệnh
bị banner độc hại ghi đè; `RoEEnforcementMiddleware` chặn target ngoài
phạm vi (xem [enforcement-and-accountability.md](enforcement-and-accountability.md)).
Giới hạn tài nguyên hiện tại: `mem_limit: 4g`, `pids_limit: 4096` — **đã
triển khai** (không còn là kế hoạch; file này từng ghi sai là "mem
unbounded, pids_limit 1024, Open"). Còn mở: 1 container Kali dùng chung
nhiều engagement (chưa tách container theo engagement); chưa có ranh
giới kernel riêng (microVM) cho đa khách hàng.

**LangGraph orchestrator**: `UntrustedOutputMiddleware` bọc kết quả mọi
`task()`; `recursion_limit` theo role (200-1000) chặn đệ quy vô hạn.
Còn mở: danh sách subagent cho phép dựa vào `raptix.subagents` entry
point, phụ thuộc operator tự tin tưởng plugin đã cài, chưa có ký số
bundle.

**Web dashboard**: route graph đã được chặn theo quyền sở hữu Prisma +
giới hạn label theo engagement. Còn mở: deploy không phải localhost chưa
có auth mặc định.

## Các chuỗi xâm nhập nguy hiểm nhất

1. **Banner độc → APOC → lộ env management.** Trang target trả về text
   ảnh hưởng lệnh `kg_query` kế tiếp của agent. Trước khi hardening,
   agent có thể bị dẫn tới gọi `apoc.cypher.runFile(...)` đọc
   `/proc/self/environ`, lộ creds Postgres/LiteLLM/OAuth. **Đã chặn**
   bằng allowlist APOC + envelope untrusted-output.
2. **Lộ dữ liệu chéo engagement qua web dashboard.** Route graph từng
   không lọc theo `[id]`, trả nguyên graph. **Đã chặn** bằng kiểm tra
   quyền sở hữu Prisma + giới hạn label theo engagement.
3. **Máy operator → đọc file OAuth của LiteLLM.** File
   `~/.claude/.credentials.json` mount RO vào LiteLLM. Máy operator bị
   chiếm có quyền đọc file đó sẽ lấy được token OAuth. **Giảm nhẹ một
   phần** — file chỉ mount RO vào LiteLLM (không vào sandbox), còn lại
   phụ thuộc vệ sinh bảo mật của máy operator.
4. **Plugin entry-point bị đầu độc.** `pip install` một package
   typosquat, `__init__.py` của nó đánh cắp `.env` lúc agent khởi động.
   **Đã chặn** bằng allowlist `RAPTIX_PLUGINS` (operator phải khai rõ);
   **còn mở**: chưa có xác minh ký số bundle.

## Hướng hardening tiếp theo (chưa làm)

Theo thứ tự ưu tiên: user Cypher riêng theo từng engagement (giới hạn
thiệt hại khi 1 sandbox bị chiếm chỉ trong phạm vi engagement đó) →
container sandbox riêng theo từng engagement (chặn rò `.scratch/` giữa 2
engagement) → ký số bundle plugin (Ed25519, operator pin trust set) →
sandbox microVM Firecracker (ranh giới kernel, chỉ cho deploy multi-tenant)
→ transparency log kiểu Sigstore cho audit ledger (để chính operator
cũng không thể viết lại lịch sử). Giới hạn chi tiêu theo engagement đã
triển khai xong (`BudgetEnforcementMiddleware`), không còn trong danh
sách chờ.

## Ngoài phạm vi tài liệu này

Mô hình mối đe dọa phía target (thuộc khách hàng), độ tin cậy của
provider LLM upstream (Raptix tin theo công bố an ninh của họ), vệ sinh
bảo mật máy operator (theo chuẩn endpoint thông thường), và lọc network
ingress ngoài phạm vi compose cấp (người triển khai tự chịu trách nhiệm
firewall ngoài các cổng `127.0.0.1:*` đã mở).

## Tài liệu tham chiếu chi tiết

[Kiểm soát hệ thống](security-controls.md) · [Kiểm soát & trách
nhiệm (RoE/HITL/audit)](enforcement-and-accountability.md) · [Phòng vệ
prompt-injection](prompt-injection-defense.md) · [Neo4j
hardening](neo4j-hardening.md)

## Báo lỗi bảo mật

Báo lỗi bảo mật của Raptix, dependency đóng gói sẵn, hoặc cấu hình mặc
định — báo riêng tư, kèm version bị ảnh hưởng, bước lặp lại, mức độ ảnh
hưởng: [Private vulnerability report](https://github.com/Akapi895/raptix/security/advisories/new).
Không đăng exploit hoạt động được, credential, hay bằng chứng nhạy cảm
khác lên issue công khai.
