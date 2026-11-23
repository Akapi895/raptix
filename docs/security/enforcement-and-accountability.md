# Kiểm soát & trách nhiệm: RoE, audit ledger, HITL

Vòng đời của 1 lệnh bị gate: **RoE** đánh giá target/command trước khi
chạy → quyết định (allow/refuse) được ghi vào **audit ledger** bất kể
mode → nếu **HITL** đang bật và lệnh khớp policy, operator phải phê
duyệt trước khi chạy, nhưng **phê duyệt của operator không bao giờ qua
được RoE** — RoE từ chối thì vẫn từ chối dù operator đã approve.

## RoE Machine Enforcement

RoE dạng người đọc (`in_scope`/`out_of_scope`/`prohibited_actions`) mà
Soundwave soạn lúc planning là để operator xem lại. Một block **tùy
chọn riêng**, `machine_enforcement`, cũng trong `plan/roe.json`, mới là
thứ middleware RoE thực sự đánh giá mỗi lần gọi tool bị gate. Khi block
này **không có**, middleware chạy audit-only: mọi lệnh bị gate được ghi
log nhưng không bao giờ bị từ chối.

**3 mode** (`mode`, mặc định `audit` để tương thích ngược):

| Mode | Hành vi khi bị từ chối |
| --- | --- |
| `audit` | Ghi log, vẫn chạy. Mặc định. |
| `warn` | Ghi log + chèn `[ROE_WARN]` vào output cho model thấy, nhưng vẫn chạy. |
| `enforce` | Ghi log, chặn hẳn bằng `[ROE_REFUSED]`, không có byte nào ra khỏi sandbox. |

**Các field khác** của `machine_enforcement`: `in_scope`/`out_of_scope`
(danh sách rule dạng CIDR/glob domain/IP/host), `forbidden_destinations`
(thêm vào danh sách IMDS mặc định — `169.254.169.254`,
`metadata.google.internal`...), `forbidden_command_patterns` (regex,
khớp là từ chối ngay trước khi xét target), `allow_cloud_metadata`
(mặc định `false`).

**Thứ tự đánh giá target** (`evaluate_target`, denylist luôn thắng):
forbidden destination → out-of-scope → in-scope (nếu `in_scope` rỗng,
target không khớp gì vẫn được allow theo mặc định). Có 1 bug đã sửa:
dấu chấm cuối domain (`host.` ) từng lách qua cả 2 lớp out-of-scope và
forbidden-destination — nay bị strip trước khi so khớp ở cả rule và
target.

**Tool bị gate** (`GATED_TOOL_NAMES`, `middleware/roe.py`) — **10 tool**:
`bash`, `bash_output`, `bash_kill`, `http_request`, `proxy_send_request`,
`browser_action`, `web_fetch`, `web_search`, `detect_tech_stack`,
`verify_workspace_candidate`. Tool ngoài danh sách này đi qua mặc định
allow, không ghi log.

**2 điểm chặn, 1 định nghĩa scope** (defense-in-depth): (1) RoE Guardrail
đọc text lệnh, trích target bằng regex best-effort, chặn sớm ở mode
`enforce` — đây là tín hiệu UX nhanh, không phải ranh giới tuyệt đối (1
agent cố tình có thể giấu target qua biến gián tiếp, command
substitution...); (2) **RoE Egress Guardrail** dịch cùng block
`machine_enforcement` thành nftables connect-allowlist + DNS allowlist
trong sandbox — một packet tới host ngoài phạm vi **không thể** ra khỏi
sandbox dù lớp parser bỏ lọt. Egress guardrail bật mặc định khi
`enforce` (tắt bằng `RAPTIX_EGRESS_DISABLE=1`), và đây mới là ranh giới
thật — lớp parser chỉ là fast-fail.

**Hạn chế**: `max_concurrent_connections`/`min_inter_request_delay_ms`
có trong schema nhưng chỉ mang tính khuyến nghị, middleware không tự
throttle. `plan/roe.json` được Soundwave sinh ra lúc planning (không có
tài liệu riêng mô tả luồng này trong docs hiện tại — xem trực tiếp
`execution/tools/plumbing/opplan.py` và prompt của Soundwave).

## Audit ledger

Mỗi lần RoE đánh giá (PASS hoặc REFUSE) đều sinh 1 record JSON Lines,
nối chuỗi hash với record trước, có thể buộc thêm HMAC bằng secret của
operator — sửa record N làm hỏng chuỗi mọi record sau N. Ghi tại
`<workspace>/audit/roe-decisions.jsonl` (đổi bằng `RAPTIX_ROE_AUDIT_PATH`).

**Lưu ý: đây là 1 trong 2 ledger khác nhau cùng nằm dưới
`<workspace>/audit/`** — ledger này ghi quyết định RoE; còn
`untrusted-quarantine.jsonl` (xem [prompt-injection-defense.md](prompt-injection-defense.md))
ghi các lần cách ly output bị nghi prompt-injection — hai cơ chế độc
lập, không dùng chung record.

**Field quyết định** (middleware ghi): `ts`, `engagement`,
`objective_id`, `tool`, `decision` (allow/refuse), `reason_code` (`OK`,
`IN_SCOPE`, `OUT_OF_SCOPE`, `NOT_IN_SCOPE`, `FORBIDDEN_DESTINATION`,
`FORBIDDEN_COMMAND`), `reason_detail`, `risk`, `matched_targets`, `mode`,
`command_excerpt` (cắt 512 ký tự).

**Field chuỗi** (sink tự thêm khi append): `seq` (tăng dần từ 1),
`prev_hash` (SHA-256 record trước, hoặc 64 số 0 cho record đầu), `hash`
(SHA-256 của record này + `prev_hash`), `hmac` (HMAC-SHA-256 của `hash`
dưới secret `RAPTIX_AUDIT_HMAC_KEY`, rỗng nếu chưa set secret).

`verify_ledger(path, hmac_key)` đi qua toàn file, kiểm `seq` không có lỗ
hổng/trùng, `prev_hash` khớp đầu chuỗi hiện tại, `hash` tính lại khớp
record lưu, và `hmac` khớp (so sánh constant-time) nếu có secret.

**Hạn chế**: chỉ ghi file cục bộ (gửi đi S3/syslog là việc chưa làm);
giả định 1 writer/file (đúng vì mỗi engagement có đúng 1 event loop
orchestrator).

## HITL Approval

`HITLApprovalMiddleware` — **tắt mặc định, opt-in** qua
`RAPTIX_HITL__ENABLED`. Khi bật, lệnh khớp policy sẽ tạm dừng run, chờ
operator approve/deny/redirect, ghi vào
`<workspace>/approvals/requests.jsonl` + `decisions.jsonl` (cùng hợp
đồng với web bridge).

**Policy mặc định** (`DEFAULT_HIGH_IMPACT_POLICY`): `T1003` (OS
Credential Dumping, timeout 300s, mặc định deny), `T1486`/`T1485` (hủy
hoại dữ liệu, timeout 600s, deny), tool khớp
`sliver_implant|sliver_generate|c2_deploy` (deploy C2, timeout 300s,
deny), tool khớp `sigma_to_|yara_to_` (đẩy rule lên SIEM/EDR, timeout
180s, deny), tool `bash` (chỉ để operator thấy, timeout 120s, **mặc
định allow** nếu không ai trả lời — mục đích là hiển thị, không phải
chặn).

**Thứ tự chặn**: HITL nằm **trên** RoE — operator approve rồi vẫn phải
qua RoE, RoE refuse thì vẫn refuse. Ngoài policy opt-in này, còn 1 lớp
**luôn bật bất kể HITL tắt hay mở**: `DANGEROUS_METHODS` trong
`middleware/hitl.py` — regex chặn cứng DoS
(`hping3 --flood`/`slowloris`...), brute-force
(`hydra`/`medusa`/`kerbrute passwordspray`...), phá hủy dữ liệu
(`rm -rf`/`mkfs`/`dd if=`/`DROP TABLE`...), ransomware
(`vssadmin delete shadows`...) — các method này được operator xác nhận
lúc planning, không phụ thuộc cờ `RAPTIX_HITL__ENABLED`.

Redaction: key như `password`/`token`/`api_key`/`private_key`/
`authorization`/`credentials`/`session`/`cookie` bị thay bằng
`***REDACTED***` trước khi hiển thị cho operator.
