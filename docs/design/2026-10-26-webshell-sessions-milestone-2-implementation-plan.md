# Implementation plan: WebShell Sessions tới Mốc 2 trên lab `bashed`

- **Ngày:** 2026-10-26.
- **Baseline source:** `0ac20644` cộng working tree hiện tại. Working tree đang có thay đổi chưa commit ở Web/runtime (bao gồm ADR-0104); kiểm tra lại `git status` và `git diff` trước khi implementation.
- **Trạng thái:** Proposed implementation plan. Chưa đổi application code ở lượt tạo tài liệu.
- **Phạm vi:** WebShell-first. Không triển khai Sliver/C2, không triển khai PTY, không tạo WebShell mới trên target trong Mốc 2.
- **Liên quan:** ADR-0100 (single-operator), ADR-0102 (project files qua project sandbox), ADR-0103 (verifier và sealed PoC), ADR-0104 (reproduce sealed PoC), ADR-0096 (feature-owned Web presentation/adapters), ADR-0067 (frontend service/data boundary), `apps/web/.scratch/frontend-backend-integration/execution.md`. ADR mới trong plan tạm gọi **ADR-0105**; số chính thức chốt khi mở PR.
- **Kết quả mong muốn:** từ finding `FIND-001` trong project `bashed`, operator bấm **Acquire WebShell**; hệ thống đọc sealed PoC, tạo hoặc xác minh connection profile, probe bằng một lệnh an toàn, rồi đăng ký một WebShell session dùng được trong tab Sessions. Nếu bước suy luận thất bại, attempt và output được giữ lại để operator retry; không có finding verdict nào bị thay đổi.

## 0. Tóm tắt quyết định

Mốc 2 được chia thành hai phần:

1. **M1 — WebShell nhập tay dùng được (bắt buộc làm trước):** tạo connection, probe, chạy lệnh một lần, xem history, reload vẫn còn, đóng connection. Đây là nền tảng của mọi thứ sau.
2. **M2 — Acquisition từ PoC:**
   - **M2.1 (deterministic):** đọc sealed PoC của `FIND-001`, trích ra profile `http-form-command` cho phpbash, probe `id;hostname`, đăng ký connection với provenance.
   - **M2.2 (LLM-assisted):** nếu trích tự động không đủ, gửi PoC và lỗi probe có giới hạn cho một LLM **không có tool**, yêu cầu trả về JSON profile; code kiểm tra hợp lệ, scope và tự probe. LLM không được tự chạy lệnh, không được tạo connection, không được ghi finding verdict.
   - **M2.3 (không thuộc plan này):** dùng LLM để sinh/upload một WebShell mới khi target chưa có primitive. Việc này cần threat model và ADR riêng vì nó ghi nội dung mới lên target.

**Nghiệm thu tối thiểu của Mốc 2:** trên project `bashed`, `FIND-001` → Acquire WebShell → connection `phpbash` xuất hiện ở trạng thái `reachable`; chạy được `id`, `pwd`, `ls /var/www/html/dev`; reload vẫn thấy connection và history; connection có provenance tới finding, PoC hash, acquisition; `FIND-001.status` và `verification.json` không đổi.

---

## 1. Dữ kiện lab `bashed` đã đọc từ workspace

Nguồn: volume `raptix-ws-bashed`, đọc qua container `sbx-bashed`; đối chiếu với API/DB đang chạy.

| Dữ kiện | Giá trị |
|---|---|
| Engagement | id `cmvorugqz000c36p7h4g9fxdi`, slug `bashed`, owner `cmvfhyof5000037pg5hjlm8pm`, authorization confirmed |
| WebShell | `POST http://10.129.88.4/dev/phpbash.php`, form-urlencoded, field `cmd`, không auth, trả stdout verbatim |
| Shell context | `www-data` (uid 33), host `bashed`, cwd `/var/www/html/dev`, Ubuntu 4.4.0-62 |
| Backup endpoint | `/dev/phpbash.min.php` (cùng hành vi) |
| FIND-001 | critical, `status: confirmed`, CWE-78, sealed PoC `findings/poc/FIND-001.py`; PoC curl chạy `cmd=id;hostname`, success `uid=33` |
| FIND-002 | high, `status: candidate`, privesc cron www-data → scriptmanager → root; không cần cho WebShell |
| Standing primitive | `exploit/shells.json` SHELL-002: endpoint phpbash luôn sẵn sàng, trả stdout |
| Bind shell | `exploit/shells.json` SHELL-001: bind shell target:4444, one-shot, chỉ dùng khi cần shell tương tác |
| Network | Sandbox → target hoạt động; target **không** mở được kết nối ngược về sandbox. Reproduce `FIND-001` lúc 06:48Z đã chạy thành công từ project sandbox |
| Reproduce artifact | `findings/evidence/FIND-001_reproduce_20261026T064855558464Z.json`: `reproduced: true`, output có `uid=33(www-data)` |
| Stack hiện tại | UI `127.0.0.1:3001`; API container internal 8081; C2 `supported=true, available=false, reason=provider_unavailable`; `independentReview=required` (single-operator đang tắt) |

**Kết luận từ dữ kiện:**

- Mốc 2 **không cần bind shell** và không cần Sliver. WebShell phpbash đã là một command primitive ổn định.
- Acquisition có thể là **deterministic** cho `FIND-001`; LLM chỉ cần thiết khi PoC không tự mô tả được request.
- Phải bật `RAPTIX_WEB_SINGLE_OPERATOR=1` cho deployment local này nếu muốn operator dùng trực tiếp không qua grant. Nếu không bật, WebShell phải trả refusal trung thực, không tự hạ guard rail.
- C2 đang unavailable; WebShell panel phải render độc lập, không bị chặn bởi lỗi C2.

---

## 2. Mốc 2: định nghĩa và anti-goals

### 2.1 Deliverable

**M1:**

- Thêm/sửa/xóa connection WebShell thuộc engagement.
- Probe connection và hiển thị kết quả thật.
- Chạy một command, nhận output, lưu ledger.
- Xem history; refresh/reload không mất dữ liệu.
- Đóng connection; dispatch mới bị từ chối.
- Mọi thao tác có actor, engagement, target và audit.

**M2.1:**

- Chọn finding có sealed PoC (MVP: `FIND-001`).
- Trích profile từ chính sealed command, không sinh lệnh mới.
- Probe bằng `id;hostname` hoặc command chuẩn khác, kiểm tra pattern.
- Tạo connection với provenance đầy đủ.
- Nếu endpoint đã có connection, không tạo bản trùng; ghi attempt mới và cập nhật trạng thái.

**M2.2:**

- Nếu M2.1 trả `needs_refinement`, gọi LLM một lần (tối đa hai attempt) với:
  - sealed PoC block,
  - finding metadata,
  - danh sách target hợp lệ,
  - lỗi probe đã được lọc/giới hạn.
- LLM trả JSON profile hoặc refusal. Code validate, kiểm tra scope, probe.
- Chỉ profile hợp lệ + probe thành công mới tạo connection.
- Attempt thất bại lưu profile/refusal/error để operator xem và retry thủ công.

### 2.2 Anti-goals

- Không thêm PTY, interactive shell, hay bind/reverse shell vào WebShell.
- Không tích hợp Sliver/C2 trong plan này; không sửa C2 grant semantics.
- Không cho LLM gọi tool, chạy command, hoặc tự quyết định connection state.
- Không tạo mới/upload WebShell lên target (M2.3).
- Không thay đổi finding status, không ghi `FIND-NNN_verification.json`.
- Không lưu secret/command output vào log, SSE, notice hay metadata công khai.
- Không dùng browser timer/optimistic success để thay server acknowledgement.
- Không thêm framework provider tổng quát cho mọi loại WebShell. MVP chỉ có `http-form-command`; adapter khác là follow-up.

---

## 3. Kiến trúc và ranh giới

```text
┌─────────────────────────────────────────────────────────────┐
│ Browser                                                     │
│  Sessions tab: WebShell list / Add / Probe / Console        │
│  Finding Reproduce tab: Acquire WebShell                    │
└──────────────────────────────┬──────────────────────────────┘
                               │ same-origin /api
┌──────────────────────────────▼──────────────────────────────┐
│ Web server (Fastify)                                        │
│  webshell-service: authority, records, ledger, audit        │
│  webshell-acquisition-service: derive/refine orchestration  │
│  PostgreSQL: connection, probe, command, acquisition        │
└──────────────────────────────┬──────────────────────────────┘
                               │ runtime HTTP + runtime token
┌──────────────────────────────▼──────────────────────────────┐
│ Python runtime                                              │
│  webshell adapter: profile validation, curl request build   │
│  RoE/time/abort/scope gates                                 │
│  derive (sealed PoC → profile)                              │
│  refine (LLM structured proposal, no tools)                 │
│  probe/execute via project sandbox                          │
└──────────────────────────────┬──────────────────────────────┘
                               │ sandbox URL + per-project token
┌──────────────────────────────▼──────────────────────────────┐
│ Project sandbox `sbx-bashed`                                │
│  curl/http request outbound to target                       │
└──────────────────────────────┬──────────────────────────────┘
                               │
                     phpbash on 10.129.88.4
```

**Ranh giới cố định:**

1. Web server **không** gửi request trực tiếp tới target. Mọi execution đi qua runtime và project sandbox.
2. Runtime **không** ghi business record của Web. Runtime trả profile/probe/execute result; Web server quyết định lưu connection/acquisition.
3. Workspace là nơi giữ artifact acquisition/output lớn; PostgreSQL giữ metadata, trạng thái và ledger.
4. WebShell là provider riêng, không dùng chung bảng `C2Command`/`C2Grant`, không giả lập session Sliver.
5. Browser không bao giờ nhận runtime URL, sandbox token, credential hay raw endpoint ngoài profile đã được server kiểm tra.

---

## 4. Quyết định thiết kế chi tiết

### 4.1 Single-operator direct access

- Chỉ bật direct access khi `isSingleOperator()` trả true (`RAPTIX_WEB_SINGLE_OPERATOR=1`, ADR-0100).
- Khi bật:
  - owner/operator của engagement được tạo connection, probe, chạy command, đóng connection mà không cần C2Grant/WebShell grant.
  - mọi request vẫn qua `requireEngagementAccess(..., 'operator')`, `assertEngagementOpen`, `assertNoActiveStop`, approved scope revision, ROE window và target-in-scope.
  - actor, target, command hash và outcome vẫn được audit.
- Khi tắt:
  - WebShell create/execute trả `403` với lý do `webshell_direct_access_requires_single_operator`.
  - Không tự chuyển sang grant, không tự bật flag, không dùng `mode`/`authMode` để suy đoán.
- Đây là quyết định mới, phải ghi trong ADR-0105. Không sửa ADR-0100 để mở rộng ngầm.

### 4.2 WebShell là request/response, không phải PTY

- MVP chỉ hỗ trợ `http-form-command`: một HTTP request mang một command, response mang output.
- Không giữ cwd/env giữa các request, trừ khi provider thật sự làm được (phpbash không làm được).
- UI dùng nhãn **Command console**, không dùng nhãn **Interactive shell**.
- Bind shell, reverse shell, file transfer và PTY là out of scope.

### 4.3 Profile là dữ liệu có kiểu, không phải chuỗi curl

Profile MVP:

```json
{
  "provider": "http-form-command",
  "target": "10.129.88.4",
  "endpoint": "http://10.129.88.4/dev/phpbash.php",
  "method": "POST",
  "content_type": "application/x-www-form-urlencoded",
  "command_parameter": "cmd",
  "headers": {"User-Agent": "Bashed-RT/1.0"},
  "probe_command": "id;hostname",
  "probe_pattern": "uid=33",
  "expected_user": "www-data"
}
```

Quy tắc validate:

- `provider` chỉ nhận `http-form-command` trong MVP.
- `endpoint`: http/https, có host, không userinfo/fragment; port hợp lệ; host phải nằm trong allowed target set.
- `method`: chỉ `POST`.
- `command_parameter`: `^[A-Za-z_][A-Za-z0-9_.-]{0,63}$`.
- `headers`: allowlist `User-Agent` và `Content-Type`; không nhận `Host`, `Authorization`, `Cookie` trong MVP (credential để follow-up).
- `probe_command`: 1–1024 ký tự, không NUL/CR/LF.
- `probe_pattern`: regex 4–256 ký tự, không comma, không match empty string; dùng lại quy tắc của `check_candidate` (ADR-0103).
- `target` và host của `endpoint` phải khớp nhau sau khi normalize.
- Không lưu raw curl trong profile. Executor tự dựng request an toàn.
- Output trả về từ `HTTPSandbox` có thể kèm footer `[cwd: ...]` (thấy trong reproduce artifact của `FIND-001`). Parser phải tách body trước marker HTTP status và bỏ footer sandbox; không hiển thị footer như output của command.

### 4.4 Trạng thái command: trung thực với khả năng của provider

phpbash trả stdout, không trả remote exit code. Vì vậy:

| Trạng thái | Ý nghĩa |
|---|---|
| `creating` | Web đã reserve, chưa có kết quả |
| `delivered` | HTTP request hoàn tất, response nhận được; **không** khẳng định command chạy thành công |
| `failed` | Không gửi được, endpoint trả lỗi rõ ràng, hoặc profile/scope từ chối |
| `uncertain` | Timeout/mất kết nối sau khi đã gửi; command có thể đã chạy |

- `exitCode` là `null` khi provider không báo; UI hiển thị “Not reported by provider”.
- Không tự retry `uncertain`. Reconcile chỉ đọc trạng thái đã lưu; không dispatch lại.
- Probe dùng trạng thái riêng: `reachable`, `reachable_no_proof`, `unreachable`, `unknown`.
- `reachable` chỉ khi HTTP 2xx **và** pattern khớp. HTTP 200 + body rỗng là `reachable_no_proof`, không phải connected.

### 4.5 LLM boundary

- LLM chỉ nhận dữ liệu, không có tool, không có quyền chạy lệnh.
- Input: sealed PoC block, finding metadata, allowed targets, lỗi probe đã lọc (bounded, bọc là untrusted data).
- Output bắt buộc JSON:
  - `{"kind":"profile","profile":{...},"confidence":"high|medium|low"}`
  - `{"kind":"refused","reason":"..."}`
- Code parse, validate bằng Pydantic, kiểm tra endpoint/host, rồi tự probe. LLM không được trả connection state hay verdict.
- Tối đa 2 attempt (1 lần đầu + 1 lần repair). Attempt thứ ba bị từ chối.
- Timeout mỗi LLM call 60 giây; tổng acquisition 180 giây (cùng bound với reproduce ADR-0104).
- Nếu model không trả JSON hợp lệ: `failed`, lưu lỗi, không chạy gì.
- Nếu profile trỏ ra ngoài allowed targets: `refused`, không probe.
- Prompt injection trong PoC/output chỉ là dữ liệu; không được đổi system instruction hay kích hoạt tool.

**M2.2a (mặc định):** chỉ cho LLM trả profile.

**M2.2b (flag off by default, follow-up):** cho LLM đề xuất một command acquisition; code seal command, chạy qua RoE/HITL, tối đa một lần. Không đưa vào acceptance Mốc 2. Lý do: nó là “ghi nội dung mới lên target”, gần với M2.3 và cần threat model riêng.

### 4.6 Provenance và finding verdict

- Connection lưu:
  - `producerFindingId` (ví dụ `FIND-001`),
  - `producerPocSha256`,
  - `producerSpecSha256`,
  - `producerAcquisitionId`.
- Acquisition artifact lưu profile, probe result, hash và timestamp.
- Acquisition **không** gọi `verify_workspace_candidate`, không sửa `status`, không ghi `findings/evidence/FIND-NNN_verification.json`.
- Test phải so sánh bytes của `FIND-001.md` và `FIND-001_verification.json` trước/sau acquisition.

### 4.7 Dedupe và concurrency

- Một connection được định danh bởi `(engagementId, provider, endpoint, commandParameter)`.
- Acquisition lại cùng endpoint:
  - nếu connection đang mở: cập nhật probe, ghi acquisition mới liên kết, không tạo bản trùng;
  - nếu connection đã `closed`: tạo connection mới (hoặc yêu cầu operator reopen), không tự mở.
- Mỗi connection tối đa một command chưa settle (`activeConnectionId` unique), giống pattern `C2Command.activeSessionId`.
- Probe không chiếm command slot của operator; nó có request identity và rate limit riêng.

### 4.8 RoE, abort, scope, stop

- Web service kiểm tra:
  - membership operator,
  - engagement open,
  - no active emergency stop,
  - approved scope revision,
  - ROE time window,
  - target in scope.
- Runtime kiểm tra lại (defense in depth):
  - `load_rules` + `evaluate_time_window`,
  - `.abort` marker,
  - `evaluate_command` + `extract_targets` + `evaluate_target` cho request command và endpoint host.
- Endpoint host phải nằm trong allowed target set; với acquisition, allowed target set lấy từ chính sealed PoC command, không lấy từ model text.
- Không tái sử dụng `C2Grant`; không hạ `SafeCommand`, RoE, egress, HITL hay sandbox.

### 4.9 C2 không bị thay đổi

- Mốc 2 không sửa `C2Service`, `C2GrantsService`, bridge Sliver hay `C2Command`.
- Sessions tab hiển thị hai section độc lập: C2 và WebShell. C2 unavailable không chặn WebShell.
- Việc cho C2 direct access trong single-operator là follow-up riêng (ADR + threat model).

---

## 5. Data model

Migrations mới: `apps/web/server/prisma/migrations/20261101000200_webshell_sessions/migration.sql`.

### `WebShellConnection`

| Cột | Kiểu | Ghi chú |
|---|---|---|
| `id` | String cuid | |
| `engagementId` | String | không FK tới C2; FK Engagement nếu schema hiện có |
| `assetId` | String? | optional; không auto-create asset |
| `provider` | String | `http-form-command` |
| `name` | String | hiển thị |
| `target` | String | host/IP đã normalize |
| `endpoint` | String | URL đã validate |
| `method` | String | `POST` |
| `contentType` | String | `application/x-www-form-urlencoded` |
| `commandParameter` | String | `cmd` |
| `headers` | Json? | allowlist, không secret |
| `probeCommand` | String | mặc định `id;hostname` |
| `probePattern` | String | mặc định `uid=` |
| `expectedUser` | String? | `www-data` |
| `state` | String | `unverified\|reachable\|reachable_no_proof\|unreachable\|unknown\|closed` |
| `source` | String | `manual\|poc_acquisition` |
| `createdBy` | String | actor |
| `producerFindingId` | String? | `FIND-001` |
| `producerPocSha256` | String? | |
| `producerSpecSha256` | String? | |
| `producerAcquisitionId` | String? | |
| `lastProbeId` | String? | |
| `lastProbeAt` | DateTime? | |
| `concurrencyVersion` | Int | default 1 |
| `createdAt` / `updatedAt` | DateTime | |

Index/unique: `@@unique([engagementId, provider, endpoint, commandParameter])`, `@@index([engagementId, state])`.

### `WebShellProbe`

`id`, `connectionId`, `engagementId`, `requestId`, `state`, `httpStatus`, `matched`, `output`, `outputTruncated`, `error`, `durationMs`, `createdAt`. Unique `(connectionId, requestId)`.

### `WebShellCommand`

`id`, `connectionId`, `engagementId`, `requestId`, `command`, `payloadHash`, `status`, `httpStatus`, `exitCode?`, `output`, `outputTruncated`, `capturePath?`, `captureSha256?`, `error`, `actorId`, `runId?`, `invocationId?`, `activeConnectionId?` unique, `createdAt`, `updatedAt`. Unique `(engagementId, requestId)`; index `(connectionId, createdAt)`.

### `WebShellAcquisition`

`id`, `engagementId`, `findingId`, `requestId`, `mode` (`derive|refine`), `state` (`queued|running|succeeded|failed|refused|cancelled`), `attempt`, `maxAttempts`, `pocSha256?`, `specSha256?`, `profile` Json?, `connectionId?`, `error?`, `artifactPath?`, `artifactSha256?`, `actorId`, `createdAt`, `updatedAt`. Unique `(engagementId, requestId)`.

### Workspace artifacts

- `webshell/acquisitions/<acquisitionId>.json`
- `webshell/captures/<commandId>.txt` (chỉ khi output vượt bound DB)
- Artifact acquisition tối thiểu:
  - `acquisition_id`, `engagement`, `finding_id`, `mode`,
  - `poc_sha256`, `spec_sha256`,
  - `profile`, `probe` (state/status/matched/output excerpt),
  - `recorded_at`.

---

## 6. API

### 6.1 Web API (cookie/CSRF, actor từ server)

| Method | Path | Mục đích |
|---|---|---|
| GET | `/api/engagements/:id/webshell/connections` | list owned connections |
| POST | `/api/engagements/:id/webshell/connections` | tạo manual connection |
| GET | `/api/engagements/:id/webshell/connections/:connectionId` | chi tiết |
| PATCH | `/api/engagements/:id/webshell/connections/:connectionId` | sửa profile (khi không có command in-flight) |
| POST | `/api/engagements/:id/webshell/connections/:connectionId/close` | đóng connection |
| POST | `/api/engagements/:id/webshell/connections/:connectionId/probe` | probe |
| GET | `/api/engagements/:id/webshell/connections/:connectionId/probes` | probe history |
| GET | `/api/engagements/:id/webshell/connections/:connectionId/commands` | command history |
| POST | `/api/engagements/:id/webshell/connections/:connectionId/commands` | chạy command |
| GET | `/api/engagements/:id/webshell/commands/:commandId` | đọc trạng thái |
| POST | `/api/engagements/:id/webshell/acquisitions` | tạo acquisition từ finding ref |
| GET | `/api/engagements/:id/webshell/acquisitions` | list |
| GET | `/api/engagements/:id/webshell/acquisitions/:acquisitionId` | trạng thái/artifact |
| POST | `/api/engagements/:id/webshell/acquisitions/:acquisitionId/retry` | retry thủ công |

- `requestId` do client sinh cho mutation; server unique theo engagement.
- Response lỗi dùng envelope hiện có: 400 payload sai, 403 policy/single-operator, 404 foreign id, 409 conflict/active command, 429 rate, 503 dependency unavailable.
- Không trả output trong metadata SSE/notice; command/probe response dùng `Cache-Control: no-store`.

### 6.2 Runtime API (runtime token, internal)

Router mới `packages/raptix/raptix/interfaces/api/webshell_routes.py`, mount trong `plugins_api.py`:

| Method | Path | Input | Output |
|---|---|---|---|
| POST | `/_raptix/webshell/probe` | `sandbox_url`, `sandbox_token`, `profile`, `request_id` | probe state, status, matched, bounded output |
| POST | `/_raptix/webshell/execute` | như trên + `command`, `request_id` | command state, status, bounded output |
| POST | `/_raptix/webshell/derive` | `sandbox_url`, `sandbox_token`, `finding_id`, `acquisition_id` | profile hoặc `needs_refinement`/refusal |
| POST | `/_raptix/webshell/refine` | như derive + bounded `failure` | profile hoặc refusal |

- Runtime đọc sealed PoC bằng `read_sealed_poc`/`project_files_for` hiện có; không nhận command/pattern từ model.
- Runtime validate profile lại trước mọi request.
- Runtime không trả raw secret; output được bound và truncate rõ.

### 6.3 Capabilities

Thêm vào `GET /api/capabilities`:

- `webshell: {supported, available, reason?}`
- `webshellAcquisition: {supported, available, reason?}`

Điều kiện:

- `webshell` available khi DB + runtime + sandbox key + per-project sandbox sẵn sàng.
- `webshellAcquisition` available khi thêm runtime API token và LLM factory cấu hình.
- Availability không phải authorization; single-operator check vẫn ở service.

---

## 7. UI

### 7.1 Sessions tab

- Giữ route/tab id `c2`; đổi label menu `C2 Sessions` → `Sessions` trong `project-sections.ts`.
- Trong `C2ProviderTab` main view, render hai section:
  1. `C2 sessions` (hiện có, có thể unavailable).
  2. `WebShell sessions` (mới).
- Không để lỗi C2 chặn WebShell; mỗi section có query/error riêng.
- Các route detail `c2-session`/`c2-channel` giữ nguyên C2; WebShell detail dùng state trong panel (MVP) hoặc route `webshell/:connectionId` (follow-up).

### 7.2 WebShell panel

- List: name, target, provider, state, last probe, source, finding link.
- Add form:
  - preset `phpbash (HTTP form · cmd)`,
  - target/asset,
  - endpoint,
  - command parameter,
  - User-Agent,
  - probe command/pattern.
- Probe button: hiển thị `reachable` / `reachable_no_proof` / `unreachable` / `unknown`; không hiển thị “Connected” khi chỉ có HTTP 200.
- Console:
  - command input,
  - run button (operator+),
  - output monospace, truncation marker,
  - status `delivered|failed|uncertain`, HTTP status, “exit code not reported”,
  - command history.
- Close connection: dispatch mới bị từ chối; lịch sử vẫn đọc được.
- Sensitive content: không copy command/output vào toast/notice/log.

### 7.3 Acquisition UI

- Trong tab Reproduce của finding detail, dưới `SealedPocPanel`, thêm `WebShellAcquirePanel`.
- Trạng thái: `idle → running → succeeded|failed|refused`.
- Hiển thị:
  - finding ref, PoC hash,
  - mode `derive`/`refine`,
  - attempt,
  - profile tóm tắt (endpoint, parameter),
  - probe result,
  - link “Open WebShell session”.
- Nếu connection đã tồn tại: hiển thị “Linked to existing connection” thay vì tạo mới.
- Nếu thất bại: hiển thị lỗi bounded + nút Retry; không tự retry.

---

## 8. Phases và PR slices

Mỗi PR phải ≤400 runtime lines / ≤10 files / một concern. Các phase dưới đây là work packages; một phase có thể nhiều PR nhỏ.

### 8.0 File inventory

| Lớp | File | Thay đổi |
|---|---|---|
| Docs | `docs/adr/0105-webshell-provider-and-single-operator-sessions.md` | ADR mới (Proposed) |
| Docs | `docs/design/2026-10-26-webshell-sessions-milestone-2-implementation-plan.md` | Plan này |
| Contracts | `apps/shared/web-contracts/src/webshell.ts` | DTO + validators |
| Contracts | `apps/shared/web-contracts/src/index.ts` | export |
| DB | `apps/web/server/prisma/schema.prisma` | 4 model mới |
| DB | `apps/web/server/prisma/migrations/20261101000200_webshell_sessions/migration.sql` | migration |
| Web server | `apps/web/server/src/services/webshell-service.ts` | authority, CRUD, probe/execute, ledger |
| Web server | `apps/web/server/src/services/webshell-acquisition-service.ts` | derive/refine orchestration |
| Web server | `apps/web/server/src/integrations/webshell/runtime-webshell-client.ts` | runtime HTTP client |
| Web server | `apps/web/server/src/http/routes/webshell.routes.ts` | routes |
| Web server | `apps/web/server/src/app.ts` | wire service/routes/capabilities |
| Web server | `apps/web/server/src/main.ts` | compose service, single-operator gate |
| Web server | `apps/web/server/src/http/routes/capabilities.routes.ts` | webshell capabilities |
| Runtime | `packages/raptix/raptix/execution/tools/webshell/__init__.py` | public surface |
| Runtime | `packages/raptix/raptix/execution/tools/webshell/profile.py` | profile model/validation |
| Runtime | `packages/raptix/raptix/execution/tools/webshell/http_form.py` | request builder/parser |
| Runtime | `packages/raptix/raptix/execution/tools/webshell/gates.py` | RoE/time/abort/scope |
| Runtime | `packages/raptix/raptix/execution/tools/webshell/probe.py` | probe/execute |
| Runtime | `packages/raptix/raptix/execution/tools/webshell/derive.py` | sealed PoC → profile |
| Runtime | `packages/raptix/raptix/execution/tools/webshell/refine.py` | LLM proposal + validation |
| Runtime | `packages/raptix/raptix/intelligence/prompts/webshell/acquire.md` | prompt |
| Runtime | `packages/raptix/raptix/interfaces/api/webshell_routes.py` | internal endpoints |
| Runtime | `packages/raptix/raptix/interfaces/api/plugins_api.py` | mount router |
| UI | `apps/web/src/features/webshell/{index,service,api,remote,query}.ts` | feature port/adapter |
| UI | `apps/web/src/features/webshell/views/*.tsx` | panel/add/console/history |
| UI | `apps/web/src/features/c2/provider-tab.tsx` | mount WebShell panel |
| UI | `apps/web/src/features/navigation/project-sections.ts` | label `Sessions` |
| UI | `apps/web/src/features/findings/sealed-poc.tsx` | Acquire control/panel |
| Tests | `apps/web/server/tests/webshell-*.test.ts` | service/acquisition/routes |
| Tests | `apps/web/src/features/webshell/**/*.test.tsx` | UI states |
| Tests | `apps/web/src/features/findings/webshell-acquire.test.tsx` | finding flow |
| Tests | `packages/raptix/tests/unit/webshell/*.py` | adapter/gates/derive/refine |
| Tests | `packages/raptix/tests/unit/interfaces/test_webshell_routes.py` | runtime routes |
| Harness | `apps/web/tools/verify-webshell-live.mjs` | live gates |
| Config | local `.env`/compose override | `RAPTIX_WEB_SINGLE_OPERATOR=1` (không commit secret) |

### Phase 0 — ADR, contracts, schema

**Deliverable:**

- `docs/adr/0105-webshell-provider-and-single-operator-sessions.md` (Proposed):
  - WebShell là provider request/response, không phải C2/PTY.
  - Direct access chỉ khi single-operator; các gate còn nguyên.
  - LLM chỉ đề xuất profile; code validate/probe.
  - Không thay finding verdict.
- `apps/shared/web-contracts/src/webshell.ts` + export index:
  - `WebShellProfile`, `WebShellConnectionView`, `WebShellProbeView`, `WebShellCommandView`, `WebShellAcquisitionView`.
  - validators cho wire boundary.
- Prisma schema + migration.
- Capabilities types/route fields.

**Tests:**

- contract validator tests (valid/invalid profile, oversized fields, bad endpoint, bad pattern).
- `prisma migrate deploy`/generate check.
- capabilities response shape.

**Acceptance:** `npm run build --workspace=@raptix/web-contracts`, `npm run prisma:generate --workspace=@raptix/web-raptix-server`, server/web typecheck; schema migration applies on a scratch DB.

### Phase 1 — Runtime adapter, gates, probe/execute

**Deliverable:**

- `packages/raptix/raptix/execution/tools/webshell/`:
  - `profile.py` — Pydantic model + validation.
  - `http_form.py` — build curl args with `shlex.quote`, parse status/body, map exit codes.
  - `gates.py` — RoE/time/abort/target checks; reuse `load_rules`, `evaluate_*`, `ABORT_PATH`.
  - `probe.py` — probe/execute functions over `HTTPSandbox`.
- `interfaces/api/webshell_routes.py` — probe/execute.
- Mount in `plugins_api.py`.
- Unit tests.

**Tests:**

- profile validation: endpoint scheme/userinfo/fragment/port, parameter, headers allowlist, pattern rules.
- curl builder: command with quotes/semicolons/`$()`/newline rejected or safely quoted; no shell injection.
- parser: HTTP 200 + body, 500, empty body, `-w` marker, truncation.
- gates: out-of-scope target, time window, abort marker, unreadable RoE fails closed.
- execute: timeout → `uncertain`; connect refused → `failed`; no retry.
- output bound and no raw secret in logs.

**Acceptance:** `uv run pytest packages/raptix/tests/unit/webshell`; a manual runtime call against `sbx-bashed` with the profile returns `uid=33`.

### Phase 2 — Web service, ledger, routes (M1)

**Deliverable:**

- `apps/web/server/src/services/webshell-service.ts`.
- `apps/web/server/src/integrations/webshell/runtime-webshell-client.ts`.
- `apps/web/server/src/http/routes/webshell.routes.ts`.
- Wire in `app.ts`/`main.ts`; add capabilities.
- Single-operator direct access; all gates.
- Workspace artifact write for acquisitions (Phase 4 uses it).

**Tests:**

- create/list/get/update/close; foreign engagement 404.
- single-operator off → 403; on → allowed.
- scope/ROE/stop refusal before runtime call.
- probe: reachable, reachable_no_proof, unreachable, uncertain.
- command: stable requestId, same payload replays, changed payload 409, one in-flight, no re-dispatch on uncertain.
- output bound/truncation, no-store.
- C2 service absent does not affect WebShell.

**Acceptance:** server suites pass; live API creates/probes/executes against `bashed`.

### Phase 3 — WebShell UI (M1)

**Deliverable:**

- `apps/web/src/features/webshell/{index,service,api,remote,query}.ts`
- `apps/web/src/features/webshell/views/{panel,add-connection,console,command-table}.tsx`
- Mount `<WebShellPanel>` in `features/c2/provider-tab.tsx`.
- Rename menu label to `Sessions` in `project-sections.ts`; update:
  - `app-routing.real.test.tsx`
  - `project-nav.characterization.test.ts`
  - `nav.test.ts`
  - `project-sections.test.ts`
- Find detail: no change until Phase 6.

**Tests:**

- panel states (loading/error/empty/unavailable).
- add form validation; probe result labels.
- console disabled when not operator/single-operator; command history; truncation.
- C2 unavailable + WebShell available renders both independently.
- no fake “connected”; no optimistic success.

**Acceptance (M1 live):** on `bashed`, add phpbash connection, probe shows `reachable` with `uid=33`, run `id`/`pwd`, reload persists, close blocks dispatch.

### Phase 4 — M2.1 deterministic derive

**Deliverable:**

- `packages/raptix/raptix/execution/tools/webshell/derive.py`:
  - parse sealed `command`/`negative_command` with `shlex`,
  - extract URL, method, form parameter, command template, headers,
  - require the payload appears exactly once and the baseline is the same command with payload removed (reuse ADR-0103 rules),
  - return profile or `needs_refinement`.
- `interfaces/api/webshell_routes.py`: `derive` endpoint.
- `apps/web/server/src/services/webshell-acquisition-service.ts`:
  - read sealed PoC via runtime `read_sealed_poc` (or call derive endpoint),
  - create acquisition row, run derive, probe, persist,
  - dedupe/adopt connection,
  - write workspace artifact.
- Routes for acquisitions.
- Finding Reproduce UI panel (basic status/link).

**Tests:**

- derive from `FIND-001`-shaped curl → exact profile.
- non-curl → `needs_refinement`.
- payload not in command, appears twice, baseline mismatch → refusal.
- missing PoC/nonexistent finding → refusal.
- probe failure → acquisition `failed`, no connection.
- duplicate endpoint → link existing, no duplicate.
- finding bytes/verification unchanged.

**Acceptance (M2.1 live):** Acquire WebShell on `FIND-001` creates a `reachable` connection with provenance; manual probe/command works; duplicate acquisition links.

### Phase 5 — M2.2 LLM-assisted refine

**Deliverable:**

- `packages/raptix/raptix/execution/tools/webshell/refine.py`:
  - input assembly (sealed PoC, finding metadata, allowed targets, bounded failure),
  - one structured LLM call via `LLMFactory().get_model("exploit")`,
  - strict JSON parse + Pydantic validation,
  - no tools; max 2 attempts; 60s per call.
- `packages/raptix/raptix/intelligence/prompts/webshell/acquire.md`.
- `interfaces/api/webshell_routes.py`: `refine` endpoint.
- Web acquisition service: if derive returns `needs_refinement`, call refine; persist attempts.
- Optional flag `RAPTIX_WEBSHELL_ALLOW_COMMAND_PROPOSAL` (off) for M2.2b; not part of acceptance.

**Tests:**

- fake proposer returns valid profile → probe → success.
- invalid JSON, missing fields, out-of-scope endpoint, wrong host, bad pattern → refusal.
- prompt injection text in PoC/output does not change system behavior or execute anything.
- max attempts enforced; third attempt refused.
- model timeout → `failed`; no auto retry.
- no finding verdict change; no secrets in prompt/log/artifact.

**Acceptance (M2.2 live):** gọi thẳng endpoint `refine` cho `FIND-001` trong harness (không cần cờ production để tắt derive), LLM trả phpbash profile, probe `uid=33`, connection created with `mode: refine`; invalid-profile case leaves no connection.

### Phase 6 — Acquisition UI polish

**Deliverable:**

- `WebShellAcquirePanel` in finding Reproduce tab.
- Acquisition list/status in WebShell panel; link to connection.
- Retry/cancel controls.
- Provenance display.
- E2E UI tests.

**Acceptance:** from browser, `FIND-001` → Acquire → connection visible in Sessions; failure shows refusal and retry.

### Phase 7 — Live verification and evidence

**Deliverable:**

- `apps/web/tools/verify-webshell-live.mjs`:
  - login using env credentials (no hardcoded secret),
  - capabilities check,
  - manual create/probe/execute/history/reload,
  - acquisition `FIND-001`,
  - forced refine path,
  - negative cases (wrong parameter, out-of-scope endpoint, foreign engagement, single-operator off),
  - cleanup test connection (or mark for UAT).
- Evidence under `tests/local/artifacts/webshell/<run-id>/`:
  - JSON state, sanitized outputs, command history, acquisition artifact, findings hash before/after.

**Acceptance:** all live gates pass on the running `bashed` stack; evidence recorded; ADR-0105 can move to Accepted only after owner review.

---

## 9. Verification plan

### 9.1 Static / unit / integration

```powershell
# shared contracts first
npm run build --workspace=@raptix/streaming
npm run build --workspace=@raptix/web-contracts
npm run prisma:generate --workspace=@raptix/web-raptix-server

# server
npm run typecheck --workspace=@raptix/web-raptix-server
npm run lint --workspace=@raptix/web-raptix-server
npm run test --workspace=@raptix/web-raptix-server -- tests/webshell-service.test.ts tests/webshell-acquisition.test.ts

# web
npm run typecheck --workspace=@raptix/web-raptix
npm run lint --workspace=@raptix/web-raptix -- --max-warnings=0
npm run test --workspace=@raptix/web-raptix -- src/features/webshell src/features/findings/reproduce.test.tsx src/features/findings/webshell-acquire.test.tsx
npm run check:boundaries --workspace=@raptix/web-raptix

# runtime
uv run pytest packages/raptix/tests/unit/webshell packages/raptix/tests/unit/interfaces/test_webshell_routes.py
uv run pytest packages/raptix/tests/unit/tools/test_candidate_reproduction.py
```

Chỉ chạy targeted tests; không mặc định full suite. Khi sửa shared contracts/schema, nêu rõ consumer bị ảnh hưởng.

### 9.2 Live gates trên `bashed`

Điều kiện:

- Stack đang chạy; `sbx-bashed` healthy; `10.129.88.4` reachable từ sandbox (đã có evidence reproduce).
- Bật `RAPTIX_WEB_SINGLE_OPERATOR=1` cho API container (local `.env`/compose override), restart API; capabilities trả `independentReview: single-operator`.
- Không đổi `bashed` finding/PoC trong lúc test; chụp hash trước/sau.

| Gate | Thao tác | Kỳ vọng |
|---|---|---|
| L1 | Add WebShell: endpoint phpbash, `cmd`, UA `Bashed-RT/1.0` | connection `unverified` |
| L2 | Probe | `reachable`, HTTP 200, output có `uid=33`, pattern khớp |
| L3 | Execute `id`, `pwd`, `ls /var/www/html/dev` | `delivered`, output thật, không fake exit code |
| L4 | Reload UI/API | connection + command history còn |
| L5 | Sai parameter (`xcmd`) | probe `reachable_no_proof`/`unreachable`; không connected; không crash |
| L6 | Sai endpoint path | `failed`/`unreachable`; không tạo connection giả |
| L7 | Timeout/connection drop | `uncertain`; không auto re-dispatch; retry thủ công là request mới |
| L8 | Acquisition `FIND-001` | `succeeded`; connection provenance finding/PoC/acquisition; profile khớp |
| L9 | Acquisition lần 2 cùng endpoint | linked, không duplicate |
| L10 | Forced refine path | profile hợp lệ, probe pass; invalid/out-of-scope → refused, no connection |
| L11 | Finding hash before/after | `FIND-001.md` và `verification.json` byte-identical |
| L12 | Foreign engagement/actor | 404/403; không lộ dữ liệu |
| L13 | Single-operator off | create/execute 403; UI giải thích |
| L14 | C2 unavailable | WebShell vẫn dùng được; C2 error riêng |
| L15 | Close connection | dispatch mới 409/403; history vẫn đọc |

### 9.3 Evidence cần lưu

- `tests/local/artifacts/webshell/<run-id>/state.json`: kết quả từng gate.
- `.../acquisition-FIND-001.json`: profile, probe, provenance.
- `.../command-history.json`: command/status/httpStatus/output excerpt.
- `.../hash-before.json`, `hash-after.json`.
- Không lưu secret; output sanitized; ghi rõ nếu có gate không chạy.

### 9.4 PR end-to-end statement

Mỗi PR runtime/UI phải có một đoạn nêu rõ:

- stack nào đã chạy,
- engagement `bashed`/sandbox nào,
- command/harness đã chạy,
- output quan sát được,
- gate nào chưa chạy và vì sao.

Không chấp nhận “tests pass” hoặc “should work” làm bằng chứng.

---

## 10. Rủi ro và câu hỏi còn mở

### 10.1 Rủi ro chính

| Rủi ro | Giảm thiểu |
|---|---|
| LLM bịa endpoint ngoài scope | allowed targets lấy từ sealed PoC + scope; code validate trước probe |
| Prompt injection từ output/PoC | LLM không có tool; output bọc untrusted; code không tin model text |
| Command chứa secret bị lưu/log | bound + no-store; không log command/output; role operator; retention theo evidence |
| Timeout nhưng command đã chạy | trạng thái `uncertain`; không auto retry; operator quyết định |
| Duplicate connection do retry | unique key + adopt/link; requestId idempotent |
| C2 unavailable làm hỏng tab | hai section/query độc lập; test riêng |
| Single-operator bị bật nhầm ở multi-user | env off by default; startup warning; ADR threat model; UI hiển thị mode |
| Acquisition treo request lâu | bound 180s; LLM 60s; ghi `failed`/`uncertain`; follow-up worker nếu cần |
| Restart giữa acquisition | không auto chạy lại; row `running` quá hạn → `failed` + retry thủ công; không replay target action |

### 10.2 Câu hỏi cần chốt trước Phase 2

1. **Asset binding:** MVP có bắt buộc chọn asset không? Đề xuất: optional; nếu có asset list thì operator chọn, server vẫn validate target theo scope. Không auto-create asset từ connection.
2. **Adopt tự động hay xác nhận:** Đề xuất auto-adopt khi probe `reachable`, vì single-operator; operator có thể rename/close. Nếu muốn kiểm soát hơn, thêm bước confirm.
3. **Lưu output:** DB bound 192 KiB (196,608 bytes) + workspace capture khi vượt. Có cần retention riêng cho WebShell captures không? MVP dùng retention hiện có của workspace/evidence.
4. **M2.2b command proposal:** có bật không? Đề xuất để off và làm sau M2.3, vì nó là ghi nội dung mới lên target.
5. **C2 direct access:** có làm ngay trong cùng tab không? Đề xuất follow-up ADR/PR, không trộn với WebShell.
6. **Route riêng cho WebShell detail:** MVP dùng panel state; nếu cần deep link, thêm route `webshell/:connectionId` sau.

---

## 11. Definition of done

- [ ] ADR-0105 Proposed, có threat model và quyết định single-operator/direct access.
- [ ] Contracts + Prisma migration + capabilities được review.
- [ ] Runtime adapter/gates/probe/execute có unit tests; injection/out-of-scope/uncertain được kiểm.
- [ ] WebShell M1 dùng được trên `bashed` từ browser, reload còn dữ liệu.
- [ ] M2.1 acquisition từ `FIND-001` tạo connection `reachable` có provenance.
- [ ] M2.2 refine path có fake-model tests và một live run; invalid output không tạo connection.
- [ ] Finding status và `verification.json` không đổi.
- [ ] C2 unavailable không chặn WebShell; single-operator off trả refusal đúng.
- [ ] Evidence live được lưu dưới `tests/local/artifacts/webshell/<run-id>/`.
- [ ] Không có secret trong log/DB/artifact; command/output không vào SSE/notice.
- [ ] PR body có end-to-end verification statement; không claim gate chưa chạy.
