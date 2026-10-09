import json

UA = 'D:/.VTNet/redteam/raptix/.ua'
batches = json.load(open(UA + '/intermediate/batches.json', encoding='utf-8'))
batch = [x for x in batches['batches'] if x.get('batchIndex') == 10][0]
batchFiles = batch['files']
batchImportData = batch['batchImportData']
neighborMap = batch.get('neighborMap', {})
ext = json.load(open(UA + '/tmp/ua-file-analyzer-output-10.json', encoding='utf-8'))
results = {r['path']: r for r in ext['results']}

# ---------- file meta (Vietnamese) ----------
FILE_META = {
"clients/web-raptix/src/App.tsx": ("Cổng vào chế độ xem trước trực quan; chuyển sang RealApp khi VITE_DATA_MODE là real, còn lại dựng shell VisualApp với Sidebar, Header và 13 trang tải lười.", ["giao-diện", "điều-hướng", "entry-point", "react", "shell"], "moderate"),
"clients/web-raptix/src/app/RealApp.tsx": ("Gốc workspace chế độ real; quản lý danh sách dự án thật, điều hướng theo URL, dựng 13 trang real và xử lý tạo dự án chờ server ACK rồi chuyển tới Charter.", ["giao-diện", "workspace", "điều-hướng", "react", "real-mode"], "complex"),
"clients/web-raptix/src/app/config.ts": ("Cấu hình chế độ dữ liệu và địa chỉ API cho frontend, đọc từ biến môi trường Vite với giá trị mặc định an toàn.", ["cấu-hình", "môi-trường", "api"], "simple"),
"clients/web-raptix/src/app/navigation.ts": ("Đăng ký điều hướng 13 trang theo nhóm, nhãn màn hình và danh tính operator dùng cho khung giao diện.", ["điều-hướng", "cấu-hình", "nhãn-màn-hình"], "simple"),
"clients/web-raptix/src/app/providers.tsx": ("Provider giữ store danh sách dự án real trong suốt vòng đời RealApp để chuyển route không hủy request đọc danh sách.", ["react", "provider", "trạng-thái", "real-mode"], "simple"),
"clients/web-raptix/src/app/real-capabilities.ts": ("Ánh xạ lý do khả dụng thật cho các trang real và chuẩn hóa lỗi tạo dự án từ API thành lỗi form.", ["khả-dụng", "xử-lý-lỗi", "real-mode"], "simple"),
"clients/web-raptix/src/app/router.ts": ("Tiện ích định tuyến URL-scoped: phân tích pathname, sinh đường dẫn và hook useAppRoute theo dõi history.", ["điều-hướng", "router", "hook", "url"], "simple"),
"clients/web-raptix/src/components/Header.tsx": ("Thanh đầu workspace hiển thị breadcrumb, tên dự án, nút phê duyệt HITL và điều khiển menu trên mobile.", ["giao-diện", "component", "header", "điều-hướng"], "moderate"),
"clients/web-raptix/src/components/HitlModal.tsx": ("Hộp thoại phê duyệt hành động của agent (cho phép hoặc từ chối) kèm màn hình kết quả xác nhận.", ["giao-diện", "hitl", "phê-duyệt", "modal"], "complex"),
"clients/web-raptix/src/components/Icons.tsx": ("Thư viện biểu tượng SVG thống nhất với hàm tạo icon và khoảng 60 biểu tượng dùng chung toàn frontend.", ["giao-diện", "icons", "svg", "dùng-chung"], "moderate"),
"clients/web-raptix/src/components/NewChatModal.tsx": ("Hộp thoại chọn dự án để mở chat mới với tìm kiếm, lọc dự án chưa hoàn thành và lối tắt tạo dự án.", ["giao-diện", "modal", "chat-mới", "tìm-kiếm"], "complex"),
"clients/web-raptix/src/components/NewProjectModal.tsx": ("Biểu mẫu tạo engagement mới, kiểm tra tên, khách hàng và loại phạm vi trước khi gọi tạo.", ["giao-diện", "modal", "tạo-dự-án", "biểu-mẫu"], "moderate"),
"clients/web-raptix/src/components/Sidebar.tsx": ("Thanh điều hướng 13 mục theo nhóm với bộ chuyển dự án, huy hiệu HITL và ngăn kéo mobile.", ["giao-diện", "sidebar", "điều-hướng", "component"], "complex"),
"clients/web-raptix/src/features/agent-runs/AgentDetailPanel.tsx": ("Panel chi tiết sub-agent ở chế độ mock: trạng thái, kỹ năng, công cụ, hành động gần đây và nút quyết định HITL.", ["giao-diện", "agent", "chi-tiết", "mock"], "complex"),
"clients/web-raptix/src/features/agent-runs/RealConsole.tsx": ("Màn hình Operator Console thật: timeline, inspector, thanh lệnh và form trả lời interrupt, chỉ render dữ liệu API đã kiểm chứng.", ["giao-diện", "console", "real-mode", "luồng-chạy"], "complex"),
"clients/web-raptix/src/features/agent-runs/console-view.ts": ("View-model thuần túy ánh xạ trạng thái stream thành timeline và tóm tắt inspector, hợp nhất lịch sử checkpoint không trùng lặp.", ["view-model", "timeline", "inspector", "thuần-túy"], "moderate"),
"clients/web-raptix/src/features/agent-runs/history-merge.ts": ("Hợp nhất snapshot lịch sử thread ở cấp checkpoint vào trạng thái stream theo ID provenance, không ghi đè dữ liệu live.", ["đồng-bộ", "lịch-sử", "checkpoint", "hợp-nhất"], "moderate"),
"clients/web-raptix/src/features/agent-runs/model.ts": ("Kiểu dữ liệu và hằng số cho chế độ mock agent-runs: trạng thái, kịch bản, giới hạn và kiểu badge.", ["kiểu-dữ-liệu", "hằng-số", "mock"], "simple"),
"clients/web-raptix/src/features/agent-runs/observe-stream.ts": ("Client SSE quan sát run theo phạm vi, kiểm tra cursor và contract, tự phục hồi snapshot khi mất kết nối.", ["sse", "luồng-chạy", "phục-hồi", "api-client"], "simple"),
"clients/web-raptix/src/features/agent-runs/store.ts": ("Store mock phía client cho agent-runs: seed kịch bản, quản lý thread và tin nhắn, quyết định phê duyệt, lưu localStorage.", ["store", "mock", "trạng-thái", "thread"], "complex"),
"clients/web-raptix/src/features/agent-runs/stream-reducer.ts": ("Reducer trạng thái stream: rút gọn sự kiện, giới hạn bộ nhớ đệm, theo dõi invocation, tool, question và transport.", ["reducer", "luồng-chạy", "trạng-thái", "thuần-túy"], "moderate"),
"clients/web-raptix/src/features/agent-runs/use-console-session.ts": ("Hook phiên console thật: nạp thread, hợp nhất lịch sử, quan sát run, gửi tin nhắn và điều khiển resume, hủy, phê duyệt.", ["hook", "console", "phiên-làm-việc", "real-mode"], "complex"),
"clients/web-raptix/src/features/c2/RealC2.tsx": ("Trang C2 và Sessions thật: registry Sliver, HTTP profile, quyền sở hữu listener và lệnh đã kiểm toán theo engagement.", ["giao-diện", "c2", "phiên-làm-việc", "real-mode"], "moderate"),
"clients/web-raptix/src/features/campaigns/RealCampaigns.tsx": ("Trang Vector Campaigns thật: bản nháp persisted, chọn tài sản GoPhish và Evilginx, chạy job generate và deploy.", ["giao-diện", "chiến-dịch", "phishing", "real-mode"], "complex"),
"clients/web-raptix/src/features/campaigns/real-campaigns-api.ts": ("Lớp gọi API campaign theo engagement, kiểm chứng contract cho capabilities, danh sách, tạo và job.", ["api-client", "chiến-dịch", "kiểm-chứng", "engagement"], "simple"),
"clients/web-raptix/src/features/findings-evidence/RealFindings.tsx": ("Trang Findings và Evidence thật: thanh tổng hợp severity, bảng findings, modal chi tiết và trình duyệt artifact.", ["giao-diện", "findings", "evidence", "real-mode"], "complex"),
"clients/web-raptix/src/features/findings-evidence/findings-view.ts": ("View-model thuần túy biến FindingView thành hàng hiển thị, đếm severity, lọc tìm kiếm và định dạng artifact.", ["view-model", "findings", "lọc-tìm-kiếm", "thuần-túy"], "moderate"),
"clients/web-raptix/src/features/findings-evidence/real-findings-api.ts": ("Lớp gọi API findings và artifact theo engagement, kiểm chứng contract trước khi trả về.", ["api-client", "findings", "artifact", "kiểm-chứng"], "simple"),
"clients/web-raptix/src/features/findings-evidence/use-real-findings.ts": ("Hook trạng thái trang findings thật: nạp findings và artifacts, xem trước nội dung file, làm mới.", ["hook", "findings", "artifact", "real-mode"], "moderate"),
"clients/web-raptix/src/features/infrastructure/RealAssets.tsx": ("Trang Assets và Inventory thật: bộ đếm, tab lọc, tìm kiếm, bảng tài sản và modal kiểm tra từ projection công khai.", ["giao-diện", "tài-sản", "kiểm-kê", "real-mode"], "moderate"),
"clients/web-raptix/src/features/infrastructure/RealInfrastructure.tsx": ("Trang Infrastructure và Data thật: bảng node đồ thị scoped, tìm kiếm, tóm tắt và modal thuộc tính đã biên tập.", ["giao-diện", "hạ-tầng", "đồ-thị", "real-mode"], "moderate"),
"clients/web-raptix/src/features/infrastructure/graph-view.ts": ("Helper projection đồ thị và tài sản thuần túy: lọc, đếm, nhãn hiển thị và chuỗi tóm tắt.", ["view-model", "đồ-thị", "tài-sản", "thuần-túy"], "moderate"),
"clients/web-raptix/src/features/infrastructure/real-graph-api.ts": ("Lớp gọi API graph và assets theo engagement, kiểm chứng contract và dựa vào redaction phía server.", ["api-client", "đồ-thị", "tài-sản", "kiểm-chứng"], "simple"),
}

FUNC_META = {
"clients/web-raptix/src/App.tsx:App": ("Cổng vào ứng dụng, rẽ sang RealApp ở chế độ real và VisualApp ở chế độ mock.", ["entry-point", "điều-hướng", "react"]),
"clients/web-raptix/src/App.tsx:VisualApp": ("Shell xem trước trực quan: đồng bộ route, quản lý modal và dựng 13 trang theo dự án đã chọn.", ["shell", "workspace", "điều-hướng", "trạng-thái"]),
"clients/web-raptix/src/app/RealApp.tsx:RealApp": ("Bọc toàn bộ workspace real trong RealProviders để giữ store danh sách dự án.", ["entry-point", "provider", "real-mode"]),
"clients/web-raptix/src/app/RealApp.tsx:RealRoot": ("Điều phối trang real: xử lý tạo dự án, lỗi, trạng thái not-found và chuyển tới RealShell.", ["điều-phối", "workspace", "real-mode", "trạng-thái"]),
"clients/web-raptix/src/app/RealApp.tsx:RealProjectWorkspace": ("Chọn trang workspace real theo screen: Charter, Scope, Console, Campaigns, C2, hạ tầng, findings, logs, reports, settings.", ["định-tuyến", "workspace", "real-mode"]),
"clients/web-raptix/src/app/RealApp.tsx:RealShell": ("Khung workspace real: điều hướng nhóm, chuyển dự án, danh tính operator và vùng nội dung trang.", ["shell", "điều-hướng", "bố-cục", "real-mode"]),
"clients/web-raptix/src/app/RealApp.tsx:RealProjectSwitcher": ("Bộ chọn dự án real với tìm kiếm, trạng thái tải và tạo mới.", ["chọn-dự-án", "tìm-kiếm", "real-mode"]),
"clients/web-raptix/src/app/RealApp.tsx:RealCharterLanding": ("Trang Charter real hiển thị tài liệu planning đã kiểm chứng của dự án.", ["charter", "tài-liệu", "real-mode"]),
"clients/web-raptix/src/app/RealApp.tsx:RealUnavailableScreen": ("Màn hình trạng thái không khả dụng trung thực cho trang chưa có nguồn backend.", ["trạng-thái", "không-khả-dụng", "real-mode"]),
"clients/web-raptix/src/app/RealApp.tsx:IdentityRow": ("Hàng hiển thị danh tính operator trong khung real.", ["giao-diện", "danh-tính", "hiển-thị"]),
"clients/web-raptix/src/app/providers.tsx:RealProviders": ("Giữ store danh sách dự án trong suốt vòng đời real để chuyển route không hủy request.", ["provider", "vòng-đời", "store"]),
"clients/web-raptix/src/app/real-capabilities.ts:toCreateFormError": ("Chuẩn hóa lỗi tạo dự án từ API thành lỗi form, chỉ gán field name khi xung đột 409.", ["xử-lý-lỗi", "biểu-mẫu", "api"]),
"clients/web-raptix/src/app/router.ts:parseRoute": ("Phân tích pathname thành screen và projectId, đánh dấu not-found khi không khớp 13 trang.", ["router", "phân-tích", "url"]),
"clients/web-raptix/src/app/router.ts:routePath": ("Sinh đường dẫn URL chuẩn từ screen và projectId.", ["router", "sinh-url", "điều-hướng"]),
"clients/web-raptix/src/app/router.ts:navigateUrl": ("Đẩy đường dẫn mới vào history và phát sự kiện popstate để hook route cập nhật.", ["router", "điều-hướng", "history"]),
"clients/web-raptix/src/app/router.ts:useAppRoute": ("Hook đăng ký popstate và trả về route hiện tại cho toàn workspace.", ["hook", "router", "trạng-thái"]),
"clients/web-raptix/src/components/Header.tsx:Header": ("Render breadcrumb, tiêu đề dự án, huy hiệu HITL và nút menu mobile cho workspace.", ["header", "breadcrumb", "hitl", "component"]),
"clients/web-raptix/src/components/HitlModal.tsx:HitlModal": ("Quản lý quyết định phê duyệt của operator và hiển thị kết quả cho phép hoặc từ chối.", ["hitl", "phê-duyệt", "modal", "trạng-thái"]),
"clients/web-raptix/src/components/Icons.tsx:icon": ("Hàm tạo component icon SVG từ path, hỗ trợ fill hoặc stroke thống nhất.", ["icons", "factory", "svg", "dùng-chung"]),
"clients/web-raptix/src/components/NewChatModal.tsx:NewChatModal": ("Liệt kê dự án khả dụng kèm tìm kiếm để chọn nơi mở chat mới.", ["modal", "chat-mới", "tìm-kiếm", "danh-sách"]),
"clients/web-raptix/src/components/NewProjectModal.tsx:NewProjectModal": ("Thu thập tên, khách hàng và loại phạm vi, kiểm tra hợp lệ rồi gọi tạo dự án.", ["modal", "tạo-dự-án", "biểu-mẫu", "kiểm-tra"]),
"clients/web-raptix/src/components/Sidebar.tsx:Sidebar": ("Dựng nhóm điều hướng 13 mục, bộ chuyển dự án và logic drawer mobile với bẫy focus.", ["sidebar", "điều-hướng", "dự-án", "mobile"]),
"clients/web-raptix/src/components/Sidebar.tsx:NavButton": ("Nút điều hướng đơn lẻ hiển thị trạng thái active và chấm HITL.", ["button", "điều-hướng", "hitl", "giao-diện"]),
"clients/web-raptix/src/features/agent-runs/AgentDetailPanel.tsx:AgentDetailPanel": ("Hiển thị trạng thái, loại, kỹ năng, công cụ và hành động gần đây của sub-agent mock kèm quyết định HITL.", ["agent", "chi-tiết", "hitl", "mock"]),
"clients/web-raptix/src/features/agent-runs/RealConsole.tsx:TransportChip": ("Hiển thị trạng thái transport của console: chưa có run, cần phục hồi, đang live hoặc đang nối lại.", ["trạng-thái", "transport", "hiển-thị"]),
"clients/web-raptix/src/features/agent-runs/RealConsole.tsx:QuestionAnswerForm": ("Biểu mẫu trả lời câu hỏi interrupt với chọn đơn hoặc đa lựa chọn và ô tự do.", ["biểu-mẫu", "câu-hỏi", "interrupt", "console"]),
"clients/web-raptix/src/features/agent-runs/RealConsole.tsx:Card": ("Thẻ render một mục console: tin nhắn, tool, invocation, câu hỏi hoặc interrupt.", ["thẻ", "timeline", "console", "render"]),
"clients/web-raptix/src/features/agent-runs/RealConsole.tsx:RealConsole": ("Điều phối console thật: nạp phiên, timeline, inspector, thanh lệnh và điều khiển interrupt.", ["console", "điều-phối", "real-mode", "luồng-chạy"]),
"clients/web-raptix/src/features/agent-runs/console-view.ts:isTerminalRunStatus": ("Kiểm tra trạng thái run đã kết thúc (success, error, timeout, interrupted).", ["trạng-thái", "kiểm-tra", "run"]),
"clients/web-raptix/src/features/agent-runs/console-view.ts:liveItems": ("Ánh xạ sự kiện stream live thành danh sách mục console có thứ tự.", ["ánh-xạ", "sự-kiện", "timeline"]),
"clients/web-raptix/src/features/agent-runs/console-view.ts:consoleTimeline": ("Hợp nhất mục live và lịch sử checkpoint thành timeline đầy đủ, chống trùng khi reconnect.", ["timeline", "hợp-nhất", "lịch-sử", "chống-trùng"]),
"clients/web-raptix/src/features/agent-runs/console-view.ts:consoleInspector": ("Tóm tắt invocation, tool và số câu hỏi cho panel inspector.", ["inspector", "tóm-tắt", "console"]),
"clients/web-raptix/src/features/agent-runs/console-view.ts:activeRunFromPage": ("Chọn run chưa kết thúc mới nhất từ trang run, null khi chỉ còn lịch sử.", ["run", "chọn-lọc", "trạng-thái"]),
"clients/web-raptix/src/features/agent-runs/history-merge.ts:mergeTool": ("Hợp nhất payload tool checkpoint vào tool hiện có, ưu tiên nội dung live khi bị cắt ngắn.", ["hợp-nhất", "tool", "checkpoint"]),
"clients/web-raptix/src/features/agent-runs/history-merge.ts:mergeThreadHistory": ("Hợp nhất snapshot thread (tin nhắn và transcript) vào trạng thái stream theo provenance.", ["hợp-nhất", "lịch-sử", "thread", "snapshot"]),
"clients/web-raptix/src/features/agent-runs/history-merge.ts:mergeHistoryEvent": ("Hợp nhất một sự kiện lịch sử (tool, invocation, câu hỏi) vào đúng map trạng thái.", ["hợp-nhất", "sự-kiện", "lịch-sử"]),
"clients/web-raptix/src/features/agent-runs/observe-stream.ts:observeRunStream": ("Quan sát SSE của run với kiểm tra phạm vi và cursor, phục hồi snapshot sau tối đa ba lần thử.", ["sse", "quan-sát", "phục-hồi", "kiểm-chứng"]),
"clients/web-raptix/src/features/agent-runs/store.ts:loadPersistedStore": ("Đọc store đã lưu theo dự án từ localStorage với kiểm tra hình dạng an toàn.", ["lưu-trữ", "localstorage", "tải-dữ-liệu"]),
"clients/web-raptix/src/features/agent-runs/store.ts:persistRun": ("Ghi thread, phê duyệt và trạng thái run của dự án xuống localStorage có giới hạn.", ["lưu-trữ", "persist", "run"]),
"clients/web-raptix/src/features/agent-runs/store.ts:seedSeqFromPersisted": ("Khởi tạo bộ đếm ID từ dữ liệu đã lưu để ID phiên mới không trùng.", ["khởi-tạo", "id", "persist"]),
"clients/web-raptix/src/features/agent-runs/store.ts:seedRun": ("Seed trạng thái run mock cho dự án từ fixture kịch bản được chọn.", ["seed", "mock", "kịch-bản", "run"]),
"clients/web-raptix/src/features/agent-runs/store.ts:buildSnapshot": ("Dựng snapshot bất biến cho subscriber từ trạng thái run nội bộ.", ["snapshot", "trạng-thái", "subscriber"]),
"clients/web-raptix/src/features/agent-runs/store.ts:getOrCreateRun": ("Lấy hoặc khởi tạo trạng thái run cho dự án.", ["run", "khởi-tạo", "truy-xuất"]),
"clients/web-raptix/src/features/agent-runs/store.ts:scheduleAgentReply": ("Hẹn câu trả lời mô phỏng của agent sau độ trễ cố định cho thread đang chờ.", ["hẹn-giờ", "mô-phỏng", "agent", "thread"]),
"clients/web-raptix/src/features/agent-runs/store.ts:getRunSnapshot": ("Trả về snapshot run hiện tại của dự án cho lần đọc đầu.", ["snapshot", "run", "truy-xuất"]),
"clients/web-raptix/src/features/agent-runs/store.ts:subscribeRuns": ("Đăng ký listener nhận thông báo khi snapshot run thay đổi.", ["subscriber", "lắng-nghe", "run"]),
"clients/web-raptix/src/features/agent-runs/store.ts:useRunSnapshot": ("Hook đọc snapshot run và tự render lại khi store thay đổi.", ["hook", "snapshot", "run"]),
"clients/web-raptix/src/features/agent-runs/store.ts:createThread": ("Tạo thread mới cho dự án, tôn trọng giới hạn số thread và lưu persist.", ["thread", "tạo-mới", "quản-lý"]),
"clients/web-raptix/src/features/agent-runs/store.ts:selectThread": ("Chọn thread active cho dự án và phát hành snapshot mới.", ["thread", "chọn-lọc", "trạng-thái"]),
"clients/web-raptix/src/features/agent-runs/store.ts:submitMessage": ("Thêm tin nhắn operator vào thread, kích hoạt trả lời mô phỏng của agent.", ["tin-nhắn", "gửi", "mô-phỏng"]),
"clients/web-raptix/src/features/agent-runs/store.ts:decideApproval": ("Ghi quyết định phê duyệt HITL và tiếp tục luồng mock của agent.", ["hitl", "phê-duyệt", "quyết-định"]),
"clients/web-raptix/src/features/agent-runs/store.ts:setRunState": ("Đặt trạng thái điều khiển run (chạy hoặc dừng) cho dự án.", ["run", "điều-khiển", "trạng-thái"]),
"clients/web-raptix/src/features/agent-runs/store.ts:configureMockScenario": ("Đổi kịch bản mock cho dự án và seed lại trạng thái run tương ứng.", ["mock", "kịch-bản", "cấu-hình"]),
"clients/web-raptix/src/features/agent-runs/stream-reducer.ts:emptyStreamState": ("Khởi tạo trạng thái stream rỗng cho một cặp engagement và thread.", ["khởi-tạo", "stream", "trạng-thái"]),
"clients/web-raptix/src/features/agent-runs/stream-reducer.ts:bounded": ("Giới hạn map trạng thái theo số mục mới nhất để chặn tăng bộ nhớ.", ["giới-hạn", "bộ-nhớ", "tiện-ích"]),
"clients/web-raptix/src/features/agent-runs/stream-reducer.ts:tool": ("Cập nhật map tool từ sự kiện tool_call hoặc tool_result, xử lý downgrade checkpoint.", ["tool", "cập-nhật", "sự-kiện"]),
"clients/web-raptix/src/features/agent-runs/stream-reducer.ts:reduceStreamEvent": ("Rút gọn một sự kiện stream vào trạng thái: tin nhắn, tool, invocation, câu hỏi hoặc handoff.", ["reducer", "sự-kiện", "stream", "trạng-thái"]),
"clients/web-raptix/src/features/agent-runs/stream-reducer.ts:streamDisconnected": ("Đánh dấu transport mất kết nối và yêu cầu phục hồi.", ["mất-kết-nối", "transport", "phục-hồi"]),
"clients/web-raptix/src/features/agent-runs/stream-reducer.ts:mergeRunObservation": ("Hợp nhất quan sát run (rawStatus) vào attempts và tính lại cờ phục hồi.", ["quan-sát", "run", "hợp-nhất"]),
"clients/web-raptix/src/features/agent-runs/stream-reducer.ts:observedExecutionCount": ("Đếm tool đã quan sát, loại trừ ủy thác task.", ["đếm", "tool", "thống-kê"]),
"clients/web-raptix/src/features/agent-runs/use-console-session.ts:waitForAcceptance": ("Poll trạng thái chấp nhận request của server với giới hạn lần thử và hỗ trợ abort.", ["poll", "chấp-nhận", "request", "server"]),
"clients/web-raptix/src/features/agent-runs/use-console-session.ts:useConsoleSession": ("Quản lý toàn bộ phiên console: thread, stream, run, gửi tin nhắn, trả lời, hủy và phê duyệt.", ["hook", "phiên-làm-việc", "console", "real-mode"]),
"clients/web-raptix/src/features/c2/RealC2.tsx:RealC2": ("Quản lý registry C2, lịch sử lệnh và form thực thi lệnh có kiểm chứng phạm vi.", ["c2", "phiên-làm-việc", "lệnh", "real-mode"]),
"clients/web-raptix/src/features/campaigns/RealCampaigns.tsx:RealCampaigns": ("Quản lý bản nháp campaign, tài sản GoPhish, profile Evilginx và vòng đời job.", ["chiến-dịch", "bản-nháp", "job", "real-mode"]),
"clients/web-raptix/src/features/campaigns/real-campaigns-api.ts:campaignProviderCapabilities": ("Đọc capabilities provider của campaign theo engagement có kiểm chứng phạm vi.", ["api-client", "capabilities", "chiến-dịch"]),
"clients/web-raptix/src/features/campaigns/real-campaigns-api.ts:listCampaigns": ("Liệt kê campaign của engagement có kiểm chứng phạm vi.", ["api-client", "danh-sách", "chiến-dịch"]),
"clients/web-raptix/src/features/campaigns/real-campaigns-api.ts:createCampaign": ("Tạo bản nháp campaign mới cho engagement.", ["api-client", "tạo-mới", "chiến-dịch"]),
"clients/web-raptix/src/features/campaigns/real-campaigns-api.ts:runCampaignJob": ("Chạy job generate hoặc deploy cho campaign với requestId chống trùng.", ["api-client", "job", "chiến-dịch"]),
"clients/web-raptix/src/features/campaigns/real-campaigns-api.ts:reconcileCampaignJob": ("Đối soát trạng thái job campaign từ server.", ["api-client", "đối-soát", "job"]),
"clients/web-raptix/src/features/findings-evidence/RealFindings.tsx:RealFindings": ("Điều phối trang findings: lọc severity, tìm kiếm, chọn finding và mở artifact.", ["findings", "lọc", "tìm-kiếm", "real-mode"]),
"clients/web-raptix/src/features/findings-evidence/RealFindings.tsx:RealFindingModal": ("Modal chi tiết một finding với thông tin CVSS, CWE, MITRE và cảnh báo parser.", ["modal", "chi-tiết", "findings"]),
"clients/web-raptix/src/features/findings-evidence/RealFindings.tsx:ArtifactBrowser": ("Trình duyệt artifact theo thư mục với xem trước nội dung file.", ["artifact", "trình-duyệt", "xem-trước"]),
"clients/web-raptix/src/features/findings-evidence/findings-view.ts:toSeverity": ("Chuẩn hóa severity informational thành info cho ngôn ngữ hiển thị.", ["chuẩn-hóa", "severity", "ánh-xạ"]),
"clients/web-raptix/src/features/findings-evidence/findings-view.ts:findingRow": ("Biến FindingView thành hàng hiển thị với cờ chất lượng parser.", ["ánh-xạ", "hàng-hiển-thị", "findings"]),
"clients/web-raptix/src/features/findings-evidence/findings-view.ts:findingRows": ("Ánh xạ toàn bộ FindingsView thành danh sách hàng.", ["ánh-xạ", "danh-sách", "findings"]),
"clients/web-raptix/src/features/findings-evidence/findings-view.ts:severityCounts": ("Đếm findings theo từng severity.", ["đếm", "severity", "thống-kê"]),
"clients/web-raptix/src/features/findings-evidence/findings-view.ts:matchesSearch": ("Kiểm tra hàng finding có khớp từ khóa theo tiêu đề, tài sản hoặc ID.", ["tìm-kiếm", "lọc", "findings"]),
"clients/web-raptix/src/features/findings-evidence/findings-view.ts:formatSize": ("Định dạng bytes thành chuỗi B, KB hoặc MB.", ["định-dạng", "kích-thước", "tiện-ích"]),
"clients/web-raptix/src/features/findings-evidence/findings-view.ts:artifactPaths": ("Trải phẳng thư mục artifact thành danh sách file có đường dẫn.", ["artifact", "đường-dẫn", "danh-sách"]),
"clients/web-raptix/src/features/findings-evidence/findings-view.ts:contentHeader": ("Dựng chuỗi tiêu đề cho nội dung artifact gồm đường dẫn, loại và kích thước.", ["tiêu-đề", "artifact", "định-dạng"]),
"clients/web-raptix/src/features/findings-evidence/real-findings-api.ts:loadFindings": ("Tải FindingsView của engagement có kiểm chứng phạm vi.", ["api-client", "findings", "tải-dữ-liệu"]),
"clients/web-raptix/src/features/findings-evidence/real-findings-api.ts:loadArtifacts": ("Tải cây artifact của engagement có kiểm chứng phạm vi.", ["api-client", "artifact", "tải-dữ-liệu"]),
"clients/web-raptix/src/features/findings-evidence/real-findings-api.ts:loadArtifactContent": ("Tải nội dung một artifact theo đường dẫn có kiểm chứng engagement và path.", ["api-client", "artifact", "nội-dung"]),
"clients/web-raptix/src/features/findings-evidence/use-real-findings.ts:useRealFindings": ("Nạp song song findings và artifacts, quản lý xem trước nội dung và làm mới.", ["hook", "findings", "artifact", "real-mode"]),
"clients/web-raptix/src/features/infrastructure/RealAssets.tsx:RealAssets": ("Điều phối trang tài sản: đếm, lọc, tìm kiếm và modal kiểm tra tài sản.", ["tài-sản", "lọc", "tìm-kiếm", "real-mode"]),
"clients/web-raptix/src/features/infrastructure/RealInfrastructure.tsx:RealInfrastructure": ("Điều phối trang hạ tầng: bảng node đồ thị, tìm kiếm và modal thuộc tính.", ["hạ-tầng", "đồ-thị", "tìm-kiếm", "real-mode"]),
"clients/web-raptix/src/features/infrastructure/RealInfrastructure.tsx:NodeModal": ("Modal hiển thị thuộc tính đã biên tập và provenance của một node đồ thị.", ["modal", "node", "thuộc-tính"]),
"clients/web-raptix/src/features/infrastructure/graph-view.ts:matchesAssetFilter": ("Kiểm tra tài sản có thuộc tab lọc đã chọn.", ["lọc", "tài-sản", "kiểm-tra"]),
"clients/web-raptix/src/features/infrastructure/graph-view.ts:matchesAssetSearch": ("Kiểm tra tài sản có khớp từ khóa trên nhãn, hostname, IP, URL hoặc OS.", ["tìm-kiếm", "tài-sản", "lọc"]),
"clients/web-raptix/src/features/infrastructure/graph-view.ts:filterAssets": ("Lọc danh sách tài sản theo tab và từ khóa.", ["lọc", "tài-sản", "danh-sách"]),
"clients/web-raptix/src/features/infrastructure/graph-view.ts:assetCounters": ("Đếm tài sản theo nhóm host, web, identity và mobile.", ["đếm", "tài-sản", "thống-kê"]),
"clients/web-raptix/src/features/infrastructure/graph-view.ts:nodeDisplayLabel": ("Chọn nhãn hiển thị tốt nhất cho node từ hostname, IP, tên hoặc URL.", ["nhãn", "node", "hiển-thị"]),
"clients/web-raptix/src/features/infrastructure/graph-view.ts:graphSummary": ("Dựng chuỗi tóm tắt số node, edge và cờ cắt ngắn của đồ thị.", ["tóm-tắt", "đồ-thị", "hiển-thị"]),
"clients/web-raptix/src/features/infrastructure/graph-view.ts:assetsSummary": ("Dựng chuỗi tóm tắt số tài sản và cờ cắt ngắn.", ["tóm-tắt", "tài-sản", "hiển-thị"]),
"clients/web-raptix/src/features/infrastructure/real-graph-api.ts:loadGraph": ("Tải GraphView scoped của engagement có kiểm chứng phạm vi.", ["api-client", "đồ-thị", "tải-dữ-liệu"]),
"clients/web-raptix/src/features/infrastructure/real-graph-api.ts:loadAssets": ("Tải AssetsView của engagement có kiểm chứng phạm vi.", ["api-client", "tài-sản", "tải-dữ-liệu"]),
}

BUILTINS = {"useState","useEffect","useMemo","useCallback","useRef","useSyncExternalStore","useContext","fetch","setTimeout","setInterval","clearTimeout","JSON","Math","Object","Array","String","Number","Boolean","Promise","console","window","document","localStorage","history","location","navigator","crypto","encodeURIComponent","decodeURIComponent","isArray","includes","map","filter","find","findIndex","forEach","push","slice","splice","split","join","replace","test","exec","flatMap","entries","values","keys","fromEntries","parse","stringify","setInterval","requestAnimationFrame"}

def func_complexity(start, end):
    n = end - start + 1
    if n > 60: return "complex"
    if n >= 20: return "moderate"
    return "simple"

nodes = []
edges = []

# file nodes
for f in batchFiles:
    p = f['path']
    r = results.get(p, {})
    ne = r.get('nonEmptyLines', f.get('sizeLines', 0))
    if ne >= 200: cx = "complex"
    elif ne >= 50: cx = "moderate"
    else: cx = "simple"
    summary, tags, override = FILE_META.get(p, ("Tệp mã nguồn thuộc web-raptix.", ["mã-nguồn", "frontend", "web-raptix"], None))
    if override: cx = override
    # adjust: keep computed unless override differs strongly? use override as authored
    name = p.split('/')[-1]
    nodes.append({"id": "file:" + p, "type": "file", "name": name, "filePath": p, "summary": summary, "tags": tags, "complexity": cx})

# function nodes with significance filter
export_map = {}
for p, r in results.items():
    export_map[p] = set(e.get('name') for e in r.get('exports', []))

included = {}  # (path,name) -> node id
for p, r in results.items():
    for fn in r.get('functions', []):
        name = fn['name']
        s, e = fn['startLine'], fn['endLine']
        nlines = e - s + 1
        exported = name in export_map.get(p, set())
        if not exported and nlines < 10:
            continue
        key = p + ":" + name
        if key in FUNC_META:
            summary, tags = FUNC_META[key]
        else:
            summary = "Hàm %s trong %s xử lý logic %s." % (name, p.split('/')[-1], "được xuất dùng chung" if exported else "nội bộ")
            tags = ["hàm", "logic", "frontend"]
        nodes.append({"id": "function:" + p + ":" + name, "type": "function", "name": name, "filePath": p, "lineRange": [s, e], "summary": summary, "tags": tags, "complexity": func_complexity(s, e)})
        included[(p, name)] = "function:" + p + ":" + name
    for cl in r.get('classes', []):
        name = cl.get('name')
        s, e = cl.get('startLine', 1), cl.get('endLine', 1)
        exported = name in export_map.get(p, set())
        methods = cl.get('methods', [])
        if not exported and len(methods) < 2 and (e - s + 1) < 20:
            continue
        summary = "Lớp %s trong %s." % (name, p.split('/')[-1])
        nodes.append({"id": "class:" + p + ":" + name, "type": "class", "name": name, "filePath": p, "lineRange": [s, e], "summary": summary, "tags": ["lớp", "mô-hình", "frontend"], "complexity": func_complexity(s, e)})
        included[(p, name)] = "class:" + p + ":" + name

# contains + exports
for (p, name), fid in included.items():
    edges.append({"source": "file:" + p, "target": fid, "type": "contains", "direction": "forward", "weight": 1.0})
    if name in export_map.get(p, set()):
        edges.append({"source": "file:" + p, "target": fid, "type": "exports", "direction": "forward", "weight": 0.8})

# imports 1:1
for src, targets in batchImportData.items():
    for t in targets:
        edges.append({"source": "file:" + src, "target": "file:" + t, "type": "imports", "direction": "forward", "weight": 0.7})

# calls: intra-batch from callGraph
name_to_ids = {}
for (p, name), fid in included.items():
    name_to_ids.setdefault(name, []).append((p, fid))
imported_map = {k: set(v) for k, v in batchImportData.items()}

def base_name(callee):
    c = callee.strip()
    # handle ['a','b'].includes -> includes
    if '.' in c:
        c = c.split('.')[-1]
    c = c.strip("[]'\"() ")
    # e.g. "includes" from above
    return c.split('(')[0].strip()

seen_calls = set()
for p, r in results.items():
    for cg in r.get('callGraph', []):
        caller = cg.get('caller')
        callee = cg.get('callee')
        if not caller or not callee:
            continue
        b = base_name(callee)
        if not b or b in BUILTINS or len(b) < 2:
            continue
        if (p, caller) not in included:
            continue
        src_id = included[(p, caller)]
        cands = name_to_ids.get(b, [])
        if not cands:
            continue
        # prefer same file, then imported file; skip if target is neither
        # (avoids false positives like RealConsole -> store.ts helpers via
        # session method names sharing the same basename)
        same = [c for c in cands if c[0] == p]
        if same:
            tgt = same[0][1]
        else:
            imp = imported_map.get(p, set())
            inf = [c for c in cands if c[0] in imp]
            if not inf:
                continue
            tgt = inf[0][1]
        if src_id == tgt:
            continue
        key = (src_id, tgt, 'calls')
        if key in seen_calls:
            continue
        seen_calls.add(key)
        edges.append({"source": src_id, "target": tgt, "type": "calls", "direction": "forward", "weight": 0.8})

# cross-batch calls via neighborMap symbols (only when callee matches neighbor symbol and caller included)
neighbor_symbols = {}  # path -> set(symbols)
for src, neighs in neighborMap.items():
    for n in neighs or []:
        neighbor_symbols.setdefault(n.get('path'), set()).update(n.get('symbols', []) or [])
for p, r in results.items():
    for cg in r.get('callGraph', []):
        caller = cg.get('caller')
        callee = cg.get('callee')
        if not caller or not callee:
            continue
        b = base_name(callee)
        if not b or b in BUILTINS:
            continue
        if (p, caller) not in included:
            continue
        if b in name_to_ids:
            continue  # already handled intra-batch
        # find neighbor file exporting b that is also in batchImportData targets (imported)
        for t in batchImportData.get(p, []):
            if b in neighbor_symbols.get(t, set()):
                src_id = included[(p, caller)]
                # guess node type: function by default (all neighbor symbols here are components/functions)
                tgt_id = "function:" + t + ":" + b
                key = (src_id, tgt_id, 'calls')
                if key not in seen_calls:
                    seen_calls.add(key)
                    edges.append({"source": src_id, "target": tgt_id, "type": "calls", "direction": "forward", "weight": 0.8})
                break

out = {"batchIndex": 10, "batchFiles": batchFiles, "nodes": nodes, "edges": edges}
open(UA + '/intermediate/batch-10.json', 'w', encoding='utf-8').write(json.dumps(out, ensure_ascii=False, indent=2))
print("nodes=%d edges=%d files=%d" % (len(nodes), len(edges), len(batchFiles)))
from collections import Counter
print(Counter(e['type'] for e in edges))
print("contains=%d exports=%d imports=%d calls=%d" % (sum(1 for e in edges if e['type']=='contains'), sum(1 for e in edges if e['type']=='exports'), sum(1 for e in edges if e['type']=='imports'), sum(1 for e in edges if e['type']=='calls')))
