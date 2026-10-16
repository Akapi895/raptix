# Verification O01–O03: source regression và deployment thực tế

- **Ngày:** 2026-10-16; selected test runs bắt đầu 17:35 UTC+7, các deployment probes thực hiện trong cùng lượt verify.
- **Spec:** [mock-to-operational plan, O01–O03](2026-10-16-web-mock-to-operational-system-implementation-plan.md#5-lộ-trình-triển-khai-theo-sáu-phase).
- **Claim được kiểm tra:** [operational baseline](2026-10-16-web-operational-baseline.md).
- **Source:** HEAD `b4b4ce9`, cộng working-tree O03 chưa commit; baseline plan `2012e69`.
- **Kết luận:** **O01 partial; O02 blocked; O03 blocked. Chưa đủ điều kiện đóng nhóm O01–O03.**

Đây là verification, không phải implementation fix. Không sửa application code,
không recreate/deploy/stop container, không migrate hoặc thay đổi password/membership.
Probe tạo session đăng nhập và marker ngẫu nhiên của chính phiên verify; đã logout
session reviewer và dọn marker. Các kết quả lịch sử không bị xóa hoặc sửa thành pass mới.

## 1. Phạm vi source đã được kiểm tra

`git log 2012e69..HEAD --oneline` chỉ có commit `b4b4ce9` về LLM retry. Phần O03
nằm trong diff chưa commit:

- `apps/web/server/src/services/runtime/stream-service.ts` và test tương ứng.
- `apps/web/src/real/workspace-session.ts`, `screens/{login,workspace}.tsx`.
- `precommit-regressions.test.tsx`, `screens/workspace.test.tsx` và file mới
  `workspace-session.test.ts`.
- Docs ADR-0078/execution plan và operational baseline cho O01/O02.

Blob IDs ghi nhận sau tests:

| File | `git hash-object` |
|---|---|
| `server/src/services/runtime/stream-service.ts` | `618ad0fc83e1084b242d79c8905064403731e337` |
| `src/real/screens/login.tsx` | `efc7bb861f05b0386e0f9299b857afecaf8084bd` |
| `src/real/workspace-session.ts` | `ca78c0620c4be66a27bf9176d6bab76d8f3b86eb` |

Các file ngoài nhóm Web đang dirty từ trước được giữ nguyên. Probe regression
tạm cho actor switch đã được chuyển khỏi `src/` sau khi chạy; không để failing
verification fixture trong test collection mặc định.

## 2. Verdict theo từng work item

| Work item | Đã xác minh | Chưa đạt / blocker | Verdict |
|---|---|---|---|
| **O01** | Có baseline, route-group/nav inventory, phân loại gaps và naming update; mock hoạt động khi chặn toàn bộ `/api/**` | Chưa khép source↔image revision; action-level inventory còn sơ lược; baseline deployment đã thay đổi và claim workspace fix không còn đúng với roundtrip hiện tại | **Partial** |
| **O02** | DB migration status up-to-date; persistent mounts hiện diện; reviewer login qua nginx, session, CSRF/origin và foreign-ID refusal pass; Vault key có cấu hình | **Runtime không chia sẻ workspace hiệu lực với API/sandbox**; owner credential test trả 401; clean/upgrade migrations, restart durability, inference, backup/restore chưa được chứng nhận | **Blocked** |
| **O03** | Actor-specific selection/pending keys, deliberate legacy drop khi write, logout/expiry cleanup và idle-heartbeat revoke test đã có; regression hiện hữu pass | **Busy stream không re-attest; authenticated A→B giữ cache/in-flight result và plaintext recovery**; thiếu deployment namespace; deployment chưa chứa O03 | **Blocked** |

## 3. Standards review

Typecheck/lint hai package pass; review không phát hiện thêm hard coding-standard
violation độc lập với các vấn đề correctness ở §4.

**S1 — Delivery-size prerequisite (P2, nếu gom toàn bộ làm một PR).** Nhóm review
có 9 tracked files cộng `workspace-session.test.ts` và operational baseline mới,
tổng 11 files. `CONTRIBUTING_AGENT.md:69–74` yêu cầu ≤10 files/PR hoặc explicit
exception. Cần tách phạm vi delivery nếu giữ nguyên nhóm này. Đây là gate cho PR,
không phải kết luận rằng implementation chức năng sai chỉ vì đang có dirty files.

## 4. Spec findings

### F1 — P0: shared workspace fail trên deployment hiện tại (O02)

Spec O02 yêu cầu API/runtime/sandbox cùng đọc/ghi engagement workspace và có
roundtrip marker. Baseline §2.1 ghi đã fix; probe mới không xác nhận claim đó.

Config API đã đọc ở runtime:

```json
{"workspace":"/workspace","runtimeRoot":"/workspace","pinnedSlug":"juice-shop-v4-r2","authMode":"multi","vaultKeyConfigured":true}
```

Marker độc lập cho từng writer, tên `.verify-o02-<uuid>-<writer>.txt`; API dùng
`/workspace/juice-shop-v4-r2/`, runtime/sandbox dùng `/workspace/`.

| Writer → Reader | API | Runtime | Sandbox |
|---|---|---|---|
| API | PASS | **MISSING** | PASS |
| Runtime | **MISSING** | PASS | **MISSING** |
| Sandbox | PASS | **MISSING** | PASS |

`docker inspect` ghi nhận API bind `D:/.VTNet/redteam/raptix/.raptix/workspace`,
runtime/sandbox khai báo bind `/mnt/d/.VTNet/redteam/raptix/.raptix/workspace/juice-shop-v4-r2`.
Mount strings nhìn tương tự không chứng minh effective storage giống nhau.
Chưa kết luận nguyên nhân bên trong Windows/WSL/Docker mount translation; ma trận
read/write trên là failure đã tái hiện.

**Ảnh hưởng:** planning/artifacts mà API nhìn thấy có thể khác filesystem runtime;
runtime và tool backend cũng chưa coherent. Healthy/readiness/catalog không phát hiện lỗi này.

**Cần đóng:** xác định effective mount origin cho đúng Docker context, làm ba bên
dùng một storage mapping bền vững; chạy lại ma trận hai chiều trước và sau recreate
trong môi trường test. Không fold override hiện tại thành runbook hoàn tất khi
roundtrip chưa pass. Marker test đã được dọn, không sửa planning docs có sẵn.

### F2 — P1: busy SSE có thể bỏ qua re-attestation vô thời hạn (O03)

Source: `apps/web/server/src/services/runtime/stream-service.ts:38–55`.

Mỗi upstream frame thắng `Promise.race` sẽ clear và tạo lại heartbeat timer.
`runs.getRun()` chỉ được gọi trong nhánh heartbeat. Khi frames liên tục đến nhanh
hơn heartbeat, nhánh re-attestation không chạy dù membership đã bị thu hồi.

Probe chạy **StreamService thực**, thay upstream/auth environment:

- Heartbeat 30ms; 80 native `values` frames, khoảng 3ms/frame.
- Revoke membership flag tại frame 5; `getRun()` sẽ reject nếu được gọi lại.
- Kiểm tra số `run-event` chunks sau hai heartbeat kể từ revoke.

```json
{"heartbeatMs":30,"authorizations":1,"chunksAfterRevocationDeadline":71,"closed":true,"reattestationPassed":false}
```

`closed: true` ở đây do upstream hữu hạn kết thúc, không phải revoke được enforce.
Existing idle-revoke test xanh vì có khoảng chờ đủ để heartbeat thắng.

**Cần đóng:** deadline re-attestation dựa elapsed time độc lập với event traffic;
verify idle lẫn continuous/bursty traffic và reconnect denial. Check quyền phải
có bounded latency theo policy, không phụ thuộc upstream im lặng.

### F3 — P1: authenticated actor A→B giữ dữ liệu/in-flight result của A (O03)

Sources:

- `apps/web/src/real/screens/login.tsx:88–102`: cleanup chỉ khi session unauthenticated;
  authenticated actor change chỉ đổi `key` của children.
- `apps/web/src/real/bootstrap.tsx:75–80`: QueryClient vẫn dùng chung.
- `apps/web/src/real/queries.ts:14–16` và `screens/workspace.tsx:113–145`:
  project/thread query keys chưa chứa trusted actor/deployment identity.

Hai regression probe dùng **RealLoginGate thực**, actual QueryClient và session
query update làm environmental input:

1. A có thread query đang chờ → session đổi trực tiếp sang authenticated B →
   resolve response A: DOM của B hiện `ACTOR_A_PRIVATE_HISTORY` → **FAIL**.
2. A có draft trong recovery → session đổi trực tiếp sang authenticated B:
   `ACTOR_A_PRIVATE_DRAFT` còn trong localStorage → **FAIL**.

Đây là actor-transition/cache regression đã tái hiện trên source, không phải
claim đã exploit qua production backend. Browser login/logout bình thường có thể
đi qua nhánh unauthenticated; nhánh đó không thay thế authenticated transition,
ví dụ session re-probe sau thay account ở tab khác.

**Cần đóng:** actor boundary đổi thì cancel/dispose old requests/streams, clear
incompatible recovery/cache, hoặc dùng actor/deployment-keyed QueryClient và scoped
keys. Late response không được cài data vào scope B; test cả cached và in-flight.

### F4 — P1: deployment chưa có O03, source pass không chứng nhận live (O01/O03)

Image IDs thực tế từ `docker inspect`:

| Thành phần | Image ID |
|---|---|
| UI | `sha256:42063a629d606adb0cb9ee18dc2081ed5403676354fc89910b45bd644091ea43` |
| API | `sha256:53dfcbdef25fb03edcc4fd842712008b0e8ef63dbd0eab01190851f25b0f8bf0` |
| Runtime | `sha256:0664e56b01c569788a6f1f38ea5ca3590ccb041dd6b5a9a73ad970572caefccb` |

API built `dist/services/runtime/stream-service.js` chỉ có **1** occurrence
`this.runs.getRun`, không có code re-attestation mới. File SHA-256:
`d3aa0321409d6113764e155c3498d294da91e65bf8fd3f4f9d691dd701f223de`.
UI browser tải 7 JS assets trong login/projects flow; không có recovery marker
`raptix.real.selection.v1.`. UI/API labels chỉ có version `0.0.0`, runtime revision
label rỗng; chưa có source revision proof.

**Cần đóng:** sửa source blockers trước, build/pin images đúng source rồi nghiệm
thu lại deployed O03. Không dùng API hiện tại làm bằng chứng idle/busy revoke đã fix.

### F5 — P2: recovery namespace chưa có deployment identity (O03)

`apps/web/src/real/workspace-session.ts:17–18,86` dùng actor/engagement cho selection
và pending, thêm thread cho draft; chưa có deployment namespace như spec yêu cầu.

Actor scoping đã là tiến bộ thực, nhưng khi cùng origin thay backend/deployment
và IDs trùng, browser vẫn có thể restore state sai deployment, đặc biệt local
identity. Đây là source/spec gap; chưa chạy cross-deployment live repro trong lượt này.

**Cần đóng:** define trusted deployment identity/epoch và scope recovery/cache;
test hai deployments có overlapping IDs và deliberate invalidation legacy entries.

### F6 — P2: baseline completion/evidence chưa đủ điều kiện exit (O01/O02)

- O01 inventory hiện là route/panel grouping, chưa khép modal/header action/deep-link/
  mutation-level coverage; source↔image revision chưa được freeze đầy đủ.
- Migration **status up-to-date** là pass hiện tại, không chứng minh clean DB +
  upgrade data và rollback/restore behavior như O02 yêu cầu.
- Volume mount và vault-key-configured là observation; chưa phải restart/key
  backup/restore rehearsal. O02 yêu cầu inference thật, health endpoint ghi rõ
  `notProbed: model_inference, tool_execution, provider_operations`.
- Credential test của `o02admin` hiện trả 401. Reviewer login pass; chưa verify
  two distinct actors/revoke giữa hai browser contexts trên deployment.

Không kết luận auth code hỏng chỉ từ credential test owner bị từ chối. Cần account
test hợp lệ trước live two-actor acceptance; không reset password để làm probe xanh.
Không tự chuyển gate inference/backup từ O02 sang O05/O14 rồi gọi O02 complete.

## 5. Checks đã chạy và kết quả

### 5.1 Source checks — PASS

```powershell
npm run test --workspace=@raptix/web-raptix -- --pool=threads --maxWorkers=2 src/real/workspace-session.test.ts src/real/screens/workspace.test.tsx src/real/precommit-regressions.test.tsx src/real/session-api.test.ts src/real/stream.test.tsx src/real/bootstrap.test.tsx src/real/transport.test.ts
# 7 files / 55 tests passed

npm run test --workspace=@raptix/web-raptix-server -- --maxWorkers=2 tests/stream-service.test.ts tests/t07-auth-members.test.ts tests/w02-run-authorization.test.ts tests/bootstrap.test.ts
# 4 files / 42 tests passed

npm run typecheck --workspace=@raptix/web-raptix
npm run typecheck --workspace=@raptix/web-raptix-server
npm run lint --workspace=@raptix/web-raptix
npm run lint --workspace=@raptix/web-raptix-server
# Cả bốn commands pass
```

Hai actor-transition probes **2/2 FAIL** như F3; busy SSE probe **FAIL** như F2.
Đây là probes bổ sung, không được cộng vào số regression pass hiện hữu.

### 5.2 Deployment checks

| Check | Kết quả |
|---|---|
| Capabilities qua nginx `:3001` | PASS multi-user; C2 vẫn `provider_unavailable` (O12) |
| `/api/health/ready` | PASS dependency wiring; không probe inference/tools/provider |
| `docker exec raptix-web-raptix-api npx --no-install prisma migrate status` | PASS 19 migrations, schema up to date |
| PostgreSQL/runtime/Neo4j persistent mounts | OBSERVED; chưa rehearsal restart/restore |
| API ↔ runtime ↔ sandbox roundtrip | **FAIL**, matrix F1 |
| `o02reviewer` browser login/session/projects/logout | PASS 200; không page errors |
| Missing CSRF logout / cross-origin login | PASS refusal 403 |
| Foreign engagement ID | PASS refusal 404 |
| `o02admin` browser login bằng credential test hiện có | 401; two-actor acceptance **UNVERIFIED** |
| Mock với `/api/**` bị browser abort | PASS AI Workspace + Execution inspector; 0 API requests, 0 page errors |
| Deployed O03 source match | **FAIL**, API/UI vẫn là build trước O03 |

Probe scripts lưu ngoài workspace tại `C:\Users\tuanp\AppData\Local\Temp\opencode`:
`verify-o03-busy-stream.mjs`, `verify-o01-o03-deployed.cjs`,
`verify-o02-workspace.cjs`, `verify-o01-mock-isolation.cjs`,
và saved actor-transition fixture `o03-verification-probe.test.tsx`.
Tên/algorithm/results đã được ghi trong báo cáo này để không chỉ dựa vào temp artifacts.

**Command notes:** lần đầu thử npm workspace script trong API image không chạy
được vì image không chứa ancestor workspace manifests; chưa chạy migration.
Đổi sang Prisma `migrate status` trực tiếp như trên. Workspace matrix probe ban
đầu dùng `python` trong sandbox bị thiếu executable; đổi `python3` và chạy đủ matrix.
Mọi marker của các lần thử đã được dọn.

## 6. Thứ tự khép lại đề xuất

1. **O02:** xử lý effective workspace mapping, probe lại cả ba bên; cập nhật baseline
   với image/runtime mới thay vì tái dùng roundtrip cũ.
2. **O03:** fix heartbeat starvation và authenticated actor transition; giữ các
   failing cases làm regression trước khi fix, bổ sung deployment namespace.
3. Chuẩn bị account owner/reviewer test hợp lệ; test live revoke/reconnect và
   stale-response isolation bằng hai browser contexts.
4. Build/pin/deploy source đã fix; verify API/UI có code mới và source revision.
5. Khép O01 action inventory/manifest; O02 clean/upgrade migrations, inference và
   restart/backup/restore evidence theo spec. Chỉ sau đó đóng O01–O03.

**Tổng kết hai trục:** Standards: 1 delivery prerequisite (S1), không có thêm hard
coding-standard finding độc lập. Spec: 6 findings mở (F1–F6), nghiêm trọng nhất
là F1 shared workspace failure. Current tests xanh không phủ các counterexamples
đã tái hiện và không chứng nhận deployed images.
