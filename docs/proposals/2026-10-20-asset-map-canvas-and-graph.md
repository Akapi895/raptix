# Đề xuất Asset Map: canvas, mô hình asset và quản lý graph

- **Trạng thái:** Đề xuất để thảo luận, chưa phê duyệt kiến trúc hay triển khai.
- **Ngày:** 2026-10-20.
- **Cơ sở:** Thảo luận về Execution, asset graph và kiểm tra mã nguồn hiện tại. Chưa chạy live engagement hoặc benchmark graph lớn cho tài liệu này.

## 1. Mục tiêu và quyết định đề xuất

Thay trải nghiệm lấy runtime run/thread làm trung tâm bằng một **Asset Map dạng sơ đồ**, giúp operator trả lời: đã biết gì về môi trường, các tài sản liên quan thế nào, tài sản nào đang được kiểm thử và bằng chứng nằm ở đâu.

Hướng đề xuất:

1. Canvas là sơ đồ có node/card, cạnh và vùng nhóm; không phải danh sách code hoặc cây toggle thay cho sơ đồ.
2. Canvas tổng quan chỉ thể hiện tài sản và quan hệ hữu ích. Sitemap, endpoint inventory, cloud policy, mobile manifest và dữ liệu chi tiết dùng view chuyên biệt.
3. Một mô hình định danh chung liên kết inventory, KG và artifact; mỗi loại tài sản vẫn giữ ngữ nghĩa riêng. IP không phải gốc bắt buộc của cloud, mobile hay identity.
4. Graph lưu quan hệ và tri thức quan sát được; không trở thành kho chứa mọi payload, log và bản sao business state.
5. Với dải IP lớn, tải theo nhóm và vùng quan tâm; không tạo sẵn một node cho từng địa chỉ trong CIDR.
6. Thay vị trí điều hướng Execution bằng Asset Map khi các thao tác cần thiết đã có nơi thay thế. Đưa diagnostics về chi tiết công việc trong AI Workspace; không xóa lịch sử hay API runtime.

**Tiêu chí sản phẩm:** người dùng hiểu tài sản, tiến độ và kết quả mà không phải hiểu `run_id`, `thread_id` hoặc ID nội bộ của Neo4j.

## 2. Hiện trạng đã kiểm tra

| Thành phần | Hiện trạng | Khoảng trống liên quan |
|---|---|---|
| Asset inventory | Prisma `WebAsset`: identifier, kind `host/web_url/ip_range`, scope classification, provenance quản lý cơ bản | Chưa phải catalog đa domain với identity/locator và quan hệ containment thống nhất |
| Knowledge graph | Neo4j qua `KGStore`; node có kind/key/label/properties, cạnh có loại và provenance | Các bên ghi cung cấp key; chưa tự hợp nhất các cách gọi cùng đối tượng |
| Ingest | Agent record, scanner adapters và parser registry; auto-ingest một số định dạng | Không phải mọi tool output đều tự được ingest; độ phủ từng domain cần kiểm chứng |
| Web graph API | Response tối đa 400 node/1.200 cạnh, scoped theo workspace slug và lọc properties | Query giới hạn node trước khi mở cạnh, nhưng gom cạnh trước khi cắt response; chưa bảo đảm traversal bounded hoặc API overview/expand |
| ID trên Web graph | Dùng Neo4j `elementId`; inventory dùng `WebAsset.id` | Chưa có public asset identity chung trong các luồng đã kiểm tra |
| UI graph | Assets liệt kê một phần cạnh; Analysis có technique coverage và chuỗi observed records | Chưa có canvas sơ đồ đa domain và inspector chuyên biệt được nối đầy đủ |
| Web surface | Có ingest Host/Endpoint/Parameter; có proxy tools đọc sitemap Caido | Chưa thấy trải nghiệm sitemap Web hoàn chỉnh nối các nguồn này |
| Execution | Danh sách execution threads/runs, controls và logs; Workspace history dùng lại component đó | Trùng bề mặt, ưu tiên trạng thái hạ tầng thay vì công việc và kết quả |

Hai hiện tượng cần xử lý riêng:

- `<IP>` và `https://<IP>` có thể là hai đối tượng dữ liệu hợp lệ, nhưng không nên thành hai asset ngang hàng không có liên kết trên toàn cảnh.
- Các chuỗi nối trong KG không tự chứng minh đường khai thác. Giữ phân biệt recorded claim, evidence và kết quả đã xác minh theo [glossary](../../GLOSSARY.md).

Những mô hình, tên trường và read operation bên dưới là **thiết kế đề xuất**, không phải contract đã tồn tại.

## 3. Trải nghiệm canvas

### 3.1. Bố cục

| Khu vực | Nội dung và thao tác |
|---|---|
| Thanh công cụ | Tìm IP/domain/resource/app; chọn domain, nhóm và loại quan hệ; fit view, zoom, quay lại focus trước |
| Canvas trung tâm | Node có nhãn nghiệp vụ, cạnh có ý nghĩa, nhóm có ranh giới trực quan; chọn, kéo, pan/zoom và mở rộng tại chỗ |
| Inspector bên phải | Tóm tắt tài sản/quan hệ đã chọn, nguồn, độ mới, finding liên quan và nút mở view chuyên biệt |
| View chi tiết | Vùng riêng đủ rộng cho sitemap, API inventory, cloud policy hoặc mobile components; giữ đường quay lại node và camera trước |
| Chỉ báo dữ liệu | Phân biệt tổng số với phần đang tải; hiện vùng bị giới hạn, nguồn unavailable, dữ liệu cũ và cập nhật mới |

Ở màn hình hẹp, inspector có thể thành drawer. View chi tiết có deep link để chia sẻ theo quyền truy cập hiện có.

### 3.2. Node, cạnh và nhóm

- Node hiển thị hostname/IP, tên ứng dụng, cloud resource name hoặc package identifier; ID kỹ thuật nằm trong diagnostics.
- Card có loại tài sản và các badge tóm tắt phù hợp: số service, finding, hoạt động đang chạy. Chỉ hiện số liệu có nguồn; chưa biết không được diễn đạt thành an toàn hoặc không có finding.
- Services/endpoints mặc định được tóm tắt bên trong hoặc cạnh tài sản cha; mở rộng khi chọn, không bung tất cả khi vào trang.
- Cạnh có nhãn nghiệp vụ như “resolves to”, “exposes”, “calls”, “member of”; chỉ nhóm các cạnh tương đương và vẫn mở được thành viên.
- Nhóm có thể là network segment, cloud account/project/region, application hoặc domain pack. Nhóm để trình bày không tự trở thành asset mới.
- Chọn node/cạnh bằng bàn phím mở cùng inspector như chuột. Có danh sách tài sản tương đương để tìm kiếm và truy cập mà không phụ thuộc thao tác kéo canvas.

### 3.3. Tương tác tối thiểu

1. Chọn nhóm để xem các tài sản bên trong; thu gọn trở lại ngay trên sơ đồ.
2. Chọn node để làm nổi bật các quan hệ lân cận; tải thêm theo loại quan hệ và giới hạn rõ ràng.
3. Mở Sitemap/Services/Permissions/Components từ node tương ứng, không ép tất cả thành node của toàn cảnh.
4. Lọc theo domain, loại, scope, nguồn, độ mới và trạng thái kiểm thử có bằng chứng.
5. Tìm một đối tượng ngoài phần đang tải vẫn định vị được vùng chứa nó.
6. Có overlay hoạt động/finding tùy chọn. Runtime event chỉ cập nhật badge liên quan; không trở thành hàng nghìn node trên bản đồ.
7. Node được ghim hoặc đang chọn giữ vị trí khi có dữ liệu mới. Có thông báo cập nhật thay vì tự bố cục lại toàn màn hình ở mỗi tool call.

Overlay phải nối qua asset references do nguồn sở hữu cung cấp; không suy attribution từ nội dung chat hoặc run mới nhất. Refresh/invalidation cần revision/freshness rõ ràng; có dữ liệu mới không tự xóa camera, selection hoặc saved view của người dùng.

Pan/zoom chỉ hỗ trợ điều hướng. Việc giảm chi tiết còn cần group/expand và tải dữ liệu theo phạm vi; không tải toàn bộ rồi chỉ thu nhỏ hình vẽ.

## 4. Mô hình và cách lưu asset

### 4.1. Phân biệt những đối tượng dễ bị trộn

| Khái niệm | Ý nghĩa |
|---|---|
| Asset/entity | Đối tượng có danh tính và vòng đời: host, application, cloud resource, identity, mobile application |
| Locator | Cách định vị đối tượng: IP, DNS name, URL origin, cloud resource ID hoặc package identifier trong namespace phù hợp |
| Service/surface | Chức năng hoặc bề mặt được cung cấp: TCP service, HTTP origin, API endpoint, mobile component |
| Observation | Bản ghi từ một nguồn về đối tượng hoặc quan hệ ở một thời điểm; có thể thiếu, sai hoặc mâu thuẫn |
| Scope selector | Quy tắc/phạm vi được quản lý: CIDR, domain, URL hoặc resource selector; không đồng nghĩa tài sản đã được phát hiện |
| View group | Nhóm bố cục/tổng hợp cho người dùng; không đồng nghĩa một thực thể vật lý hay quyền kiểm thử |

Không mặc định một IP là một máy vật lý. Một IP có thể phục vụ nhiều ứng dụng; một ứng dụng có thể trải trên nhiều IP; một hostname có thể đổi địa chỉ theo thời gian.

### 4.2. Định danh và chuẩn hóa

- Public `assetId` phải ổn định qua đổi label, thêm locator và tải lại graph; không dùng label, vị trí canvas hay Neo4j `elementId` làm identity nghiệp vụ.
- Canonical key phụ thuộc loại và namespace. IP cần network context; cloud resource cần provider/account/region khi áp dụng; mobile cần platform/package, còn build/digest được giữ riêng khi cần phân biệt phiên bản.
- Chuẩn hóa an toàn: biểu diễn IP, DNS name, scheme/hostname và default port của origin. Không tự viết lại path có phân biệt hoa/thường hoặc làm mất query quan trọng.
- IP, DNS và web origin có thể là đối tượng/locator liên kết; cùng IP không đủ để hợp nhất hai application hay hai scope authorization.
- Với `http://IP` và `https://IP`, toàn cảnh có thể gom dưới một node địa chỉ/host; service và web origin vẫn là các bản ghi riêng, có thể mở xem.
- Endpoint inventory giữ method, origin, path và parameters. Gom `/users/123` và `/users/456` thành route template chỉ khi có căn cứ; việc nhóm trên UI không được xóa capture gốc.
- Match không chắc chắn được giữ là candidate association có nguồn; không tự merge identity chỉ bằng heuristic hostname, banner hoặc IP chung.

### 4.3. Phân bổ lưu trữ được khuyến nghị

**Đề xuất cần ADR:** mở rộng danh mục asset do Fastify/Prisma sở hữu để cấp identity nghiệp vụ ổn định và quản lý metadata; Neo4j tiếp tục là authority cho tri thức/quan hệ quan sát được. Không chuyển toàn bộ KG hoặc runtime state sang Prisma.

Phương án này chỉ được chọn nếu chứng minh runtime vẫn ghi observation độc lập với Web. ADR phải so sánh catalog cấp ID với identity do runtime tạo theo shared contract rồi reconcile vào catalog; chốt đúng một nguồn quyết định identity và version normalization. Không yêu cầu agent gọi Web đồng bộ trước mọi KG write, cũng không thêm một identity service riêng theo mặc định. Bảng dưới là phương án ứng viên, chưa phải quyền sở hữu đã chốt.

| Dữ liệu | Nơi lưu đề xuất | Ghi chú |
|---|---|---|
| Identity, canonical key, locators, metadata operator, merge/alias history | Catalog trong PostgreSQL, phát triển từ boundary inventory hiện có | Không duy trì hai catalog độc lập lâu dài; kế hoạch chuyển `WebAsset` phải rõ |
| Scope selectors, approval/revision và binding tới asset | PostgreSQL, reuse scope/governance services | Tách identity khỏi scope policy; phát hiện asset không tự cấp quyền thực thi |
| Quan hệ, observed properties và tham chiếu nguồn | Neo4j | Dùng identity chuẩn hoặc mapping tới `assetId`; giữ evidence refs thay vì copy payload |
| Raw scans, HTTP captures, binary APK/IPA và tài liệu lớn | Artifact/evidence storage hiện có, kèm metadata phù hợp | Domain inspector truy xuất qua owning API, không nhét file lớn vào node properties |
| Sitemap/endpoint index và domain detail read models | Projection có thể dựng lại từ observations/artifacts | Chọn physical storage theo nhu cầu truy vấn; không mặc định mọi index phải nằm trong Neo4j |
| Layout, pin, camera và saved filters | View metadata trong Web persistence | Tách view cá nhân và view chia sẻ; không ghi tọa độ lên canonical asset hoặc observation |

Nhóm trường logic tối thiểu của catalog: `assetId`, `engagementId`, `kind`, `namespace`, `canonicalKey`, `displayName`, locators, lifecycle/version và source associations. Chi tiết theo domain có schema/version riêng; tránh một bảng hàng trăm cột hoặc một JSON không kiểm soát cho mọi loại asset.

### 4.4. Merge và thay đổi theo thời gian

- Ingest lại cùng nguồn không sinh thêm asset hoặc quan hệ trùng.
- Concurrent ingest cần cùng kết quả như replay tuần tự; có uniqueness/idempotency ở persistence, không chỉ kiểm tra trước khi ghi. Thay version normalization phải có migration key/alias, không âm thầm đổi identity.
- Merge cần lưu alias/redirect để deep link và tham chiếu cũ tiếp tục resolve; giữ observation/evidence gốc để có thể xem lại hoặc tách khi phát hiện merge sai.
- Hết thấy một asset không có nghĩa nó bị xóa hay an toàn. Giữ last-seen, freshness và trạng thái nguồn; phân biệt chưa kiểm tra, không phản hồi và đã xác minh không còn tồn tại.
- Các chỉ số “N assets” phải nói rõ đang đếm entity, địa chỉ hay web origins; không cộng mọi KG node thành số asset.

## 5. Graph quản lý những gì

### 5.1. Trách nhiệm

Graph quản lý **đối tượng có quan hệ, các quan hệ có ý nghĩa và nguồn hỗ trợ chúng**. Canvas là projection phục vụ con người trên graph đó, không phải bản sao 1:1 của Neo4j.

| Nhóm quan hệ | Ví dụ | Cách đưa lên canvas |
|---|---|---|
| Containment/ownership | Account chứa resource, network chứa host, app chứa surface | Nhóm/card mở rộng; không bung mọi phần tử mặc định |
| Resolution/exposure | Domain resolves to IP, host exposes service, origin exposes endpoint | Hiện cạnh ở cấp phù hợp; endpoint thường vào sitemap |
| Connectivity/dependency | App calls API, workload uses storage, service connects to service | Hiện khi có ghi nhận hỗ trợ; không suy từ “cùng subnet” thành kết nối |
| Identity/access | User member of group, role has recorded permission tới resource | Lớp xem riêng để tránh lẫn cấu hình quyền và quyền truy cập đã chứng minh |
| Security context | Finding affects asset, evidence supports claim | Badge/liên kết inspector; trạng thái review do finding service sở hữu |
| Discovery association | Nguồn scan phát hiện locator hoặc surface | Dùng cho provenance/inspector; không biến mọi lần scan thành node toàn cảnh |

### 5.2. Ngữ nghĩa và provenance

- Quan hệ cần có source/target identity, type, provenance, thời điểm và trạng thái xác minh phù hợp. Confidence của parser không đồng nghĩa confidence về exploitability.
- Phân biệt recorded observation, configured relation và inferred hypothesis. Một quan hệ được ghi nhận không mặc nhiên là kết luận đúng.
- Nhiều nguồn cùng ghi nhận một quan hệ cần được truy ra; chỉ giữ trường `source` mới nhất không đủ cho corroboration hoặc lịch sử. Giữ supporting records ngoài hoặc gắn tham chiếu rõ tới chúng.
- Scope approval, finding review và runtime run status giữ authority tại owning service. Graph chỉ tham chiếu hoặc có projection ghi rõ nguồn/revision.
- Khả năng truy cập, kết nối được quan sát và khai thác thành công là ba kết luận khác nhau; không dùng một màu “connected” cho tất cả.

### 5.3. Những gì không bung vào asset graph tổng quan

Không render mặc định từng query parameter, HTTP request/response, log line, agent message, source file, permission statement hay mọi đường tấn công có thể có. Chúng có thể được lưu/index ở lớp phù hợp và mở qua view chuyên biệt.

Attack path là **một chế độ focus theo asset/finding/mục tiêu**, không phải canvas chính liệt kê toàn bộ tổ hợp đường đi. Nếu dùng, phải giới hạn độ sâu/số đường, giữ loại cạnh và phân biệt giả thuyết với đường đã có evidence.

## 6. View chuyên biệt theo domain

Phạm vi là toàn bộ domain/specialist hiện có, không chỉ network/web/cloud/mobile. Khi triển khai, lập coverage matrix từ `plugins/*/pyproject.toml`, runtime subagent registrations, `langgraph.json` và cấu hình activation; kiểm tra riêng nguồn ghi, API, renderer và bằng chứng. Plugin domain, agent role và asset type là ba khái niệm khác nhau: một role có thể dùng nhiều loại tài sản, nhiều role có thể ghi cùng entity.

| Domain | Asset/quan hệ ở toàn cảnh | View chi tiết nên có |
|---|---|---|
| Network | Segment, địa chỉ/host, service quan trọng, kết nối được ghi nhận | Ports/services, fingerprints, interfaces, neighbors và nguồn scan |
| Web/API | Application/origin, host/backend liên quan | Sitemap, endpoint table, methods, parameters, auth context, capture và finding |
| Cloud | Account/project, region/network, workload, storage, identity | Resource inventory, cấu hình, IAM/policy, quan hệ phụ thuộc và exposure có nguồn |
| Mobile | App/package/build và backend/API được ghi nhận | Manifest, permissions, exported components, deep links, storage/network observations và artifact |
| AD/identity | Domain, user/group/computer và access relations | Membership, quyền cấu hình, sessions và đường truy cập focus có evidence |
| Wireless | AP/radio, client và quan hệ quan sát được; không bắt buộc có IP | Radio/protocol inventory, observations và capture đã thu thập |
| IoT/embedded | Device, firmware/component, interface và dịch vụ liên quan | Firmware inventory, interfaces, protocol observations và findings có nguồn |
| ICS/OT | Asset/controller, service/protocol và quan hệ được ghi nhận | Protocol/device inventory, cấu hình quan sát được và evidence; không suy topology chỉ từ subnet |
| Reversing | Binary/module, component và dependencies | File metadata, symbols/strings, analysis results và artifact references |
| Smart contracts | Chain/network, contract/deployment, account và quan hệ được ghi nhận | Source/ABI, functions, analysis results và evidence; không ép contract thành network host |
| Phishing/social engineering | Domain, site, identity và campaign-linked entities | Campaign/lure context và provider evidence; campaign lifecycle vẫn do owning service quản lý |
| OSINT | Domain, identity, organization và hạ tầng có nguồn liên hệ | Source attribution, discovered identifiers và confidence; không tự hợp nhất identity theo tên |
| DFIR/forensics | Host/image/capture và observed artifacts liên quan | Timeline, IOC và source records; thời gian sự kiện phân biệt thời gian ingest |
| Supply chain | Repository/package/build/component và dependencies | Dependency inventory, build/provenance, findings và artifact references |
| Defense/blue cell | Asset, rule/detection và quan hệ coverage có nguồn | Detection observations, rule mappings và evidence; có rule không đồng nghĩa đã phát hiện thành công |
| Domain chưa có renderer | Typed entity và quan hệ đã biết | Inspector thuộc tính an toàn + artifact links; hiện rõ phần chưa được hỗ trợ |

Các hàng trên là hướng biểu diễn đề xuất, không khẳng định các API/detail view đã được nối. Các vai trò recon/exploit/postexploit, analyst và pipeline scanner/detector/verifier/patcher/exploiter cũng phải được rà soát nguồn ghi; không tạo thêm một domain hoặc một asset type cho mỗi role. Domain mới được đăng ký phải hiện trong coverage matrix, kể cả khi chỉ có typed inspector hoặc đang config-gated/unverified.

**Sitemap:** mở từ web origin/application, nhóm theo origin/path với bảng endpoint có search/filter và phân trang. Chọn endpoint xem method, parameters, trạng thái quan sát và nguồn capture. Có thể dùng sơ đồ/cây đường dẫn trong view này, nhưng nó không thay thế canvas tổng quan.

**Cross-domain:** một mobile app gọi API trên cloud là một quan hệ giữa các entity; không cần giả tạo một cây “IP → mọi thứ”. Cùng một entity được tham chiếu từ nhiều view nhưng giữ identity chung.

Domain adapter cung cấp normalization, loại entity/relationship và detail projection; domain renderer cung cấp UI. Reuse plugin/parser contracts và server hiện có; không tạo hệ plugin manager, graph store hoặc backend UI thứ hai.

## 7. Graph lớn và cơ chế tải dữ liệu

### 7.1. Dải IP không đồng nghĩa số lượng asset đã phát hiện

CIDR `/16` là phạm vi khoảng 65 nghìn địa chỉ, không phải 65 nghìn host đã biết. Lúc đầu có thể chỉ hiện scope group cùng trạng thái chưa khám phá. Các số “đã kiểm tra”, “phản hồi”, “đã phát hiện” lấy từ nguồn riêng và không được đánh đồng.

### 7.2. Các read operation cần có

Đây là nhu cầu contract, chưa ấn định URL mới:

- **Overview:** groups, totals, trạng thái nguồn và revision; không trả mọi node.
- **Group members:** thành viên có cursor, sort ổn định, filters và tổng số tương ứng.
- **Neighborhood:** entity trung tâm, loại cạnh, hướng, giới hạn độ sâu và cursor.
- **Search/locate:** tìm xuyên phần dữ liệu chưa tải; trả context để mở đúng nhóm.
- **Domain detail:** sitemap/resources/components độc lập với giới hạn canvas.

Response cần tách `total/loaded`, `hasMore/truncated`, freshness và source availability. Một lát 400 node bị cắt không được mô tả như toàn bộ môi trường.

Cursor gắn revision/snapshot hoặc trả yêu cầu restart rõ khi dữ liệu đổi. Tổng số chưa tính được trả unknown, không thành zero hay số node đã tải. Giới hạn phải áp dụng cả query/traversal ở kho dữ liệu, không chỉ cắt JSON sau khi đọc hết cạnh; xác minh indexes và query plan trên dataset đại diện. Các read phải phục vụ thành viên có quyền theo policy hiện có, không vô tình giới hạn chỉ owner.

### 7.3. Ngân sách và ổn định giao diện

- Chỉ tải và bố cục vùng đang xem. Giữ giới hạn phía server và phía client; overflow trở thành cluster hoặc hành động “load more”.
- Có thể thử ngân sách ban đầu khoảng 100 node/250 cạnh hiển thị, nhưng đây là giả thuyết cần đo, không phải kết quả benchmark hay giới hạn backend.
- Dùng semantic zoom để thay đổi lượng nhãn/badge; thu gọn nhóm để thay đổi số entity thực sự hiển thị. Gom cạnh và lọc relation để tránh mớ đường nối.
- Virtualize bảng/inspector có nhiều dòng. Không giữ hàng chục nghìn endpoint trong DOM chỉ để hiện một host.
- Layout cập nhật theo vùng, giữ node được pin và selection. Kết quả query cũ không được ghi đè engagement/filter mới.
- Đo cold load, expand, search/locate và cập nhật khi có ingest; chốt dataset và ngưỡng nghiệm thu trước khi chọn engine/layout library.

## 8. Nguồn dữ liệu và đồng bộ

### 8.1. Giữ ranh giới authority

- **Web catalog:** identity nghiệp vụ, metadata quản lý, scope binding và view preferences theo phương án catalog được phê duyệt.
- **KG:** tri thức và quan hệ được ghi nhận; hỗ trợ truy vấn/khám phá, không tự phê duyệt finding hoặc scope.
- **Artifact/evidence:** bytes gốc và capture identity; graph/index chứa reference có thể resolve qua API.
- **Runtime:** thread/run, agent activity và checkpoint state; chỉ chiếu trạng thái liên quan lên asset map.

Mở rộng DTO/domain projections trong shared contracts, server service và owning Python subsystem theo đúng luồng API. Python runtime không ghi trực tiếp vào Prisma; browser không đọc Neo4j hoặc filesystem trực tiếp.

### 8.2. Identity reconciliation và tính nhất quán

1. Adapter giữ locator/raw source, tạo normalized identity theo loại và namespace.
2. Owning identity boundary resolve hoặc cấp `assetId` theo khóa idempotent đã thống nhất.
3. Observation/relationship và artifact association tham chiếu identity đó; replay không nhân đôi dữ liệu.
4. Projection trả revision/freshness và phần chưa reconcile. UI không giả thành empty/success khi catalog, KG hoặc artifact source unavailable.

Nếu catalog và Neo4j được cập nhật bất đồng bộ, cần đường retry/reconcile bền vững và kiểm thử crash giữa hai lần ghi. Chọn cơ chế nhỏ nhất đáp ứng yêu cầu này trong ADR; không giả định một transaction bao phủ cả PostgreSQL và Neo4j.

Metadata có sẵn trong KG nhưng bị bỏ khỏi public allowlist hiện tại cần có DTO/projection phù hợp để inspector truy nguồn; không mở toàn bộ raw properties chỉ để lấy provenance. Asset map chỉ hiện secret/credential reference hoặc metadata đã được phép, không hiện secret bytes.

### 8.3. Migration

- Kiểm kê `WebAsset`, KG keys và nguồn parser/legacy writes trước khi backfill; không merge bằng chuỗi đơn thuần.
- Schema/key migrations và compatibility tests đi cùng thay đổi persistence đầu tiên; rehearsal backfill toàn bộ và cutover ở cuối. Không để code phụ thuộc schema mới rồi mới thiết kế migration.
- Backfill mappings có báo cáo ambiguous/unmatched và có thể chạy lại. Giữ alias/redirect khi chuyển identity.
- Chạy so sánh projection mới/cũ trên engagement đại diện; thay UI từng lát, giữ runtime/evidence nguyên trạng.
- Tách thay đổi identity/storage, API projection và UI thành các patch bounded; boundary/public API mới cần Proposed ADR trước code.

## 9. Điều chỉnh điều hướng và Execution

- **Asset Map:** vị trí chính để hiểu tài sản và quan hệ trong project; có chế độ list phục vụ tìm kiếm/inventory.
- **AI Workspace:** giao việc, hội thoại, xem mục tiêu/agent đang làm gì và controls theo công việc.
- **Findings/Evidence:** giữ authoring/review và capture workflows; inspector graph liên kết tới các màn này.
- **Analysis:** gộp hoặc phân vai lại cùng Asset Map. Không thêm Graph rồi giữ hai màn gần trùng về observed relations/path.
- **Execution history:** bỏ như một bề mặt run-ID riêng. Lịch sử công việc/các cuộc hội thoại vẫn có tên, thời gian và tóm tắt kết quả; tool logs mở từ context tương ứng.

Trước khi bỏ entry Execution, chuyển đủ pause/resume/cancel và diagnostics đang có. Cancel một run, pause một operation và emergency stop có scope khác nhau; giữ contract và nơi thực thi hiện có, không gom thành một nút dừng mơ hồ. Các deep link cũ cần redirect tới công việc hoặc diagnostics tương ứng.

## 10. Lộ trình và tiêu chí nghiệm thu

### 10.1. Thứ tự triển khai

Theo [implementation plan 8 phase](../design/2026-10-20-asset-map-implementation-plan.md): identity/coverage → boundary ghi và compatibility → read models → domain details và canvas → chuẩn bị điều hướng/controls → hoàn thiện toàn bộ domain → rehearsal/rollout. Network/web là lát đầu, không giới hạn phạm vi. Chỉ cutover navigation mặc định sau release gate; không duy trì hai lịch phase khác nhau trong proposal và plan.

Coverage matrix cần có owner/source, entity/relationship, read model, renderer, fixture và mức kiểm chứng. Role không ghi asset phải được giải thích thay vì tạo adapter giả. Mỗi domain có data-integration gate chạy retained output thật hoặc lab data xuyên persistence/API/UI; live acquisition từ provider/tool/hardware là gate riêng. Artifact replay không chứng minh tool hoạt động live; thiếu dữ liệu bắt buộc giữ blocked, không tính demo là pass.

### 10.2. Acceptance matrix

| Tình huống | Kết quả quan sát được cần có |
|---|---|
| Một IP, HTTP và HTTPS | Toàn cảnh có node địa chỉ/host được gom; hai service/origin vẫn xem riêng được; không mất nguồn |
| Nhiều virtual hosts chung IP | Application identities không tự merge; thể hiện quan hệ tới địa chỉ chung |
| Import CIDR `/16` | Không tạo sẵn từng host; overview phản ánh scope và phần đã khám phá |
| Nhiều host/service/endpoints | Canvas có nhóm/giới hạn và mở tiếp; totals không lấy từ số node đang tải |
| Sitemap lớn | Mở view riêng có search/filter/paging; không làm bung hàng nghìn URL lên toàn cảnh |
| Mobile gọi API trên cloud | App/package, API và cloud resource giữ đúng loại, liên kết theo nguồn, không ép dưới IP |
| Domain/specialist ngoài network/web/cloud/mobile | Từng nguồn ghi có mapping/inspector phù hợp, giữ identity/quan hệ và provenance; không bị bỏ khỏi inventory vì không có IP |
| Domain đăng ký nhưng thiếu tool/provider/hardware | Vẫn có trong coverage matrix, phân biệt khả năng hỗ trợ với availability và kiểm chứng; không dựng demo data để tính pass |
| Ingest cùng output hai lần | Identity và quan hệ không nhân đôi; các nguồn hỗ trợ vẫn truy xuất được |
| Ingest đồng thời, pagination khi graph đổi | Không trùng identity; cursor giữ snapshot/revision hoặc yêu cầu restart rõ ràng |
| Host đổi label/locator, identity merge | Deep link ổn định hoặc resolve qua alias; evidence gốc còn truy được |
| Dữ liệu mâu thuẫn hoặc thiếu quan hệ | Hiện nguồn/trạng thái chưa xác minh; không tự vẽ cạnh chắc chắn để lấp khoảng trống |
| Neo4j/artifact unavailable hoặc sync dở dang | Hiện phần unavailable/pending; không fallback demo hay kết luận không có tài sản |
| Chuyển project trong lúc request còn chạy | Response cũ không khôi phục node, selection hoặc dữ liệu project trước |
| Refresh/reload và saved view | Nhận discovery mới nhưng giữ camera/pin hợp lệ; view và asset references không rò sang user/project khác |
| Bỏ entry Execution | Controls cần thiết vẫn hoạt động từ công việc; lịch sử, diagnostics và deep link được bảo toàn |

Kiểm tra nguồn/contract và targeted tests theo owning package, cộng flow real-mode thành công và lỗi. Benchmark UI dùng dataset có phân bố host/service/endpoint/edge thực tế; dữ liệu tổng hợp chỉ chứng minh scalability của view, không chứng minh độ phủ ingest domain hay hiệu quả red teaming.

## 11. Quyết định cần chốt trước triển khai

| Quyết định | Khuyến nghị trong đề xuất | Điều kiện chốt |
|---|---|---|
| Authority của stable asset identity | Catalog PostgreSQL là ứng viên; so sánh với runtime-issued identity/shared contract rồi reconcile | Chốt một authority, version normalization và luồng Web-offline; không thêm phụ thuộc Web đồng bộ vào KG write |
| Phạm vi identity | Engagement-scoped và có namespace theo domain | Có ca thử shared IP, overlapping private networks, cloud account và app builds |
| WebAsset và scope selectors | Tách asset identity khỏi quy tắc phạm vi; migrate có compatibility | Không thay đổi ngầm quyền thực thi hoặc các revision đã duyệt |
| Lưu domain detail | Artifact làm nguồn bytes; typed index/projection phục vụ UI | Chọn theo truy vấn và provenance, tránh copy payload sang mọi kho |
| Layout engine | Thử compound/grouped layout, incremental update và keyboard access | Đo trên dataset đại diện; chưa chốt thư viện từ hình mock |
| Layout cá nhân/chia sẻ | Tách preference cá nhân và saved view có quyền truy cập rõ | Shared pin/filter không làm đổi dữ liệu asset hoặc scope |
| Domain rollout | Network/web là lát đầu; toàn bộ domain/specialist theo registry đều thuộc coverage matrix | Source → contract → API → renderer → evidence được kiểm tra theo từng domain, availability/verification gaps ghi riêng |

Tài liệu này chưa thay thế ADR, spec API hoặc ticket graph hiện có. Khi triển khai, cập nhật tracker liên quan bằng bằng chứng mới; trạng thái “có schema”, “đã nối”, “khả dụng theo cấu hình” và “đã kiểm chứng live” phải được ghi riêng.

## 12. Tham chiếu mã nguồn

- [WebAsset và scope inventory](../../apps/web/server/prisma/schema.prisma), [ScopeService](../../apps/web/server/src/services/scope-service.ts), [inventory routes](../../apps/web/server/src/http/routes/scope.routes.ts).
- [Core KG vocabulary và in-memory identities](../../packages/raptix-core/raptix_core/types/kg.py), [KGStore và Neo4j writes](../../packages/raptix/raptix/knowledge/graph/store.py).
- [Plugin packages/manifests](../../plugins/), [runtime subagent registrations](../../packages/raptix/pyproject.toml), [graph registry](../../langgraph.json), [domain contracts](../../packages/raptix-core/raptix_core/contracts/domains.py).
- [Agent KG tools](../../packages/raptix/raptix/knowledge/graph/tools.py), [scanner adapters/surface inventory](../../packages/raptix/raptix/knowledge/graph/ingest.py), [auto-ingest](../../packages/raptix/raptix/middleware/kg_autoingest.py).
- [Parser registry](../../packages/raptix/raptix/knowledge/ingest/registry.py), [materialization và artifact/parser references](../../packages/raptix/raptix/knowledge/ingest/materialize.py).
- [Web graph projection](../../apps/web/server/src/services/graph-service.ts), [graph routes](../../apps/web/server/src/http/routes/graph.routes.ts), [shared graph DTOs](../../apps/shared/web-contracts/src/run-api.ts).
- [Real asset adapter](../../apps/web/src/real/service-adapter/assets.ts), [Assets/ObservedGraphCard](../../apps/web/src/screens/d-assets.tsx), [Observed Analysis UI](../../apps/web/src/features/analysis/observed-tab.tsx).
- [Artifact/capture service](../../apps/web/server/src/services/artifacts-service.ts), [proxy sitemap tools](../../packages/raptix/raptix/execution/tools/proxy/tools.py).
- [Runtime Operations UI](../../apps/web/src/features/operations/runtime-tab.tsx), [controls và run table](../../apps/web/src/features/operations/runtime-runs.tsx), [AI Workspace/history](../../apps/web/src/real/screens/workspace.tsx).
- [Integration spec](../../apps/web/.scratch/frontend-backend-integration/spec.md), [coverage](../../apps/web/.scratch/frontend-backend-integration/coverage.md), [execution contract](../../apps/web/.scratch/frontend-backend-integration/execution.md), [real service adapter ADR](../adr/0084-real-service-adapter-boundary.md).
