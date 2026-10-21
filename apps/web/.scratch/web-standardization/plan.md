# Chuẩn hóa apps/web: audit và kế hoạch

- **Ngày:** 2026-10-21
- **Trạng thái:** D1–D9 đã chốt và triển khai theo mục 8–9. Vòng 3 (mục 9.8): policy disposition của mock theo server (theo actor, version, lý do, quyền); Copy/Download hủy khi quyền đọc đổi; dismiss, restore, add-to-report và tab Evidence đã kiểm chứng trên stack thật (13/13); presentation Findings đã chuyển khỏi `screens/e-findings.tsx`, còn route registry. Chưa commit, chưa push.
- **Phạm vi:** `apps/web/` (src, server, tests, `.scratch/`) và các tài liệu phụ thuộc: ADR-0068, ADR-0084, ADR-0086, ADR-0090, `docs/design/2026-10-16-web-screens-unification-implementation-plan.md`, proposal 2026-10-21, ADR-0095.
- **Mức kiểm chứng:** đọc source; typecheck, lint, `vitest` có mục tiêu (25 file, 199 test vùng findings); stack thật (PostgreSQL 17 trong container riêng, server từ source, Vite): vòng 2 (14/14) và vòng 3 (13/13); mock 11 quan sát, bốn lần chạy (mục 9.8). Operations không chạy lại vì không đổi code.

## 1. Quyết định đã ghi nhận

Chủ dự án trả lời 5 câu hỏi Access/Console ngày 2026-10-21 (ghi trong proposal §3.5):

- PTY đầy đủ: giữ `cd`, environment, hỗ trợ Ctrl+C.
- Chung provider, namespace theo project; binding asset ↔ session bắt buộc.
- Đóng tab là detach; reload hoặc mất mạng được attach lại nếu session còn sống; kết thúc bằng nút riêng.
- Một bên điều khiển tại một thời điểm; operator tiếp quản thì agent nhường.
- Lưu trữ: PostgreSQL giữ metadata và outcome; transcript là artifact, đề xuất tối đa 100 MiB mỗi phiên, giữ 30 ngày, báo rõ khi chạm giới hạn.

Hệ quả: PTY đảo ngược phạm vi của ADR-0036 (Proposed). ADR-0095 (Proposed) thay phần đó và phải được Accepted trước khi implement. PTY thuộc đợt tính năng riêng, không nằm trong đợt chuẩn hóa này.

## 2. Hiện trạng đã đối chiếu

| Vùng | Quy mô | Nhận xét |
| --- | --- | --- |
| `src/features/` | 33 thư mục, ~35.700 dòng, **0 file `index.ts`** | Service, query và presentation (tab, console) lẫn lộn. |
| `src/screens/` (mock UI) | 42 file trực tiếp, ~18.700 dòng | Tên a–h. Là "target UX" theo ADR-0084. |
| `src/real/` | 45 file trực tiếp, ~14.150 dòng kể cả `screens/` (33 file) và `service-adapter/` (35 file, 21 không phải test) | Trộn transport, session, stream, queries, format, markdown, shell parts, bootstrap và adapter. |
| `src/shell/`, `src/ui/`, `src/state/`, `src/domain/`, `src/router/` | ~1.000–2.000 dòng mỗi vùng | Nền tảng, tương đối gọn. |
| `src/safety/` | 7 file, ~820 dòng | Toàn bộ là `*.test.tsx`, không có source. |
| `tests/`, `tools/`, `server/` | Fixture đặt theo ticket (`w00`, `w06`); 28 script trong `tools/` | Server có package riêng. |
| Root `implementation-plan.md` | 59 KB | Đã archive (xem D6). |

**Đã kiểm tra và đúng:**
- `real/mode.ts` có thứ tự ưu tiên khớp ADR-0068: query > localStorage > build > mock.
- `MIGRATED_ROUTES` có 19 key, khớp design doc.
- Không có `@ts-ignore`, `console.log` hay `TODO` trong `src/`. `as any` chỉ nằm trong comment.
- `server/dist`, `node_modules` và Prisma generated không được git theo dõi.
- Producer findings của runtime đã nằm trong tab AI Suggestions của Finding module. Project Findings tab render `FindingList`. Không còn panel producer riêng (D4).
- Operations đã nối backend cho pause run, resume operation, complete operation và cancel run (D5).

**Trạng thái unification** (design doc §8, cập nhật 2026-10-17): pilot Findings và Evidence đã commit trên branch `web-improve-refactor`. Còn lại: Reports, Assets/Library, C2, Operations, Global inventories, Instance/subagent, Vault, Settings/Team/Audit, Closeout.

## 3. Vấn đề đã xác nhận

Mức: **A** = sai ranh giới hoặc có rủi ro thật; **B** = lệch quy ước, tăng chi phí đọc và sửa; **C** = dọn dẹp.

| ID | Mức | Vấn đề | Bằng chứng | Trạng thái |
| --- | --- | --- | --- | --- |
| S1 | A | Hai cây presentation song song. ADR-0084 đã được Accepted với prose khớp source. | ADR-0084. | Đã đóng phần ADR. Cây presentation vẫn song song. |
| S2 | A | Ranh giới mock/real bị phá cả hai chiều: 34 file ngoài `real/` import từ `real/`. | grep `from '…/real/`. | Mở. Chuyển theo feature đang sửa (D2). |
| S3 | B (hạ từ A) | Real adapter import `unavailable*Service` từ feature service. Các hàm này không chạy code demo. Module `demo-clock` chỉ được import lúc load, và acceptance cũ "real build không còn demo-clock" là sai vì app là một bundle. | `real/service-adapter/index.ts`. | Mở, mức thấp. Tiêu chí đúng: real adapter không import giá trị runtime từ `features/*/service.ts`. |
| S4 | A | Demo clock nằm trong code production: 12 file trong `features/` import `stamp`/`hhmm`. | grep `demo-clock`. | Mở. Findings và Reports đã hết import `demo-clock` (mục 9.6). Các feature còn lại: xem D3 và mục 10. |
| S5 | A | `real/api.ts` là monolith 1.745 dòng, 222 export. | `wc`, grep `^export`. | Mở. Tách theo domain khi migrate. |
| S6 | B | Feature không có entry point: 33 feature, 0 `index.ts`. | grep. | Mở. Quy ước mục 5. |
| S7 | B | Mode nằm trong `real/mode.ts`; mock screen và shell dùng `isRealMode()` từ đó. | grep `real/mode`. | Mở. |
| S8 | B | `real/screens/detail.tsx` import `EvidenceList`, `FindingList` từ `screens/e-findings`. | Dòng 23. | Mở, cần xác nhận là tạm thời. |
| S9 | B | File quá lớn: `e-findings.tsx` ~1.407 dòng, `real/screens/workspace.tsx` 1.400, `operations/service.ts` 1.011, `f-report.tsx` 950, `reports/service.ts` 941, `findings/service.ts` 920. | `wc`. | Mở. Phase 4. |
| S10 | B | Tên không mang nghĩa: `screens/a.tsx`…`h.tsx`, `c-common`, `d-shared`, `g-common`, `b-detail2`; fixture theo ticket `w00`, `w06`. | `ls`. | Mở. Phase 4. |
| S11 | B | Hình dạng feature không nhất quán: `features/findings/` không có presentation; `features/c2/` có; `src/safety/` không có source. | `ls`. | Mở. |
| S12 | C | 119 `eslint-disable` trong 37 file, trong đó 98 là `react-refresh/only-export-components`. | grep. | Mở. D7: không thêm mới, sửa khi chạm file. |
| S13 | C | Tài liệu lệch: AGENTS.md "Project structure" thiếu các thư mục hiện có. | Đọc file. | Đã cập nhật AGENTS.md; root plan đã archive. |
| S14 | A (sản phẩm) | Finding reproduction không có trong Web. | grep. | **Đã có** trong đợt này (mục 9). Đã kiểm chứng trên stack thật. |
| S15 | A (sản phẩm) | Access/Console single-shot; PTY chưa có. | Proposal §3.2; ADR-0036, ADR-0095. | Mở. Đợt tính năng riêng (ADR-0095 Proposed). |

**Đã kiểm tra và không phải lỗi:** trong `e-findings.tsx`, các thao tác ghi ở nhánh real đi qua writes; không có thao tác ghi nào bị bỏ qua âm thầm ở real mode.

## 4. Quyết định đã chốt (2026-10-21)

| ID | Câu hỏi | Quyết định của chủ dự án |
| --- | --- | --- |
| D1 | Chấp nhận ADR-0084? | Có, sau khi sửa prose theo source. |
| D2 | Presentation mới ở đâu? | `features/<domain>/`, chuyển theo feature đang sửa, không bulk move. |
| D3 | Clock và authority? | Inject clock qua factory. Presentation và real interface không nhận MockClock. Backend giữ authority cho deadline thật. |
| D4 | Producer findings? | Ở tab AI Suggestions, import thành draft, không tự confirmed. |
| D5 | Operations và C2? | Operations: giữ và nối implementation hiện có. C2 transcript: gate tới khi có PTY backend. |
| D6 | Root `implementation-plan.md`? | Archive vào `.scratch/web-improve-refactor/archive/`. |
| D7 | `eslint-disable`? | Không thêm mới, không đổi config, sửa nguyên nhân tại file đang chạm. |
| D8 | ADR cho PTY? | Viết ADR mới, supersede phần Shell/PTY của ADR-0036; giữ các quyết định còn phù hợp. |
| D9 | Finding reproduction? | Copy/Download trước; chạy lại PoC làm sau. Tối thiểu: prerequisites, inputs, steps, expected observation, artifact/version, trạng thái kiểm chứng. Finding thủ công không bắt buộc có script. |

## 5. Quy ước chuẩn hóa

Đã đưa vào `apps/web/AGENTS.md`.

1. Mỗi feature có `index.ts` làm entry cho caller bên ngoài. Feature mới phải có entry này. Feature cũ được bổ sung khi chạm.
2. Presentation (mock hoặc real) không import `real/api`, `real/session`, transport hay file nội bộ của feature khác. Nó gọi entry của feature.
3. `real/` không nhận file mới ngoài `service-adapter/<domain>.ts`. Không thêm nhánh presentation vào `real/`.
4. Presentation mới nằm trong `features/<domain>/`. Thời gian đi qua factory clock. Presentation và real interface không nhận `MockClock`.
5. Tên file kebab-case, theo domain. Không dùng a/b/c hay ID ticket trong tên production code.
6. Không thêm `eslint-disable` mới nếu không có lý do đi kèm.
7. Mỗi PR ≤400 dòng runtime, ≤10 file, một mối quan tâm (CONTRIBUTING_AGENT.md).

## 6. Kế hoạch theo phase

**Phase 0: Quyết định và tài liệu.** Đã xong (D1–D8). Xem mục 8.

**Phase 1: Vệ sinh, không đổi hành vi.**
- 1.1 Chuyển `real/mode.ts` sang `state/mode.ts` và cập nhật import (S7).
- 1.2 Thay `unavailable*Service` trong `real/service-adapter/index.ts` bằng stub trung lập (S3, mức thấp). Tiêu chí đúng: real adapter không import giá trị runtime từ `features/*/service.ts`.
- 1.3 Chuyển `src/safety/*.test.tsx` về cạnh module sở hữu hoặc `tests/invariants/` (S11).

**Phase 2: Gỡ coupling, giữ hành vi.**
- 2.1 Mock-side không import `real/*` (S2). Chia theo domain.
- 2.2 Demo clock và demo runtime chuyển sang `src/demo/`; feature nhận clock qua factory (S4, D3). Chia theo nhóm feature.
- 2.3 Tách `real/api.ts` theo domain, đi cùng từng adapter (S5).

**Phase 3: Hợp nhất presentation theo domain (ADR-0084 PR 5–10).** Thứ tự đề xuất: Reports → Assets/Library → Global → Vault → Settings/Team/Audit → Instance → C2 → Operations → Closeout. C2 và Operations xếp sau vì `h-session.tsx` và `c-console.tsx` còn gọi `services.authority`/`clock` trực tiếp.

**Phase 4: Đổi tên và lint.** Đổi tên a–h bằng PR chỉ đổi tên, sau phase 3. Giảm suppression `react-refresh` khi chạm file (D7). Xóa `src/screens/` khi rỗng.

**Phase 5: Tính năng sản phẩm.** Access/Console tracer: ADR-0095 phải được Accepted trước. Không bắt đầu trong đợt chuẩn hóa.

## 7. Kiểm chứng mỗi PR

- Build contracts trước khi typecheck web hoặc server: `npm run build --workspace=@raptix/web-contracts`. Web và server đọc `dist`.
- `npm run typecheck` và `npm run lint` đúng workspace.
- Test có mục tiêu theo phần thay đổi. Không chạy lại toàn bộ suite nếu không có thay đổi ảnh hưởng.
- Với thay đổi hành vi: kiểm chứng luồng thật tương ứng trên stack (mục 9.3 là mẫu). Test mock không thay thế kiểm chứng này.

## 8. Quyết định và trạng thái triển khai

| ID | Quyết định | Trạng thái |
| --- | --- | --- |
| D1 | Chấp nhận ADR-0084, sửa prose theo source | Xong. ADR-0084 là Accepted; prose cập nhật theo adapter đã có, vị trí presentation, và Operations đã nối. |
| D2 | Presentation mới ở `features/<domain>/`; chuyển theo feature đang sửa | Xong cho reproduction (`reproduce.tsx`, `reproduction-form.tsx`, `reproduction-draft.ts`) và AddToReport (`add-to-report.tsx`), đều trong `features/findings/`. Phần còn lại của Findings (e-findings.tsx) vẫn ở `screens/`, xem mục 10. |
| D3 | Clock inject qua factory; MockClock không vào presentation hoặc real interface | Một phần. Dismiss và add-to-report đi qua facade; comment và audit của mock lấy thời gian từ clock được inject (mục 9.6). Còn vi phạm: `EvidenceInspector` trong `e-findings.tsx`, `c-console.tsx`, `h-session.tsx`, xem mục 10. |
| D4 | Producer findings ở AI Suggestions, import thành draft | Đã đạt sẵn, không đổi code. Đã kiểm chứng trên UI: import qua hộp xác nhận tạo draft có producer lineage. |
| D5 | Operations giữ và nối; C2 transcript gate tới PTY | Operations không đổi code; đã nối sẵn. C2 transcript: không có UI transcript ở real mode nên chưa có gì để gate. |
| D6 | Archive root `implementation-plan.md` | Xong: `.scratch/web-improve-refactor/archive/implementation-plan.md`, link đã sửa. |
| D7 | Không thêm `eslint-disable`, không đổi config | Xong: không có suppression mới trong các file đã sửa. |
| D8 | ADR mới cho PTY, supersede phần Shell/PTY của ADR-0036 | Xong: ADR-0095 (Proposed); ADR-0036 có ghi chú. |
| D9 | Copy/Download trước; chạy lại làm sau | Xong ở mức đã chốt: gói tái hiện đầy đủ trường, artifact được liên kết và kiểm chứng digest, Copy/Download nguyên bản. Chạy lại chưa làm. |

## 9. Kết quả đợt triển khai (D9)

### 9.1 Thiết kế đã chốt

- **Ba khái niệm tách biệt.**
  - *Producer source*: nguồn claim của runtime (`findings/FIND-*.md`). Hiển thị trong card "Producer source", không phải PoC, không đưa vào Copy/Download.
  - *Reproduction artifact*: một capture được giữ lại (retained capture) do operator chọn. Được tham chiếu bằng `captureId` + `digest`, cùng `filename`, `mediaType`, `sizeBytes` lấy từ capture lúc liên kết.
  - *Evidence*: giữ nguyên cơ chế hiện có.
- **Gói tái hiện** lưu trong `body.reproduction` của curated finding (cột `body` đã là Json, không cần migration). Các trường: prerequisites, inputs, steps (tối đa 100 bước, mỗi bước 2000 ký tự), expectedObservation, limitations, artifact (hoặc null), và `verification: 'not_recorded'`. Trạng thái verification do server gắn, không nhập tay.
- **Finding cũ** không có key `reproduction`. UI hiển thị "No reproduction package recorded". Không dựng gói rỗng và không suy từ mô tả.
- **Ràng buộc identity và digest** ở server (`storedReproduction`): capture phải thuộc đúng engagement (không có thì 404); digest gửi lên phải khớp digest đã giữ (lệch thì 409).
- **Copy/Download** lấy byte gốc qua `GET /api/engagements/:id/artifacts/captures/:captureId/content`. Route này trả `application/octet-stream` kèm `X-Content-SHA256`, và server kiểm tra integrity trước khi trả. Adapter tính sha256 của byte nhận được và so với digest đã ghi; lệch thì trả conflict và không copy, không download. Download lưu đúng byte gốc. Copy lấy text UTF-8 giải mã nghiêm ngặt từ chính các byte đã xác minh; nhị phân thì từ chối và hướng người dùng sang Download.
- **Transport**: đường tái hiện không dùng `artifacts/content`. Đó là text projection UTF-8, cắt ở 256 KiB, không phải byte gốc. Giới hạn thực tế: capture tối đa 262 144 byte khi upload, nên không có cắt cụt trên đường byte gốc.
- **Capture chưa phân loại**: server từ chối đọc byte gốc cho tới khi owner hoặc reviewer phân loại. UI hiển thị lý do, picker ghi "classify it to read the original".
- **Verification** luôn là "Not verified / Not recorded". Chạy lại PoC làm sau.

### 9.2 Code đã thay đổi

- `apps/shared/web-contracts/src/finding-workflow.ts`: `FindingReproductionArtifact`, `FindingReproduction`, `FindingReproductionInput`, guard `isFindingReproduction`, `body.reproduction` optional. `dist` đã build lại.
- `apps/web/server/src/services/findings-workflow-service.ts`: parse và validate (`parseReproductionInput`), `storedReproduction` (tra `retainedCapture` theo engagement, kiểm digest), persist trong create và update (update không có key thì giữ package cũ), `reproductionPart` cho view.
- `apps/web/server/tests/t10-findings-workflow.test.ts`: thêm accessor `retainedCapture` cho memory DB và describe "reproduction package contract" với 3 test (lưu đúng và trả đúng trạng thái; finding cũ không có key và update giữ package; capture khác engagement, digest lệch, quá 100 bước bị từ chối).
- `apps/web/src/real/api.ts`: `createCuratedFinding`, `updateCuratedFinding` nhận `reproduction`.
- `apps/web/src/domain/entities.ts`: `Finding.reproduction`.
- `apps/web/src/features/findings/service.ts`: `RetainedArtifact` (captureId, filename, bytes, text), `RetainedCaptureOption`, `FindingService.readArtifact` và `reproductionCaptures`, `FindingSaveInput.reproduction`. Mock: đọc artifact trả unavailable, không cho liên kết capture, lưu gói tái hiện ở dữ liệu demo.
- `apps/web/src/features/findings/query.ts`: `readArtifact` cho UI; hook `useReproductionCaptures`.
- `apps/web/src/real/service-adapter/findings.ts`: `toFinding` map gói tái hiện; save truyền gói; `readArtifact` xác minh digest, trả byte và text; `reproductionCaptures` đọc capture của engagement; helper `sha256Hex` và `decodeText` (giữ BOM).
- `apps/web/src/features/findings/reproduce.tsx` (viết lại): `ReproducePanel` với các trường, "Not verified", artifact (Copy text, Download original), và card producer source riêng.
- `apps/web/src/features/findings/reproduction-form.tsx` (mới): `ReproductionFields`, dùng cho cả mock và real.
- `apps/web/src/features/findings/reproduction-draft.ts` (mới): `EMPTY_REPRODUCTION`, `draftFromReproduction`, `reproductionPayload`.
- `apps/web/src/screens/e-findings.tsx`: trường `reproduction` trong draft, khởi tạo (finding cũ mở với `null`), payload (gửi khi có gói), form, và tab Reproduce.
- Test web: `features/findings/reproduce.test.tsx` (10 test hành vi), `features/findings/reproduction-form.test.tsx` (3), `features/findings/reproduction-draft.test.ts` (3), `real/service-adapter/findings-artifact.test.ts` (3 test về digest, lệch digest, nhị phân).

### 9.3 Kiểm chứng

**Stack thật** (không dùng DB hay server của người dùng):
- PostgreSQL 17 trong container Docker riêng, cổng 55432, cơ sở dữ liệu dùng một lần. Migrate bằng `prisma migrate deploy` (đã áp dụng toàn bộ).
- Server chạy từ source (`node --import tsx src/main.ts`), cổng 5280, `RAPTIX_WEB_AUTH_MODE=multi`, đăng nhập bằng tài khoản admin xác minh.
- Web dev server (Vite) cổng 5273, proxy `/api` tới 5280, mở bằng `?dataMode=real`.
- Hai engagement: `d9-verify-a` (có các capture) và `d9-verify-b` (có một capture để kiểm tra identity).
- Producer finding (`FIND-*.md`) được ghi vào workspace của engagement. Đây là mô phỏng output của runtime, không phải kết quả của một lần chạy LLM.

**API** (script kiểm chứng, không đưa vào repo): 18/18 check đạt.
- Lưu gói có liên kết capture với tên, loại, digest và kích thước đúng. Trạng thái `not_recorded`.
- Finding không có gói không có key `reproduction`.
- Capture của engagement khác: 404 "Retained capture not found in this engagement." Digest lệch: 409. Quá 100 bước và digest viết hoa: 400.
- Update không có key giữ gói; update có gói thay thế và có thể bỏ liên kết artifact.
- Byte gốc của capture 262 144 byte khớp từng byte với file local; header `X-Content-SHA256` đúng.
- Capture của engagement khác đọc qua engagement này: 404.
- Capture chưa phân loại: 409 với thông báo phân loại. Sau phân loại, owner đọc được.
- File lưu trữ bị xóa: 409 "missing from storage". File bị sửa: 409 "failed its recorded integrity check".

**UI trình duyệt** (Playwright, Chromium headless, web thật): 15/15 check đạt.
- Đăng nhập qua form thật; danh sách project hiện đúng.
- Import producer finding từ AI Suggestions qua hộp xác nhận: finding thành `draft`, có producer lineage, không tự confirmed. Chi tiết hiển thị "Producer source" tách khỏi gói, và "No reproduction package recorded".
- Tạo finding thủ công qua form thật: nhập tiêu đề, mức độ, mô tả, impact, khuyến nghị; thêm gói với điều kiện, đầu vào, các bước, kết quả mong đợi, giới hạn; chọn `exploit.py`. Lưu thành công; API xác nhận gói được lưu đúng.
- Tab Reproduce hiện "Not verified", các bước và digest đã ghi.
- Picker chỉ liệt kê capture của project này; `other.txt` của engagement khác không xuất hiện.
- Copy text: clipboard có đúng nội dung `exploit.py`. Xem ghi chú về xuống dòng bên dưới.
- Download: tên file là `exploit.py`; sha256 của file tải về bằng `8e45b1ca…435`, khớp digest đã ghi và khớp file gốc.
- Chỉnh sửa finding draft đã import: thêm gói liên kết `boundary.log` (262 144 byte). Download tải đủ 262 144 byte, sha256 khớp.
- Artifact bị xóa khỏi đĩa: operator thấy lý do của server, không có file tải về.
- Artifact bị sửa sau khi giữ: operator thấy "failed its recorded integrity check", không có file.
- Artifact chưa phân loại: operator thấy lý do phân loại, không có file.
- Finding cũ không có gói: hiện "No reproduction package recorded", không có nút copy hay download.

**Test và kiểm tra tĩnh:**
- `apps/web/server` t10: 23/23 test đạt (gồm 3 test mới của gói tái hiện).
- `apps/web`: typecheck đạt; các file test liên quan (`features/findings`, `findings-artifact.test.ts`, `findings.test.ts`, `findings-real-mode.test.tsx`): 7 file, 97 test đạt.
- `apps/web/server`: typecheck đạt; lint file đã sửa đạt.
- `apps/web`: lint còn **5 lỗi có sẵn** trong `src/screens/f.tsx` (`react-refresh/only-export-components`). File này không nằm trong đợt này và không bị sửa. Các file đã sửa lint sạch.

**Ghi chú quan sát:**
- Clipboard của Windows ghi xuống dòng thành `\r\n` khi đọc lại. Kiểm tra copy so sánh sau khi chuẩn hóa xuống dòng. Kênh Download vẫn là byte-exact và là kênh đối chiếu chính.
- Các dòng trùng trong picker là dữ liệu từ các lần chạy kiểm chứng lặp lại, không phải lỗi sản phẩm.

**Chưa kiểm chứng (nói rõ):**
- File có BOM đi qua UI chưa được thử. Đường xử lý BOM chỉ có trong unit test.
- Mock mode: chỉ luồng dismiss và add-to-report đã chạy trong trình duyệt, xem mục 9.6.
- Nhánh truncated không còn áp dụng cho đường tái hiện (xem 9.1).
- Operations và PTY không đổi code trong đợt này; chưa chạy lại kiểm chứng UI cho Operations.

### 9.4 Thay đổi so với kế hoạch trước

- Thiết kế cũ (đọc artifact qua `artifacts/content`, định danh bằng path, text projection cắt 256 KiB) đã bỏ hoàn toàn. Lý do: text projection không phải byte gốc, và không thể đối chiếu digest của capture.
- Producer source không còn được xử lý như PoC. Đây là sửa lỗi của thiết kế cũ.
- Tiêu chí S3 trong mục 1.2 đã được hiệu chỉnh (xem mục 3).

### 9.5 Vòng 2: sửa lỗi D9 và kiểm chứng lại trên stack thật

Bốn lỗi, mỗi lỗi có test hồi quy:

1. **Metadata bị lộ.** Tên file của capture sensitive được chép vào body của finding lúc liên kết, nên người không có quyền vẫn thấy tên. Sửa: server không lưu tên. `reproductionView` tính lại `filename`, `classification` và `canReadOriginal` mỗi lần đọc, theo classification hiện tại và role của người đọc (`captureFilenameVisible`, `captureOriginalReadable` dùng chung với `artifacts-service.ts`). Phân loại lại có hiệu lực ngay. Test: t10 "shows a sensitive capture by name only to owners and reviewers, and follows its current classification"; `reproduce.test.tsx` "masks a restricted capture".
2. **Remove package không xóa gói.** `null` bị đổi thành `undefined`, nên server giữ gói cũ. Sửa: ba trạng thái ở draft, payload và server. `undefined` giữ gói, `null` xóa gói, object đặt gói. Test: t10 "clears the stored package when an update sends an explicit null, and keeps it when the key is absent"; `reproduction-draft.test.ts`.
3. **Copy và Download dùng kết quả cũ.** Kết quả đọc của artifact cũ có thể hoàn thành sau khi liên kết đã đổi, rồi ghi thông báo lên capture khác. Sửa: busy và notice khóa theo `captureId:digest`; kết quả của artifact đã đổi bị bỏ; cờ `alive` được đặt trong effect để StrictMode không làm rơi kết quả. Test: `reproduce.test.tsx` "discards a copy that finishes after the linked artifact changed" và "still copies the current artifact under StrictMode".
4. **Truy vấn capture không có trạng thái loading và error.** Picker hiện trạng thái đang tải, lỗi kèm Retry, giữ lựa chọn hiện tại, và vẫn gọi tên capture đang liên kết dù danh sách chưa có nó. Test: `reproduction-form.test.tsx` (3 test).

Kiểm chứng:
- Server t10: 25/25 đạt (23 của vòng 1 và 2 test mới). `findings-artifacts.test.ts` 17/17; `findings-artifacts-fs.test.ts` 2/2.
- Web, sau khi gỡ coupling (mục 9.6): `features/findings`, `features/reports`, `real/service-adapter`, `router`, `screens/e`: 28 file, 265 test đạt.
- Stack thật, cùng môi trường mục 9.3, log `flows-run3.log`:
  - Luồng 1 (owner): sửa, gỡ, lưu, tải lại: 5/5. Form sửa chọn đúng capture đã liên kết. Gỡ gói hiện lại nút thêm. Sau lưu, server không còn gói. Sau tải lại, tab Reproduce không có gói và không có nút copy hay download.
  - Luồng 2 (owner và viewer, capture sensitive, phân loại lại): 9/9. Owner tải byte gốc, sha256 khớp digest đã ghi. Viewer thấy "Restricted capture", không thấy tên; nút copy và download bị khóa; lý do hiển thị class Sensitive. API trả `filename: null`, `canReadOriginal: false`. Owner chuyển sang standard: viewer thấy tên và class Standard nhưng vẫn không có byte gốc. Chuyển lại sensitive: viewer bị che lại.
  - Tổng: 14/14.

### 9.6 Gỡ coupling authority và clock của Findings (mock mode)

> Vòng 3 (mục 9.8) thay phần suggestion trong mục này: trạng thái dismiss nay theo actor trong DB mock, không còn session filter `fd-dismissed`, không còn nhánh `isRealMode()` cho dismiss, và dismiss không ghi comment. Phần authority, clock và AddToReport vẫn đúng.

Thay đổi:
- Dismiss, restore và add-to-report đi qua facade ở cả hai mode. Trước đây màn hình gọi trực tiếp `addFindingCommentTransaction(services.authority, …)`, `recordAudit(services, …)` và `setReportFindingsLegacyTransaction(services.authority, …)`; comment legacy dùng `stamp()`.
- `setFindingSuggestionDisposition(authority, clock, ctx, findingId, input)` (mock): một lần dismiss ghi comment và audit row trong một commit, thời gian lấy từ clock được inject. Trạng thái ẩn vẫn là session-local như trước; restore không ghi gì. Finding ngoài phạm vi truy cập của actor trả `not-found`.
- Interface `setSuggestionDisposition(ctx, findingId, input)`: facade truyền id tường minh. Real adapter nhận `_findingId` và gửi server đúng body như trước.
- Add-to-report ở mock đi qua `reportWrites.setFindings`, như real mode. Hệ quả có chủ đích: mock giờ kiểm version, từ chối finding chưa confirmed (như real), và ghi audit "Updated report findings" (trước đây không ghi).
- Xóa `addFindingCommentTransaction`, `setReportFindingsLegacyTransaction`, và import `stamp` trong `features/findings` và `features/reports`. Findings và Reports không còn import demo-clock.
- Giữ một nhánh `isRealMode()` có chủ đích: cập nhật session filter `fd-dismissed` chỉ ở mock. Real list đọc disposition từ server. Nếu ghi filter ở real mode, một suggestion mà người khác vừa restore vẫn bị ẩn trong trình duyệt này.
- Helper `audit` thứ hai (trong `EvidenceInspector`) không phải dead code: nó ghi sự kiện "Viewed original evidence" của mock. Giữ lại, chuyển khi làm phần evidence. Điều này sửa lại kế hoạch trước, vốn ghi là có thể xóa.
- Presentation phần 1: `AddToReport` chuyển sang `features/findings/add-to-report.tsx` (48 dòng). Import của `e-findings.tsx` đã cập nhật.

Kiểm chứng:
- Mock mode trong trình duyệt, 11 kết quả quan sát, chạy ba lần: trước khi đổi, sau khi gỡ coupling, và sau khi chuyển `AddToReport`. Kết quả giống hệt nhau (diff JSON rỗng):
  - Dismiss FD-012 từ tab AI Suggestions: toast "FD-012 dismissed.", dòng bị ẩn, comment "AI suggestion dismissed: Covered by FD-011", audit "Dismissed AI suggestion" có lý do.
  - Add FD-011 vào REP-017, report nháp mới của cùng project: REP-014 vẫn "Open report" và không ghi gì; REP-017 hiện "Add"; toast "Added FD-011 to REP-017."; cả hai report chứa FD-011.
- Typecheck web đạt. Eslint các file đã sửa sạch. Lint toàn web: đúng 5 lỗi có sẵn ở `f.tsx`.
- Test mới `features/findings/suggestion-disposition.test.ts`: 3 test (thời gian lấy từ clock; restore không ghi; ngoài phạm vi trả not-found).
- Chưa kiểm chứng: real mode sau khi gỡ coupling. Đường gọi và body gửi server không đổi; đã typecheck và test.

### 9.7 Tách PR (chưa commit)

Thứ tự commit: A → B → C1 → C2 → D1 → P2 → P3a → P3b → P4a → P4b → P5. Mỗi PR chỉ dùng code có sẵn ở PR trước đó hoặc chính nó. Điểm tích hợp và cách tự kiểm chứng ghi ở từng dòng.

Giới hạn theo CONTRIBUTING_AGENT.md: ≤400 dòng runtime, ≤10 file, một mối quan tâm. Số dòng là ước tính: `git diff --numstat` cho file đã theo dõi, `wc -l` cho file mới. P2–P5 là chuyển presentation thuần: khối bị xóa khỏi `screens/e-findings.tsx` và thêm vào file đích. Git đếm cả hai phía, nên số +/- lớn hơn số dòng chuyển. Nếu CONTRIBUTING tính +/-, P3a, P3b, P4b vượt 400 dòng và cần `large-diff-approved`, hoặc tách tiếp theo khối (kích thước ghi trong bảng).

| PR | Nội dung | File (số file) | Dòng ước tính | Điểm tích hợp | Tự kiểm chứng |
| --- | --- | --- | --- | --- | --- |
| A | Tài liệu, ADR, archive | `docs/adr/0036…`, `docs/adr/0084…`, `docs/adr/0095…`, `docs/proposals/2026-10-21…`, `apps/web/AGENTS.md`, `apps/web/implementation-plan.md` (xóa), `apps/web/.scratch/web-improve-refactor/archive/`, `apps/web/.scratch/web-standardization/` | 0 runtime | — | `git diff --check` |
| B | Contract và server gói tái hiện | `apps/shared/web-contracts/src/finding-workflow.ts`, `apps/web/server/src/services/artifacts-service.ts`, `apps/web/server/src/services/findings-workflow-service.ts`, `apps/web/server/tests/t10-findings-workflow.test.ts` (3 file runtime + 1 test) | ~210 + test 110 | Body `reproduction` của curated finding | t10: 25/25 (mục 9.5) |
| C1 | Đọc gói và tab Reproduce | `domain/entities.ts`, `real/service-adapter/findings.ts` (chỉ phần đọc: `toFinding`, `readArtifact`, `reproductionCaptures`, `sha256Hex`, `decodeText`), `features/findings/service.ts` (kiểu `RetainedArtifact`, `RetainedCaptureOption`, `readArtifact`, `reproductionCaptures`, stub mock), `features/findings/query.ts` (hook đọc), `features/findings/reproduce.tsx` (mới), `reproduce.test.tsx`, `real/service-adapter/findings-artifact.test.ts`, `screens/e-findings.tsx` (import `ReproducePanel` và nhánh tab `reproduce`) (8 file) | ~250 + test 230 | Tab Reproduce trong chi tiết finding, gọi `writes.readArtifact` | `vitest` cho `reproduce.test.tsx` (12) và `findings-artifact.test.ts` (3); typecheck; stack thật luồng 2 (owner và viewer, 9/9, mục 9.5). Luồng 2 chỉ đọc, không cần form. |
| C2 | Form ghi gói | `real/api.ts` (`createCuratedFinding`, `updateCuratedFinding` nhận `reproduction`), `real/service-adapter/findings.ts` (phần `save`), `features/findings/service.ts` (`FindingSaveInput.reproduction`, mock save), `reproduction-form.tsx` (mới), `reproduction-form.test.tsx`, `reproduction-draft.ts` (mới), `reproduction-draft.test.ts`, `screens/e-findings.tsx` (`FindingFormBody`: draft, payload, khối form) (8 file) | ~180 + test 60 | Form tạo và sửa finding | `vitest` cho `reproduction-form.test.tsx` (3) và `reproduction-draft.test.ts` (3); stack thật luồng 1 (5/5, mục 9.5). Luồng 1 kiểm tra sau lưu bằng tab Reproduce, nên cần C1. |
| D1 | Policy disposition của mock, gỡ coupling, AddToReport | `data.ts` (kiểu `FindingRow`), `features/findings/service.ts` (policy, `listFindings`, `getFinding`), `features/findings/query.ts` (facade), `real/service-adapter/findings.ts` (`buildList` bỏ hide cục bộ), `screens/e-findings.tsx` (hook dismiss, restore), `features/reports/service.ts` (bỏ transaction legacy), `features/findings/add-to-report.tsx` (mới), `suggestion-disposition.test.ts` (mới), `query.test.tsx` (9 file) | ~190 + test 150 | Tab AI Suggestions (dismiss, restore) và nút Add to Report | `vitest` `suggestion-disposition.test.ts` (10); mock baseline (11 quan sát, mục 9.8); stack thật: `flow-r4` các check dismiss, restore, add-to-report |
| P2 | Hook `useAiActions` | `features/findings/ai-actions.tsx` (mới, 63), `screens/e-findings.tsx` (2 file) | 120 (chuyển) | Hook dùng bởi danh sách và chi tiết | mock baseline; `flow-r4` |
| P3a | Tab Evidence, upload, preview | `features/findings/evidence.tsx` (mới, phần 1: `saveEvidenceFile` đến `EvidencePreview`, 296 dòng), `features/findings/delayed-nav.ts` (mới, 15), `screens/e-findings.tsx` (3 file) | 311 (chuyển) | `EvidenceTab` trong chi tiết | typecheck; lint; `vitest` vùng findings; `flow-r4` (mở tab Evidence) |
| P3b | Evidence list, Inspector, facade `recordOriginalView` | `features/findings/evidence.tsx` (phần 2: `EvidenceList`, `EvidenceInspector`, 201 dòng), `features/findings/service.ts` (`recordOriginalView`), `features/findings/query.ts` (hook), `real/service-adapter/findings.ts` (no-op ở real mode), `features/findings/original-view.test.ts` (mới, 16), `screens/e-findings.tsx`, `real/screens/detail.tsx` (import `EvidenceList`) (7 file) | ~240 + test 16 | Route `evidence`, `evidence-inspector`; danh sách evidence của real/screens/detail | `original-view.test.ts` (1); typecheck; lint. Chưa có check stack thật cho Inspector. |
| P4a | Danh sách Findings | `features/findings/list.tsx` (mới, 161), `features/findings/access.tsx` (mới, 32), `features/findings/create-reason.ts` (mới, 16), `features/findings/service.ts` (export `SEVS`), `screens/e-findings.tsx`, `real/screens/detail.tsx` (import `FindingList`) (6 file) | ~210 (chuyển) | Route `findings` | mock baseline; `flow-r4` (tab AI, danh sách) |
| P4b | Chi tiết Finding và tab Retest | `features/findings/detail.tsx` (mới, 388 gồm Retest 88 và `FLOW`), `screens/e-findings.tsx` (2 file) | 390 (chuyển) | Route `finding` | mock baseline; `flow-r4` (chi tiết, tab Evidence, Add to Report) |
| P5 | Form tạo và sửa Finding | `features/findings/form.tsx` (mới, 266 gồm `Draft`, `STATUS_LABEL`), `screens/e-findings.tsx` (2 file) | 250 (chuyển) | Route `finding-new` | typecheck; lint; luồng 1 (sửa gói, 5/5); mock baseline |

File dùng chung giữa các PR: `service.ts`, `query.ts`, `real/service-adapter/findings.ts`, `screens/e-findings.tsx`. Stage theo hunk (`git add -p`). `e-findings.tsx` có hunk của C1, C2, D1 và của mọi PR chuyển; đây là chỗ dễ sai nhất khi stage.

Chưa kiểm chứng: từng PR chưa được stage và chạy riêng. Cách làm: dùng index tạm (`GIT_INDEX_FILE`), stage đúng hunk của từng PR, rồi chạy typecheck và `vitest` vùng findings trên index đó. Không đụng index của người dùng.

Không đưa vào PR nào, vì có sẵn trong `git status` từ đầu phiên và chưa rõ chủ sở hữu: `docs/proposals/temp.md`, `docs/proposals/test-asset.png`, `infra-test.log`, `now.txt`, `report-do-an/`, `report-vdt/`, `web-sandboxes/`.

### 9.8 Vòng 3: policy disposition của mock, Copy/Download theo quyền đọc, kiểm chứng real mode, presentation

**Nguồn sự thật.** Server thật là chuẩn. Đối chiếu `server/src/services/finding-suggestions.ts` và `setSuggestion` trong `findings-workflow-service.ts` cho thấy mock lệch ở các điểm sau. Mỗi điểm có test hồi quy trong `suggestion-disposition.test.ts`:

| Hành vi | Server | Mock trước vòng 3 | Mock sau vòng 3 |
| --- | --- | --- | --- |
| Phạm vi trạng thái | theo actor (`engagementId, actorId, producerRef`) | session filter `fd-dismissed`, theo trình duyệt | theo actor trên dòng finding (`suggestionDispositions`); đọc qua `presentFinding` |
| Comment | không ghi | comment chung trên finding, mọi người thấy | không ghi |
| Restore | ghi audit `suggestion.restored` | không ghi gì, trả version giả | ghi audit "Restored AI suggestion", tăng version |
| Quyền | gate curate (operator trở lên) | không kiểm | gate `createFinding`, cùng gate với UI (`why(f)`) |
| Project khóa | `409` khi engagement đóng | không kiểm khi restore | `forbidden`, read-only như các ghi finding khác |
| Lý do | bắt buộc khi dismiss, 1–4000 ký tự | không kiểm | bắt buộc, cắt khoảng trắng, không quá 4000 |
| `expectedVersion` | `409` khi lệch | không kiểm | `conflict` khi lệch |
| Trạng thái lặp lại | trả trạng thái hiện tại, không ghi | không | trả trạng thái hiện tại, không ghi |
| Restore ngoài phạm vi | `404` | trả `ok` (lỗi) | `not-found` (hồi quy) |

- Test: `suggestion-disposition.test.ts` 10 test. Test "advances the injected clock…" là test hiện có, nay advance clock trước khi restore và kiểm thời gian audit của restore. `query.test.tsx` "excludes dismissed suggestions…" dùng `setFindingSuggestionDisposition`. Test "hides a dismissed suggestion only for the user who dismissed it" kiểm phạm vi actor.
- Mock không kiểm đường dẫn `findings/*.md` của `producerRef`. Mock khóa theo id finding, như đã ghi ở interface `FindingService`.
- Gate của mock vẫn cho `analyst` (matrix quyền có sẵn). Server không có role này. Đổi matrix là thay đổi lớn ngoài phạm vi, nên để riêng.

**Copy và Download theo quyền đọc (`reproduce.tsx`).** Khóa cũ `captureId:digest` không đổi khi chỉ quyền đọc đổi (phân loại lại, hoặc role đổi). Một kết quả đọc đang chạy vẫn được copy hoặc download. Khóa mới gồm `captureId`, `digest`, `classification`, `canReadOriginal`. Hai test hồi quy: "discards a copy that finishes after the read permission of the same capture changed" và "discards a download that finishes after the read permission of the same capture changed". Request mạng không bị hủy; chỉ kết quả bị bỏ.

**Kiểm chứng real mode: dismiss → restore và add-to-report.** Stack thật: PostgreSQL 17 trong container riêng `raptix-verify-pg3` (cổng 55443), API chạy từ source (5280), Vite (5273). Dữ liệu tạo qua API (`setup-r4.mjs`): engagement, hai producer finding trong workspace, một finding confirmed bởi reviewer độc lập, một report draft. Script `flow-r4.cjs` (scratchpad), **13/13**:
- Dismiss: dòng biến khỏi danh sách mặc định. Server: `version 1`, lý do đúng.
- Reload: vẫn ẩn, nên trạng thái đến từ server, không từ session.
- Show dismissed: có nhãn dismissed và nút Restore.
- Restore, reload: dòng trở lại. Server: `dismissed=false`, `version 2`.
- Tab Evidence của finding mở được (nhánh đã chuyển).
- Add to Report: server gắn finding (`findingVersion 3`), report đi từ v1 sang v2. Lần thứ hai hiện "Open report" và toast "already in".
- Không có lỗi JavaScript không bắt được trong toàn bộ luồng.
- Audit PostgreSQL: `suggestion.dismissed` (có lý do), `suggestion.restored`, `report.findings_selected` ở v2.

**Mock mode.** `mock-baseline.cjs` (11 quan sát) chạy bốn lần: trước vòng 3 (`mock-before.json`), sau policy (`mock-policy.json`), sau chuyển presentation (`mock-move2.json`), cuối (`mock-final.json`). Khác biệt duy nhất là `dismiss.commentRecorded` đổi từ true sang false ở lần policy. Đây là chủ đích: server không ghi comment. Ba lần sau khớp nhau hoàn toàn.

**Presentation đã chuyển** (`features/findings/`): `ai-actions.tsx` (hook, 63 dòng), `evidence.tsx` (tab Evidence, upload, preview, `EvidenceList`, `EvidenceInspector`, 520 dòng), `delayed-nav.ts` (15), `list.tsx` (161), `access.tsx` (32), `create-reason.ts` (16), `detail.tsx` (388, gồm Retest), `form.tsx` (266). `screens/e-findings.tsx` còn 10 dòng, chỉ là route registry. Thứ tự là ai-actions → evidence → list/detail → form. Evidence chuyển trước vì `detail` import `EvidenceTab` và `EvidenceList`; làm ngược lại sẽ tạo vòng import. Thứ tự này thay thế thứ tự cũ ghi ở mục 10 (list/detail trước evidence).

**Authority còn lại đã xử lý.** `EvidenceInspector` không còn `useServicesOrNull` và `recordAudit(services, …)`. Ghi "Viewed original evidence" đi qua facade `recordOriginalView`. Mock: commit với clock được inject. Real: no-op, như trước, vì `useServicesOrNull` trả null ở real mode. Các module findings không còn import `stamp()` của features/audit.

**Kiểm tra chung vòng 3.** Typecheck web đạt. Eslint các file đã đổi đạt (5 lỗi có sẵn ở `f.tsx` không đổi). `vitest` vùng findings: 25 file, 199 test đạt (gồm `features/findings`, `real/findings-real-mode.test.tsx`, `real/service-adapter`, `screens/e*`, `safety/ai-proposals.test.tsx`). Không chạy lại toàn bộ 265 test, theo yêu cầu.

### 9.9 Vòng 4: đóng Findings và D9

- **Active-project policy.** `setFindingSuggestionDisposition` dùng `writableFinding`, nên dismiss/restore sai active project trả `forbidden`; test mới trong `suggestion-disposition.test.ts`. `recordOriginalView` kiểm `getEvidence` (scope, project, `canViewOriginal`) trước khi ghi audit; test trong `original-view.test.ts`. UI chỉ ghi log sau khi facade đồng ý.
- **Feature entry và router.** Thêm `features/findings/index.ts` (presentation + kiểu công khai) và `features/reports/index.ts`. `router/findings.ts` giữ alias route Findings/Evidence; `screens/e.tsx` import từ đó. Xóa `screens/e-findings.tsx` và `screens/resource-scope.ts` (chuyển sang `state/resource-scope.ts`).
- **Dependency của feature.** `finding-session` và `capture-session` cùng test chuyển vào `features/findings/`. `presentation-context.ts` là composition seam duy nhất đọc `DATA_MODE`/`SessionContext`; module findings khác không còn import trực tiếp `real/mode` hay `real/session`.
- **Kiểm chứng tự động, có thể chạy lại.** `apps/web/tools/verify-findings-final.mjs` dựng PostgreSQL 17 tạm, API từ source, Vite và Chromium; **9/9**: route Reproduce qua feature entry, Download nguyên byte (BOM + CRLF), Copy giữ BOM, Inspector đọc/verify capture, viewer bị chặn, filename sensitive bị che, mock Inspector ghi audit qua facade, không lỗi trình duyệt.
- **Test và kiểm tra tĩnh.** Vitest vùng findings + router + safety: 17 file, 168 test đạt. Server `t10`, `findings-artifacts`, `findings-artifacts-fs`: 44 test đạt. Web typecheck, server typecheck, `vite build`, ESLint các file đã sửa: đạt. Lint toàn web vẫn còn đúng 5 lỗi có sẵn ở `f.tsx`.
- **Commit.** Chia ba commit: tài liệu; contract + server; web (tính năng D9 và tổ chức Findings). Phần di chuyển presentation dùng ngoại lệ commit lớn hơn 400 dòng mà chủ dự án đã chấp thuận.

## 10. Còn lại

- **Presentation Findings**: đã chuyển hết; `screens/e-findings.tsx` đã xóa. Route alias nằm ở `router/findings.ts`.
- **Authority và clock**: đã xử lý trong 9.6, 9.8 và 9.9. Không còn `services.authority`, `recordAudit` hay `stamp()` trong findings.
- **Kiểm chứng**: BOM, Evidence Inspector và mock Inspector đã có check tự động (9.9). Operations không đổi code nên không chạy lại UI.
- **Lint**: 5 lỗi có sẵn ở `src/screens/f.tsx`, không đổi, cần một thay đổi riêng cho file đó.
- **PTY**: chưa mở. ADR-0095 còn Proposed, nên không triển khai.
- **Chạy lại PoC**: execution mới có provenance, làm sau.
- **Cấu trúc hóa gói cho finding thủ công**: đã có trong contract và form. Luồng 1 kiểm chứng sửa gói trên finding do script tạo. Chưa kiểm chứng riêng cho finding đã review.
- **PR**: ba commit, xem 9.9. Không push.
