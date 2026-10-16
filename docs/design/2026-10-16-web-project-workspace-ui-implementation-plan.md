# Implementation plan — Project Workspace UI

- **Trạng thái:** Đã chốt hướng UX; sẵn sàng triển khai, chưa thực hiện qua tài liệu này.
- **Ngày:** 2026-10-16.
- **Baseline:** `web-improve-refactor`, HEAD `d5f3140` cộng working tree; kiểm tra lại diff khi bắt đầu.
- **Ưu tiên:** giao diện và luồng thao tác, mock-first; giữ cấu trúc UX nhất quán với real.
- **Liên quan:** [Global Navigation — 8 mục](2026-10-16-web-global-navigation-implementation-plan.md).

## 1. Kết quả cần đạt

Biến các màn hình trong một project thành workspace liên tục, với ba câu hỏi rõ ràng:

1. Tôi đang ở project nào và đang làm việc ở phần nào?
2. Phạm vi, tài liệu và phiên bản nào đang áp dụng?
3. Hệ thống đang thực thi gì, đang chờ gì và tôi cần làm gì tiếp theo?

Người dùng đã đồng ý giải quyết năm vấn đề: header/context bị lặp; sidebar phẳng;
tab bar project trùng sidebar; Scope & ROE khó đọc và thiếu trải nghiệm tài liệu;
Operations mới là trang danh sách trung gian.

**Chỉ tổ chức thành 3 giai đoạn lớn** (§5). Mỗi giai đoạn bàn giao một luồng UI dùng
được để review ngay, không chia thành hàng chục ticket nhỏ. Các bullet dưới đây là
tiêu chí của giai đoạn, không phải task độc lập.

## 2. Phạm vi UI-first và ranh giới dữ liệu

### Trong phạm vi

- Shell/header/sidebar project, nhãn trang, phân nhóm và giữ context khi drill-down.
- Scope & ROE: asset scope, trình đọc tài liệu, chỉnh bản nháp, diff và trạng thái lưu.
- Execution: bố cục theo dõi run/operation và hành động tiếp theo từ các nguồn có sẵn.
- Bộ dữ liệu mock đủ các trạng thái để test giao diện; browser review trên Docker `:3001`.
- Real dùng cùng cấu trúc trang; chức năng được thể hiện theo khả năng API hiện có.

### Ranh giới

- Giữ sidebar **8 mục toàn hệ thống** của plan trước.
- Giữ hash router và resource deep links; nhãn Execution không buộc đổi operation IDs/URLs.
- Không thay cơ chế fan-out, dispatch, scheduler, cách chọn tool/model hoặc thuật toán exploit.
- Không thay nghĩa của RoE, authorization, handoff, preflight, approval, stop hay policy đang áp dụng.
- Không thêm dependency editor chỉ để có giao diện mới; ưu tiên component/form/textarea có sẵn.
- Real không fallback mock. Thiếu API đọc/ghi tài liệu phải hiển thị đúng khả năng:
  đọc được thì cho đọc; chưa ghi được thì read-only và giải thích ngay tại editor.
- Mock save chỉ cập nhật mock authority/draft theo project và được ghi rõ là mô phỏng.
  Không dùng toast thành công để giả lập một lần ghi file thật ở real mode.

Nếu persistence tài liệu cần public API/schema mới, ghi dependency riêng và tuân thủ
Proposed ADR/contract review của repo. Không chặn review UI mock vì dependency đó,
nhưng không đánh dấu editor real hoàn tất trước khi ghi/đọc lại thật được xác minh.

## 3. Cấu trúc giao diện đích

### 3.1 Một header dùng chung, sidebar làm điều hướng chính

```text
Header: project switcher | search | status/alerts | Emergency Stop | account

Sidebar project                 Nội dung
Tên project + All projects      Breadcrumb ngắn nếu cần
Nhóm điều hướng                 Tiêu đề trang: Scope & ROE / Planning / Execution / ...
                                Hành động đúng ngữ cảnh trang
                                Nội dung làm việc
```

- Tên project nằm ở đầu sidebar và trong switcher, không lặp nguyên cụm identity/status
  trong nhiều thanh ngang rồi lặp tiếp ở đầu mọi trang.
- Gộp thông tin hữu ích của context ribbon vào header/context gọn; bỏ thanh project
  riêng sau khi các nút quan trọng đã có nơi tương đương. Emergency Stop luôn dễ tìm,
  giữ quyền, reason và trạng thái requested/acknowledged hiện hành.
- Bỏ tab bar project `Overview / Scope & ROE / Operations / Planning / ... / More`
  trong cả mock và real. Sidebar là đường điều hướng giữa các phần của project.
- Cho phép tab cục bộ có ý nghĩa: Documents/History trong Scope, Live/History trong
  một run. Tab cục bộ không lặp danh sách các trang của project.
- Tiêu đề chính là section đang mở; riêng trang chi tiết có thể là tên run/tài liệu.
- Ask AI có một entry rõ ràng dẫn vào Planning/workspace đúng project, không lặp ở
  header và mọi page header. Close Project chuyển về Closeout.
- CTA theo trang: Edit draft ở Scope, Continue planning ở Planning, Open run ở
  Execution. Không rải Create Operation/Close Project lên Findings/Evidence/ROE.

### 3.2 Sidebar theo nhóm công việc

```text
PROJECT
  Overview

PREPARATION
  Scope & ROE
  Planning

EXECUTION
  Execution
  C2 Sessions

RESULTS
  Findings
  Evidence
  Reports

MANAGEMENT
  Team & Approvals
  Activity & Audit
  Project Settings
  Closeout
```

- Objectives nằm trong Overview/Planning; có link mở phần chi tiết hiện hữu.
- Fleet/Workers là góc nhìn cục bộ của Execution, phân biệt AI worker và host agent.
- Activity/Audit có hai view cục bộ, giữ phân biệt activity feed với audit có attribution.
- Governance/Vault/Settings hiện có ở real phải còn đường vào trong Management;
  có thể là các section của Project Settings với deep link tới surface hiện hữu.
  Giữ quyền và nhãn rõ ràng, không loại bỏ workflow chỉ để rút số mục.
- Đây là phân nhóm UX chung, không ép mọi mục phải có dữ liệu real ngay. Mode nào
  chưa có một surface thể hiện unavailable rõ ràng; không render action giả.

### 3.3 Hợp đồng context

- Project shell phải giữ nguyên khi đi từ project list → operation/run → session/
  finding/report/tài liệu, không chỉ khi `route.page === 'project'`.
- Active sidebar dùng **section sở hữu**: operation/run detail → Execution;
  finding/evidence detail → Findings/Evidence; document reader → Scope hoặc Planning
  theo entry, không bật nav toàn hệ thống chỉ vì URL đổi resource type.
- Xác định project từ route có engagement identity hoặc canonical resource read
  được cấp quyền. Không đoán từ prefix resource ID, không lấy project đầu tiên.
- All projects trở về scope all qua navigation seam/dirty guard hiện có.
- Project switch, reload và Back/Forward phục hồi context; draft của project A không
  xuất hiện trong B. Truy cập ID không có quyền giữ trạng thái denied/not-found.
- Giữ alias cũ: mock `plans` và real `planning`; nhãn Execution vẫn nhận `operations`;
  `sessions`/`c2` map đúng theo mode. Không đổi ID trong dữ liệu chỉ để đổi tên menu.

## 4. Yêu cầu nội dung cho ba trang trọng tâm

### Scope & ROE — phạm vi và tài liệu nhìn thấy ngay

**Bố cục:** một status strip ngắn → nội dung chính rộng → panel chi tiết khi chọn.
Không để hai card Effective/Proposed lớn và ROE sidebar chiếm phần lớn màn hình
trước khi bảng asset xuất hiện. Không render ROE đồng thời hai lần.

**Phạm vi mục tiêu**

- Có các nhóm rõ: Approved in-scope / Out-of-scope / Pending changes / Unclassified.
- Asset pending không được tính vào nhãn Approved in-scope. Đừng dùng `scope != out`
  làm bằng chứng asset đã được phép thực thi.
- Tìm theo URL/domain/IP/CIDR; bảng có identifier, loại, trạng thái, nguồn và lý do
  nếu nguồn có cung cấp. Không suy diễn lý do hoặc version không có trong dữ liệu.
- Bấm asset xem chi tiết; thêm/chỉnh scope theo workflow hiện hữu. Chưa có thay đổi
  thì phần Proposed changes thu gọn, không giữ card trống chiếm nửa màn hình.

**ROE bằng ngôn ngữ tự nhiên**

- Trình bày mục tiêu, phạm vi, hoạt động được phép/cấm, thời gian/timezone, giới hạn
  tác động, điều kiện dừng, contact và điều phối thành các section dễ đọc.
- Phân biệt bản hiện hành với bản nháp; edit trực tiếp trên trang hoặc panel đủ rộng,
  thay cho hộp thoại nhỏ chứa mọi thứ.

**Tài liệu, source và chỉnh sửa**

- Danh sách tài liệu có tên, loại, trạng thái, version/source có thật, thời điểm cập
  nhật có source. Bao gồm ROE và các tài liệu planning liên quan; mock có mẫu hợp lý.
- Bấm tài liệu mở reader ngay trong workspace: chế độ **Readable** và **Source**
  (JSON/text khi có), Download là action phụ. PDF có thể preview khi bytes tồn tại;
  không biến tên file PDF mô phỏng thành tuyên bố có file thật.
- Tài liệu tự nhiên/brief, tài liệu AI sinh và scope áp dụng phải có nhãn phân biệt.
  Trình bày liên kết giữa chúng, không mặc định bản AI sinh là bản runtime đang dùng.
- Edit → draft có dirty state; Save draft / Discard / Compare changes; trạng thái
  saving, saved, failed, stale-version/conflict rõ ràng. Không tự ghi đè bản áp dụng.
- Readable/source chỉnh cùng một document model, không giữ hai bản độc lập. JSON
  lỗi parse giữ nguyên draft, chỉ rõ lỗi, không báo saved. Schema validation chỉ
  hiện khi có schema/contract tương ứng; parse thành công không đồng nghĩa đủ chuẩn.
- Bộ tài liệu tám file planning và OPPLAN vẫn theo contract hiện hành; OPPLAN không
  bị đổi thành điều kiện bắt buộc mới hoặc thay thế bước duyệt chỉ vì editor mới.
- Planning và Scope dùng chung reader/editor cho cùng tài liệu, chỉ khác entry;
  không tạo kho tài liệu thứ hai hay copy file giữa hai trang để hiện nội dung.

### Planning — nơi làm việc với AI và hoàn thiện kế hoạch

- Có đường tiếp tục hội thoại và xem câu hỏi chưa trả lời ngay trong project context.
- Bộ tài liệu đã sinh/thiếu/lỗi dễ thấy; mở trực tiếp reader/editor như trên.
- Kế hoạch, phiên bản, trạng thái duyệt/handoff giữ nghĩa hiện có. Không biến việc
  mở Planning hoặc đủ file thành một hành động dispatch mới.
- Planning hoàn tất có đường sang Execution rõ ràng; không thêm thay đổi tự chạy
  exploit trong đợt chỉnh UI này.

### Execution — workspace thực thi, không là bảng trung gian

**Bổ sung đã chốt:** [Execution: hội thoại và điều hành subagent](2026-10-16-web-execution-agent-workspace-implementation-plan.md)
làm rõ giai đoạn 3: giữ tên Execution, hội thoại ở giữa và cây subagent/control
ở cột phải. Không thêm một mục Runs hoặc một trang chat độc lập trùng chức năng.

- Điểm vào chính cho operation/run của project. Bỏ vòng đi `Operations tab` →
  `Open in Operations` → một bảng khác mới vào run.
- Phần đầu: đang chạy / đang chờ / lỗi / chưa bắt đầu, kèm mục tiêu và bước tiếp
  theo có căn cứ từ dữ liệu. Không quy successful run thành finding đã xác minh.
- Có selector/list operation hoặc run, vùng chi tiết chính và lịch sử chạy. Tab
  cục bộ Live / Timeline / Results & Evidence / Workers chỉ đổi view của resource.
- Mỗi item liên kết plan/scope version, conversation và evidence nếu source có;
  field thiếu dùng No source/Unknown phù hợp, không tạo metadata giả để đủ UI.
- Chưa có run: chỉ rõ điều kiện còn thiếu và link tới Scope/Planning hiện hữu.
  Không rải ID thread/request kỹ thuật lên phần chính; giữ trong Details khi cần.
- Dùng lại lifecycle controls đang có theo quyền và trạng thái quan sát. Unknown,
  interrupted, failed và pending decision hiển thị đúng nghĩa; không tự retry,
  resume hay dispatch khi đổi tab. Fan-out chỉ được hiển thị như nguồn hiện hữu,
  không thay đổi cơ chế, contract hoặc logic của nó.
- Real tiếp tục dùng execution threads/runs hiện hữu; không tạo model business
  operation mới chỉ để giao diện giống dataset mock.

## 5. Ba giai đoạn triển khai và bàn giao

Các điểm chạm frontend trong bảng dưới đây tương đối với `apps/web/src/`.

| Giai đoạn | Phạm vi gộp | Điểm chạm dự kiến | Bàn giao để review |
|---|---|---|---|
| **1. Project shell thống nhất** | Header/context gọn; sidebar chia nhóm; bỏ tab bar/More; title/action theo trang; giữ shell khi mở resource detail | `shell/{shell,header,context-ribbon,sidebar}.tsx`, `shell/nav.ts`, `router/navigate.ts`, `screens/b-detail.tsx`, `real/{shell-parts,screens/detail}.tsx` | Trên mock, mở project → chuyển các trang → mở operation/session → quay lại vẫn một shell; desktop/mobile đều rõ |
| **2. Scope & document workspace** | Asset scope rõ trạng thái; ROE dễ đọc; reader/editor draft dùng chung giữa Scope và Planning; diff/save/error states | `screens/b-detail2.tsx`, mock planning surfaces, `features/assets`, `real/screens/{scope-panel,planning-panel}.tsx`, document UI/adapters trong frontend | Mock có thể xem asset in/out/pending, đọc/edit JSON hoặc nội dung tự nhiên, kiểm tra lỗi và lưu draft; real nêu đúng khả năng API |
| **3. Execution & nghiệm thu toàn luồng UI** | Gộp entry Operations vào Execution; live/detail/history/results; giữ context; rà regression UI và deploy | `screens/{b-detail,c,c-console}.tsx`, `real/screens/{operations-panel,workspace}.tsx`, router/section mapping, owning tests | Mock: Scope → Planning → Execution → Findings/Evidence; đủ empty/loading/error states; image Docker được verify |

Thứ tự **1 → 2 → 3**, có bản Docker để người dùng test sau mỗi giai đoạn. Không đợi
đóng toàn bộ integration/backend mới review layout. Mỗi giai đoạn là một hạng mục
sản phẩm; nếu diff vượt giới hạn repo thì chia commit/PR kỹ thuật theo ownership,
không biến thành thêm nhiều task sản phẩm hoặc gộp PR vượt budget.

Nguồn chuẩn khi bắt đầu: `apps/web/AGENTS.md`, `CONTRIBUTING_AGENT.md`,
`docs/QUALITY_BAR.md`, plan Global Navigation và [ADR-0068](../adr/0068-web-frontend-real-mode-data-boundary.md).
Giữ nguyên user work đang sửa trong working tree; đối chiếu source hiện tại thay
vì tin các dòng Done trong báo cáo cũ là toàn bộ UX đã được nghiệm thu.

## 6. Nghiệm thu giao diện

| Luồng | Kết quả bắt buộc |
|---|---|
| Mở project từ All Projects | Sidebar có nhóm, tên project rõ; một header gọn; không có tab bar project/More; title là section |
| Chuyển Scope / Planning / Execution / Results | Không lặp identity/status/CTA; active sidebar đúng; global sidebar 8 mục không bị ảnh hưởng |
| Mở run, session, finding, report rồi Back/reload | Vẫn trong shell/project đúng; return path không lẫn project hoặc mất resource ID |
| Scope có approved/pending/out/unclassified | Counts đúng nguồn; pending tách riêng; bảng thấy ngay và tìm được identifier |
| Mở ROE và tài liệu planning | Đọc trực tiếp; một nội dung ROE tại một thời điểm; source/version áp dụng và draft được phân biệt |
| Edit readable/source + invalid JSON | Một draft nhất quán; lỗi giữ nội dung; không báo lưu thành công giả; real thiếu write API rõ read-only |
| Draft dirty → đổi trang/project hoặc Back | Stay giữ nguyên route/scope; Discard đúng draft; Save chờ kết quả, lỗi không làm mất bản sửa |
| Hai bản sửa / phản hồi lưu đến muộn | Không ghi đè draft mới hoặc draft project khác; conflict hiện rõ theo khả năng contract |
| Execution chưa có run / chạy / đang chờ / lỗi / hoàn tất | Mỗi trạng thái có nội dung và bước tiếp theo; không cần vào một bảng Operations thứ hai |
| Chọn/view run hoặc document | Không sinh thêm run, auto-resume hay thao tác runtime ngoài ý muốn |
| Role hạn chế / source lỗi / ID không có quyền | Không lộ data/action; error/empty khác nhau; real không fallback demo |
| 1440px, 1024px, 390px; light/dark; keyboard | Sidebar groups, drawer, reader/editor usable; focus/aria-current/Escape đúng; scroll ở vùng nội dung phù hợp |

Mock cần một project có đủ dữ liệu, một project trống và một bản scope/tài liệu
pending/invalid để review đủ trạng thái. Dùng thêm persona reviewer/viewer. Kiểm
tra cùng snapshot khi so counters vì demo scheduler có thể đổi trạng thái.

## 7. Kiểm tra và deploy

- Viết regression ở seam thực tế: click từ portfolio, drill-down resource, form
  draft và editor; không chỉ assert số button hoặc mở trực tiếp route đẹp nhất.
- Chạy focused tests cho shell/router, project detail, Scope, Planning, Operations,
  session, Findings/Reports và document UI thay đổi. Test cũ phụ thuộc tab bar phải
  chuyển sang assert sidebar/section tương đương, giữ coverage hành vi.
- Chạy từ repo root trong WSL với Node/npm Linux:

```bash
npm run typecheck --workspace=@raptix/web-raptix
npm run lint --workspace=@raptix/web-raptix
npm run test --workspace=@raptix/web-raptix -- --pool=threads --maxWorkers=2 src/router/navigate.test.tsx src/router/routes.test.tsx src/shell/shell.test.tsx src/shell/unsaved.test.tsx src/screens/project-detail/detail.test.tsx src/real/app-routing.real.test.tsx
# Thêm owning tests của document/Scope/Execution thực sự đổi vào focused run.
npm run build --workspace=@raptix/web-raptix

docker compose -f docker-compose.web-raptix.yml build --build-arg VITE_DATA_MODE=mock web-raptix-ui
WEB_RAPTIX_PORT=3001 docker compose -f docker-compose.web-raptix.yml up -d --no-deps --wait --wait-timeout 60 web-raptix-ui
```

Build shared `@raptix/streaming` và `@raptix/web-contracts` trước nếu dist chưa có.
Mock URL: **http://127.0.0.1:3001/?dataMode=mock**. Sau mỗi giai đoạn deploy, ghi
asset hash/image ID và chụp ít nhất project shell, Scope, document editor và
Execution. Người dùng hard reload và test song song; báo rõ mỗi lần UI được cập nhật.

Real kiểm tra shell/navigation bằng `?dataMode=real` với dữ liệu/API có thật; ghi
riêng read/edit/persist gaps. Không cần chạy exploit hoặc kiểm thử fan-out để chốt
layout. Không recreate API/runtime hoặc reset dữ liệu chỉ để cập nhật UI.

## 8. Điều kiện hoàn tất

- **UI mock được chấp nhận:** hoàn tất ba giai đoạn, các luồng §6 chạy được và đã
  kiểm chứng trên image đang phục vụ `:3001`; người dùng có thể review luồng trực tiếp.
- **Real UI được đồng bộ:** cùng shell/section/route behavior, thể hiện trung thực
  trạng thái nguồn và khả năng đọc/ghi; không còn đường rơi về global nav khi drill-down.
- **Document persistence real:** chỉ đánh dấu hoàn tất khi Save → reload → đọc lại
  chứng minh được dữ liệu/version đúng. API còn thiếu được ghi dependency, không lấy
  mock pass để xác nhận backend đã xong.
- Bàn giao ngắn theo **3 giai đoạn**: đã làm gì, kết quả gate/browser, URL/image đang
  chạy, khả năng còn thiếu. Cập nhật changelog khi triển khai; không phát sinh thêm
  một bản plan/ticket cho từng nút, card hay từng dòng menu.
