# I00 record: contract, baseline và phạm vi I01

- **Ngày:** 2026-10-19.
- **Plan:** [single-active-project-environments](2026-10-19-single-active-project-environments-implementation-plan.md).
- **ADR:** [0092](../adr/0092-single-active-project-environments.md) (Proposed).
- **Branch:** `feat/single-active`, tạo từ `web-improve-refactor` tại `e9b20969`. Worktree: `.claude/worktrees/single-active`.

## 1. Baseline đã ghi nhận

| Hạng mục | Kết quả | Ghi chú |
|---|---|---|
| Server typecheck (`@raptix/web-raptix-server`) | Pass | Chạy sau `prisma:generate`. |
| Server test (`@raptix/web-raptix-server`) | 485/485 pass | Trước mọi thay đổi. |
| Contract test (`@raptix/web-contracts`) | 48/49 pass | Lỗi có sẵn: `tests/run-api.test.ts` "validates the truthful local single-user members view additively" (`isMembersView` trả `false`). Không thuộc plan; không sửa trong branch này, cần issue riêng. |
| Migration sạch | Áp đủ 26 migration hiện có lên Postgres 17 dùng một lần | Container `raptix-envtest-i01`, cổng `127.0.0.1:55432`, có label `raptix.test=i01`. |
| Runtime đang chạy | Không đổi | Snapshot chỉ đọc lưu tại `scratchpad/runtime-baseline-snapshot.txt` (102 dòng). Gồm 19 container của stack `raptix`, `raptix-web-raptix`, 4 sandbox `sbx-*` và `juice-shop`. |

Không chụp row hay schema của `raptix-web-postgres` trong I00. Theo quyết định của người yêu cầu, phần này chuyển sang I07.

## 2. Default trong plan §1.2 được chốt

- Project chưa dùng chỉ có metadata và storage. Container tạo khi activate lần đầu.
- Xem project, finding, report không tự activate runtime.
- Khi project A còn run, tool hoặc câu hỏi, mở B trả trạng thái `busy`. Không kill A và không chạy song song. Chuyển sang B chỉ bằng stop-and-switch rõ ràng, và phần này thuộc I06.
- Pause không giải phóng slot.
- Restart laptop hoặc API không tự resume. Phải reconcile trước.
- Archive và stop giữ dữ liệu. Xóa vĩnh viễn là thao tác riêng (xem §4).

## 3. Transport của host controller

- Controller là module Go nằm trong `apps/launcher`, chạy trên host, lắng nghe HTTP ở `127.0.0.1`.
- Container API truy cập qua `host.docker.internal`. Cần xác minh trên Docker Desktop Windows ở I02.
- Xác thực bằng bearer token riêng cho từng deployment. Token được mount chỉ vào container API, không vào runtime hay sandbox, và không đưa vào env hay log.
- Giới hạn request body 64 KiB. Mỗi lệnh có timeout 30 giây. Việc lâu chạy bất đồng bộ và kết quả được quan sát bằng polling.
- Không lấy Docker socket cho Fastify, runtime hay sandbox.

Phương án đã loại: unix socket (Windows không dùng được), named pipe (phức tạp với Docker Desktop), gRPC (thêm dependency mới).

## 4. Chính sách xóa

- Codebase hiện không có đường xóa project. `projects-service.ts` không có hàm delete.
- Trong I01–I06, không có hard-delete. Stop và archive là hai thao tác duy nhất có trong phạm vi.
- Hard-delete phải có ADR riêng, retention policy riêng và resource disposition. Nút "Delete Project" không dùng `docker compose down -v`.

## 5. Routing mode và legacy

- Mỗi project có routing mode `legacy` hoặc `environment`. Không có fallback tự động.
- Trong I00 mới chỉ xác định được nguồn legacy: CLI dùng `RAPTIX_ENGAGEMENT` và raw URL; Web dùng một `web-runtime` và volume `web_runtime_workspace` dùng chung. Việc map sang project canonical thuộc I07.

## 6. Phạm vi I01 đã chốt

Mục tiêu: registry bền vững, lifecycle intent có idempotency, và slot toàn deployment được thay đổi bằng CAS.

**File dự kiến (runtime, ≤10 file, ≤400 dòng mỗi patch):**

| File | Vai trò |
|---|---|
| `apps/web/server/prisma/schema.prisma` | Thêm 3 model: `DeploymentSlot`, `ProjectEnvironment`, `EnvironmentCommand`. Chỉ additive. |
| `apps/web/server/prisma/migrations/20261028000000_project_environments/migration.sql` | Migration additive, không đổi bảng cũ. |
| `apps/shared/web-contracts/src/environments.ts` | DTO và validator cho command, slot, binding. Export qua `index.ts`. |
| `apps/web/server/src/services/environments/project-environment-service.ts` | Service duy nhất cho admission và command. |
| `apps/web/server/src/services/runtime-ownership.ts` | Gọi kiểm tra admission trong transaction `reserve` cho `create_run` và `resume`. |

**Test:**

- Pure: validator trong `apps/shared/web-contracts/tests/environments.test.ts`.
- Real DB: `apps/web/server/tests/environment-admission-live.ts`, chạy thủ công với `DATABASE_URL` trỏ tới DB dùng một lần. Không dùng `*.test.ts` để tránh phụ thuộc DB trong suite mặc định.
- Các case bắt buộc của plan I01: hai actor cùng activate khác project chỉ có một winner; duplicate và mất ACK; crash sau reserve; version cũ; lease hết hạn không giải phóng slot; viewer hoặc foreign project bị từ chối.

**Ngoài I01:** route HTTP cho activate/stop (thuộc I03 và I05), controller, container thật, và mọi thay đổi Compose.

**Hành vi tương thích:** nếu chưa có dòng `DeploymentSlot`, slot được coi là `idle` và cho phép admit. Deployment hiện tại không thay đổi hành vi.

## 7. Điểm để lại cho I02 trở đi

- Xác minh `host.docker.internal` từ container API trên Docker Desktop Windows.
- Định nghĩa image digest allowlist và cách cấp bootstrap config cho environment.
- Threat model riêng cho thay đổi Compose hardening khi đến I02.
- Quyết định về Neo4j: role theo database hay scoped facade.

## 8. Kết quả I01

Commit trên `feat/single-active`: `a48cd77b` (bảng, migration, contract) và `763fcc01` (service, admission, test DB thật).

**Đã làm:**

- Migration `20261028000000_project_environments`: 5 enum, 3 bảng, 3 index, 3 FK. Chỉ additive.
- `apps/shared/web-contracts/src/environments.ts`: request và result của lệnh, cùng validator. Kết quả `busy` không bao giờ chứa `activeEngagementId`, và phải có phase khác `idle`.
- `ProjectEnvironmentService`: `submit` (activate/stop), `observe` (nội bộ, dành cho controller ở I02), `assertAdmits` (đường admission).
- `RuntimeOwnershipService.reserve`: kiểm admission cho `create_run` và `resume` ngay sau nhánh replay.
- `requireProjectAccess`: tách từ `owned` để service mới và `reserve` dùng chung một kiểm tra quyền.
- Retry và reassign đi qua `submit → startRun → reserve(create_run)`, nên cũng bị admission chặn. Khi bị từ chối, nhánh `catch` đã có sẵn trong `commandInstance` sẽ revoke operator grant. Đường revoke này **chưa có test riêng**.

**Kết quả kiểm chứng:**

| Kiểm tra | Kết quả |
|---|---|
| Migration: clean (26) rồi upgrade (+1) trên Postgres 17 dùng một lần | Pass |
| Diff schema với DB sau upgrade | Không có drift mới. 40 câu drift có sẵn giữ nguyên (xem §8.2) |
| `web-contracts` `environments.test.ts` | 5/5 |
| `web-contracts` toàn bộ | 53/54. Một lỗi có sẵn (xem §1) |
| Typecheck: server, web-raptix, cli | Pass |
| Server test toàn bộ | 485/485, không đổi so với baseline |
| `tests/environment-admission-live.ts` trên Postgres thật | 13/13 nhóm pass |
| Đột biến: cho admission luôn qua | Test đỏ ở `Missing expected rejection (isConflict)`. File được khôi phục và khớp byte |
| ESLint các file mới và file sửa | Sạch |

**Lệch so với plan hoặc quyết định đã ghi:**

1. **Thứ tự kiểm tra: stale trước busy.** Hai client cùng gửi version 0 thì client thứ hai nhận `stale` kèm phase và version mới, không nhận `busy` ngay. Đây là hành vi compare-and-set. Retry với version mới sẽ nhận `busy`. Test được sửa theo hành vi này.
2. **Chưa có route HTTP cho activate/stop.** Route thuộc I03 và I05. Trong I01, entrypoint duy nhất là service.
3. **Khi `RAPTIX_WEB_DEPLOYMENT_ID` không được đặt**, deployment key là `default`.
4. Lỗi lint `main.ts:235` (`prefer-const`) có sẵn ở HEAD và không thuộc thay đổi này.

**Nợ kỹ thuật, không sửa trong I01:**

- Schema hiện đã lệch migration ở HEAD (40 câu: FK, default, một index đổi tên). Nên mở issue riêng. Không gộp vào I01 vì sẽ sinh migration không liên quan.
- Test `run-api.test.ts` "members view" lỗi có sẵn.
- Admission kiểm tại thời điểm reserve. Nếu slot đổi sau đó nhưng run đã vào runtime thì chưa bị chặn. Chặn thật cần routing theo environment (I03) và stop-and-drain (I06).
- Đường revoke grant khi retry bị refused chưa có test. Nên bổ sung ở I03 cùng với routing.

## 9. Kết quả I02–I05 (đã làm trong branch, chưa có live)

**Commit:** `27db9d72` (controller Go), `9b3d2187` (định tuyến runtime), `7a035096` (cầu nối control plane và facade), `269e0bff`, `aaf56258`, `049956b9` (CLI), `c64e7cb5` (panel Web), `06bdabf4` và `360d0118` (sửa admission và chốt parity).

**Đã làm:**

- **I02:** `apps/launcher/internal/environments` gồm identity, render argv, controller và transport loopback. Cầu nối phía control plane gồm `HostControllerClient` (chỉ loopback, bearer token ≥32 byte, timeout, mã lỗi ổn định) và `EnvironmentLifecycle` (bring-up và shut-down). Lifecycle chỉ giải phóng slot khi quan sát được cả hai container đã dừng.
- **I03:** `RuntimeRouter` chọn endpoint theo project. Project không có bản ghi môi trường đi đường legacy. Project được quản lý chỉ đi tới runtime của nó khi `ready`, và không bao giờ fallback. `RunService` và `StreamService` resolve theo engagement khi có router. Endpoint chỉ được lưu khi khớp tên container mà controller dẫn xuất.
- **I04:** CLI không còn gọi LangGraph trực tiếp. Có facade client, adapter chuyển sự kiện đã chiếu sang chunk mà reducer hiện có đã hiểu, phiên project, và các lệnh `/project`, `/activate`, `/stop`. CLI không còn đọc `RAPTIX_ENGAGEMENT`.
- **I05:** Panel vòng đời trong tổng quan project. Chuyển project là hai bước xác nhận rõ ràng. Click lặp không tạo lệnh trùng, và trạng thái đang chuyển tiếp được polling cho tới khi ổn định.

**Số liệu kiểm chứng:**

| Bộ | Kết quả |
|---|---|
| Controller Go `internal/environments` | 20/20 |
| Server (toàn bộ) | 500/500 |
| Live DB: admission | 14/14 nhóm (đột biến "luôn admit" làm đỏ) |
| Live DB: lifecycle | 5/5 nhóm (đột biến "lỗi không xác định giải phóng slot" làm đỏ) |
| Live DB: facade qua Fastify | 7/7 nhóm |
| Định tuyến runtime (double HTTP) | 10/10 (đột biến "fallback legacy" làm đỏ 4 test) |
| CLI | 74/74, typecheck sạch |
| Web: panel và logic | 15/15 và logic pass. Toàn bộ web: năm file timeout 5 s khi chạy song song, và pass 48/48 khi chạy riêng |
| `web-contracts` | 54/55. Lỗi có sẵn ở `run-api.test.ts` |

**Chưa làm hoặc chưa được kiểm chứng (cần live hoặc việc còn lại):**

1. Controller chưa được đăng ký làm subcommand của binary launcher. Chưa có Docker thật: create, start, stop, mount và inspect mạng đều chưa chạy. Chưa có compose packaging và digest image thật.
2. Container chưa thể chạy agent thật: chưa có cấu hình runtime (endpoint sandbox, model) được cấp cho container. Đây là việc của I08.
3. CLI: không gửi được model override qua control plane, nên lệnh bị từ chối rõ ràng. Thống kê token về 0 vì projection không mang usage. Hàm `verifyThreadForResume` đã có và được test, nhưng chưa gắn vào luồng restore. Dispatch vẫn do server từ chối khi môi trường không ready. Chưa xử lý dirty draft khi đổi project vì CLI chưa có draft.
4. Web: chưa có màn chọn project toàn cục hay nút chuyển trên shell. Test "hai tab" mới kiểm ở tầng server (CAS), chưa có rendered test hai tab. Chưa audit viewport và keyboard của panel.
5. Chưa chạy E01–E12, live model/tool run, TTY foreground, hay browser acceptance.
6. Lỗi có sẵn chưa sửa: `prefer-const` ở `main.ts` (`sessionProvider`); drift 40 câu giữa schema và migration; timeout của năm file web khi chạy song song.

## 10. Bằng chứng live (2026-10-19) và phần I06 còn lại

**Commit:** `ddb9e6fe` (controller host), `210c9184` (trạng thái chuyển tiếp và timeout), `01e6ccb0` (CLI displayName).

**Đã chạy thật trên Docker, API trong container, controller trên host:**

- Activate: slot và row đi `starting` → `ready` trong khoảng 15–20 s, với `RAPTIX_USE_SKILLOGY=false` trong runtime env.
- Stop: row đi `stopping` ngay khi slot đổi, rồi `stopped/idle` trong khoảng 5–10 s.
- Khi `stopped`, tạo thread bị từ chối với thông báo nêu rõ trạng thái.
- CLI qua `AgentTransport`: tạo thread planning (assistant `soundwave`) và stream nhận được chunk `values` từ runtime live. Không có chunk lỗi. Run không có câu trả lời của model vì chưa cấu hình LLM.
- Tạo thread `execution` bị chặn đúng quy tắc: `executionReady` cần planning `ready`. Đây là hành vi đúng, không phải lỗi môi trường.

**Test chạy lại sau thay đổi:**

| Bộ | Kết quả |
|---|---|
| Go `internal/environments` và `go vet` cmd/internal | pass |
| Live DB: admission | exit 0, 14 nhóm |
| Live DB: lifecycle | exit 0, 6 nhóm |
| Live DB: facade | exit 0, 7 nhóm |
| Routing, context, controller client | 28/28 |
| Server (toàn bộ) | 502/502 (55 file) |
| CLI | 74/74 (10 file) |
| Web (toàn bộ) | 1354/1364. Mười lỗi ở 9 file đều dừng ~5 s khi chạy song song. Chạy riêng 9 file đó: 120/120 |

Test `controller-client` "gives up after the timeout" trước đây đặt timeout 20 ms cho op `stop`, nhưng `stop` luôn có budget tối thiểu 120 s. Test đã đổi sang op `observe`.

**Chưa làm, nên I06 chưa đóng:**

1. Archive, delete và retention. Hard-delete vẫn bị từ chối theo quyết định I00.
2. Cleanup retry và phân loại orphan/partial resource với kết quả có tên.
3. Tích hợp P10 (mailbox/grant) và P11 (checkpoint/question). Stop-and-drain khi run đang chạy.
4. Test bắt buộc theo plan: bộ đếm graph/tool, stop giữa model/tool, paused restart, controller mất kết nối sau Docker ACK, partial start runtime/sandbox, lost ACK/cancel race, cleanup fail rồi retry, cross-client delete.
5. Restart battery cho runtime và sandbox (E06), và controller crash giữa start (đã có test double, chưa chạy lại live sau sửa).
6. Run có model thật (cần LLM credential) và E12.
7. Acceptance trình duyệt cho panel (I05).

**Vẫn mở từ trước:** sandbox có thể tới runtime API và host controller (cần ADR quyết định). Skillogy đang tắt cho runtime môi trường. Tài liệu ADR-0092 giữ trạng thái `Proposed` vì chưa đủ điều kiện Accepted.

## 11. Kết quả I06 và I07 (2026-10-19, đã làm, một phần)

**Commit:** `10ae66f2` (controller bind trước khi báo listening), `919e5b7a` (archive, drain, lý do lỗi).

**I06 đã làm:**

- **Archive và unarchive:** lệnh mới, lưu `archivedAt` (migration additive `20261030000000_environment_archive`). Archive bị từ chối khi project đang giữ slot (`held`) hoặc môi trường chưa dừng (`not_stopped`). Project đã archive không activate được (`archived`) và không admit run. Dữ liệu và generation được giữ.
- **Drain trước khi stop:** stop chỉ dừng container khi không còn run đang in flight. Run được coi là kết thúc khi runtime báo trạng thái terminal. Hết `drainTimeoutMs` (mặc định 10 phút) thì slot trở lại `ready` với lý do `run_active`, container vẫn chạy.
- **Lý do lỗi có tên:** `ProjectEnvironment.lastError` và `EnvironmentStateView.environment.lastError` (mã đóng, ví dụ `rejected_path`). Lỗi đầu tiên trong ngày (activate im lặng khi thiếu thư mục workspace) nay hiện lý do thay vì chỉ `stopped`.
- **Kiểm chứng:** `environment-recovery-live.ts` (3 nhóm) pass trên PostgreSQL dùng một lần. Ba bộ live cũ (admission 14, lifecycle 6, facade 7) pass sau thay đổi. Server 502/502. Contracts 54/55, lỗi duy nhất là lỗi có sẵn `run-api.test.ts`. Web panel và CLI typecheck sạch.

**I06 chưa làm:**

- Orphan detection: cần thao tác controller liệt kê container theo label, nằm ngoài sáu thao tác đã duyệt. Chưa làm.
- Cleanup retry có giới hạn: chưa làm.
- Tích hợp P10 (mailbox/grant) và P11 (checkpoint/question): chưa làm.
- Bộ test còn lại trong plan (bộ đếm graph/tool, stop giữa model/tool, paused restart, lost ACK/cancel race): chưa làm.
- Drain với run thật trên runtime: mới kiểm chứng với runtime status double. Chưa chạy live.
- CLI và Web chưa hiển thị `lastError`.

**I07 đã làm (dry-run, bản sao, không ghi DB thật):**

- Phạm vi theo quyết định của người yêu cầu: chỉ `reddish`. Project `viettel-peru` không tồn tại trong DB web, DB restore, hay volume workspace, nên không có gì để migrate. Cần xác nhận lại tên.
- Công cụ `apps/web/server/scripts/legacy-migration/migrate_legacy_project.py` có `dry-run`, `verify`, `rollback`. Rollback chỉ xóa thư mục có marker dry-run.
- Kết quả dry-run cho `reddish`: workspace 10 file khớp hash. Checkpoint: 51 checkpoint và 215 write (khóa theo `thread_id`). Mailbox: 0 dòng. `verified: true`. Rollback và verify đều kiểm chứng.
- Chạy trong container với volume chỉ đọc, đầu ra ở thư mục riêng. Không mở runtime legacy và không ghi DB thật.

**I07 chưa làm:**

- Snapshot chưa quiesce: runtime legacy vẫn chạy khi chụp. Cutover thật cần dừng nguồn, và cần duyệt riêng.
- Pickle toàn cục (`.langgraph_ops.pckl` 4.9 MB, `store.pckl`, `store.vectors.pckl`, retry counter) chưa được migrate. Chưa biết chúng có tham chiếu tới thread của `reddish` hay không. Cần quyết định.
- Chưa đưa dữ liệu đã migrate vào volume state của môi trường `reddish`. Runtime môi trường hiện bắt đầu với store trống, nên lịch sử thread không hiển thị trong chế độ environment.
- Cutover dữ liệu thật trên DB web chưa thực hiện (đúng theo phê duyệt).
- Kiểm tra CLI và Web mở cùng project sau migration chưa làm.

## 12. I06 và I07: trạng thái sau vòng tiếp theo (2026-10-19)

**I06 đã làm và kiểm chứng:**

- Archive và unarchive; drain trước khi stop; lý do lỗi có tên (`lastError`).
- Drain hoàn tất ngay khi runtime không chạy. Run mà runtime không biết (HTTP 404) không giữ stop, và dấu active của nó được giải phóng.
- Stop bị controller không trả lời được retry tối đa 3 lần. Từ chối không bao giờ được retry.
- Controller tự tạo thư mục workspace của project khi chưa có, dưới một root phải tồn tại sẵn. Trước đây activate thất bại im lặng với `rejected_path`.
- Lệnh `environment-orphans` (chỉ đọc): liệt kê container của một deployment mà environment không còn được biết. Không xóa gì.
- Kiểm chứng: recovery live 7 nhóm pass. Admission 14, lifecycle 6, facade 7 pass. Go `internal/environments` pass, gồm test workspace và test orphan.
- Lỗi thật đã tìm và sửa trong vòng này: `instanceExchange` ném lỗi với mọi mã ngoài 200/409, nên nhánh 404 không bao giờ chạy. Stop của `reddish` đã treo đến hết timeout 10 phút. Nay gọi trực tiếp và kiểm chứng lại.

**I06 chưa làm:**

- Tích hợp P10 (mailbox/grant) và P11 (checkpoint/question). Pause và câu hỏi chưa được phân biệt với stop.
- Bộ đếm graph/tool deterministic.
- Restart battery live cho runtime và sandbox (E06), và controller bị crash sau Docker ACK trên container thật.
- Xóa orphan: để người vận hành quyết định, theo báo cáo của `environment-orphans`.

**I07 đã làm và kiểm chứng (copy, không ghi DB thật):**

- Công cụ `migrate_legacy_project.py` có `dry-run`, `verify`, `apply`, `unapply`, `rollback`. Unit test 6/6 pass trên snapshot tổng hợp.
- `reddish` đã đi qua chuỗi: dry-run từ snapshot thật (chỉ đọc) → apply vào store và workspace của môi trường đã dừng → môi trường `ready` → `stopped`.
- Kết quả: store của môi trường chứa 51 checkpoint và 215 write, khớp dry-run. Workspace có đủ 10 file. Schema store khớp, nên apply không từ chối.
- Dữ liệu của `viettel-peru` không tìm thấy ở đâu, nên không có gì để migrate.

**I07 chưa làm, cần quyết định của bạn:**

1. **Bản ghi thread không được migrate.** Thread (metadata) nằm trong `.langgraph_ops.pckl`, một kho toàn cục của runtime legacy. Công cụ chưa di chuyển nó. Vì vậy `GET /threads/{id}` trên môi trường trả 404, dù checkpoint đã có.
2. **Cấu hình của thread khác cấu hình môi trường.** Thread legacy mang `runtime_context_hash` của cấu hình legacy (`sandbox_url` khác). Web từ chối với 409. Đây là guard đúng. Có hai hướng:
   - (a) Rebind: tạo lại bản ghi thread trong môi trường với cấu hình môi trường, và ghi proof (hash cũ và mới) có phiên bản. Đề xuất của tôi.
   - (b) Giữ identity legacy và chỉ đọc lịch sử, không cho chạy tiếp trong môi trường.
3. **Image khác digest.** Runtime legacy là `raptix-langgraph:stable` (`b3cd…`). Môi trường dùng digest `53c4…`. Schema store khớp, nhưng cần quyết định pin image nào (I08).
4. **Cutover trên DB và volume thật** vẫn chờ duyệt riêng. Snapshot hiện tại chưa quiesce.

## 13. I08 và I09: phần tự quyết được

**I08:**

- Đã có: lệnh `environment-controller` (bind trước khi báo listening), lệnh `environment-orphans`, và runbook vận hành (`docs/design/2026-10-19-single-active-runbook.md`).
- Chưa làm, và vì sao:
  - Đóng gói Compose và installer Windows/WSL/Linux: đổi hardening container cần ADR và threat model theo CLAUDE.md. WSL và Linux không kiểm được ở đây.
  - Image profile, offline cache, pin digest, update và rollback: cần quyết định image nào được pin (xem mục 12.3).
  - Retire đường cũ: cần parity pass và thời điểm do bạn chốt.

**I09:**

- Đã có: runbook và ma trận acceptance bên dưới (chỉ ghi những gì đã chạy).
- Chưa làm: release gate và chuyển ADR-0092 sang Accepted. Đây là quyết định của bạn. Chưa có một run có model với planning rồi đến output/findings/report. Chưa test mock mode không gọi controller. Chưa test upgrade và rollback thực tế.

**Ma trận acceptance (trạng thái thật):**

| Gate | Trạng thái | Bằng chứng |
|---|---|---|
| Activate/stop trên Docker thật | Pass | copy `reddish`, nhiều lần |
| Admission một winner giữa hai client | Pass | admission live 14 nhóm |
| Stop chờ run đang chạy | Pass (runtime status giả) | recovery nhóm 2, 6, 7 |
| Stop bị controller không trả lời | Pass | recovery nhóm 4 |
| Restart giữa stop | Pass | recovery nhóm 5, và stop treo được hoàn tất khi API khởi động lại |
| Run có model thật | Pass một lần | `xin chào` qua proxy test |
| Thread lịch sử đọc được trong môi trường | Chưa pass | 404/409, xem mục 12 |
| Restart runtime/sandbox (E06) | Chưa chạy | |
| Crash controller sau Docker ACK, trên container thật | Chưa chạy | |
| Web và CLI mở cùng project sau migration | Chưa chạy | |
| Upgrade và rollback của migration | Chưa chạy | |

## 14. Rebind thread lịch sử (I07, cập nhật sau mục 12)

- Endpoint: `POST /api/engagements/:id/threads/:thread/rebind` (operator). Thread được đưa vào runtime của môi trường với cùng id và metadata của cấu hình môi trường. Binding chuyển sang cấu hình đó, kèm fingerprint cũ được ghi trong kết quả. Không chạy run và không ghi lại checkpoint.
- Kiểm tra trước khi đổi binding: metadata thread trên runtime, và các trường cấu hình so với giá trị checkpoint. Lệch thì trả 409 và giữ nguyên binding.
- Kết quả trên bản sao của `reddish` (3 thread): cả ba trả 200 sau rebind. Số tin nhắn ở tầng runtime khớp legacy (2/2 và 75/75). Web chiếu lịch sử 75 tin nhắn thành 13 mục, đó là phép chiếu, không phải số lượng thô.
- E06 (copy): restart runtime, rồi restart sandbox. Lưu trữ giữ nguyên (75 tin nhắn), thread vẫn đọc được, môi trường vẫn `ready`.
- Crash controller khi đang start (copy): slot chuyển `uncertain` với lý do `controller_unreachable`, không bị đánh dấu `stopped` giả. Sau khi controller được bật lại, owner stop để reconcile (slot về `idle`), rồi activate lại thành công.
- Còn lại: bộ server đầy đủ sau thay đổi cuối chưa hoàn tất (bị dừng do thiếu bộ nhớ). Chưa có P10/P11. Cutover trên DB và volume thật chờ duyệt riêng.

## 15. Sửa theo đánh giá rebind và lifecycle (I06, I07)

Rebind (`POST …/threads/:thread/rebind`), theo 4 điểm đã nêu, cộng audit:
- Kiểm tra operator trước mọi lời gọi runtime. Viewer bị từ chối trước khi tạo thread.
- Chỉ HTTP 404 là thread thiếu (`threadExists`). Lỗi khác là unavailable, không tạo gì.
- Project phải có environment record và đang ready. Project legacy không được rebind.
- Lịch sử không được rỗng và số message phải khớp `expectedMessageCount` đã xác minh với migration record.
- Mỗi lần rebind ghi `WebAuditEntry` với action `thread.rebound` (fingerprint cũ và mới, số message, created).

Lifecycle:
- Drain chờ cả run trong ledger và instance đang `running` hoặc `cancel_requested` của mọi thread project. Lỗi khi đọc instance được coi là còn bận.
- Restart gặp slot `ready` mà container không chạy thì giữ slot ở `uncertain`, lý do `not_running_at_restart`.

Kiểm chứng:
- Unit rebind 9/9. Routing, context, history projection pass.
- Live: recovery 9 nhóm, admission 14, lifecycle 6, facade 7 đều pass.
- Server đầy đủ, chạy một worker: 511/511 (56 file).

Canary `reddish` (chưa thực hiện):
- Điều kiện đã có: rebind đã sửa, rehearsal trên bản sao đã làm.
- Còn lại trước khi chạm stack đang chạy: backup Web DB, workspace và checkpoint state (kèm WAL/SHM) vào thư mục lưu giữ; quiesce runtime legacy; rehearsal rollback; rồi duyệt riêng từng bước vì việc này thay đổi container API và runtime của stack bạn.
