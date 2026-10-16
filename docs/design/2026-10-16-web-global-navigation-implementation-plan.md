# Implementation plan: sidebar All Projects gồm 8 mục

- **Trạng thái:** S1–S6 đã triển khai trên working tree; mock đã nghiệm thu browser tại `:3001`. S4b (real global sync) và S7 (nghiệm thu real đầy đủ) còn lại. Xem §11.
- **Ngày:** 2026-10-16.
- **Quyết định sản phẩm:** người dùng đã đồng ý cấu trúc 8 mục sau buổi review UI mock tại `:3001`.
- **Baseline tham khảo:** branch `web-improve-refactor`, HEAD `3b40adc` **cộng working tree đang sửa**.
- **Ưu tiên:** mock-first để nghiệm thu luồng; đồng bộ cấu trúc điều hướng với real mode.

## 1. Mục tiêu và phạm vi

Khi chưa mở một project, console trả lời ba câu hỏi:

1. Hệ thống đang làm gì trên các project tôi có quyền xem?
2. Kết quả và tài nguyên dùng chung hiện ra sao?
3. Việc gì cần tôi xử lý, và cần mở project nào để xử lý?

Khi mở project, chuyển sang ngữ cảnh project để planning, hội thoại AI,
execution, tương tác session và các thao tác có ảnh hưởng đến project đó.

**Phạm vi:** frontend `apps/web`; điều hướng, bố cục và composition các màn hình.
Giữ hash router, các liên kết cũ và nguồn dữ liệu theo mode. Backend, Prisma,
Python runtime, cơ chế duyệt, dispatch và tự động planning → execution không
thuộc thay đổi này. Không bổ sung dependency hoặc một API dashboard tổng hợp mới.

Tuân thủ `CONTRIBUTING_AGENT.md`, `docs/QUALITY_BAR.md`, `apps/web/AGENTS.md`:
mỗi PR một concern, ≤400 runtime lines và ≤10 files; tách slice khi vượt budget.

## 2. Hiện trạng cần sửa

Đã kiểm tra 12 mục sidebar trong mock, persona Alex Morgan, scope All Projects:

| Hiện trạng | Vấn đề |
|---|---|
| Sidebar có 6 nhóm / 12 mục | Trộn điều hành project với giám sát và tài nguyên toàn hệ thống |
| Overview mở màn hình có tiêu đề Command Center | Tên trang, nav và đường vào chưa thống nhất |
| AI Operator trong All Projects | Nêu khả năng tổng hợp nhưng nội dung chính là yêu cầu chọn project |
| Operations | Có bảng tổng hợp hữu ích, nhưng đặt cùng nhóm thao tác execution |
| C2 & Sessions | Trộn node/relay/server dùng chung với truy cập session theo project |
| Agents | Chủ yếu là máy/agent thực thi với hostname, OS, connection; dễ nhầm với AI specialist |
| Attack Analysis | Trộn coverage tổng hợp với timeline riêng của một operation |
| Ribbon + banner + helper text | Lặp lại nhiều lần thông báo All Projects / select project |
| Quick actions | Nhiều nút tạo operation/session/finding/report bị khóa ở global scope |
| Header Default AI Mode | Xuất hiện ngoài ngữ cảnh hội thoại mà nó cấu hình |
| Mock và real | Màn hình khác nhau; project sidebar mới hiện chỉ được bật trong real mode |

Các sửa UI trong working tree trước đây chưa đồng nghĩa image Docker đã cập nhật.
Nghiệm thu phải xác nhận bundle đang phục vụ, không chỉ source đã đổi.

### Nguồn chuẩn cần đọc khi bắt đầu

| Khu vực | File |
|---|---|
| Nav và shell | `apps/web/src/shell/nav.ts`, `apps/web/src/shell/{sidebar,shell,header,context-ribbon,project-switcher}.tsx` |
| Route và navigation | `apps/web/src/router/{registry,host}.tsx`, `history.ts`, `navigate.ts` |
| Scope store | `apps/web/src/state/{stores,console}.ts` |
| Dashboard mock | `apps/web/src/screens/a-dashboard.tsx`, `screens/dashboard/` |
| AI mock | `apps/web/src/screens/{g-chat,g-common,g-workspace}.tsx` |
| Resources mock | `apps/web/src/screens/{d,d-agents,d-assets,d-library,h}.tsx` |
| Analysis mock | `apps/web/src/screens/e-analysis.tsx` |
| Real composition | `apps/web/src/real/screens/{overview,feature-route,detail,workspace}.tsx`, `real/shell-parts.tsx` |
| Mode boundary | `apps/web/src/real/mode.ts`, [ADR-0068](../adr/0068-web-frontend-real-mode-data-boundary.md) |
| Docker UI | `infra/containers/web-raptix.Dockerfile`, `docker-compose.web-raptix.yml` |

Các `.scratch/frontend-backend-integration/` và `.scratch/web-improve-refactor/`
được dẫn trong agent notes nhưng không có trong checkout lúc lập plan. Nếu chúng
xuất hiện khi triển khai, đọc lại spec/execution để đối chiếu; không coi đường
dẫn thiếu là bằng chứng một chức năng đã hoàn tất. Tài liệu completion cũ có thể
chứa số route và trạng thái gate đã lỗi thời: kiểm tra source và manifest thực tế.

## 3. Cấu trúc đích đã chốt

```text
WORKSPACE
  Overview
  Projects
  Findings
  Reports

RESOURCES
  Infrastructure
  Assets
  Library

ADMINISTRATION
  Settings
```

Đúng **8 mục chính** trên desktop, sidebar collapsed và mobile drawer; các tab
bên trong trang không tính là mục sidebar. Các mục không có quyền truy cập xử lý
theo policy hiện hành; không dùng thay đổi nav để mở rộng quyền.

### Trách nhiệm của từng mục

| Mục | Nội dung toàn hệ thống | Thao tác chuyển vào project |
|---|---|---|
| Overview | Project/run đang hoạt động, lỗi, quyết định chờ xử lý, finding nghiêm trọng, health và coverage có nguồn | Mở run, review, planning hoặc session theo project sở hữu |
| Projects | Danh sách, tìm kiếm/lọc, tạo và mở project | Bấm project → project overview |
| Findings | Danh sách finding xuyên project; severity, trạng thái, provenance và project sở hữu | Tạo/chỉnh sửa/retest/xử lý finding |
| Reports | Danh mục báo cáo xuyên project, trạng thái review/delivery | Soạn, review, export/delivery theo quyền và project |
| Infrastructure | Agent thực thi/shared pool, C2 infrastructure, theo dõi sessions | Phân bổ/tương tác có ngữ cảnh và quyền như hiện hành |
| Assets | Tra cứu inventory xuyên project; scope/source/project rõ ràng | Import, thêm hoặc thay đổi scope |
| Library | Playbooks, TTPs, ATT&CK catalog và trạng thái phiên bản | Dùng playbook trong plan/operation của project |
| Settings | Organization/workspace settings, integrations và policy hiện hành | Không thay thế Project Settings |

**Infrastructure** có các tab `Execution agents`, `C2 infrastructure`,
`Sessions`. Agent thực thi không đổi nghĩa thành AI specialist. Sessions ở đây
là màn hình giám sát: mở session → project/session cụ thể; không mở console
tương tác mà thiếu project. Không thêm tab health/runtime/model giả nếu chưa có
nguồn; health hiện có nằm trong tab sở hữu nó.

Tab IDs lần lượt là `agents`, `c2`, `sessions`; URL thiếu tab hoặc có tab không
hợp lệ mở `agents`. Back/forward phải khôi phục tab, không chỉ đổi state nội bộ.

## 4. Hợp đồng route và scope

### 4.1 Route chính và tương thích

| Nav | Route đích |
|---|---|
| Overview | `#/overview` |
| Projects | `#/projects` |
| Findings | `#/findings` |
| Reports | `#/reports` |
| Infrastructure | `#/infrastructure?tab=agents` |
| Assets | `#/assets` |
| Library | `#/playbooks` — đổi nhãn, giữ URL |
| Settings | `#/settings` |

- Thêm route nội bộ `infrastructure`; không rename hàng loạt route đã có.
- `command-center` không còn là đích sidebar. URL cũ vẫn mở overview khi ở
  global scope; bảo toàn hành vi project-scoped nếu route cũ đang được dùng.
- Sửa các link đang dùng `command-center` với nghĩa task inbox (ví dụ trong
  `real/screens/overview.tsx`) sang `tasks`, tránh vòng Overview → Overview.
- `operations`, `analysis`, `tasks` vẫn truy cập được từ các link/card của
  Overview; không xóa screen hoặc chức năng chỉ vì bỏ mục sidebar.
- Danh sách `agents` cũ ở global scope mở Infrastructure/Execution agents;
  `c2` cũ ở global scope mở tab C2 phù hợp. Dùng composition/adapter mỏng,
  không redirect mất `id`, `tab`, `engagementId` hoặc query hợp lệ.
- Deep link `agent/:id`, `c2-session/:id`, `c2-console/:id`, operation,
  finding/report detail vẫn giải đúng tài nguyên và project; không redirect
  resource detail sang một bảng tổng hợp rồi làm mất selection.
- `ai-operator`, tool trace/history vẫn mở được trong project. URL AI thiếu
  project mở picker/entry chọn project rõ ràng, không thành một trang global
  giả có lời hứa tổng hợp nhưng không có chức năng.
- Badge/active nav: operations, analysis, tasks → Overview; global agents/C2
  → Infrastructure; technique/playbook → Library. Trong project dùng nav project.
- Sau login thông thường, cả mock và real về System Overview. Login từ deep
  link vẫn quay đúng deep link. Không đổi quyền, persona hoặc auth flow.

### 4.2 Scope phải nhất quán trong URL, store và shell

`pid` là authority chọn project hiện có. Route mang project ID/engagement ID
phải được đối chiếu với authority này trước khi render nội dung hoặc mutation.
Không suy ra project từ resource ID, không chọn project đầu tiên làm fallback.

1. Mở project từ danh sách/switcher → commit project selection và route qua
   navigation seam hiện có, giữ dirty guard, rồi hiện shell project.
2. Đi All Projects/Overview hoặc một mục global → thực sự trở về global scope;
   không giữ `pid` của project cũ khiến bảng toàn hệ thống bị lọc ngầm.
3. Bấm operation/finding/report/session ở global scope → xác định project sở
   hữu từ dữ liệu được phép đọc và mở đúng trang chi tiết. Resource thuộc project
   khác/không có quyền phải ra not-found/forbidden như contract hiện hành.
4. Back/forward, reload và deep link phải phục hồi đúng scope. Không ghi
   `window.location.hash`/history từ component; giữ một location writer.
5. Đổi scope giữ nguyên các cơ chế cancel/invalidate hiện có; không để phản hồi
   của project A cập nhật panel project B, không gửi mutation trước khi chuyển xong.

Project sidebar/return path phải hoạt động ở **cả mock lẫn real**. Tái sử dụng
tab model của từng mode, map các alias tab hiện có; không ép mock dùng tab ID
của real nếu nội dung chưa được wire. Không redesign toàn bộ project workspace
trong plan này; chỉ bảo đảm global → project → global không đứt luồng.

## 5. Quy tắc nội dung và bố cục

### Overview

- Thống nhất tiêu đề **System Overview**, nav **Overview**.
- Một khu KPI ngắn, một hàng đợi Needs attention, danh sách hoạt động và kết
  quả nổi bật; không đặt toàn bộ bảng dữ liệu của mọi trang lên dashboard.
- Quick actions: Create Project, View all operations, Review pending decisions,
  Investigate failures, View critical findings. Link lọc phải áp dụng bộ lọc
  thật; nếu chưa hỗ trợ, dùng nhãn trung thực như Open Findings.
- Giữ các đường vào Operations, Tasks và Analysis/Coverage dưới dạng link phụ.
  Timeline/attack chain của một operation phải có selection rõ ràng; không tự
  hiển thị timeline OP-014 trong một trang đang tuyên bố tổng hợp mọi operation.
- Chỉ hiển thị trạng thái/counters có source. Không trình bày finding unverified
  như exploit đã thành công; `No data` khác zero và khác not detected.

### Header, ribbon, actions

- Global header: workspace, All Projects/project switcher, search, notifications,
  account. Không có bộ chọn Default AI Mode ở global scope.
- Chuyển bộ chọn mode của mock vào AI workspace, giữ semantics chỉ áp dụng cho
  conversation mới. Không tạo bộ chọn giả ở real nếu chưa có integration.
- Global Ask AI không được đưa người dùng tới trang bị khóa; chỉ hiện trong
  project hoặc mở project picker rõ mục đích trước khi vào workspace.
- Một chỉ báo All Projects ngắn là đủ; bỏ banner/helper trùng nội dung. Giữ
  cảnh báo thực như offline, degraded, source unavailable, scope conflict.
- Bỏ các CTA project-only bị disabled thường trực ở global; khi cần tạo mới,
  dùng project picker rồi vào form với project rõ ràng. Luôn giữ kiểm tra quyền.
- Bỏ badge plan khỏi AI Operator toàn hệ thống; đưa việc chờ duyệt về Needs
  attention/Tasks. Badge Infrastructure chỉ đếm lỗi hoặc request với nhãn rõ
  nghĩa; không cộng các loại counters khác nhau thành một số không giải thích.

### Infrastructure, Assets, Library, Findings, Reports

- Infrastructure compose lại nội dung Agents/C2, không nhúng nguyên hai page
  có header/ribbon/CTA riêng vào một page khác. Extract phần nội dung nhỏ cần
  dùng lại; giữ feature ownership và lazy loading.
- Ở Assets phân biệt target asset với infrastructure agent; scope của asset
  vẫn theo project. Library là nguồn dùng chung, không phải bước Planning.
- Findings/Reports giữ cột project, bộ lọc và deep link; global là điểm tra cứu,
  không tạo đường mutation vượt project. Action review hiện có vẫn mở đúng
  workflow theo quyền, không vô hiệu hóa chỉ vì danh sách xuất phát từ global.

## 6. Mock và real: một UX, hai nguồn dữ liệu

- Dùng chung nav labels, grouping, active matching và quy tắc scope. Tách
  adapters/content theo mode như ADR-0068; không đưa HTTP vào mock authority.
- Mock nghiệm thu đầy đủ dữ liệu seed và các luồng UI, không gọi `/api`.
- Real giữ transport/query/session hiện có; không fallback seed khi API thiếu.
- Hiện `RealFeatureRoute` cho Findings/Reports/Fleet/C2 yêu cầu engagement;
  đây **chưa phải global aggregate**. Không reuse nó rồi tuyên bố global đã xong.
- Real Overview hiện đọc riêng projects, tasks, findings rollup và C2 audit.
  C2 audit không phải live session inventory. Kiểm tra endpoint thực sự có trên
  API đang deploy trước khi đánh dấu section available.
- Nếu real thiếu global list/health source: render unavailable/limited đúng
  section, kèm đường vào project. Ghi vào bảng gap nghiệm thu, không mock hóa
  và không mở N provider calls cho N project ở mỗi lần render.
- Việc bổ sung API global mới, nếu cần sau mock review, là slice backend riêng
  với Proposed ADR/contract review; không gom tất cả dữ liệu vào một endpoint.

## 7. Thứ tự triển khai

Mỗi slice merge được độc lập; không để nav trỏ vào route chưa có. Số file bên
dưới là điểm chạm dự kiến, không phải lý do vượt budget. Viết test hành vi tại
seam phù hợp, thấy fail trước fix; không chỉ sửa test đếm nhãn.

| ID | Phụ thuộc | Công việc và điểm chạm chính | Exit criteria |
|---|---|---|---|
| S1 | Không | Chốt và triển khai global/project navigation transition tại `router/navigate.ts`, `shell/project-switcher.tsx` và helper scope frontend nếu cần | Portfolio/switcher → project; All Projects → global; dirty guard/back/reload giữ scope |
| S2 | S1 | Thêm route/page Infrastructure, compose Execution agents/C2/Sessions trong mock; real có composition riêng hoặc unavailable đúng source. Chạm `router/registry.tsx`, `router/host.tsx`, screen export record và wrapper mới | Route hoạt động trước khi thay menu; không duplicate page header; session detail vẫn đúng project |
| S3 | S2 | Đổi `shell/nav.ts` thành 8 mục/3 nhóm; cập nhật sidebar, active matching, route announcer và badges. Đổi nhãn Library, giữ URL cũ | 8 mục ở desktop/mobile/collapsed; Operations/Analysis/AI Operator/Agents/C2 không còn mục riêng |
| S4a | S3 | Làm gọn Overview mock, tiêu đề và quick actions; thống nhất landing/command-center compatibility | Không có disabled quick-action wall; link phụ Operations/Tasks/Analysis vẫn tới được |
| S4b | S4a | Đồng bộ shell/Overview real trong giới hạn dữ liệu có thật; ghi source gaps | Cùng kiến trúc UX, section lỗi độc lập; không có fallback seed |
| S5 | S3 | Dọn global header/ribbon/CTA; chuyển mock AI mode vào workspace; bổ sung project picker cho entry cần scope | All Projects không có AI mode hoặc trang AI bị khóa; mất banner trùng nhưng còn cảnh báo thực |
| S6 | S4a, S5 cho mock; thêm S4b khi nghiệm thu real | Kiểm tra Findings/Reports/Assets/Library và secondary Operations/Analysis; sửa chỗ scope/selection còn sai | Mỗi trang có vai trò rõ, resource detail không mất ID/project, không tạo mutation ngoài scope |
| S7 | S6 | Browser matrix, accessibility/responsive, production build và kiểm chứng Docker | Đạt các tiêu chí ở §8–9; có evidence của đúng bundle/image |

Thứ tự ưu tiên chạy: **S1 → S2 → S3 → S4a → S5 → S6 (mock)** để người dùng
test sớm; sau đó hoàn tất S4b và regression real trước khi đóng cả plan.
Nếu một slice vượt 400 runtime lines/10 files, tách theo feature; không gom
toàn bộ plan vào một PR lớn.

## 8. Tiêu chí nghiệm thu

| ID | Thao tác | Kết quả bắt buộc |
|---|---|---|
| A01 | Login thường từ `/` ở mock và real | Vào System Overview; login từ deep link giữ đích cũ |
| A02 | All Projects ở 1440px, 1024px và 390px | Chính xác 8 mục, 3 nhóm, đúng thứ tự; mobile/collapsed vẫn truy cập đủ |
| A03 | Bấm toàn bộ 8 mục khi chưa chọn project | Nội dung global hoặc source unavailable thật; không ra project chọn ngầm |
| A04 | Projects → bấm project A → Planning → All Projects | Vào project đúng; quay về scope all và global nav; không cần bấm Projects để thấy project sections |
| A05 | Switcher chọn A rồi B, sau đó về Overview/Findings global | Không còn pid A/B lọc ngầm; request/selection không lẫn |
| A06 | Global operation/finding/report/session → detail | Đúng resource và owning project; foreign/absent ID không lộ dữ liệu |
| A07 | Overview → View all operations / pending decisions / coverage | Trang phụ còn tồn tại; filter/selection khớp nhãn, không thao tác execution tự động |
| A08 | URL cũ agents/c2/playbook/command-center và resource deep links | Tới đúng nội dung, không loop, không mất ID/tab; active nav có nghĩa |
| A09 | Infrastructure đổi tab và reload | Giữ tab; agent thực thi khác AI specialist; sessions monitoring khác interactive console |
| A10 | Global header và các trang global | Không Default AI Mode; một chỉ báo scope; không lặp Select project banners/CTA disabled |
| A11 | Draft đang dirty → đổi project/global, Back/Forward | Save/Discard/Stay hoạt động; Stay không đổi scope; navigation chỉ ghi một lần |
| A12 | Empty/filter-no-match/source-error và role hạn chế | Thông báo đúng nguyên nhân; không fake zero, không fallback demo hoặc tăng quyền |
| A13 | Mock browser flow | Seed data có trên cả 8 mục; không có `/api` request trong flow |
| A14 | Real browser flow | Dữ liệu theo quyền; section chưa có source ghi gap; API lỗi không làm các section khác biến mất |
| A15 | Keyboard/light-dark/mobile | Focus và aria-current đúng; Escape đóng drawer; không overflow bảng/nav làm mất CTA |

Chạy bằng tài khoản manager và ít nhất một viewer/reviewer seed. Real cần thêm
hai project khác scope quyền. Status run mock có thể đổi do scheduler: kiểm tra
counters ở cùng snapshot, không so hai ảnh chụp cách xa rồi kết luận lệch số.

## 9. Verification và deployment

### Tests/gates

Điểm regression hiện có: `src/router/{navigate,routes}.test.tsx`,
`src/shell/{shell,unsaved}.test.tsx`, `src/real/app-routing.real.test.tsx`,
`src/screens/system/system.test.tsx`, `src/real/screens/overview.test.tsx`.
Thêm focused tests cho Infrastructure và scope transition nếu seam chưa có.

Lệnh từ repo root trong WSL, dùng Node Linux (không dùng npm Windows trên
`node_modules` Linux):

```bash
npm run build --workspace=@raptix/streaming
npm run build --workspace=@raptix/web-contracts
npm run typecheck --workspace=@raptix/web-raptix
npm run lint --workspace=@raptix/web-raptix
npm run test --workspace=@raptix/web-raptix -- --pool=threads --maxWorkers=2 src/router/navigate.test.tsx src/router/routes.test.tsx src/shell/shell.test.tsx src/shell/unsaved.test.tsx src/real/app-routing.real.test.tsx src/screens/system/system.test.tsx
# Thêm owning tests của screen thay đổi vào focused run.
npm run build --workspace=@raptix/web-raptix
```

`--pool=threads` đã dùng được trong WSL ở checkout này; không sửa config chỉ
để né timeout. Nếu gate fail, tái hiện và ghi rõ fail/assertion/timeout; không
gọi là flaky chỉ vì retry pass, không stash user work để che lỗi baseline.

Route inventory hiện là 54 trong working tree. Thêm Infrastructure dự kiến
thành 55 nếu chưa có thay đổi khác; lấy MANIFEST làm chuẩn, cập nhật screen
export/test inventory và các count docs liên quan, không xóa route cũ để giữ số.

### Chạy và nghiệm thu mock

```bash
npm run dev --workspace=@raptix/web-raptix
# Mở http://127.0.0.1:5273/?dataMode=mock

docker compose -f docker-compose.web-raptix.yml build --build-arg VITE_DATA_MODE=mock web-raptix-ui
WEB_RAPTIX_PORT=3001 docker compose -f docker-compose.web-raptix.yml up -d --no-deps --wait --wait-timeout 60 web-raptix-ui
# Mở http://127.0.0.1:3001/?dataMode=mock, hard reload.
```

`VITE_DATA_MODE` được inline lúc build; runtime env nginx không đổi được mode.
Query `?dataMode=` ưu tiên hơn localStorage và build default. Không recreate
API/runtime chỉ để refresh UI. Muốn kiểm tra real, build lại UI với
`--build-arg VITE_DATA_MODE=real` rồi deploy riêng UI và mở `?dataMode=real`.

Trên browser profile sạch, thực hiện A01–A15 phù hợp mode và ghi:
URL, mode/persona, viewport, scope trước/sau, asset hash, UI container image ID,
screenshot và network errors. Test phải bắt đầu ở **danh sách Projects rồi bấm
row**, không chỉ mở thẳng deep link project. Kiểm tra image ID mới và asset hash
đã đổi sau deployment; giữ ảnh global sidebar và project sidebar làm evidence.

Nếu cần rollback deployment, lưu image ID/tag trước khi build và dùng override
image cục bộ cho riêng UI; giữ port `3001`. Không reset DB/volume để rollback UI.

## 10. Definition of Done / bàn giao

- [ ] 8 mục sidebar đã hoạt động ở mock và real, không chỉ đổi nhãn.
- [ ] Global → project → global thống nhất ở list, switcher, deep link, reload và history.
- [ ] Operations/Tasks/Analysis và các URL cũ còn đường vào hợp lệ.
- [ ] Infrastructure không trộn agent thực thi với AI specialist hoặc audit với live sessions.
- [ ] Header/ribbon/actions gọn theo scope; không mất cảnh báo hoặc permission checks.
- [ ] Mock đầy đủ flow để người dùng test; real source gaps được liệt kê riêng theo section.
- [ ] Focused tests, typecheck, lint, build đã chạy; lỗi còn lại có bằng chứng và owner/follow-up.
- [ ] Đã kiểm chứng browser trên image đang chạy tại `:3001`, không chỉ dev server.
- [ ] Có danh sách file thay đổi, commands/evidence và hướng rollback; cập nhật changelog khi triển khai.

**Chốt nghiệm thu sản phẩm mock** sau S6 cho phép tiếp tục review giao diện.
**Đóng toàn bộ plan** cần cả S4b/S7; mock pass không chứng minh backend/runtime
đã tích hợp đủ hoặc các gap của web completion cũ đã được giải quyết.

## 11. Trạng thái triển khai (2026-10-16)

Mock-first, đo trên bundle Docker đang chạy tại `:3001` (`VITE_DATA_MODE=mock`).

| Slice | Trạng thái | Ghi chú |
|---|---|---|
| S1 scope transition | Done | `goGlobal()` trong `router/navigate.ts`; `useRoute` sync `pid` cho project/overview/projects/infrastructure; sidebar dùng `goGlobal`. |
| S2 Infrastructure | Done | Route `infrastructure` (MANIFEST 55), tab URL `agents`/`c2`/`sessions`; `AgentsContent`/`C2InfraContent`/`Sessions monitor` extract; `#/agents`, `#/c2` giữ nghĩa theo scope. |
| S3 nav 8 mục | Done | 3 nhóm/8 mục; alias active; Library giữ URL `playbooks`; badge theo 1 nghĩa (projects = approvals chờ, infrastructure = agent lỗi). Project sidebar chạy cả mock (13 tab) lẫn real (15 tab). |
| S4a Overview mock | Done | Tên "System Overview"; quick actions global thật (Investigate failures set `operations.status=error`); KPI trỏ Infrastructure; `e-analysis` chỉ hiện timeline khi có `route.id`. |
| S4b real Overview | Partial | Real overview đọc projects/tasks/findings/C2 audit; link task inbox đã sửa; chưa đồng bộ sâu + chưa ghi bảng source gap vào doc. |
| S5 header/ribbon | Done | Bỏ Default AI Mode khỏi header global (đưa vào AI workspace); Ask AI chỉ trong project; ẩn CTA project-only ở global; bỏ banner trùng. |
| S6 sweep | Done | "Command Center" → System Overview; resource detail từ global adopt project sở hữu qua `screens/resource-scope.ts` (operation/finding/report/session, chỉ khi đang `all`). |
| S7 nghiệm thu | Partial | Mock A01–A15 pass; real browser matrix + production restart chưa chạy. |

### Nghiệm thu browser (mock, container `:3001`)

Tất cả pass: 8 mục global ở desktop/mobile; mở project từ portfolio → sidebar project → reload giữ tab → All projects trả nav global; switcher đổi scope rồi clear; quick link "Investigate failures" áp filter thật; Infrastructure đổi tab + reload + URL cũ; mở session ở global nhận đúng project; không phát sinh request `/api` và không có page error.

### Gate

- `tsc --noEmit` (web) sạch; `eslint .` (web) sạch.
- Focused suites pass: router/shell/real-routing/system/overview/infrastructure + `features/{c2,findings,reports,operations}` + `screens/{project-detail,dashboard,b-portfolio}` (136 + 70 test, không lỗi).
- Ba test cũ từng đỏ trong môi trường `/mnt/d` (routes deep-link, shell "highlights Projects", t15 timeout 5s) đã xác nhận hỏng sẵn trên cây gốc trước thay đổi; sau đó deep-link và shell đã pass với preload lazy chunk trong test.

### Còn lại trước khi đóng plan

1. **S4b**: đồng bộ real Overview theo cùng kiến trúc (section lỗi độc lập) và ghi bảng source gap cho Findings/Reports/Operations/Analysis/Infrastructure.
2. **S7**: build `VITE_DATA_MODE=real`, chạy A01–A15 trên stack thật, kiểm tra restart UI/API.
3. Cập nhật changelog khi mở PR; tách S2/S3/S5/S6 thành PR riêng theo budget ≤10 file.

### File thay đổi chính

Nav/shell: `shell/nav.ts`, `shell/sidebar.tsx`, `shell/header.tsx`, `router/{navigate,host,registry,history}.tsx`.
Screens: `screens/infrastructure.tsx` (mới), `screens/resource-scope.ts` (mới), `screens/{a-dashboard,a-login,a-tasks,c,d-agents,d-assets,e-findings,e-analysis,f,f-report,g-chat,g-common,h,h-session,system/*}`.
Real: `real/{shell-parts,screens/overview,screens/global-resource}`; `real/screens/global-resource.tsx` (mới) render trạng thái unavailable thật cho global chưa có API.
Tests: `router/{navigate,routes}.test.tsx`, `shell/shell.test.tsx`, `real/app-routing.real.test.tsx`, `screens/system/system.test.tsx`, `screens/infrastructure.test.tsx` (mới), `real/screens/overview.test.tsx` (mới).
Docs: `apps/web/AGENTS.md` (53→55).
