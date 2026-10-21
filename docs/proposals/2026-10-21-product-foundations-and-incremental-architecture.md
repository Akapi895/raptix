# Raptix: nền tảng tính năng và tái cấu trúc tăng dần

- **Ngày:** 2026-10-21.
- **Trạng thái:** Đề xuất tổng hợp để thảo luận; chưa phải ADR được chấp thuận hoặc kế hoạch triển khai đã duyệt.
- **Phạm vi:** Asset Map, Access/Console, Finding reproduction, prompt và cách tổ chức Web.
- **Nền đánh giá:** Source snapshot `282a54ba`, lịch sử thay đổi, glossary, ADR và các luồng đã khảo sát trong phiên đánh giá kiến trúc.
- **Mức kiểm chứng:** Đọc source và test definitions; chưa chạy stack, terminal, model/tool smoke hoặc benchmark trong đợt đánh giá này.

## Tóm tắt định hướng

Raptix cần thống nhất những hành vi sản phẩm cốt lõi trước khi tiếp tục tối ưu cấu trúc. Tuy nhiên, không cần hoàn thiện mọi tính năng rồi mới refactor. Cách làm đề xuất là:

> Chốt một luồng sử dụng cụ thể → làm sâu module chịu trách nhiệm → kiểm chứng xuyên suốt → mở rộng tiếp.

Luồng đầu ra chung của hệ thống là:

```text
Agent thực thi
    ↓
Ghi nhận asset / finding / evidence / access
    ↓
Lưu identity, quan hệ và kết quả quan sát
    ↓
Web hoặc CLI trình bày dữ liệu thuộc đúng project
    ↓
Operator xem chứng cứ / tái hiện / mở console
```

Một trang mới nên là cách nhìn hoặc thao tác lên các khái niệm này. Việc thêm trang không nên mặc nhiên kéo theo một mô hình dữ liệu, một backend và một cách thực thi riêng.

Đích kiến trúc là một control plane chung cho các caller, cùng implementation Python runtime, các module có chủ sở hữu rõ và adapter tại những seam thực sự cần thay đổi hành vi. Phân tách runtime/sandbox theo project vẫn được giữ theo hướng isolation hiện có.

## Cách đọc và từ vựng

Tài liệu phân biệt ba loại phát biểu:

- **Hiện trạng:** đã đối chiếu trong source, không đồng nghĩa đã kiểm chứng live.
- **Đề xuất:** hướng thiết kế được khuyến nghị, chưa phải implementation hoặc quyết định đã phê duyệt.
- **Cần chốt:** lựa chọn sản phẩm hoặc kỹ thuật còn ảnh hưởng đáng kể tới phạm vi.

Các thuật ngữ kiến trúc được dùng nhất quán:

| Thuật ngữ | Ý nghĩa trong tài liệu |
| --- | --- |
| **module** | Một phần hệ thống có interface và implementation; có thể là feature, package hoặc một luồng xuyên nhiều thư mục. |
| **interface** | Mọi điều caller phải biết để sử dụng module đúng: dữ liệu, invariant, thứ tự thao tác, lỗi và cấu hình. |
| **depth** | Khả năng module che giấu nhiều hành vi sau một interface nhỏ. |
| **seam** | Nơi có thể thay đổi hành vi thông qua interface mà không sửa caller. |
| **adapter** | Implementation cụ thể đáp ứng interface tại một seam. |
| **locality** | Tri thức, thay đổi và kiểm chứng tập trung ở owning module. |
| **leverage** | Một implementation đem lại giá trị cho nhiều caller và nhiều kiểm thử. |

Ba phép kiểm tra cho mọi đề xuất:

1. **Deletion test:** nếu bỏ module, caller có phải tái dựng tri thức và hành vi mà nó đang che giấu không? Chỉ đổi chỗ hoặc đổi tên file không làm tăng depth.
2. **Interface là test surface:** kiểm thử đi qua cùng seam mà caller thực sự sử dụng, không chỉ kiểm tra các helper bên trong.
3. **Một adapter là seam giả thuyết; hai adapter là seam có nhu cầu thật:** không dựng hệ thống mở rộng chỉ vì có thể sẽ cần trong tương lai.

Các khái niệm evidence tuân theo [GLOSSARY.md](../../GLOSSARY.md): recorded claim, evidence reference, producer lineage, agent instance, scanner capture và retest observation là những thứ khác nhau. Những tên mới như Access hay Reproduction package bên dưới là từ vựng đề xuất; cần thống nhất nghĩa trước khi đưa vào glossary chính thức.

## 1. Chốt hành vi sản phẩm trước khi tối ưu cấu trúc

### 1.1. Vấn đề cần giải quyết

Các tính năng hiện đang được phát triển qua nhiều đường: agent tạo file, runtime giữ trạng thái, Web giữ business records và giao diện có cả demo lẫn backend-backed implementation. Nếu đầu ra sử dụng được chưa được xác định, mỗi trang dễ bổ sung mapping và state riêng để lấp khoảng trống.

Asset Map làm lộ rõ vấn đề này: muốn nối asset với finding, evidence hoặc access thì identity và quan hệ phải có nghĩa nhất quán xuyên suốt hệ thống. Một đồ thị đẹp không tự tạo ra những quan hệ còn thiếu.

Vì vậy, thứ cần chốt trước là khả năng người dùng nhận được, nguồn dữ liệu chứng minh khả năng đó và trạng thái phải được lưu.

### 1.2. Bốn hành vi nền tảng

| Khu vực | Hành vi người dùng cần có | Điều kiện dữ liệu và trạng thái |
| --- | --- | --- |
| **Asset Map** | Quan sát tài sản và quan hệ; từ tài sản đi tới finding, evidence và access liên quan. | Asset identity ổn định, quan hệ có nguồn, kết quả phân trang/truncation được biểu đạt rõ. |
| **Access/Console** | Chọn một access đã tồn tại và mở giao diện tương tác tới đúng máy/session. | Access identity, provider/session binding, target binding và trạng thái kết nối được quan sát. |
| **Finding** | Hiểu vấn đề, xem chứng cứ và có cách tái hiện sử dụng được. | Recorded claim, evidence reference, reproduction artifact và kết quả kiểm chứng được phân biệt. |
| **Agent** | Tạo dữ liệu và artifact đủ để các thao tác trên hoạt động. | Đầu ra có identity, quan hệ, artifact references và trạng thái đúng với điều thực sự đã xảy ra. |

### 1.3. Phân chia authority

| Nội dung | Authority hiện tại cần giữ |
| --- | --- |
| Project ownership, membership, business workflow, request intent | Fastify control plane và PostgreSQL/Prisma. |
| Thread/run execution, checkpoints, OPPLAN và agent execution state | Python runtime và các persisted stores thuộc runtime. |
| Asset catalog identity metadata, lifecycle và scope binding | PostgreSQL; deterministic asset ID theo quy tắc ở Core. |
| Observed relations và evidence references trong engagement knowledge | Neo4j theo các quy tắc ghi nhận của runtime. |
| Scanner capture, script và các retained artifact bytes | Workspace/artifact authority cùng metadata và integrity tương ứng. |
| Trạng thái session hoặc command do C2 thực thi | Provider observation; control plane giữ các record, binding và ledger thuộc trách nhiệm của mình. |

Không suy ra finding đã xác minh từ việc nó xuất hiện trong graph; không suy ra session có thể tương tác chỉ vì một asset được đánh dấu có access; không dùng browser state thay cho trạng thái execution.

### 1.4. Định hướng kiến trúc

Mỗi hành vi có owning module và interface theo mục đích sử dụng. Các adapter hấp thụ khác biệt transport/provider tại seam phù hợp. Depth nằm ở việc caller không phải tự nối identity và đoán trạng thái; locality giúp sửa một hành vi tại một nơi; leverage cho phép Asset Map, trang detail, Web và CLI dùng lại cùng ngữ nghĩa.

**Điều kiện chốt một luồng:** mô tả được thao tác thành công, trường hợp không khả dụng, nguồn dữ liệu, record cần lưu và acceptance check xuyên suốt. Không cần đóng băng toàn bộ mô hình cho mọi tính năng tương lai.

## 2. Hiểu đúng `src/real/` và vai trò của mock/demo

### 2.1. Hiện trạng

Web có hai data mode:

- **Mock:** dữ liệu seed, clock và hành vi mô phỏng trong browser; có thể chạy độc lập.
- **Real:** dùng transport tới control plane và các record/runtime thực tế.

`src/App.tsx` chọn composition trước khi mount. `src/real/mode.ts` giải quyết mode theo thứ tự query parameter → localStorage → build configuration → mặc định `mock`.

Mock là công cụ demo, phát triển và kiểm thử. Nó không phải dữ liệu dự phòng khi backend lỗi. Real mode phải biểu đạt rõ trạng thái unavailable hoặc failure theo [ADR-0068](../adr/0068-web-frontend-real-mode-data-boundary.md).

### 2.2. Vì sao cách tổ chức hiện tại gây rối

`src/real/` không chỉ chứa transport. Nó còn chứa session, request recovery, feature adapters, screens, shell, formatting và Markdown rendering. Cùng một domain vì thế trải qua `features/`, `screens/` và `real/`.

Điều này làm người phát triển phải biết mode trước khi biết owning module của hành vi cần sửa. Một phần presentation còn tồn tại theo hai implementation, khiến một thay đổi UX cần sửa song song.

Tuy nhiên, không nên coi toàn bộ Web là hai cây tách biệt hoàn toàn: source được khảo sát đã có 19 migrated route key dùng chung screen và 16 feature ports trong real adapter factory. Những phần đó là nền tảng để tiếp tục.

### 2.3. Hướng đề xuất

```text
Presentation theo domain
         ↓
Feature module / interface theo hành vi
         ↓ seam dữ liệu
Backend adapter       Demo adapter
```

Hai adapter thực sự tồn tại nên seam này có cơ sở. Mục tiêu là một presentation implementation cho cùng hành vi sản phẩm, không phải ép mọi demo behavior thành runtime behavior tương đương.

- Feature-specific mapping, query và remote calls thuộc owning feature.
- HTTP/session/streaming dùng chung thuộc phần hạ tầng browser dùng chung.
- Seed, clock, reset và demo-only composition thuộc `demo/`.
- Presentation không lựa chọn backend/demo cho từng thao tác.
- Unknown, unavailable, refused và uncertain là các trạng thái có nghĩa, không được đổi thành dữ liệu demo hoặc thành công giả.

Depth tăng khi interface che giấu khác biệt dữ liệu; locality tăng khi tri thức domain ở một module; leverage đến từ dùng chung presentation và acceptance tests. Chỉ đổi tên `real/` thành một thư mục khác mà giữ nội dung trộn lẫn không đạt mục tiêu này.

### 2.4. Acceptance check

- Cùng hành vi có cùng rendering và cùng ngữ nghĩa trạng thái qua hai adapter.
- Real outage không tạo hoặc đọc demo authority.
- Chuyển project không khôi phục cache, thread hoặc selection của project khác.
- Demo-only thao tác như reset clock không đi vào production feature interface.
- Một feature được hợp nhất thực sự bỏ được presentation implementation trùng; không chỉ gom hai nhánh mode vào một file lớn.

## 3. Access/Console: từ access đã có tới tương tác trên Web

### 3.1. Mục tiêu sản phẩm

Người dùng muốn chọn máy mà hệ thống đã có access và mở giao diện tương tác ngay trên Web bằng một thao tác. Tên provider là chi tiết implementation; thao tác chính là sử dụng một access cụ thể.

Từ vựng đề xuất:

- **Access:** một đường truy cập được ghi nhận tới một tài sản, dưới một identity/quyền và điều kiện cụ thể.
- **Interactive console:** một phiên tương tác operator mở hoặc attach qua access đó.

Một host có thể có nhiều access, nhiều session và nhiều user. Do đó asset identity không thể thay thế access/session identity.

### 3.2. Hiện trạng và khoảng trống

| Nội dung | Hiện trạng source | Khoảng trống với mục tiêu |
| --- | --- | --- |
| Danh sách C2 session | Web đọc scoped provider registry. | Cần nối access/session tới đúng asset và hiển thị hành động phù hợp. |
| Thực thi command | Nhập session ID, absolute binary path và arguments; gửi single-shot command. | Chưa phải shell giữ trạng thái hoặc terminal PTY. |
| Command history | Có durable ledger, trạng thái uncertain và reconcile. | Ledger không tự trở thành interactive transcript. |
| Access do agent tạo | Prompt phân biệt Sliver operator state của agent với Web lab bridge. | Session agent có không mặc nhiên xuất hiện trong provider mà Web đọc. |
| Interactive shell | ADR-0036 loại `Shell`/PTY khỏi phạm vi. | Đây là thay đổi khả năng thực sự, cần quyết định mới trước triển khai. |

Nguồn chính: `features/c2/provider-console.tsx`, `server/src/services/c2-service.ts`, `server/src/integrations/c2/sliver-client.ts` và `standard/raptix.md:197–204`.

### 3.3. Luồng đích

```text
Agent / provider ghi nhận access
          ↓
Access có binding tới project + asset + provider session
          ↓
Asset Map / Access list / Asset detail
          ↓ “Open console”
Quan sát trạng thái và khả năng tương tác hiện tại
          ↓
Mở hoặc attach console đúng session
          ↓
Tương tác → disconnect → giữ lịch sử thuộc đúng phiên
```

“Open console” không phải dựng URL từ IP. Nó phải sử dụng binding đã biết và trả trạng thái trung thực nếu access mất kết nối, chưa được gán asset hoặc không hỗ trợ tương tác yêu cầu.

### 3.4. Owning module và trách nhiệm

- **Access module:** che giấu việc tra cứu binding, lựa chọn session và chuyển đổi trạng thái access thành thao tác operator có thể dùng.
- **Provider adapter:** thực hiện những thao tác provider thực sự hỗ trợ; không tự phát minh capability.
- **Console presentation:** hiển thị kết nối, input/output và trạng thái phiên; không sở hữu provider credentials hoặc tự suy đoán authorization.
- **Runtime/specialist:** ghi nhận access được thiết lập cùng references thực tế; không chỉ trả câu “đã có shell”.

Interface theo mục đích sử dụng nằm tại seam của Access module. Depth giữ provider knowledge bên trong; locality tập trung trạng thái và binding; leverage cho phép nhiều điểm vào dùng cùng hành vi. Giai đoạn đầu chỉ cần implementation Sliver đang có; provider thứ hai chưa tồn tại không phải lý do dựng framework mở rộng.

### 3.5. Các lựa chọn cần chốt và quyết định đã ghi nhận

1. **Mức tương tác:** console gửi lệnh liên tiếp hay terminal PTY giữ `cd`, environment, chương trình tương tác và Ctrl+C? Người dùng chưa xác nhận lựa chọn cuối cùng.
2. **Nguồn session:** Web và agent dùng chung provider namespace hay cần bước đăng ký/binding từ runtime sang control plane? Source hiện tại chưa chứng minh chúng đã nối với nhau.
3. **Vòng đời phiên:** đóng tab có chỉ detach hay kết thúc console? Mất mạng/reload có attach lại được không?
4. **Tranh chấp sử dụng:** agent và operator có được tương tác đồng thời trên cùng session không? Nếu không, ai giữ quyền sử dụng và trong bao lâu?
5. **Dữ liệu lưu:** metadata, command outcomes và interactive transcript được giữ ở đâu, với giới hạn và liên hệ evidence như thế nào?

**Quyết định của chủ dự án (2026-10-21):** ghi nhận làm căn cứ, chưa phải ADR.

1. **Mức tương tác:** PTY đầy đủ, giữ `cd`, environment và hỗ trợ Ctrl+C. Hệ quả: đảo ngược phạm vi loại trừ của ADR-0036; cần ADR mới (hoặc sửa phạm vi ADR-0036) được chấp nhận trước khi triển khai.
2. **Nguồn session:** Web và agent dùng chung provider, namespace theo project. Binding asset ↔ session là bắt buộc; không suy session ID từ mô tả.
3. **Vòng đời:** đóng tab là detach. Reload hoặc mất mạng được attach lại nếu session còn sống. Kết thúc session bằng nút riêng.
4. **Tranh chấp:** tại một thời điểm chỉ một bên điều khiển; khi operator tiếp quản, agent nhường.
5. **Lưu trữ:** PostgreSQL giữ metadata và outcome; transcript nằm trong artifacts. Đề xuất tối đa 100 MiB mỗi phiên, giữ 30 ngày, báo rõ khi chạm giới hạn.

### 3.6. Acceptance check

- Một access thực tế được ghi nhận và xuất hiện trên đúng project/asset.
- Một click mở đúng session và identity; không cần nhập lại session ID thủ công.
- Kiểu tương tác đã chọn hoạt động thực sự qua provider, không chỉ render terminal-looking UI.
- Mất session hoặc provider unavailable được phản ánh rõ; không attach sang session khác.
- Đóng/reload/mất mạng tuân theo vòng đời đã thống nhất.
- Các grant, scope, emergency-stop và authorization semantics hiện có được giữ khi thêm đường tương tác mới.

### 3.7. ADR liên quan

[ADR-0036](../adr/0036-sliver-c2-bridge.md) hiện là Proposed và mô tả phạm vi single-shot command, loại interactive Shell/PTY. Yêu cầu mới đủ cụ thể để cần một ADR bổ sung hoặc thay thế phần phạm vi đó nếu chọn PTY; không được coi đây là thay UI thuần túy.

## 4. Finding: một gói tái hiện sử dụng được

### 4.1. Mục tiêu sản phẩm

Finding không chỉ trả lời “có vấn đề gì”, mà còn giúp operator hiểu vì sao tin vào claim và làm thế nào để tái hiện. Việc này cần dữ liệu có cấu trúc và artifact references, không chỉ thêm một ô văn bản tên PoC.

### 4.2. Bốn khái niệm phải tách biệt

| Khái niệm | Trả lời câu hỏi |
| --- | --- |
| **Recorded claim** | Hệ thống khẳng định vấn đề gì? |
| **Evidence reference** | Chứng cứ retained nào hỗ trợ claim? |
| **Reproduction package** — tên đề xuất | Operator cần điều kiện, bước và artifact nào để tái hiện? |
| **Kết quả một lần tái hiện** | Đã chạy phiên bản nào, ở đâu, lúc nào và quan sát được gì? |

Một finding có thể có nhiều phiên bản reproduction package và nhiều lần tái hiện. Thành công trong một môi trường không bảo đảm cùng kết quả trên mọi target/version hoặc ở thời điểm khác.

### 4.3. Nền tảng hiện có

- Core `Finding` đã có `steps_to_reproduce` và evidence references trong `raptix_core/types/engagement.py`.
- Runtime có implementation PoC validation tại `execution/tools/research/poc.py`.
- Finding workflow trên Web có curated records, evidence links, history, review và retest.
- Shared curated view hiện chưa biểu đạt một reproduction package tương ứng với nhu cầu trên.

Đây là khoảng trống xuyên các module, không phải bằng chứng toàn hệ thống chưa có PoC. Tool implementation cũng không chứng minh tool đã được lắp vào mọi role hoặc đã tạo ra PoC chạy được trong các run thực tế.

### 4.4. Nội dung một gói tái hiện

| Nội dung | Yêu cầu về ý nghĩa |
| --- | --- |
| Điều kiện tiên quyết | Role, quyền, trạng thái đăng nhập, dữ liệu ban đầu hoặc version liên quan. |
| Target/input | Những giá trị người dùng phải cung cấp hoặc thay thế. |
| Bước thực hiện | Thứ tự thao tác đủ để một operator khác làm lại. |
| Artifact | Script, request, collection, file hoặc hướng dẫn thủ công có identity/version. |
| Expected observation | Dấu hiệu để phân biệt tái hiện thành công với không thành công. |
| Lần kiểm chứng | Phiên bản artifact, execution reference, thời điểm, kết quả và evidence references. |
| Giới hạn | Điều kiện chưa kiểm chứng, dependencies hoặc lý do chưa có cách tái hiện tự động. |

Không ép mọi finding thành script. Lỗi logic/quy trình có thể cần thao tác thủ công. Mức tối thiểu là một cách tái hiện hữu dụng, đủ điều kiện và không tự nhận đã chạy nếu chưa có kết quả thực tế.

### 4.5. Trình bày trên Web

```text
Finding detail
├── Overview
├── Evidence
├── Reproduce
│   ├── Preconditions
│   ├── Inputs
│   ├── Steps / request / script
│   ├── Copy / Download
│   └── Previous verification
└── Review / Retest
```

Copy/Download và thực thi lại là hai mức khác nhau. Nếu bổ sung thao tác chạy lại, nó tạo một execution mới gắn với phiên bản reproduction đã chọn; không ghi đè kết quả cũ và không mặc nhiên chuyển finding sang confirmed/resolved.

### 4.6. Định hướng module

Finding reproduction module sở hữu quan hệ giữa package, phiên bản và kết quả tái hiện. Interface cho xem/xuất/theo dõi kết quả nằm tại seam dùng bởi Web, report và luồng retest. Artifact adapter và runtime adapter hấp thụ I/O tương ứng. Depth che giấu version/provenance; locality tập trung quy tắc; leverage tránh mỗi caller diễn giải PoC theo một cách.

### 4.7. Acceptance check

- Finding detail có điều kiện, bước và artifact tái hiện tương ứng khi tồn tại.
- Copy/Download lấy đúng retained artifact/version và tuân theo access semantics hiện có.
- Chưa có PoC hoặc chưa kiểm chứng được biểu đạt rõ; không sinh lịch sử giả từ narrative.
- Một lần chạy lại tham chiếu đúng package version và lưu outcome/evidence mới.
- Reviewer confirmation và retest resolution giữ nghĩa riêng theo [ADR-0088](../adr/0088-persist-versioned-finding-workflow-records.md).

**Đã chốt (2026-10-21):** giai đoạn đầu chỉ Copy/Download; chạy lại là execution mới làm sau. Mức tối thiểu của package gồm điều kiện tiên quyết, đầu vào, bước thực hiện, kết quả mong đợi, artifact/version và trạng thái kiểm chứng; finding thủ công không bắt buộc có script. **Còn mở:** cấu trúc hóa các trường đó cho finding thủ công (cần đổi contract và backend); quy tắc versioning; cách migration findings cũ không có package.

## 5. Prompt, contract và implementation phải cùng thay đổi

### 5.1. Vì sao không chỉ sửa một `raptix.md`

Prompt hiện được lắp từ nhiều nguồn:

- `intelligence/prompts/standard/raptix.md`: identity và quy tắc orchestrator.
- `intelligence/prompts/workflows/raptix.md`: workflow được builder ghép vào prompt.
- `intelligence/prompts/builder.py`: fragment và pointer, gồm yêu cầu load finding-protocol.
- Specialist prompts và skills: hướng dẫn thực hiện domain work và tạo đầu ra.

Do đó sửa riêng orchestrator prompt chưa bảo đảm specialist tạo đúng file hoặc runtime ghi đúng binding. Workflow source còn có các chỉ dẫn cần đối chiếu với thiết kế mới, chẳng hạn workspace cố định và model-supplied engagement name; identity hiện phải đến từ trusted run configuration theo [ADR-0090](../adr/0090-trusted-engagement-identity-and-operator-grants.md).

### 5.2. Phân trách nhiệm

| Nơi | Trách nhiệm đề xuất |
| --- | --- |
| Orchestrator prompt | Yêu cầu deliverable phù hợp, giao việc và đánh giá đầu ra; yêu cầu specialist bổ sung phần thiếu. |
| Specialist prompt/skill | Quy trình tạo reproduction artifact, giữ evidence, ghi nhận access và bàn giao references. |
| Contract/validation | Kiểm tra hình dạng, identity, version, artifact existence/reference và quan hệ hợp lệ. |
| Runtime implementation | Thực thi, ghi kết quả quan sát và lưu trạng thái thuộc runtime. |
| Control plane | Giữ business records, ownership, binding, request lifecycle và các kiểm tra thuộc authority của nó. |
| Web/CLI | Trình bày và thao tác qua interface của owning module; không tự suy ra kết quả execution. |

### 5.3. Hai đầu ra cần làm rõ trong prompt

**Khi bàn giao access:** specialist phải phân biệt claim có access với session đã được provider quan sát; cung cấp references đủ để hệ thống gắn đúng project/asset/session. Orchestrator không tự dựng provider session ID từ lời mô tả.

**Khi tạo finding:** specialist cung cấp reproduction artifacts/steps và trạng thái kiểm chứng. Nếu không tái hiện được hoặc chỉ có bước thủ công, ghi rõ giới hạn. Evidence và PoC phải được liên kết thay vì chỉ nhắc tên trong report.

Prompt định hướng hành vi; implementation xác lập trạng thái. Validation cấu trúc/file không chứng minh exploit thành công; một lời khẳng định của model cũng không thay kết quả thực thi.

### 5.4. Hướng làm sâu

Đặt interface đầu ra rõ tại seam bàn giao specialist; prompt và tool adapter tuân theo cùng ngữ nghĩa. Depth đến từ các invariant được implementation bảo đảm; locality của deliverable rules nằm ở owning module/skill; leverage giúp nhiều role tạo ra đầu ra dùng chung cho Web và report.

Không dồn toàn bộ quy tắc domain vào orchestrator prompt. Các thay đổi prompt phải được đánh giá trên prompt đã lắp cho đúng role/profile và bằng run thực tế, không chỉ kiểm tra file Markdown riêng lẻ.

### 5.5. Acceptance check

- Prompt đã lắp không giữ các chỉ dẫn mâu thuẫn về trusted identity và workspace.
- Specialist tạo artifact và references mà luồng Web thực sự đọc được.
- Thiếu artifact/binding được ghi nhận như thiếu đầu ra, không nâng thành trạng thái thành công.
- Kiểm chứng một run có finding và một run có access, đối chiếu output với persisted records và thao tác operator.

## 6. Cấu trúc đích: feature-first, migration tăng dần

### 6.1. Mục tiêu

Cấu trúc phải giúp trả lời nhanh ba câu hỏi:

1. Hành vi này thuộc module nào?
2. Caller đi qua interface nào và adapter nào thực hiện I/O?
3. Muốn thêm trang hoặc thay presentation thì có phải chạm domain implementation không?

Đề xuất tận dụng cấu trúc hiện có, giữ route/state/UI foundation và di chuyển từng feature khi có thay đổi hành vi tương ứng.

### 6.2. Cấu trúc cấp hệ thống

```text
apps/
├── web/
│   ├── src/                    # browser presentation và feature modules
│   └── server/                 # control plane chung; giữ vị trí hiện tại
├── cli/                        # terminal caller của cùng control plane
├── launcher/                   # bootstrap và host environment controller
└── shared/
    ├── web-contracts/          # shared wire semantics hiện có
    └── streaming/              # shared streaming machinery hiện có

packages/
├── raptix-core/                # framework-free contracts
├── raptix/                     # Python runtime implementation
├── raptix-sdk/                 # extension composition theo rules hiện có
└── raptix-skills/              # skill corpus
```

Luồng hội thoại CLI và Web hiện đã hội tụ vào Fastify. Việc `server/` nằm dưới `apps/web/` gây cảm giác Web sở hữu backend riêng, nhưng chưa cần chuyển package để xác định đúng vai trò control plane chung. Đổi vị trí là một bước tổ chức có thể xét sau, không phải điều kiện để nối Access/Console hay Finding reproduction.

### 6.3. Cấu trúc Web đề xuất

```text
apps/web/src/
├── App.tsx
├── router/                     # registry, navigation, route composition hiện có
├── state/                      # composition, identity, Query context dùng chung
├── platform/                   # browser machinery thực sự dùng chung
│   ├── transport/              # HTTP, error decoding, cancellation
│   ├── session/                # authentication/session lifecycle
│   └── streaming/              # connection, cursor, reconnect/replay machinery
├── features/
│   ├── asset-map/
│   ├── access/                 # tên đề xuất; bắt đầu từ C2 implementation hiện có
│   ├── findings/
│   ├── execution/
│   └── ...
├── demo/                       # seed, clock, reset, demo-only composition
├── domain/                     # shared domain definitions còn được dùng
└── ui/                         # presentation primitives dùng chung
```

Đây là sơ đồ đích về ownership, không phải yêu cầu tạo ngay tất cả thư mục hoặc đồng loạt di chuyển file. `access/` là tên đang đề xuất, không phải một domain đã được chốt.

### 6.4. Hình dạng một feature

Ví dụ cho Finding, không phải template bắt buộc cho mọi module:

```text
features/findings/
├── index.ts                    # entry cho caller bên ngoài feature
├── model.ts                    # domain/presentation model thuộc feature
├── query.ts                    # query và mutation behavior
├── remote.ts                   # backend adapter, mapping feature-specific
├── pages/                      # route-level composition nếu cần
├── views/                      # presentation dùng lại nếu cần
├── reproduction/               # chỉ tạo khi đủ hành vi để có locality riêng
└── *.test.*                    # tests colocated với owning behavior
```

Không bắt buộc đổi `service.ts` hiện có thành `model.ts`, hoặc đổi mọi file sang tên mới để khớp sơ đồ. Giữ tên đang có nếu module đã đúng ownership. Chỉ tạo thư mục con khi nó che giấu một phần complexity có thật.

Module feature cung cấp interface cho caller; seam dữ liệu có backend/demo adapter khi hai implementation thực sự cần dùng. Depth giữ domain knowledge bên trong; locality giảm số nơi cần đọc/sửa; leverage cho phép route, project tab và drawer dùng cùng hành vi.

### 6.5. Nội dung hiện ở `real/` sẽ đi đâu?

| Nhóm hiện tại | Hướng ownership đề xuất |
| --- | --- |
| `transport.ts`, error/request machinery dùng chung | `platform/transport/`; giữ browser-specific semantics. |
| Authentication/session lifecycle | `platform/session/` hoặc phần composition hiện có tùy trách nhiệm cụ thể. |
| Streaming connection/cursor/replay dùng chung | `platform/streaming/`; feature-specific reduction vẫn thuộc feature. |
| Endpoint calls, validators và mappings của từng feature | Owning feature; validator dùng chung Web/CLI có thể thuộc shared contracts hiện có. |
| `service-adapter/findings.ts` và các adapter tương tự | Owning feature, di chuyển theo slice khi đã xác nhận callers/tests. |
| `real/screens/*` | Hợp nhất với owning feature presentation khi semantics tương đương; bỏ implementation trùng sau acceptance. |
| Formatting/Markdown rendering | Presentation module phù hợp; chỉ dùng chung khi có callers thực sự dùng chung. |
| Bootstrap và mode selection | Composition tại `App.tsx`/`state`; demo-only bootstrap thuộc `demo/`. |

Request recovery có thể là phần dùng chung nếu semantics đồng nhất; payload/finding/capture-specific state không được gom vào một session module tổng quát chỉ vì hiện nằm cạnh nhau.

### 6.6. Quy tắc dependency và ownership

- `platform/` không sở hữu finding lifecycle, asset identity, access binding hoặc OPPLAN.
- Presentation gọi owning feature interface; không import Prisma, server implementation hay demo database.
- Cross-feature caller dùng entry của feature, shared domain identity hoặc shared contract có chủ rõ; không đi sâu tùy ý vào implementation của feature khác.
- Core giữ framework-free; runtime-dependent implementation không được chuyển vào Core để tiện share.
- Browser I/O adapter và Node I/O adapter có thể khác nhau. Chỉ chia sẻ semantic validation/recovery khi thật sự cùng nghĩa.
- Không thêm một global module có interface bao trùm mọi feature. Dùng composition để ghép các module sâu, không gom domain thành một interface khổng lồ.

### 6.7. Khi muốn thêm một trang mới

| Loại thay đổi | Cách thực hiện |
| --- | --- |
| Cách nhìn mới của dữ liệu đã có | Thêm presentation trong owning feature, khai báo route/navigation và kiểm thử hành vi. |
| Tab hoặc drawer dùng cùng hành vi | Dùng lại feature module; route chỉ cung cấp context/identity phù hợp. |
| Hành vi mới trong domain đã có | Mở rộng owning module và adapter tương ứng; chốt dữ liệu/acceptance cho slice đó. |
| Domain mới thực sự | Tạo module mới sau khi xác định trách nhiệm và quan hệ với các module hiện tại. |

Ví dụ: một trang liệt kê các access còn hoạt động và nút mở console dùng Access module; một action từ Asset Map cũng dùng module đó. Hai điểm vào không tạo hai console lifecycle implementation.

Một feature page mới không mặc nhiên có một server, một real screen, một demo model và một trạng thái execution riêng. Registry tĩnh hiện có là đủ cho giai đoạn này; chưa có nhu cầu đã chứng minh cho dynamic plugin framework hoặc page builder.

### 6.8. Migration ít xáo trộn

1. Chọn một luồng sản phẩm và owning feature; xác nhận caller, authority và acceptance trước.
2. Dùng hoặc làm sâu interface hiện có; thêm adapter behavior cần cho luồng.
3. Đặt logic mới đúng ownership; không thêm nhánh presentation mới vào `real/`.
4. Chuyển phần liên quan từ `real/` sang owning module, cập nhật callers trong cùng slice.
5. Kiểm chứng hành vi xuyên seam rồi xóa implementation cũ khi không còn caller.
6. Lặp lại; chỉ bỏ thư mục `real/` khi đã phân loại và xử lý hết nội dung.

Không duy trì song song hai authority hoặc hai execution lifecycle để hỗ trợ migration. Các PR giữ một concern, giới hạn runtime lines/files theo contribution contract; không trộn thay đổi packaging với feature behavior.

## 7. Thứ tự triển khai được khuyến nghị

### Bước 1 — Chốt các quyết định đang ảnh hưởng thiết kế

| Quyết định | Trạng thái |
| --- | --- |
| Bốn hành vi nền tảng ở mục 1 | Định hướng đề xuất từ thảo luận; cần dùng làm tiêu chí cho từng slice. |
| Backend/demo là adapter, không phải hai ứng dụng sản phẩm | Hướng tái cấu trúc được khuyến nghị; chưa thực hiện migration. |
| Terminal PTY hay command console | Đã chốt PTY đầy đủ (§3.5); cần ADR trước khi triển khai. |
| Cách nối session agent với Web provider | Đã chốt: chung provider, namespace theo project, binding asset ↔ session bắt buộc (§3.5). |
| Điều kiện tối thiểu của reproduction package | Đã chốt tối thiểu (§4.7); chưa cấu trúc hóa cho finding thủ công. |
| Copy/Download trước hay gồm thực thi lại trong mốc đầu | Đã chốt: Copy/Download trước; chạy lại làm sau (§4.7). |
| Cấu trúc feature-first và giảm dần `real/` | Cấu trúc đích đề xuất; không yêu cầu bulk move. |

### Bước 2 — Tracer bullet Access/Console

> Agent có access → access hiện trên đúng asset → operator bấm mở console đúng session.

Luồng này chứng minh được identity, provider wiring, prompt handoff và Web interaction cùng hoạt động. Acceptance dựa trên access/provider thực tế, không dựa vào một terminal UI chạy với fixture.

### Bước 3 — Finding reproduction

> Specialist tạo finding cùng reproduction artifact → hệ thống lưu references/version → operator xem, copy/download và kiểm tra kết quả đã có.

Nếu chọn bổ sung chạy lại, triển khai như một execution mới có provenance, không suy diễn thành retest resolution tự động.

### Bước 4 — Hợp nhất presentation và dọn cấu trúc theo feature

Mỗi slice đã được chứng minh sẽ kéo phần tương ứng ra khỏi `real/`. Tiếp tục dùng route/state/UI foundation đang có; bỏ code trùng khi đã có acceptance, thay vì di chuyển toàn repo trước.

**Đích cần đo:** ít nơi chứa cùng domain knowledge hơn, caller ít assumptions hơn, tests đi qua đúng interface và thao tác operator hoạt động xuyên suốt. Số thư mục hoặc số abstraction không phải thước đo thành công.

## 8. Những quyết định kiến trúc cần giữ và đối chiếu

| Tài liệu | Ràng buộc hoặc tác động |
| --- | --- |
| [Runtime ownership](../architecture/runtime-boundaries.md) và [dependency rules](../architecture/dependency-rules.md) | Runtime giữ mission/execution; Core framework-free; apps không đi sâu vào runtime implementation. |
| [ADR-0036](../adr/0036-sliver-c2-bridge.md) — Proposed | Single-shot execution hiện có; interactive Shell/PTY ngoài phạm vi cũ. |
| [ADR-0068](../adr/0068-web-frontend-real-mode-data-boundary.md) — Proposed | Real mode không fallback demo; một authority theo mode. |
| [ADR-0084](../adr/0084-real-service-adapter-boundary.md) — Proposed | Feature seam và presentation unification; trạng thái prose cần đối chiếu với adapter đã có trong source. |
| [ADR-0086](../adr/0086-per-run-sandbox-workspace-isolation.md) — Accepted | Giữ isolation thực bằng sandbox mount theo project; prefix check không đủ để cô lập bash. |
| [ADR-0088](../adr/0088-persist-versioned-finding-workflow-records.md) — Accepted | Finding workflow versioned; review, history, evidence và retest có semantics riêng. |
| [ADR-0090](../adr/0090-trusted-engagement-identity-and-operator-grants.md) — Accepted | Trusted engagement identity và operator grants; model không tự xác lập identity. |
| [ADR-0091](../adr/0091-handoff-authorizes-execution.md) — Accepted | Giữ hai đường authorization tương ứng planning handoff và governed business plan. |
| [ADR-0092](../adr/0092-single-active-project-environments.md) — Proposed | Hướng runtime/sandbox theo project và admission chung; migration/acceptance chưa đồng nghĩa hoàn tất. |
| [ADR-0093](../adr/0093-environment-packaging-and-controller-bootstrap.md) — Accepted, Windows scope | Host controller và image policy; retirement legacy là quyết định riêng. |
| [ADR-0094](../adr/0094-asset-identity-authority.md) — Accepted | PostgreSQL catalog, deterministic asset identity, Neo4j relations và artifacts bytes giữ trách nhiệm khác nhau. |

Tài liệu này không thay thế các ADR. Khi một interface công khai hoặc module seam mới được chốt để triển khai, ghi Proposed ADR theo quy định repo. Không dùng việc source đã tồn tại để tự nâng trạng thái một ADR thành Accepted.

## 9. Điểm neo source và giới hạn đánh giá

Các đường dẫn dưới đây được dùng để đối chiếu hiện trạng; line numbers có thể thay đổi sau snapshot:

| Chủ đề | Source |
| --- | --- |
| CLI conversation qua control plane | [agentTransport.ts](../../apps/cli/src/transport/agentTransport.ts), [facadeClient.ts](../../apps/cli/src/transport/facadeClient.ts). |
| Project-aware runtime routing | [runtime-router.ts](../../apps/web/server/src/integrations/runtime/runtime-router.ts). |
| Web data mode/composition | [mode.ts](../../apps/web/src/real/mode.ts), [App.tsx](../../apps/web/src/App.tsx). |
| Presentation migration hiện tại | [route-table.ts](../../apps/web/src/router/route-table.ts), [real adapter factory](../../apps/web/src/real/service-adapter/index.ts). |
| C2 presentation và command form | [provider-tab.tsx](../../apps/web/src/features/c2/provider-tab.tsx), [provider-console.tsx](../../apps/web/src/features/c2/provider-console.tsx). |
| C2 command/session implementation | [c2-service.ts](../../apps/web/server/src/services/c2-service.ts), [sliver-client.ts](../../apps/web/server/src/integrations/c2/sliver-client.ts), [Sliver bridge](../../infra/containers/sliver-bridge/sliver_bridge.py). |
| Core Finding | [engagement.py](../../packages/raptix-core/raptix_core/types/engagement.py). |
| PoC validation implementation | [poc.py](../../packages/raptix/raptix/execution/tools/research/poc.py). |
| Curated Finding contract | [finding-workflow.ts](../../apps/shared/web-contracts/src/finding-workflow.ts). |
| Finding mapping trên Web | [findings.ts](../../apps/web/src/real/service-adapter/findings.ts). |
| Orchestrator và workflow prompt | [standard/raptix.md](../../packages/raptix/raptix/intelligence/prompts/standard/raptix.md), [workflows/raptix.md](../../packages/raptix/raptix/intelligence/prompts/workflows/raptix.md). |
| Prompt assembly | [builder.py](../../packages/raptix/raptix/intelligence/prompts/builder.py), [agent factory](../../packages/raptix/raptix/intelligence/agents/standard/raptix.py). |

Integration history phải được đọc cùng [spec](../../apps/web/.scratch/frontend-backend-integration/spec.md), [coverage](../../apps/web/.scratch/frontend-backend-integration/coverage.md), [execution contract](../../apps/web/.scratch/frontend-backend-integration/execution.md) và follow-up. Không dùng inventory gap cũ như kết luận về khả năng runtime hiện tại.

Đánh giá này chưa chứng minh throughput, latency, provider availability hoặc kết quả model/tool thực tế. Một implementation tồn tại, một graph được đăng ký hoặc một readiness check thành công không thay thế acceptance của các luồng sản phẩm đã nêu.

## Kết luận

Ưu tiên là làm cho đầu ra của agent trở thành khả năng operator sử dụng được: asset có quan hệ đúng, access mở được console đúng session, finding có evidence và cách tái hiện đủ dùng. Prompt, contracts, persistence và presentation phải cùng phục vụ những luồng đó.

Cấu trúc feature-first là hệ quả của ownership rõ ràng: mỗi hành vi có một module đủ sâu, interface nhỏ, adapter tại seam có nhu cầu thật, locality tốt và leverage cho nhiều điểm vào. Migration theo từng luồng cho phép đạt đích này mà không phải viết lại hệ thống hoặc đổi tên hàng loạt thư mục trước.
