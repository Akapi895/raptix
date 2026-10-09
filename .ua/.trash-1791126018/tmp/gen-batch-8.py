#!/usr/bin/env python3
"""Sinh batch-8.json cho file-analyzer batch 8 (tieng Viet)."""
import json, re

UA = r"D:\.VTNet\redteam\raptix\.ua"
batch = json.load(open(UA + r"\tmp\batch8-dump.json", encoding="utf-8"))
out = json.load(open(UA + r"\tmp\ua-file-analyzer-output-8.json", encoding="utf-8"))
results = {r["path"]: r for r in out["results"]}

FILE_META = {
"packages/raptix/raptix/runtime/event_log.py": ("Nhật ký sự kiện append-only cho từng chiến dịch, ghi file events.jsonl với khóa tệp đa nền tảng và đọc lại chịu lỗi dòng rách.", ["nhật-ký-sự-kiện", "chiến-dịch", "ghi-file", "khóa-tệp"], "complex"),
"packages/raptix/raptix/tools/evidence/__init__.py": ("Điểm xuất khẩu của gói công cụ bằng chứng, gom các công cụ asciicast và niêm phong chuỗi bảo quản để báo cáo kết thúc.", ["bằng-chứng", "điểm-xuất-khẩu", "báo-cáo"], "simple"),
"packages/raptix/raptix/tools/evidence/asciicast.py": ("Bộ chuyển đổi log pipe-pane của tmux sang định dạng asciicast v2 kèm sidecar thời gian và manifest phát lại trên trình duyệt.", ["asciicast", "bằng-chứng", "ghi-hình-phiên", "phát-lại"], "moderate"),
"packages/raptix/raptix/tools/evidence/tools.py": ("Các công cụ LangChain cho bằng chứng: xuất asciicast, liệt kê bản ghi, niêm phong và xác minh chuỗi bảo quản bằng SHA-256 và HMAC.", ["bằng-chứng", "chuỗi-bảo-quản", "hmac", "công-cụ-langchain"], "complex"),
"packages/raptix/raptix/tools/filesystem.py": ("Hàm trợ giúp bề mặt công cụ filesystem, loại công cụ thực thi chung để định tuyến lệnh qua công cụ bash chuyên dụng.", ["filesystem", "bề-mặt-công-cụ", "lọc"], "simple"),
"packages/raptix/raptix/tools/opplan.py": ("Bộ công cụ OPPLAN và trợ giúp lưu trữ backend: dựng payload, định dạng cho agent, kiểm tra chuyển trạng thái và фабрик bảy công cụ CRUD.", ["opplan", "kế-hoạch", "mục-tiêu", "công-cụ-langchain", "lưu-trữ"], "complex"),
"packages/raptix/raptix/tools/ops/__init__.py": ("Điểm xuất khẩu công cụ vòng đời opscontrol, gom client socket và các công cụ khởi động, dừng, dọn dẹp và trạng thái workload.", ["opscontrol", "vòng-đời", "workload", "điểm-xuất-khẩu"], "simple"),
"packages/raptix/raptix/tools/ops/client.py": ("Client HTTP qua Unix socket cho daemon opscontrol, phân giải đường dẫn socket, kiểm tra khả dụng bằng kết nối thực và gọi API vòng đời.", ["opscontrol", "unix-socket", "client-http", "workload"], "moderate"),
"packages/raptix/raptix/tools/ops/tools.py": ("Các wrapper LangChain cho daemon opscontrol: khởi động, dừng, dọn dẹp theo chiến dịch và liệt kê trạng thái, kèm chẩn đoán lỗi chuẩn.", ["opscontrol", "công-cụ-langchain", "điều-phối", "chẩn-đoán"], "moderate"),
"packages/raptix/raptix/tools/skills.py": ("Công cụ nạp skill cho agent: phân giải đường dẫn/slug qua registry, đọc qua backend, tách frontmatter và dựng chỉ mục tài liệu tham chiếu.", ["kỹ-năng", "nạp-skill", "backend", "phân-giải"], "complex"),
"packages/raptix/raptix/tools/skills_registry.py": ("Tầng dữ liệu registry skill: chuẩn hóa slug, kiểm tra đường dẫn an toàn, duyệt cây skill và phân giải chính xác/slug/mờ kèm kiểm soát nguồn.", ["kỹ-năng", "registry", "phân-giải", "an-toàn-đường-dẫn"], "moderate"),
"packages/raptix/tests/unit/agents/test_build.py": ("Bộ kiểm thử đơn vị cho cơ chế dựng agent: gói plugin, khe middleware, cổng an toàn, hợp nhất công cụ và lan truyền nguồn skill.", ["kiểm-thử", "dựng-agent", "middleware", "cổng-an-toàn"], "complex"),
"packages/raptix/tests/unit/agents/test_if_skill_contract.py": ("Kiểm thử hợp đồng skill cho điều phối và worker: phân giải router/báo cáo và ánh xạ nguồn skill tới thư mục thực.", ["kiểm-thử", "hợp-đồng-skill", "điều-phối"], "simple"),
"packages/raptix/tests/unit/cli/test_audit.py": ("Kiểm thử CLI kiểm toán sổ cái: xác minh sổ sạch, phát hiện giả mạo, khóa HMAC và định tuyến bộ điều phối cấp cao.", ["kiểm-thử", "cli", "kiểm-toán", "sổ-cái"], "moderate"),
"packages/raptix/tests/unit/cli/test_auth.py": ("Kiểm thử CLI xác thực: kiểm kê phương thức, khóa API, khóa cổng, gói đăng ký và mã thoát của trạng thái/kiểm tra.", ["kiểm-thử", "cli", "xác-thực", "nhà-cung-cấp"], "moderate"),
"packages/raptix/tests/unit/cli/test_auth_branches.py": ("Kiểm thử nhánh xác thực CLI: biểu tượng trạng thái, nạp file env, kết xuất chuỗi đã phân giải và các nhánh hàm chính.", ["kiểm-thử", "cli", "xác-thực", "nhánh"], "complex"),
"packages/raptix/tests/unit/cli/test_export_transcript.py": ("Kiểm thử xuất bản ghi chiến dịch: ghi ra chuẩn/file, giữ thứ tự thời gian, mặc định workspace và kết xuất sự kiện chung.", ["kiểm-thử", "cli", "xuất-bản-ghi", "sự-kiện"], "moderate"),
"packages/raptix/tests/unit/cli/test_scan.py": ("Kiểm thử lệnh quét: cờ tương thích, kiểm tra mục tiêu, tên chiến dịch, văn bản chỉ thị và cổng SARIF/mã thoát.", ["kiểm-thử", "cli", "quét", "sarif"], "moderate"),
"packages/raptix/tests/unit/cli/test_scan_extra.py": ("Kiểm thử mở rộng lệnh quét: diff Git, sự kiện JSONL, điều phối SDK, nạp đồ thị phát hiện và các đường đi chính thành công/lỗi.", ["kiểm-thử", "cli", "quét", "sdk", "đồ-thị"], "complex"),
"packages/raptix/tests/unit/cli/test_zip.py": ("Kiểm thử xuất/nhập lưu trữ chiến dịch: tạo archive, khôi phục file, khứ hồi qua CLI, chặn duyệt đường dẫn và symlink.", ["kiểm-thử", "cli", "lưu-trữ", "zip", "an-toàn"], "moderate"),
"packages/raptix/tests/unit/core/test_dispatch_boundary.py": ("Kiểm thử ranh giới điều phối tác vụ: lỗi có kiểu cho tác vụ cha, giữ định danh lỗi song song và kiểm tra lược đồ tham số.", ["kiểm-thử", "điều-phối", "tác-vụ", "ranh-giới"], "moderate"),
"packages/raptix/tests/unit/core/test_subagent_streaming.py": ("Kiểm thử truyền trực tiếp sub-agent: không thực thi kép khi thiếu trạng thái và chặn gọi công cụ thiếu định danh.", ["kiểm-thử", "sub-agent", "truyền-trực-tiếp"], "moderate"),
"packages/raptix/tests/unit/core/test_subagent_streaming_guard.py": ("Kiểm thử chốt chặn truyền trực tiếp sub-agent cho cả đường đồng bộ và bất đồng bộ với renderer bật/tắt.", ["kiểm-thử", "sub-agent", "chốt-chặn", "bất-đồng-bộ"], "moderate"),
"packages/raptix/tests/unit/core/test_subagent_transcript_state.py": ("Kiểm thử trạng thái bản ghi sub-agent: nối bản ghi trong trạng thái trả về, rút gọn nối chuỗi và mở rộng lược đồ.", ["kiểm-thử", "sub-agent", "bản-ghi", "trạng-thái"], "moderate"),
"packages/raptix/tests/unit/llm/test_factory.py": ("Bộ kiểm thử lớn cho nhà máy LLM: khóa thực, OAuth, token, chuỗi dự phòng, kiểm tra sức khỏe và dịch lỗi thành thông điệp hành động.", ["kiểm-thử", "llm", "nhà-máy", "nhà-cung-cấp"], "complex"),
"packages/raptix/tests/unit/llm/test_factory_attribution.py": ("Kiểm thử ghi công nhà cung cấp trong factory: lan truyền nhật ký và gắn thẻ proxy cho từng yêu cầu.", ["kiểm-thử", "llm", "ghi-công", "nhật-ký"], "simple"),
"packages/raptix/tests/unit/llm/test_factory_classify_errors.py": ("Kiểm thử phân loại lỗi nhà cung cấp: lỗi thử lại được, lỗi nghiêm trọng, nhãn 403 và lỗi mạng bí mật chưa phân loại.", ["kiểm-thử", "llm", "phân-loại-lỗi", "thử-lại"], "moderate"),
"packages/raptix/tests/unit/llm/test_factory_fallback_execution.py": ("Kiểm thử thực thi dự phòng của factory: dựng factory/yêu cầu giả, giới hạn tốc độ và chuỗi xử lý dự phòng.", ["kiểm-thử", "llm", "dự-phòng", "giới-hạn-tốc-độ"], "moderate"),
"packages/raptix/tests/unit/llm/test_factory_url_redaction.py": ("Kiểm thử che thông tin trong URL: che người dùng/mật khẩu, giữ nguyên URL thường và đường dẫn HTTPS.", ["kiểm-thử", "llm", "che-url", "bí-mật"], "simple"),
"packages/raptix/tests/unit/llm/test_provider_controls.py": ("Kiểm thử kiểm soát nhà cung cấp: tiêu đề bổ sung dạng chuỗi và yêu cầu boolean khi tắt truyền trực tiếp.", ["kiểm-thử", "llm", "kiểm-soát", "tiêu-đề"], "simple"),
"packages/raptix/tests/unit/llm/test_role_model_override.py": ("Kiểm thử ghi đè mô hình theo vai trò: phân giải mô hình từng vai và tổng hợp phân công.", ["kiểm-thử", "llm", "vai-trò", "ghi-đè-mô-hình"], "simple"),
"packages/raptix/tests/unit/llm/test_router.py": ("Kiểm thử bộ định tuyến mô hình LLM với các quy tắc chọn mô hình theo yêu cầu.", ["kiểm-thử", "llm", "định-tuyến"], "simple"),
"packages/raptix/tests/unit/middleware/test_audit_sink.py": ("Kiểm thử bộ thu kiểm toán: chuẩn hóa đường dẫn, dự phòng khóa HMAC, bỏ qua dòng trống/hỏng, fsync và khứ hồi tích hợp.", ["kiểm-thử", "middleware", "kiểm-toán", "sổ-cái"], "moderate"),
"packages/raptix/tests/unit/middleware/test_budget.py": ("Kiểm thử middleware ngân sách: bộ nhớ đệm chi tiêu, kiểm tra hạn mức, nuốt lỗi nhà cung cấp, cảnh báo mềm và gắn thẻ phạm vi.", ["kiểm-thử", "middleware", "ngân-sách", "hạn-mức"], "moderate"),
}

RUNTIME_SUM = {
# event_log
"_env_float": ("Đọc biến môi trường dạng số thực, trả về giá trị mặc định khi thiếu hoặc không dương.", ["biến-môi-trường", "số-thực", "mặc-định"], "simple"),
"_retry_lock": ("Thử lấy khóa với lùi mũ bị chặn tới khi hết thời gian, rồi ném TimeoutError thay vì quay vô hạn.", ["khóa", "thử-lại", "lùi-mũ", "hết-thời-gian"], "moderate"),
"_engagement_events_path": ("Dựng đường dẫn events.jsonl cho một chiến dịch dưới thư mục engagements.", ["đường-dẫn", "sự-kiện", "chiến-dịch"], "simple"),
"_acquire_lock": ("Lấy khóa độc quyền đa nền tảng: flock trên POSIX và locking có thử lại trên Windows.", ["khóa-tệp", "đa-nền-tảng", "độc-quyền"], "moderate"),
"_release_lock": ("Nhả khóa tệp đa nền tảng, ghi cảnh báo thay vì ném lỗi khi nhả khóa Windows thất bại.", ["khóa-tệp", "nhả-khóa", "đa-nền-tảng"], "simple"),
"read_events": ("Duyệt các sự kiện theo thứ tự ghi, bỏ qua dòng hỏng để bản ghi rách không làm hỏng phát lại.", ["đọc-sự-kiện", "phát-lại", "chịu-lỗi"], "moderate"),
"EventType": ("Liệt kê mọi loại sự kiện mà điều phối có thể phát ra để bên tiêu thụ điều phối không cần khớp chuỗi tự do.", ["loại-sự-kiện", "điều-phối", "lược-đồ"], "simple"),
"EngagementEvent": ("Một dòng trong events.jsonl với thời gian, loại, tác tử và tải trọng, kèm tuần tự hóa và phân tích chịu lỗi.", ["sự-kiện", "tuần-tự-hóa", "chịu-lỗi"], "moderate"),
"EventLog": ("Trình ghi events.jsonl append-only cho một chiến dịch, an toàn đa luồng/đa tiến trình nhờ khóa trong và khóa tệp.", ["nhật-ký", "ghi-thêm", "an-toàn-đồng-thời"], "complex"),
# asciicast
"_load_sidecar": ("Nạp file sidecar thời gian của phiên, trả về mốc tương đối hoặc None khi vắng mặt hay đọc lỗi.", ["sidecar", "thời-gian", "phiên"], "moderate"),
"_segments_from_markers": ("Cắt log theo mốc dấu nhắc, bỏ đoạn rỗng và giữ phần đuôi chưa đóng để không mất đầu ra cuối.", ["cắt-đoạn", "dấu-nhắc", "log"], "simple"),
"export_asciicast": ("Chuyển log pipe-pane thành file asciicast v2 kèm manifest mô tả chất lượng thời gian và kích thước.", ["asciicast", "xuất", "manifest", "phát-lại"], "moderate"),
"list_recordings": ("Liệt kê manifest của mọi bản ghi .cast dưới thư mục bằng chứng, bỏ qua file hỏng kèm cảnh báo.", ["liệt-kê", "bản-ghi", "manifest"], "simple"),
"AsciicastExportError": ("Ngoại lệ khi không thể chuyển đổi do thiếu log hay sidecar sai định dạng.", ["lỗi-xuất", "asciicast", "ngoại-lệ"], "simple"),
# evidence tools
"_json": ("Tuần tự hóa dữ liệu thành chuỗi JSON canh lề để agent dễ đọc.", ["json", "tuần-tự-hóa"], "simple"),
"_workspace": ("Phân giải thư mục workspace chiến dịch từ biến môi trường với dự phòng /workspace.", ["workspace", "biến-môi-trường"], "simple"),
"_evidence_dir": ("Dựng đường dẫn thư mục bản ghi evidence/recordings trong workspace hiện tại.", ["bằng-chứng", "đường-dẫn"], "simple"),
"_evidence_root": ("Dựng gốc thư mục bằng chứng, cho phép ghi đè workspace qua tham số.", ["bằng-chứng", "đường-dẫn", "ghi-đè"], "simple"),
"_hmac_key": ("Lấy khóa HMAC kiểm toán từ biến môi trường, trả về None khi chưa cấu hình.", ["hmac", "khóa", "biến-môi-trường"], "simple"),
"_hmac_equal": ("So sánh HMAC bằng compare_digest để chống tấn công thời gian.", ["hmac", "so-sánh-an-toàn"], "simple"),
"_hash_file": ("Băm SHA-256 từng khối và đếm kích thước file bằng chứng.", ["sha-256", "băm", "kích-thước"], "simple"),
"_evidence_files": ("Liệt kê mọi file bằng chứng đã sắp xếp, loại trừ chính manifest chuỗi bảo quản.", ["liệt-kê", "bằng-chứng", "manifest"], "simple"),
"export_session_asciicast": ("Công cụ chuyển log pipe-pane của phiên tmux thành file .cast kèm sidecar để phát lại trên trình duyệt.", ["công-cụ", "asciicast", "xuất-phiên"], "moderate"),
"list_session_recordings": ("Công cụ liệt kê mọi bản ghi asciicast của chiến dịch hiện tại kèm số lượng và manifest.", ["công-cụ", "liệt-kê", "bản-ghi"], "simple"),
"seal_evidence": ("Công cụ niêm phong mọi file bằng chứng thành manifest chuỗi băm-HMAC append-only để phát hiện giả mạo.", ["niêm-phong", "chuỗi-bảo-quản", "hmac", "toàn-vẹn"], "complex"),
"verify_evidence": ("Công cụ xác minh manifest: băm lại file, kiểm tra chuỗi HMAC và báo lệch, thiếu hay đứt liên kết.", ["xác-minh", "chuỗi-bảo-quản", "lệch", "toàn-vẹn"], "complex"),
# filesystem
"filesystem_tools_without_execute": ("Lọc bỏ công cụ thực thi chung khỏi bề mặt filesystem để lệnh đi qua công cụ bash chuyên dụng.", ["filesystem", "lọc", "thực-thi"], "simple"),
# opplan
"_build_opplan_payload": ("Kết xuất OPPLAN thành tài liệu JSON ổn định có tóm tắt trạng thái, sắp xếp mục tiêu để diff sạch.", ["opplan", "kết-xuất", "tóm-tắt"], "moderate"),
"_live_sandbox_backend": ("Phân giải backend sandbox của lần chạy hiện tại thay vì backend lúc dựng đồ thị để tránh ghi nhầm silo.", ["backend", "sandbox", "đa-thuê"], "moderate"),
"_scoped_opplan_backend": ("Tạo backend giới hạn phạm vi workspace cho thao tác OPPLAN.", ["backend", "phạm-vi", "opplan"], "simple"),
"_read_text_from_backend": ("Đọc văn bản qua backend trừu tượng của deepagents.", ["đọc", "backend", "văn-bản"], "simple"),
"_write_text_to_backend": ("Ghi văn bản qua backend trừu tượng của deepagents.", ["ghi", "backend", "văn-bản"], "simple"),
"_persist_opplan_to_backend": ("Lưu OPPLAN qua backend vào opplan.json của workspace chiến dịch.", ["lưu-trữ", "opplan", "backend"], "moderate"),
"_format_opplan_for_agent": ("Định dạng OPPLAN thành văn bản dễ đọc cho agent kèm tóm tắt và danh sách mục tiêu.", ["định-dạng", "opplan", "tác-tử"], "moderate"),
"build_opplan_tools": ("Fabrik bảy công cụ OPPLAN CRUD chạy trực tiếp trên trạng thái, trả về Command cho đột biến.", ["opplan", "fabrik", "crud", "trạng-thái"], "complex"),
"_is_valid_transition": ("Kiểm tra một chuyển trạng thái mục tiêu có nằm trong đồ thị chuyển hợp lệ hay không.", ["chuyển-trạng-thái", "kiểm-tra", "mục-tiêu"], "simple"),
"_valid_next": ("Liệt kê các trạng thái kế tiếp hợp lệ từ trạng thái hiện tại của mục tiêu.", ["trạng-thái", "chuyển-đổi", "mục-tiêu"], "simple"),
# ops client
"resolve_socket_path": ("Phân giải đường dẫn socket opscontrol từ biến môi trường với dự phòng mặc định.", ["socket", "đường-dẫn", "cấu-hình"], "simple"),
"ops_available": ("Kiểm tra daemon có thực sự tiếp cận được bằng kết nối socket thay vì chỉ kiểm tra file tồn tại.", ["khả-dụng", "daemon", "socket"], "moderate"),
"OpsControlError": ("Ngoại lệ khi daemon trả về HTTP lỗi kèm mã trạng thái và thân phản hồi.", ["lỗi-http", "daemon", "ngoại-lệ"], "simple"),
"OpsControlUnreachableError": ("Ngoại lệ khi daemon không tiếp cận được, gợi ý dựng stack bằng launcher.", ["không-tiếp-cận", "daemon", "chẩn-đoán"], "simple"),
"OpsControlClient": ("Client httpx mỏng quanh API opscontrol, mỗi cuộc gọi mở kết nối UDS mới rồi đóng.", ["client", "uds", "api", "workload"], "moderate"),
# ops tools
"_envelope": ("Bọc tải trọng thành JSON sắp xếp khóa để agent phân tích ổn định.", ["json", "bọc", "ổn-định"], "simple"),
"_diagnose_unreachable": ("Dựng phong bì lỗi khi daemon không tiếp cận được kèm gợi ý dùng launcher.", ["chẩn-đoán", "không-tiếp-cận", "gợi-ý"], "simple"),
"_diagnose_http": ("Dựng phong bì lỗi HTTP từ daemon kèm mã trạng thái và thân.", ["chẩn-đoán", "lỗi-http"], "simple"),
"_current_engagement": ("Phân giải slug chiến dịch từ cấu hình lần chạy LangGraph với dự phòng biến môi trường.", ["chiến-dịch", "cấu-hình-lần-chạy", "phạm-vi-luồng"], "moderate"),
"ops_start": ("Công cụ khởi tạo workload theo danh mục cho phép, tự gắn thẻ chiến dịch từ cấu hình lần chạy.", ["khởi-động", "workload", "điều-phối"], "moderate"),
"ops_stop": ("Công cụ dừng workload đã khởi động, coi dừng lặp là lũy đẳng.", ["dừng", "workload", "lũy-đẳng"], "simple"),
"ops_cleanup_engagement": ("Công cụ dừng hàng loạt mọi workload gắn thẻ chiến dịch hiện tại khi đóng chiến dịch.", ["dọn-dẹp", "chiến-dịch", "workload"], "moderate"),
"ops_status": ("Công cụ liệt kê mọi workload daemon đã chạm kèm backend, allowlist và trạng thái.", ["trạng-thái", "workload", "liệt-kê"], "simple"),
# skills
"_default_skill_registry": ("Trả về registry skill đóng gói dạng cache, tương thích cả cài đặt chỉnh sửa và wheel.", ["registry", "cache", "đóng-gói"], "simple"),
"_strip_frontmatter": ("Tách khối frontmatter YAML đầu file, chỉ phân tích cặp khóa-giá trị phẳng.", ["frontmatter", "tách", "markdown"], "simple"),
"_read_via_backend": ("Đọc file qua giao thức backend, chuẩn hóa định dạng cũ và báo lỗi thay vì ném ngoại lệ.", ["đọc", "backend", "chuẩn-hóa"], "moderate"),
"_list_dir_via_backend": ("Liệt kê file .md qua backend đã sắp xếp, suy giảm êm khi backend lỗi.", ["liệt-kê", "backend", "suy-giảm-êm"], "simple"),
"_validate_skill_path": ("Kiểm tra đường dẫn skill theo định dạng và allowlist, trả về chuỗi lỗi thay vì ném ngoại lệ.", ["kiểm-tra", "đường-dẫn", "allowlist"], "moderate"),
"_short_path_candidates": ("Mở rộng đường dẫn tương đối thành các ứng viên /skills/ chuẩn.", ["đường-dẫn", "mở-rộng", "ứng-viên"], "simple"),
"_format_ambiguous_skill": ("Định dạng thông báo lỗi mơ hồ kèm danh sách đường dẫn chính xác để agent chọn.", ["mơ-hồ", "định-dạng", "lỗi"], "simple"),
"_resolve_skill_path": ("Phân giải đường dẫn chính xác, tương đối hay slug thành đường dẫn skill an toàn.", ["phân-giải", "slug", "an-toàn"], "moderate"),
"_format_skill_body": ("Dựng tiêu đề thư mục gốc và thân skill đã tách frontmatter để trả về cho agent.", ["định-dạng", "thân-skill", "tiêu-đề"], "simple"),
"build_load_skill_tool": ("Fabrik công cụ load_skill gắn bao đóng backend/nguồn/registry để đọc toàn văn skill.", ["fabrik", "load-skill", "backend"], "moderate"),
# skills_registry
"normalize_slug": ("Chuẩn hóa slug về chữ thường với gạch nối, chuyển khoảng trắng/gạch dưới.", ["slug", "chuẩn-hóa"], "simple"),
"is_safe_skill_path": ("Kiểm tra đường dẫn skill ảo an toàn: tiền tố, đuôi .md, không backslash hay .. .", ["an-toàn", "đường-dẫn", "kiểm-tra"], "simple"),
"_frontmatter": ("Phân tích frontmatter phẳng thành từ điển, trả rỗng khi không có khối hợp lệ.", ["frontmatter", "phân-tích"], "simple"),
"_walk_skills_root": ("Duyệt mọi file .md dưới gốc skill và sinh cặp đường dẫn thực/ảo.", ["duyệt", "skill", "đường-dẫn-ảo"], "simple"),
"iter_skill_records": ("Duyệt gốc skill thành từng bản ghi với slug, tên và mô tả từ frontmatter.", ["duyệt", "bản-ghi", "frontmatter"], "moderate"),
"build_registry_from_package": ("Dựng registry từ cây skill đóng gói trong package.", ["registry", "đóng-gói", "dựng"], "simple"),
"resolve_skill": ("Phân giải truy vấn theo thứ tự id chính xác, slug, tên rồi mờ dần kèm lọc nguồn và chống đoán mò.", ["phân-giải", "slug", "mờ", "nguồn"], "complex"),
"list_skill_strings": ("Liệt kê chuỗi slug — id — mô tả đã sắp xếp, lọc tùy chọn theo từ khóa.", ["liệt-kê", "slug", "lọc"], "simple"),
"SkillRecord": ("Một file skill markdown đã phát hiện với id chuẩn, slug, tên, mô tả và nguồn allowlist.", ["bản-ghi", "skill", "siêu-dữ-liệu"], "simple"),
"AmbiguousSkill": ("Kết quả phân giải mơ hồ mang truy vấn và các ứng viên để agent tự làm rõ.", ["mơ-hồ", "ứng-viên", "phân-giải"], "simple"),
}

TEST_FILE_CTX = {
"packages/raptix/tests/unit/agents/test_build.py": ("cơ chế dựng agent", "dựng-agent"),
"packages/raptix/tests/unit/agents/test_if_skill_contract.py": ("hợp đồng skill", "hợp-đồng-skill"),
"packages/raptix/tests/unit/cli/test_audit.py": ("CLI kiểm toán", "cli-kiểm-toán"),
"packages/raptix/tests/unit/cli/test_auth.py": ("CLI xác thực", "cli-xác-thực"),
"packages/raptix/tests/unit/cli/test_auth_branches.py": ("các nhánh CLI xác thực", "cli-xác-thực"),
"packages/raptix/tests/unit/cli/test_export_transcript.py": ("xuất bản ghi", "xuất-bản-ghi"),
"packages/raptix/tests/unit/cli/test_scan.py": ("lệnh quét", "quét"),
"packages/raptix/tests/unit/cli/test_scan_extra.py": ("lệnh quét mở rộng", "quét-mở-rộng"),
"packages/raptix/tests/unit/cli/test_zip.py": ("xuất/nhập lưu trữ", "lưu-trữ"),
"packages/raptix/tests/unit/core/test_dispatch_boundary.py": ("ranh giới điều phối", "điều-phối"),
"packages/raptix/tests/unit/core/test_subagent_streaming.py": ("truyền trực tiếp sub-agent", "sub-agent"),
"packages/raptix/tests/unit/core/test_subagent_streaming_guard.py": ("chốt chặn truyền trực tiếp", "chốt-chặn"),
"packages/raptix/tests/unit/core/test_subagent_transcript_state.py": ("trạng thái bản ghi", "bản-ghi"),
"packages/raptix/tests/unit/llm/test_factory.py": ("nhà máy LLM", "nhà-máy-llm"),
"packages/raptix/tests/unit/llm/test_factory_attribution.py": ("ghi công nhà cung cấp", "ghi-công"),
"packages/raptix/tests/unit/llm/test_factory_classify_errors.py": ("phân loại lỗi LLM", "phân-loại-lỗi"),
"packages/raptix/tests/unit/llm/test_factory_fallback_execution.py": ("thực thi dự phòng LLM", "dự-phòng"),
"packages/raptix/tests/unit/llm/test_factory_url_redaction.py": ("che URL", "che-url"),
"packages/raptix/tests/unit/llm/test_provider_controls.py": ("kiểm soát nhà cung cấp", "kiểm-soát"),
"packages/raptix/tests/unit/llm/test_role_model_override.py": ("ghi đè mô hình theo vai trò", "ghi-đè"),
"packages/raptix/tests/unit/llm/test_router.py": ("bộ định tuyến mô hình", "định-tuyến"),
"packages/raptix/tests/unit/middleware/test_audit_sink.py": ("bộ thu kiểm toán", "bộ-thu"),
"packages/raptix/tests/unit/middleware/test_budget.py": ("middleware ngân sách", "ngân-sách"),
}

TOKEN_VI = {
"test": "Kiểm thử", "verify": "xác minh", "clean": "sạch", "ledger": "sổ cái", "text": "văn bản",
"tampered": "bị giả mạo", "hmac": "HMAC", "env": "biến môi trường", "wrong": "sai", "key": "khóa",
"fails": "thất bại", "fail": "lỗi", "missing": "thiếu", "config": "cấu hình", "error": "lỗi",
"errors": "lỗi", "routes": "định tuyến", "route": "định tuyến", "top": "cấp cao nhất", "dispatcher": "bộ điều phối",
"inventory": "kiểm kê", "nothing": "chưa cấu hình gì", "api": "API", "active": "đang hoạt động",
"gateway": "cổng", "method": "phương thức", "placeholder": "giữ chỗ", "subscription": "gói đăng ký",
"auto": "tự động", "priority": "ưu tiên", "omits": "bỏ sót", "omit": "bỏ sót", "explicit": "tường minh",
"status": "trạng thái", "doctor": "chẩn đoán", "exit": "mã thoát", "codes": "mã", "code": "mã",
"glyph": "biểu tượng", "happy": "thành công", "path": "đường dẫn", "never": "không bao giờ",
"live": "trực tiếp", "empty": "rỗng", "guard": "chặn", "oserror": "lỗi hệ điều hành", "zero": "bằng không",
"home": "thư mục chính", "whitespace": "khoảng trắng", "falls": "rơi về", "fall": "rơi về",
"through": "qua", "none": "không có", "exists": "tồn tại", "render": "kết xuất", "resolved": "đã phân giải",
"chain": "chuỗi", "shows": "hiển thị", "show": "hiển thị", "warning": "cảnh báo", "warn": "cảnh báo",
"idle": "nhàn rỗi", "skipped": "bị bỏ qua", "skip": "bỏ qua", "skips": "bỏ qua", "main": "hàm chính",
"found": "tìm thấy", "existing": "hiện có", "loaded": "được nạp", "loads": "nạp", "load": "nạp",
"default": "mặc định", "discovery": "tự phát hiện", "returns": "trả về", "return": "trả về", "nonzero": "khác không", "fake": "giả lập", "failure": "thất bại",
"cleanly": "sạch sẽ", "utf8": "UTF-8", "without": "mà không", "raising": "ném ngoại lệ", "raises": "ném lỗi",
"raise": "ném lỗi", "export": "xuất", "stdout": "đầu ra chuẩn", "chronological": "thứ tự thời gian",
"order": "thứ tự", "output": "đầu ra", "workspace": "không gian làm việc", "defaults": "mặc định",
"engagement": "chiến dịch", "generic": "chung", "rendered": "được kết xuất", "parser": "bộ phân tích",
"accepts": "chấp nhận", "accept": "chấp nhận", "compatible": "tương thích", "flags": "cờ",
"multiple": "nhiều", "targets": "mục tiêu", "target": "mục tiêu", "repeat": "lặp", "flag": "cờ",
"rejects": "từ chối", "reject": "từ chối", "http": "HTTP", "urls": "URL", "url": "URL", "git": "Git",
"nonexistent": "không tồn tại", "uses": "sử dụng", "use": "sử dụng", "supplied": "được cung cấp",
"timestamped": "gắn thời gian", "instruction": "chỉ thị", "combines": "kết hợp", "combine": "kết hợp",
"write": "ghi", "sarif": "SARIF", "gate": "cổng kiểm soát", "graph": "đồ thị", "high": "mức cao",
"finding": "phát hiện", "findings": "phát hiện", "only": "chỉ", "low": "mức thấp", "ok": "thành công",
"unset": "chưa đặt", "disjoint": "rời nhau", "diff": "diff Git", "changed": "đã thay đổi",
"nonzero": "khác không", "strips": "loại bỏ", "strip": "loại bỏ", "emit": "phát", "prints": "in",
"print": "in", "valid": "hợp lệ", "handles": "xử lý", "handle": "xử lý", "serializable": "tuần tự hóa được",
"sdk": "SDK", "async": "bất đồng bộ", "asyncio": "asyncio", "timeout": "hết thời gian",
"interactive": "tương tác", "propagates": "lan truyền", "exception": "ngoại lệ", "verbose": "chi tiết",
"sets": "đặt", "set": "đặt", "debug": "gỡ lỗi", "logging": "ghi nhật ký", "creates": "tạo",
"create": "tạo", "archive": "tập lưu trữ", "prefix": "tiền tố", "restores": "khôi phục",
"restore": "khôi phục", "files": "tệp", "file": "tệp", "round": "vòng", "trip": "khứ hồi",
"via": "qua", "cli": "CLI", "back": "dự phòng", "unknown": "không xác định", "traversal": "vượt đường dẫn",
"symlink": "liên kết mềm", "entry": "mục", "refuses": "từ chối", "refuse": "từ chối",
"overwrite": "ghi đè", "force": "cưỡng bức", "replaces": "thay thế", "replace": "thay thế",
"stale": "cũ", "task": "tác vụ", "tasks": "tác vụ", "parent": "cha", "receives": "nhận",
"typed": "có kiểu", "terminal": "kết thúc", "redispatch": "điều phối lại", "preserves": "giữ nguyên",
"preserve": "giữ nguyên", "parallel": "song song", "keep": "giữ", "identity": "định danh",
"separate": "riêng biệt", "unbound": "chưa ràng buộc", "description": "mô tả", "scoped": "có phạm vi",
"scope": "phạm vi", "remains": "vẫn", "reusable": "tái sử dụng được", "kind": "loại",
"diagnostic": "chẩn đoán", "policy": "chính sách", "runtime": "thời gian chạy", "param": "tham số",
"survives": "vượt qua", "schema": "lược đồ", "validation": "kiểm tra", "counting": "đếm",
"dummy": "giả", "invoke": "gọi", "state": "trạng thái", "double": "kép", "exec": "thực thi",
"toggle": "chuyển đổi", "sync": "đồng bộ", "transcript": "bản ghi", "returned": "được trả về",
"reduce": "rút gọn", "concat": "nối", "extends": "mở rộng", "extend": "mở rộng", "agent": "tác tử",
"agents": "tác tử", "real": "thực", "oauth": "OAuth", "credentials": "thông tin xác thực",
"credential": "thông tin xác thực", "present": "hiện diện", "max": "tối đa", "tokens": "token",
"token": "token", "resolution": "phân giải", "health": "sức khỏe", "check": "kiểm tra",
"resolve": "phân giải", "temperature": "nhiệt độ", "drop": "giảm", "actionable": "khả thi",
"translation": "chuyển đổi", "reasoning": "suy luận", "content": "nội dung", "local": "cục bộ",
"attribution": "ghi công", "provider": "nhà cung cấp", "classify": "phân loại", "retryable": "thử lại được",
"fatal": "nghiêm trọng", "forbidden": "bị cấm", "unclassified": "chưa phân loại", "secret": "bí mật",
"net": "mạng", "fallback": "dự phòng", "execution": "thực thi", "rate": "tốc độ", "limit": "giới hạn",
"handler": "bộ xử lý", "redacts": "che", "redact": "che", "user": "người dùng", "password": "mật khẩu",
"plain": "thường", "unchanged": "không đổi", "https": "HTTPS", "preserved": "được giữ",
"preserve_": "được giữ", "substring": "chuỗi con", "extra": "bổ sung", "headers": "tiêu đề",
"header": "tiêu đề", "string": "chuỗi", "map": "ánh xạ", "malformed": "sai định dạng",
"protected": "được bảo vệ", "values": "giá trị", "value": "giá trị", "disable": "tắt",
"streaming": "truyền trực tiếp", "requires": "yêu cầu", "boolean": "boolean", "compose": "tổng hợp",
"assignment": "phân công", "model": "mô hình", "models": "mô hình", "router": "bộ định tuyến",
"post": "sau", "init": "khởi tạo", "str": "chuỗi", "ensure": "đảm bảo", "hydrated": "được nạp đủ",
"blanks": "dòng trống", "blank": "dòng trống", "corrupt": "hỏng", "append": "ghi thêm",
"fsync": "đồng bộ đĩa", "edge": "biên", "cases": "trường hợp", "case": "trường hợp",
"iter": "duyệt", "records": "bản ghi", "record": "bản ghi", "integration": "tích hợp",
"spend": "chi tiêu", "cache": "bộ nhớ đệm", "get": "lấy", "miss": "trượt", "eviction": "loại bỏ",
"capacity": "dung lượng", "disabled": "bị tắt", "caps": "hạn mức", "under": "dưới", "cap": "hạn mức",
"over": "vượt", "exceeded": "vượt quá", "exceed": "vượt quá", "per": "theo", "checked": "được kiểm tra",
"separately": "riêng biệt", "swallowed": "bị nuốt", "swallow": "bị nuốt", "soft": "mềm",
"fires": "kích hoạt", "fire": "kích hoạt", "once": "một lần", "tag": "gắn thẻ", "request": "yêu cầu",
"injects": "chèn", "inject": "chèn", "body": "thân", "idempotent": "lũy đẳng", "noop": "không tác động",
"plugin": "plugin", "bundle": "gói", "bundles": "các gói", "unrestricted": "không giới hạn",
"matches": "khớp", "match": "khớp", "every": "mọi", "filter": "lọc", "filters": "lọc",
"yields": "sinh", "yield": "sinh", "wins": "ưu tiên", "win": "ưu tiên", "merges": "hợp nhất",
"merge": "hợp nhất", "safety": "an toàn", "blocks": "chặn", "block": "chặn", "disabling": "vô hiệu hóa",
"critical": "trọng yếu", "replacing": "thay thế", "slot": "khe", "slots": "khe", "bypass": "bỏ qua",
"allows": "cho phép", "allow": "cho phép", "tools": "công cụ", "tool": "công cụ", "dict": "từ điển",
"baseline": "cơ sở", "drops": "loại bỏ", "drop": "loại bỏ", "by": "theo", "name": "tên",
"prompt": "lời nhắc", "means": "nghĩa là", "keeps": "giữ", "keep_": "giữ", "prepend": "thêm đầu",
"skills": "kỹ năng", "skill": "kỹ năng", "sources": "nguồn", "source": "nguồn", "appends": "thêm vào",
"paths": "đường dẫn", "threads": "luồng", "thread": "luồng", "factory": "nhà máy", "mapping": "ánh xạ",
"final": "cuối cùng", "report": "báo cáo", "orchestrator": "điều phối", "worker": "worker",
"directories": "thư mục", "directory": "thư mục", "exploit": "khai thác", "dispatches": "điều phối",
"dispatch": "điều phối", "instead": "thay vì", "calling": "gọi", "call": "gọi", "calls": "gọi",
"opplan": "OPPLAN", "budget": "ngân sách", "audit": "kiểm toán", "sink": "bộ thu", "build": "dựng",
"middleware": "middleware", "roles": "vai trò", "role": "vai trò", "cond": "điều kiện",
"agentic": "tác tử", "if": "điều kiện", "contract": "hợp đồng", "zip": "ZIP", "import": "nhập",
"scan": "quét", "auth": "xác thực", "an": "một", "a": "một", "the": "này", "and": "và",
"or": "hoặc", "for": "cho", "with": "với", "when": "khi", "succeeds": "thành công",
"that": "mà", "from": "từ", "into": "vào", "are": "là", "is": "là", "was": "đã",
"were": "đã", "has": "có", "have": "có", "does": "thực hiện", "not": "không", "no": "không",
"in": "trong", "on": "trên", "of": "của", "to": "tới",
}

def vi_test_summary(func_name, file_path):
    ctx, _ = TEST_FILE_CTX.get(file_path, ("mô-đun liên quan", "lien-quan"))
    core = func_name
    if core.startswith("test_"):
        core = core[5:]
    toks = [t for t in re.split(r"_+", core) if t]
    words = []
    for t in toks:
        tl = t.lower()
        if tl in TOKEN_VI:
            words.append(TOKEN_VI[tl])
        else:
            words.append(t.replace("-", " "))
    # Viet hoa chu dau, loai bo lap "Kiem thu"
    desc = " ".join(words)
    desc = re.sub(r"\s+", " ", desc).strip()
    if desc:
        desc = desc[0].upper() + desc[1:] if len(desc) > 1 else desc.upper()
    else:
        desc = "Trường hợp kiểm thử"
    return f"Kiểm thử {ctx}: {desc.lower()}." if False else f"Kiểm thử {ctx} — {desc}."

def complexity_by_lines(n):
    if n <= 15:
        return "simple"
    if n <= 60:
        return "moderate"
    return "complex"

nodes, edges = [], []

def file_id(p): return f"file:{p}"
def func_id(p, n): return f"function:{p}:{n}"
def class_id(p, n): return f"class:{p}:{n}"

# file nodes
for f in batch["files"]:
    p = f["path"]
    summ, tags, cpl = FILE_META[p]
    base = p.split("/")[-1]
    nodes.append({"id": file_id(p), "type": "file", "name": base, "filePath": p,
                  "summary": summ, "tags": tags, "complexity": cpl})

# function/class nodes
func_index = {}  # (path,name.lower()) -> id
for p, r in results.items():
    for fn in r.get("functions", []):
        n = fn["name"]
        sl, el = fn["startLine"], fn["endLine"]
        span = el - sl + 1
        if n in RUNTIME_SUM:
            summ, tags, cpl = RUNTIME_SUM[n]
        else:
            summ = vi_test_summary(n, p)
            ctx, mod = TEST_FILE_CTX.get(p, ("mô-đun liên quan", "lien-quan"))
            if n.startswith("test_") or n.startswith("Test"):
                tags = ["kiểm-thử", mod]
            elif n.startswith("_"):
                tags = ["trợ-giúp", mod]
            else:
                tags = ["hàm", mod]
            cpl = complexity_by_lines(span)
        nodes.append({"id": func_id(p, n), "type": "function", "name": n, "filePath": p,
                      "lineRange": [sl, el], "summary": summ, "tags": tags, "complexity": cpl})
        func_index[(p, n.lower())] = func_id(p, n)
    for cl in r.get("classes", []):
        n = cl["name"]
        sl, el = cl["startLine"], cl["endLine"]
        span = el - sl + 1
        if n in RUNTIME_SUM:
            summ, tags, cpl = RUNTIME_SUM[n]
        else:
            ctx, mod = TEST_FILE_CTX.get(p, ("mô-đun liên quan", "lien-quan"))
            if n.startswith("Test"):
                # tao mo ta cu the hon tu ten lop
                core = re.sub(r"^Test", "", n)
                parts = re.findall(r"[A-Z][a-z0-9]*", core) or [core]
                vi_parts = []
                for pt in parts:
                    tl = pt.lower()
                    vi_parts.append(TOKEN_VI.get(tl, pt).lower() if tl not in ("test",) else "")
                desc = " ".join([w for w in vi_parts if w]).strip() or "lớp kiểm thử"
                summ = f"Lớp kiểm thử {ctx}: {desc}."
            else:
                summ = f"Lớp trợ giúp kiểm thử {n} trong {ctx}."
            tags = ["kiểm-thử", mod]
            cpl = complexity_by_lines(span)
        nodes.append({"id": class_id(p, n), "type": "class", "name": n, "filePath": p,
                      "lineRange": [sl, el], "summary": summ, "tags": tags, "complexity": cpl})

node_ids = {n["id"] for n in nodes}

# contains + exports
for p, r in results.items():
    local_names = {}
    for fn in r.get("functions", []):
        local_names[fn["name"]] = func_id(p, fn["name"])
    for cl in r.get("classes", []):
        local_names[cl["name"]] = class_id(p, cl["name"])
    for name, tid in local_names.items():
        edges.append({"source": file_id(p), "target": tid, "type": "contains", "direction": "forward", "weight": 1.0})
    for e in r.get("exports", []):
        en = e["name"]
        if en in local_names:
            edges.append({"source": file_id(p), "target": local_names[en], "type": "exports", "direction": "forward", "weight": 0.8})

# imports 1:1 batchImportData
for src, deps in batch["batchImportData"].items():
    for ddep in deps:
        edges.append({"source": file_id(src), "target": file_id(ddep), "type": "imports", "direction": "forward", "weight": 0.7})

# tested_by: dao nguoc test -> source
for tpath, deps in batch["batchImportData"].items():
    if "/tests/" in tpath or "/test" in tpath:
        for s in deps:
            edges.append({"source": file_id(s), "target": file_id(tpath), "type": "tested_by", "direction": "forward", "weight": 0.5})

# calls: noi suy trong cung file
for p, r in results.items():
    fmap = {}
    for fn in r.get("functions", []):
        fmap[fn["name"].lower()] = func_id(p, fn["name"])
    for c in r.get("callGraph", []):
        caller, callee = c.get("caller"), c.get("callee")
        if not caller or not callee:
            continue
        base = callee.split(".")[-1].strip()
        if not base:
            continue
        src = fmap.get(caller.lower())
        tgt = fmap.get(base.lower())
        if src and tgt and src != tgt:
            # tranh trung lap
            edges.append({"source": src, "target": tgt, "type": "calls", "direction": "forward", "weight": 0.8})

# khu trung edges
seen, uniq = set(), []
for e in edges:
    k = (e["source"], e["target"], e["type"])
    if k not in seen:
        seen.add(k)
        uniq.append(e)
edges = uniq

data = {"batchIndex": 8, "batchFiles": batch["files"], "nodes": nodes, "edges": edges}
json.dump(data, open(UA + r"\intermediate\batch-8.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)
print(f"nodes={len(nodes)} edges={len(edges)} files={len(batch['files'])}")
from collections import Counter
print("node types:", dict(Counter(n['type'] for n in nodes)))
print("edge types:", dict(Counter(e['type'] for e in edges)))
# kiem tra ID prefix
bad = [n['id'] for n in nodes if not re.match(r"^(file|function|class|config|document|service|pipeline|resource|table|schema|endpoint):", n['id'])]
print("bad node ids:", bad[:5], len(bad))
bad_e = [e for e in edges if e['type'] not in ("contains","exports","imports","calls","inherits","implements","depends_on","tested_by")]
print("bad edge types:", bad_e[:2])
