# -*- coding: utf-8 -*-
"""Sinh batch-5.json tu batchImportData + ket qua extract-structure (batch 5)."""
import json

UA = r"D:/.VTNet/redteam/raptix/.ua"
batches = json.load(open(UA + "/intermediate/batches.json", encoding="utf-8"))
batch = [x for x in batches["batches"] if x.get("batchIndex") == 5][0]
batch_files = batch["files"]
batch_import = batch["batchImportData"]
neighbor = batch["neighborMap"]
ext = json.load(open(UA + "/tmp/ua-file-extract-results-5.json", encoding="utf-8"))
results = {r["path"]: r for r in ext["results"]}
nonempty = {r["path"]: r.get("nonEmptyLines", 0) for r in ext["results"]}

def fcx(n):
    if n < 50:
        return "simple"
    if n <= 200:
        return "moderate"
    return "complex"

def fncx(s, e):
    n = e - s + 1
    if n < 15:
        return "simple"
    if n <= 40:
        return "moderate"
    return "complex"

# ---------- File nodes (tieng Viet) ----------
# path -> (summary, tags, languageNotes|None)
FILES = {
"clients/launcher/internal/migrate/migrate_test.go": (
    "Bộ kiểm thử cho cơ chế migration của launcher, bao phủ bước chạy tương tác/không tương tác, tái đồng thuận telemetry và backfill biến môi trường.",
    ["test", "migration", "telemetry", "env-backfill"], None),
"clients/launcher/internal/migrate/steps.go": (
    "Đăng ký và thi hành các bước migration khi nâng cấp launcher: backfill env từ mẫu nhúng và hỏi lại đồng thuận telemetry.",
    ["migration", "upgrade", "telemetry", "env-backfill"], None),
"clients/launcher/internal/opscontrol/allowlist.go": (
    "Quản lý danh sách workload opscontrol được phép: nạp từ catalog mặc định cộng biến môi trường và kiểm tra tên hợp lệ.",
    ["allowlist", "workload", "validation", "security"], None),
"clients/launcher/internal/opscontrol/allowlist_test.go": (
    "Kiểm thử nạp allowlist mặc định, mục bổ sung qua env và logic từ chối tên không hợp lệ hoặc lạ.",
    ["test", "allowlist", "validation"], None),
"clients/launcher/internal/opscontrol/backend.go": (
    "Định nghĩa interface Backend cùng các kiểu Handle và WorkloadStatus cho việc quản lý workload opscontrol.",
    ["interface", "backend", "workload", "type-definition"],
    "File thuần định nghĩa interface Go, quy ước tên phương thức Start/Stop/List/Name cho mọi backend."),
"clients/launcher/internal/opscontrol/docker_compose_backend.go": (
    "Backend Docker Compose triển khai khởi động, dừng và liệt kê workload, sinh file override gắn nhãn run-id riêng cho từng lần chạy.",
    ["docker-compose", "backend", "workload", "deployment"], None),
"clients/launcher/internal/opscontrol/docker_compose_labels_test.go": (
    "Kiểm thử việc sinh compose override gắn nhãn bao phủ mọi service trong file compose.",
    ["test", "docker-compose", "labels"], None),
"clients/launcher/internal/opscontrol/launchd.go": (
    "Triển khai ServiceManager cho macOS launchd: cài đặt, gỡ bỏ, khởi động/dừng service và sinh file plist.",
    ["macos", "launchd", "service-manager", "deployment"], None),
"clients/launcher/internal/opscontrol/paths.go": (
    "Các hàm tính đường dẫn runtime (socket, PID, tên stack/project compose) và dựng biến môi trường cho lệnh compose.",
    ["paths", "compose", "runtime", "utility"], None),
"clients/launcher/internal/opscontrol/registry.go": (
    "Registry nội bộ theo dõi trạng thái workload theo engagement, dùng mutex riêng từng workload để an toàn đồng thời.",
    ["registry", "state-tracking", "concurrency", "workload"], None),
"clients/launcher/internal/opscontrol/server.go": (
    "HTTP server của opscontrol giao tiếp qua Unix socket, xử lý health, list, start/stop workload và dọn dẹp theo engagement.",
    ["http-server", "opscontrol", "workload", "api-handler"],
    "Server Go dùng http.ServeMux trên Unix socket, serialize start đồng thời bằng khóa registry theo workload."),
"clients/launcher/internal/opscontrol/server_test.go": (
    "Kiểm thử server opscontrol với backend giả: envelope health, chặn workload lạ và traversal, start idempotent, serialize đồng thời và cleanup engagement.",
    ["test", "http-server", "opscontrol", "concurrency"], None),
"clients/launcher/internal/opscontrol/service.go": (
    "Trừu tượng ServiceManager đa nền tảng: tự phát hiện systemd hoặc launchd, dự phòng bằng bản triển khai noop.",
    ["service-manager", "cross-platform", "abstraction", "factory"], None),
"clients/launcher/internal/opscontrol/service_test.go": (
    "Kiểm thử hợp đồng của noop manager, logic phát hiện service manager và chuẩn hóa tên project compose cùng tên stack.",
    ["test", "service-manager", "compose"], None),
"clients/launcher/internal/opscontrol/systemd.go": (
    "Triển khai ServiceManager cho Linux systemd: ghi unit file, dọn drop-in của binary đã chết, điều khiển enable/start/stop.",
    ["linux", "systemd", "service-manager", "deployment"], None),
"clients/launcher/internal/opscontrol/systemd_test.go": (
    "Kiểm thử logic dọn drop-in systemd: xóa override của binary đã chết, giữ override còn hiệu lực và chấp nhận tiền tố modifier.",
    ["test", "systemd", "cleanup"], None),
"clients/launcher/internal/platform/platform.go": (
    "Phát hiện môi trường WSL và trích địa chỉ IP host WSL từ resolv.conf cho launcher.",
    ["wsl", "platform-detection", "networking"], None),
"clients/launcher/internal/platform/platform_test.go": (
    "Kiểm thử phát hiện WSL qua nội dung file version và trích nameserver đầu tiên của resolv.conf.",
    ["test", "wsl", "platform-detection"], None),
"clients/launcher/internal/platform/system.go": (
    "Thu thập thông tin hệ thống (distro Linux, Docker, gợi ý cài đặt) và nhãn OS phục vụ kiểm tra điều kiện tiên quyết.",
    ["system-info", "docker", "prerequisites", "utility"], None),
"clients/launcher/internal/platform/system_test.go": (
    "Kiểm thử phân tích distro, cờ Docker, nhãn OS và gợi ý cài đặt Docker theo từng nền tảng.",
    ["test", "system-info", "docker"], None),
"clients/launcher/internal/runtime/runtime.go": (
    "Phát hiện và mô tả runtime container (Docker/Podman, rootless, socket, compose) rồi áp DOCKER_HOST vào môi trường.",
    ["container-runtime", "docker", "podman", "detection"],
    "Dò runtime bằng cách gọi binary docker/podman và đọc biến môi trường, phân biệt rõ chế độ rootless."),
"clients/launcher/internal/runtime/runtime_test.go": (
    "Kiểm thử hiển thị chuỗi runtime, áp DOCKER_HOST và xử lý override phát hiện không hợp lệ.",
    ["test", "container-runtime", "docker"], None),
"clients/launcher/internal/starprompt/browser.go": (
    "Mở URL kho Raptix trên trình duyệt theo từng hệ điều hành, ưu tiên wslview khi chạy trong WSL.",
    ["browser", "deep-link", "cross-platform", "utility"], None),
"clients/launcher/internal/starprompt/gh.go": (
    "Kiểm tra CLI gh khả dụng, truy vấn trạng thái star của repo và thực hiện star qua gh khi được đồng ý.",
    ["github-cli", "star-prompt", "integration"], None),
"clients/launcher/internal/starprompt/starprompt.go": (
    "Luồng nhắc star GitHub một lần sau cài đặt: kiểm tra file ack và stdin tương tác, star qua gh hoặc mở trình duyệt dự phòng.",
    ["star-prompt", "onboarding", "github", "interactive"], None),
"clients/launcher/internal/starprompt/starprompt_test.go": (
    "Kiểm thử toàn bộ kịch bản star prompt với stub cho gh, trình duyệt và hộp thoại xác nhận trên thư mục home tạm.",
    ["test", "star-prompt", "onboarding"], None),
"clients/launcher/internal/ui/theme.go": (
    "Định nghĩa banner, màu trạng thái và theme huh/lipgloss cho giao diện terminal của launcher.",
    ["theme", "cli-ui", "styling", "lipgloss"],
    "Theme xây trên charm huh và lipgloss với điểm nhấn đỏ Raptix cho form tương tác."),
"clients/launcher/internal/updater/checksums_test.go": (
    "Kiểm thử phân tích manifest checksum SHA-256 và xác thực file tải về đúng cũng như sai hash.",
    ["test", "checksum", "sha256", "update"], None),
"clients/launcher/internal/updater/reexec_unix.go": (
    "Thay thế tiến trình hiện tại bằng binary mới qua syscall.Exec trên Unix sau khi tự cập nhật.",
    ["unix", "self-update", "reexec", "process"], None),
"clients/launcher/internal/updater/reexec_windows.go": (
    "Khởi chạy lại binary mới rồi thoát tiến trình cũ trên Windows sau khi tự cập nhật.",
    ["windows", "self-update", "reexec", "process"], None),
"clients/launcher/internal/updater/updater.go": (
    "Luồng tự cập nhật launcher: phân giải kênh release, so sánh semver, đồng bộ config có xác thực checksum và thay thế binary.",
    ["self-update", "release", "semver", "checksum"],
    "So sánh semver tự cài đặt (base số + prerelease), kênh stable yêu cầu thời gian soak sau publish."),
"clients/launcher/internal/updater/updater_test.go": (
    "Kiểm thử so sánh phiên bản, fetch release qua HTTP giả, tải file, thay binary, ghi version và các guard cập nhật.",
    ["test", "self-update", "semver", "http-mock"], None),
"clients/launcher/internal/updater/web_config_test.go": (
    "Kiểm thử đồng bộ config web: xác thực mọi file trước khi thay thế và giữ nguyên biến môi trường.",
    ["test", "config-sync", "web", "checksum"], None),
"clients/launcher/main.go": (
    "Điểm vào của launcher, ủy quyền toàn bộ xử lý cho lệnh gốc của CLI.",
    ["entry-point", "launcher", "cli"], None),
}

# ---------- Function/Class nodes ----------
# (path, kind, name) -> (summary, tags)
S = {
# migrate_test.go
("clients/launcher/internal/migrate/migrate_test.go","function","newTestCtx"): ("Dựng ngữ cảnh migration tạm với file env và ack mẫu cho kiểm thử.", ["test-helper","migration","setup"]),
("clients/launcher/internal/migrate/migrate_test.go","function","TestRun_NonInteractiveStepAlwaysRuns"): ("Xác minh bước không tương tác luôn chạy và đánh dấu ack.", ["test","migration","non-interactive"]),
("clients/launcher/internal/migrate/migrate_test.go","function","TestRun_InteractiveDeferredOnNonTTY"): ("Xác minh bước tương tác bị hoãn khi stdin không phải TTY.", ["test","migration","tty"]),
("clients/launcher/internal/migrate/migrate_test.go","function","TestRun_InteractiveRunsOnceThenAcked"): ("Xác minh bước tương tác chạy đúng một lần rồi ghi ack, lần sau bỏ qua.", ["test","migration","ack"]),
("clients/launcher/internal/migrate/migrate_test.go","function","TestTelemetryReconsent_Yes"): ("Xác minh người dùng đồng ý thì lựa chọn telemetry được lưu lại.", ["test","telemetry","consent"]),
("clients/launcher/internal/migrate/migrate_test.go","function","TestTelemetryReconsent_No"): ("Xác minh người dùng từ chối thì không ghi đè lựa chọn telemetry.", ["test","telemetry","consent"]),
("clients/launcher/internal/migrate/migrate_test.go","function","TestTelemetryReconsent_HardOptOutDoNotTrack"): ("Xác minh biến DO_NOT_TRACK buộc từ chối telemetry mà không cần hỏi.", ["test","telemetry","opt-out"]),
("clients/launcher/internal/migrate/migrate_test.go","function","TestTelemetryReconsent_HardOptOutMarker"): ("Xác minh file marker opt-out trên đĩa buộc từ chối telemetry.", ["test","telemetry","opt-out"]),
("clients/launcher/internal/migrate/migrate_test.go","function","TestEnvBackfillStepReflectsIntoEnv"): ("Xác minh bước backfill phản ánh giá trị mới vào file env.", ["test","env-backfill","migration"]),
("clients/launcher/internal/migrate/migrate_test.go","function","TestRunAll_ExistingUserUpgrade"): ("Kiểm thử đầu-cuối quy trình nâng cấp người dùng hiện hữu qua RunAll.", ["test","upgrade","end-to-end"]),
("clients/launcher/internal/migrate/migrate_test.go","function","assertEnvKey"): ("Trợ giúp đọc env và so sánh một khóa với giá trị mong đợi.", ["test-helper","env","assertion"]),
# steps.go
("clients/launcher/internal/migrate/steps.go","function","Registry"): ("Trả về danh sách các bước migration kèm cờ tương tác và mô tả.", ["migration","registry","factory"]),
("clients/launcher/internal/migrate/steps.go","function","applyEnvBackfill"): ("Backfill các khóa env còn thiếu từ mẫu nhúng rồi nạp lại env.", ["env-backfill","migration","config"]),
("clients/launcher/internal/migrate/steps.go","function","applyTelemetryReconsent"): ("Hỏi lại đồng thuận telemetry trừ khi có opt-out cứng, rồi lưu lựa chọn.", ["telemetry","consent","migration"]),
# allowlist.go
("clients/launcher/internal/opscontrol/allowlist.go","class","Allowlist"): ("Tập workload được phép kèm biểu thức kiểm tra tên.", ["allowlist","security","type-definition"]),
("clients/launcher/internal/opscontrol/allowlist.go","function","LoadAllowlist"): ("Nạp allowlist từ catalog mặc định cộng biến môi trường, báo lỗi khi tên sai định dạng.", ["allowlist","config","validation"]),
("clients/launcher/internal/opscontrol/allowlist.go","function","Permits"): ("Kiểm tra tên workload đúng định dạng và nằm trong danh sách cho phép.", ["allowlist","validation","security"]),
("clients/launcher/internal/opscontrol/allowlist.go","function","Members"): ("Trả về danh sách tên workload đã sắp xếp trong allowlist.", ["allowlist","listing","utility"]),
# allowlist_test.go
("clients/launcher/internal/opscontrol/allowlist_test.go","function","TestLoadAllowlist_DefaultsMatchCatalog"): ("Xác minh allowlist mặc định khớp catalog tích hợp.", ["test","allowlist","defaults"]),
("clients/launcher/internal/opscontrol/allowlist_test.go","function","TestLoadAllowlist_ExtraEnvAppends"): ("Xác minh mục bổ sung qua biến môi trường được nối vào allowlist.", ["test","allowlist","env"]),
("clients/launcher/internal/opscontrol/allowlist_test.go","function","TestLoadAllowlist_RejectsInvalidExtra"): ("Xác minh mục bổ sung sai định dạng khiến nạp thất bại.", ["test","allowlist","validation"]),
("clients/launcher/internal/opscontrol/allowlist_test.go","function","TestPermits_RejectsIllegalNames"): ("Xác minh tên chứa ký tự nguy hiểm kiểu traversal bị từ chối.", ["test","allowlist","security"]),
("clients/launcher/internal/opscontrol/allowlist_test.go","function","TestPermits_RejectsUnknownButValid"): ("Xác minh tên đúng định dạng nhưng lạ vẫn bị từ chối.", ["test","allowlist","security"]),
# backend.go
("clients/launcher/internal/opscontrol/backend.go","class","Handle"): ("Mô tả định danh và trạng thái của một workload đang chạy.", ["workload","type-definition","state"]),
("clients/launcher/internal/opscontrol/backend.go","class","WorkloadStatus"): ("Trạng thái vòng đời của workload kèm thời điểm cập nhật.", ["workload","state","type-definition"]),
("clients/launcher/internal/opscontrol/backend.go","class","Backend"): ("Interface backend quản lý workload với thao tác đặt tên, khởi động, dừng và liệt kê.", ["interface","backend","workload"]),
# docker_compose_backend.go
("clients/launcher/internal/opscontrol/docker_compose_backend.go","class","DockerComposeBackend"): ("Backend điều khiển workload bằng docker compose với run-id và override gắn nhãn riêng.", ["docker-compose","backend","workload"]),
("clients/launcher/internal/opscontrol/docker_compose_backend.go","function","NewDockerComposeBackend"): ("Khởi tạo backend compose với thư mục home Raptix.", ["constructor","docker-compose","backend"]),
("clients/launcher/internal/opscontrol/docker_compose_backend.go","function","Name"): ("Trả về tên định danh của backend compose.", ["backend","naming","accessor"]),
("clients/launcher/internal/opscontrol/docker_compose_backend.go","function","baseArgs"): ("Dựng tham số compose cơ bản gồm project name và file cấu hình.", ["docker-compose","args-builder","utility"]),
("clients/launcher/internal/opscontrol/docker_compose_backend.go","function","labeledComposeOverride"): ("Sinh file compose override tạm gắn nhãn run-id cho mọi service.", ["docker-compose","labels","override"]),
("clients/launcher/internal/opscontrol/docker_compose_backend.go","function","Start"): ("Khởi động workload bằng compose up và ghi nhận run-id để dừng sau này.", ["docker-compose","start","workload"]),
("clients/launcher/internal/opscontrol/docker_compose_backend.go","function","Stop"): ("Dừng workload bằng compose stop/rm rồi xóa bản ghi run.", ["docker-compose","stop","workload"]),
("clients/launcher/internal/opscontrol/docker_compose_backend.go","function","profileExclusiveServices"): ("Tính các service độc quyền của profile để tránh xung đột khi khởi động.", ["docker-compose","profiles","planning"]),
("clients/launcher/internal/opscontrol/docker_compose_backend.go","function","listServices"): ("Liệt kê service trong compose qua lệnh config/services.", ["docker-compose","listing","inspection"]),
("clients/launcher/internal/opscontrol/docker_compose_backend.go","function","List"): ("Liệt kê các workload đang được backend theo dõi.", ["backend","listing","workload"]),
# labels test
("clients/launcher/internal/opscontrol/docker_compose_labels_test.go","function","TestLabeledComposeOverrideScopesEveryService"): ("Xác minh override gắn nhãn bao phủ mọi service và giữ cấu trúc compose.", ["test","docker-compose","labels"]),
# launchd.go
("clients/launcher/internal/opscontrol/launchd.go","class","LaunchdManager"): ("Quản lý service Raptix trên macOS qua launchd và file plist.", ["macos","launchd","service-manager"]),
("clients/launcher/internal/opscontrol/launchd.go","function","Name"): ("Trả về tên định danh của trình quản lý launchd.", ["naming","launchd","accessor"]),
("clients/launcher/internal/opscontrol/launchd.go","function","Available"): ("Kiểm tra launchctl khả dụng và phiên GUI của người dùng hiện tại.", ["launchd","availability","detection"]),
("clients/launcher/internal/opscontrol/launchd.go","function","Installed"): ("Kiểm tra file plist của service đã được cài đặt.", ["launchd","installation","detection"]),
("clients/launcher/internal/opscontrol/launchd.go","function","Active"): ("Kiểm tra service launchd đang chạy qua lệnh print.", ["launchd","status","detection"]),
("clients/launcher/internal/opscontrol/launchd.go","function","Install"): ("Ghi plist, bootstrap và kích hoạt service launchd.", ["launchd","installation","deployment"]),
("clients/launcher/internal/opscontrol/launchd.go","function","Uninstall"): ("Gỡ service launchd và xóa file plist.", ["launchd","uninstall","cleanup"]),
("clients/launcher/internal/opscontrol/launchd.go","function","Start"): ("Kích hoạt service launchd đã được cài đặt.", ["launchd","start","service"]),
("clients/launcher/internal/opscontrol/launchd.go","function","Stop"): ("Gửi tín hiệu dừng tới service launchd.", ["launchd","stop","service"]),
("clients/launcher/internal/opscontrol/launchd.go","function","renderPlist"): ("Sinh nội dung plist với biến môi trường và hậu tố stack.", ["launchd","plist","templating"]),
# paths.go
("clients/launcher/internal/opscontrol/paths.go","function","StackName"): ("Tính tên stack đã sanitize từ biến môi trường hoặc giá trị mặc định.", ["naming","stack","sanitization"]),
("clients/launcher/internal/opscontrol/paths.go","function","HostSocketPath"): ("Trả về đường dẫn Unix socket điều khiển opscontrol.", ["paths","socket","opscontrol"]),
("clients/launcher/internal/opscontrol/paths.go","function","PIDFilePath"): ("Trả về đường dẫn file PID của tiến trình nền.", ["paths","pid","runtime"]),
("clients/launcher/internal/opscontrol/paths.go","function","EnsureRunDir"): ("Tạo thư mục runtime nếu chưa tồn tại.", ["paths","filesystem","setup"]),
("clients/launcher/internal/opscontrol/paths.go","function","ServiceUnitName"): ("Tính tên unit service từ tên stack.", ["naming","service","systemd"]),
("clients/launcher/internal/opscontrol/paths.go","function","ComposeProjectName"): ("Xác định tên compose project từ env hoặc tên stack.", ["compose","naming","env"]),
("clients/launcher/internal/opscontrol/paths.go","function","ComposeCommandEnv"): ("Dựng môi trường cho lệnh compose, chuẩn hóa các biến chưa đặt.", ["compose","env","utility"]),
# registry.go
("clients/launcher/internal/opscontrol/registry.go","class","registry"): ("Kho trạng thái workload an toàn đồng thời, khóa riêng theo từng workload.", ["registry","concurrency","state-tracking"]),
("clients/launcher/internal/opscontrol/registry.go","function","lockFor"): ("Lấy mutex riêng cho một workload, tạo mới nếu chưa có.", ["concurrency","locking","registry"]),
("clients/launcher/internal/opscontrol/registry.go","function","set"): ("Ghi trạng thái workload kèm engagement và thời điểm cập nhật.", ["registry","state-tracking","write"]),
("clients/launcher/internal/opscontrol/registry.go","function","snapshot"): ("Chụp toàn bộ trạng thái workload hiện tại phục vụ API list.", ["registry","snapshot","read"]),
("clients/launcher/internal/opscontrol/registry.go","function","workloadsForEngagement"): ("Liệt kê workload thuộc về một engagement cụ thể.", ["registry","engagement","query"]),
# server.go
("clients/launcher/internal/opscontrol/server.go","class","Server"): ("HTTP server opscontrol gắn backend, allowlist và registry, giao tiếp qua Unix socket.", ["http-server","opscontrol","api"]),
("clients/launcher/internal/opscontrol/server.go","function","NewServer"): ("Khởi tạo server với logger, registry mới và cấu hình cho trước.", ["constructor","http-server","opscontrol"]),
("clients/launcher/internal/opscontrol/server.go","function","Listen"): ("Mở Unix socket, đăng ký mux và phục vụ kèm shutdown duyên dáng.", ["http-server","socket","lifecycle"]),
("clients/launcher/internal/opscontrol/server.go","function","handleStart"): ("Xử lý khởi động workload: kiểm tra allowlist, khóa registry rồi chạy nền.", ["api-handler","start","workload"]),
("clients/launcher/internal/opscontrol/server.go","function","handleStop"): ("Xử lý dừng workload: kiểm tra allowlist và cập nhật trạng thái.", ["api-handler","stop","workload"]),
("clients/launcher/internal/opscontrol/server.go","function","handleCleanupEngagement"): ("Dừng toàn bộ workload gắn với một engagement và báo cáo kết quả.", ["api-handler","engagement","cleanup"]),
# server_test.go
("clients/launcher/internal/opscontrol/server_test.go","class","fakeBackend"): ("Backend giả đếm số lần start/stop để kiểm thử server.", ["test-double","backend","mocking"]),
("clients/launcher/internal/opscontrol/server_test.go","function","Name"): ("Backend giả trả về tên cố định cho kiểm thử server.", ["test-double","backend","naming"]),
("clients/launcher/internal/opscontrol/server_test.go","function","Start"): ("Backend giả mô phỏng khởi động workload kèm sleep giả lập tranh chấp.", ["test-double","backend","start"]),
("clients/launcher/internal/opscontrol/server_test.go","function","Stop"): ("Backend giả mô phỏng dừng workload và ghi nhận số lần gọi.", ["test-double","backend","stop"]),
("clients/launcher/internal/opscontrol/server_test.go","function","List"): ("Backend giả trả về danh sách rỗng cho kiểm thử.", ["test-double","backend","listing"]),
("clients/launcher/internal/opscontrol/server_test.go","function","newTestServer"): ("Trợ giúp dựng server kiểm thử với allowlist và backend giả.", ["test-helper","http-server","setup"]),
("clients/launcher/internal/opscontrol/server_test.go","function","TestServer_HealthEnvelope"): ("Xác minh endpoint health trả envelope đúng và liệt kê workload.", ["test","health","api"]),
("clients/launcher/internal/opscontrol/server_test.go","function","TestServer_StartRejectsUnknownWorkload"): ("Xác minh khởi động workload lạ bị từ chối và không gọi backend.", ["test","security","start"]),
("clients/launcher/internal/opscontrol/server_test.go","function","TestServer_StartRejectsTraversal"): ("Xác minh tên chứa traversal bị chặn ở API start.", ["test","security","traversal"]),
("clients/launcher/internal/opscontrol/server_test.go","function","TestServer_StartIdempotentForSameWorkload"): ("Xác minh start lặp cùng workload không khởi động trùng.", ["test","idempotency","start"]),
("clients/launcher/internal/opscontrol/server_test.go","function","TestServer_StartConcurrentSerializes"): ("Xác minh các start đồng thời được serialize qua khóa registry.", ["test","concurrency","start"]),
("clients/launcher/internal/opscontrol/server_test.go","function","TestServer_StopAfterStart"): ("Xác minh dừng sau khởi động cập nhật đúng bộ đếm và trạng thái.", ["test","stop","lifecycle"]),
("clients/launcher/internal/opscontrol/server_test.go","function","TestServer_CleanupEngagementStopsTaggedWorkloads"): ("Xác minh cleanup engagement dừng đúng các workload được gắn thẻ.", ["test","engagement","cleanup"]),
("clients/launcher/internal/opscontrol/server_test.go","function","TestServer_CleanupEngagementRejectsBadID"): ("Xác minh cleanup với ID sai định dạng bị từ chối.", ["test","engagement","validation"]),
("clients/launcher/internal/opscontrol/server_test.go","function","TestServer_ListReflectsRegistry"): ("Xác minh API list phản ánh đúng snapshot của registry.", ["test","listing","registry"]),
# service.go
("clients/launcher/internal/opscontrol/service.go","class","ServiceManager"): ("Interface quản lý service hệ thống: phát hiện, cài đặt, khởi động và dừng.", ["interface","service-manager","cross-platform"]),
("clients/launcher/internal/opscontrol/service.go","class","InstallSpec"): ("Đặc tả cài đặt service gồm nhãn, binary và biến môi trường.", ["type-definition","service","install"]),
("clients/launcher/internal/opscontrol/service.go","class","noopManager"): ("Bản triển khai rỗng khi không có service manager nào khả dụng.", ["noop","service-manager","fallback"]),
("clients/launcher/internal/opscontrol/service.go","function","DetectServiceManager"): ("Phát hiện systemd hoặc launchd khả dụng, nếu không trả về noop.", ["factory","detection","cross-platform"]),
("clients/launcher/internal/opscontrol/service.go","function","Name"): ("Noop trả về tên rỗng.", ["noop","service-manager","naming"]),
("clients/launcher/internal/opscontrol/service.go","function","Available"): ("Noop luôn báo không khả dụng.", ["noop","service-manager","detection"]),
("clients/launcher/internal/opscontrol/service.go","function","Installed"): ("Noop luôn báo chưa cài đặt.", ["noop","service-manager","installation"]),
("clients/launcher/internal/opscontrol/service.go","function","Active"): ("Noop luôn báo không active.", ["noop","service-manager","status"]),
("clients/launcher/internal/opscontrol/service.go","function","Install"): ("Noop báo lỗi khi yêu cầu cài đặt.", ["noop","service-manager","installation"]),
("clients/launcher/internal/opscontrol/service.go","function","Uninstall"): ("Noop báo lỗi khi yêu cầu gỡ cài đặt.", ["noop","service-manager","uninstall"]),
("clients/launcher/internal/opscontrol/service.go","function","Start"): ("Noop báo lỗi khi yêu cầu khởi động.", ["noop","service-manager","start"]),
("clients/launcher/internal/opscontrol/service.go","function","Stop"): ("Noop báo lỗi khi yêu cầu dừng.", ["noop","service-manager","stop"]),
# service_test.go
("clients/launcher/internal/opscontrol/service_test.go","function","TestNoopManager_Contract"): ("Xác minh noop manager tuân thủ toàn bộ hợp đồng interface.", ["test","noop","contract"]),
("clients/launcher/internal/opscontrol/service_test.go","function","TestDetectServiceManager_ReturnsCorrectShape"): ("Xác minh phát hiện trả về đúng hình dạng manager theo nền tảng.", ["test","detection","factory"]),
("clients/launcher/internal/opscontrol/service_test.go","function","TestComposeProjectName_EnvOverrideWins"): ("Xác minh biến môi trường thắng tên stack khi tính project name.", ["test","compose","env"]),
("clients/launcher/internal/opscontrol/service_test.go","function","TestComposeProjectName_FallsBackToStackName"): ("Xác minh thiếu env thì dùng tên stack làm project name.", ["test","compose","fallback"]),
("clients/launcher/internal/opscontrol/service_test.go","function","TestComposeCommandEnv_NormalizesUnsetVars"): ("Xác minh biến chưa đặt được chuẩn hóa khi dựng env compose.", ["test","compose","env"]),
("clients/launcher/internal/opscontrol/service_test.go","function","TestStackName_SanitizesEnv"): ("Xác minh tên stack lấy từ env được sanitize ký tự lạ.", ["test","naming","sanitization"]),
# systemd.go
("clients/launcher/internal/opscontrol/systemd.go","class","SystemdManager"): ("Quản lý service Raptix trên Linux qua systemd user units.", ["linux","systemd","service-manager"]),
("clients/launcher/internal/opscontrol/systemd.go","function","Available"): ("Kiểm tra systemctl user khả dụng trên hệ thống.", ["systemd","availability","detection"]),
("clients/launcher/internal/opscontrol/systemd.go","function","Name"): ("Trả về tên định danh của trình quản lý systemd.", ["naming","systemd","accessor"]),
("clients/launcher/internal/opscontrol/systemd.go","function","Installed"): ("Kiểm tra unit file của service đã tồn tại.", ["systemd","installation","detection"]),
("clients/launcher/internal/opscontrol/systemd.go","function","Active"): ("Kiểm tra service đang active qua systemctl is-active.", ["systemd","status","detection"]),
("clients/launcher/internal/opscontrol/systemd.go","function","Install"): ("Ghi unit, dọn drop-in cũ, reload daemon rồi enable service.", ["systemd","installation","deployment"]),
("clients/launcher/internal/opscontrol/systemd.go","function","removeStaleDropIns"): ("Xóa drop-in override trỏ tới binary không còn tồn tại.", ["systemd","cleanup","drop-in"]),
("clients/launcher/internal/opscontrol/systemd.go","function","Uninstall"): ("Disable service, xóa unit rồi reload daemon.", ["systemd","uninstall","cleanup"]),
("clients/launcher/internal/opscontrol/systemd.go","function","Start"): ("Khởi động service sau khi kiểm tra đã cài đặt.", ["systemd","start","service"]),
("clients/launcher/internal/opscontrol/systemd.go","function","Stop"): ("Dừng service qua systemctl stop.", ["systemd","stop","service"]),
("clients/launcher/internal/opscontrol/systemd.go","function","renderUnit"): ("Sinh nội dung unit systemd từ đặc tả cài đặt.", ["systemd","templating","unit"]),
# systemd_test.go
("clients/launcher/internal/opscontrol/systemd_test.go","function","TestRemoveStaleDropIns_DeletesDeadBinaryOverride"): ("Xác minh override của binary đã chết bị xóa nhưng giữ file chính.", ["test","systemd","cleanup"]),
("clients/launcher/internal/opscontrol/systemd_test.go","function","TestRemoveStaleDropIns_KeepsLiveBinaryOverride"): ("Xác minh override của binary còn sống được giữ lại.", ["test","systemd","cleanup"]),
("clients/launcher/internal/opscontrol/systemd_test.go","function","TestRemoveStaleDropIns_AcceptsModifierPrefixes"): ("Xác minh drop-in có tiền tố modifier vẫn được xử lý.", ["test","systemd","drop-in"]),
("clients/launcher/internal/opscontrol/systemd_test.go","function","TestRemoveStaleDropIns_NoDirIsNoop"): ("Xác minh thiếu thư mục drop-in thì không làm gì và không lỗi.", ["test","systemd","noop"]),
# platform.go
("clients/launcher/internal/platform/platform.go","function","IsWSL"): ("Phát hiện WSL qua chuỗi microsoft/wsl trong file version.", ["wsl","detection","platform"]),
("clients/launcher/internal/platform/platform.go","function","WSLHostIP"): ("Trích IP host WSL từ nameserver đầu tiên của resolv.conf.", ["wsl","networking","resolv"]),
# platform_test.go
("clients/launcher/internal/platform/platform_test.go","function","withTempFile"): ("Trợ giúp tạo file tạm với nội dung cho trước cho kiểm thử.", ["test-helper","filesystem","setup"]),
("clients/launcher/internal/platform/platform_test.go","function","TestIsWSL_DetectsMicrosoftToken"): ("Xác minh chuỗi microsoft trong version được nhận là WSL.", ["test","wsl","detection"]),
("clients/launcher/internal/platform/platform_test.go","function","TestIsWSL_DetectsWslToken"): ("Xác minh chuỗi wsl trong version được nhận là WSL.", ["test","wsl","detection"]),
("clients/launcher/internal/platform/platform_test.go","function","TestIsWSL_NativeLinuxReturnsFalse"): ("Xác minh Linux thuần không bị nhận nhầm là WSL.", ["test","wsl","detection"]),
("clients/launcher/internal/platform/platform_test.go","function","TestIsWSL_MissingFileReturnsFalse"): ("Xác minh thiếu file version thì coi như không phải WSL.", ["test","wsl","edge-case"]),
("clients/launcher/internal/platform/platform_test.go","function","TestWSLHostIP_FirstNameserver"): ("Xác minh lấy đúng nameserver đầu tiên làm IP host.", ["test","wsl","networking"]),
("clients/launcher/internal/platform/platform_test.go","function","TestWSLHostIP_IgnoresCommentsAndOptions"): ("Xác minh comment và option trong resolv.conf bị bỏ qua.", ["test","wsl","parsing"]),
("clients/launcher/internal/platform/platform_test.go","function","TestWSLHostIP_MissingFileReturnsEmpty"): ("Xác minh thiếu resolv.conf thì trả về rỗng.", ["test","wsl","edge-case"]),
("clients/launcher/internal/platform/platform_test.go","function","TestWSLHostIP_NoNameserverReturnsEmpty"): ("Xác minh không có nameserver thì trả về rỗng.", ["test","wsl","edge-case"]),
# system.go
("clients/launcher/internal/platform/system.go","class","SystemInfo"): ("Thông tin hệ thống: OS, distro, Docker và trạng thái sẵn sàng.", ["system-info","type-definition","prerequisites"]),
("clients/launcher/internal/platform/system.go","function","LinuxDistro"): ("Đọc tên distro từ file os-release.", ["linux","distro","detection"]),
("clients/launcher/internal/platform/system.go","function","Detect"): ("Phát hiện distro, WSL, docker và compose để điền SystemInfo.", ["detection","system-info","factory"]),
("clients/launcher/internal/platform/system.go","function","OSLabel"): ("Tạo nhãn OS thân thiện từ thông tin hệ thống.", ["os","labeling","display"]),
("clients/launcher/internal/platform/system.go","function","Ready"): ("Cho biết hệ thống đã sẵn sàng chạy Raptix.", ["readiness","prerequisites","status"]),
("clients/launcher/internal/platform/system.go","function","DockerHint"): ("Gợi ý cài đặt hoặc khởi động Docker phù hợp từng OS khi chưa sẵn sàng.", ["docker","hint","ux"]),
# system_test.go
("clients/launcher/internal/platform/system_test.go","function","TestLinuxDistroParsesPrettyName"): ("Xác minh pretty name trong os-release được phân tích đúng.", ["test","linux","parsing"]),
("clients/launcher/internal/platform/system_test.go","function","TestLinuxDistroMissingFile"): ("Xác minh thiếu os-release không gây lỗi khi đọc distro.", ["test","linux","edge-case"]),
("clients/launcher/internal/platform/system_test.go","function","TestDetectDockerFlags"): ("Xác minh cờ Docker/compose được phát hiện qua probe giả.", ["test","docker","detection"]),
("clients/launcher/internal/platform/system_test.go","function","TestSystemInfoReadyAndHint"): ("Xác minh trạng thái Ready và gợi ý Docker theo từng cấu hình.", ["test","readiness","docker"]),
("clients/launcher/internal/platform/system_test.go","function","TestOSLabel"): ("Xác minh nhãn OS sinh ra đúng cho từng hệ thống.", ["test","os","labeling"]),
("clients/launcher/internal/platform/system_test.go","function","TestDockerHint_ComposeMissing"): ("Xác minh gợi ý khi thiếu compose plugin.", ["test","docker","compose"]),
("clients/launcher/internal/platform/system_test.go","function","TestDockerHint_LinuxDaemonStopped"): ("Xác minh gợi ý khi daemon Docker trên Linux dừng.", ["test","docker","linux"]),
("clients/launcher/internal/platform/system_test.go","function","TestDockerHint_WSLDaemonStopped"): ("Xác minh gợi ý khi Docker trong WSL chưa chạy.", ["test","docker","wsl"]),
("clients/launcher/internal/platform/system_test.go","function","TestDockerHint_PerOSInstallURL"): ("Xác minh URL cài đặt Docker đúng cho từng OS.", ["test","docker","install-url"]),
("clients/launcher/internal/platform/system_test.go","function","TestDetect_ComposeAvailableWhenDockerInstalled"): ("Xác minh compose được coi khả dụng khi Docker đã cài.", ["test","docker","compose"]),
("clients/launcher/internal/platform/system_test.go","function","TestLinuxDistroIgnoresQuotedValues"): ("Xác minh giá trị có ngoặc kép trong os-release bị bỏ qua đúng.", ["test","linux","parsing"]),
# runtime.go
("clients/launcher/internal/runtime/runtime.go","class","Runtime"): ("Mô tả runtime container gồm tên, socket, rootless và phiên bản.", ["container-runtime","type-definition","detection"]),
("clients/launcher/internal/runtime/runtime.go","function","Detect"): ("Phát hiện runtime qua biến override hoặc dò Docker/Podman.", ["detection","container-runtime","factory"]),
("clients/launcher/internal/runtime/runtime.go","function","probe"): ("Dò một binary runtime: kiểm tra info, rootless, socket và compose.", ["probing","docker","podman"]),
("clients/launcher/internal/runtime/runtime.go","function","podmanSocket"): ("Tìm socket Podman từ env hoặc đường dẫn mặc định theo UID.", ["podman","socket","detection"]),
("clients/launcher/internal/runtime/runtime.go","function","rootless"): ("Xác định runtime đang chạy rootless qua lệnh info.", ["rootless","detection","security"]),
("clients/launcher/internal/runtime/runtime.go","function","versionString"): ("Lấy chuỗi phiên bản server của runtime container.", ["version","detection","runtime"]),
("clients/launcher/internal/runtime/runtime.go","function","Apply"): ("Áp DOCKER_HOST và biến liên quan vào môi trường khi còn thiếu.", ["env","docker-host","apply"]),
("clients/launcher/internal/runtime/runtime.go","function","String"): ("Hiển thị runtime dưới dạng chuỗi gồm tên và chi tiết.", ["display","formatting","runtime"]),
# runtime_test.go
("clients/launcher/internal/runtime/runtime_test.go","function","TestRuntime_String_OnlyName"): ("Xác minh chuỗi hiển thị khi runtime chỉ có tên.", ["test","display","runtime"]),
("clients/launcher/internal/runtime/runtime_test.go","function","TestRuntime_String_FullFields"): ("Xác minh chuỗi hiển thị khi runtime có đủ trường chi tiết.", ["test","display","runtime"]),
("clients/launcher/internal/runtime/runtime_test.go","function","TestRuntime_Apply_AddsDockerHostWhenUnset"): ("Xác minh DOCKER_HOST được thêm khi chưa đặt.", ["test","docker-host","env"]),
("clients/launcher/internal/runtime/runtime_test.go","function","TestRuntime_Apply_RespectsExistingDockerHost"): ("Xác minh DOCKER_HOST có sẵn không bị ghi đè.", ["test","docker-host","env"]),
("clients/launcher/internal/runtime/runtime_test.go","function","TestRuntime_Apply_NoOpWhenNoDockerHost"): ("Xác minh không có socket thì Apply không thay đổi env.", ["test","docker-host","noop"]),
("clients/launcher/internal/runtime/runtime_test.go","function","TestDetect_RespectsInvalidOverride"): ("Xác minh override không hợp lệ khiến phát hiện báo lỗi.", ["test","detection","validation"]),
("clients/launcher/internal/runtime/runtime_test.go","function","TestPodmanSocket_ReturnsEmptyWhenNothingExists"): ("Xác minh không tìm thấy socket Podman thì trả về rỗng.", ["test","podman","socket"]),
# browser.go
("clients/launcher/internal/starprompt/browser.go","function","openBrowserToRepo"): ("Mở trang kho Raptix bằng lệnh phù hợp từng OS và WSL.", ["browser","cross-platform","utility"]),
# gh.go
("clients/launcher/internal/starprompt/gh.go","function","ghReady"): ("Kiểm tra CLI gh đã cài và xác thực được.", ["github-cli","detection","prerequisites"]),
("clients/launcher/internal/starprompt/gh.go","function","checkStarStatus"): ("Truy vấn trạng thái star của repo qua gh api.", ["github-cli","star","query"]),
# starprompt.go
("clients/launcher/internal/starprompt/starprompt.go","function","PromptIfNotStarred"): ("Nhắc star một lần nếu chưa có ack và stdin tương tác.", ["star-prompt","onboarding","entry"]),
("clients/launcher/internal/starprompt/starprompt.go","function","promptViaGh"): ("Nhắc star qua gh: star tại chỗ nếu đồng ý, lỗi thì mở trình duyệt.", ["star-prompt","github-cli","fallback"]),
("clients/launcher/internal/starprompt/starprompt.go","function","promptViaBrowser"): ("Nhắc star bằng cách mở trình duyệt tới trang repo.", ["star-prompt","browser","fallback"]),
("clients/launcher/internal/starprompt/starprompt.go","function","touchAck"): ("Ghi file ack để không nhắc lại trong các lần chạy sau.", ["ack","persistence","star-prompt"]),
("clients/launcher/internal/starprompt/starprompt.go","function","runConfirm"): ("Hiển thị hộp xác nhận Có/Bỏ qua bằng huh trên terminal.", ["confirm","cli-ui","interactive"]),
# starprompt_test.go
("clients/launcher/internal/starprompt/starprompt_test.go","function","install"): ("Trợ giúp tiêm stub gh, trình duyệt và xác nhận vào starprompt.", ["test-helper","stubbing","setup"]),
("clients/launcher/internal/starprompt/starprompt_test.go","function","TestPromptIfNotStarred_AckExists_Returns"): ("Xác minh đã có ack thì trả về ngay không nhắc.", ["test","star-prompt","ack"]),
("clients/launcher/internal/starprompt/starprompt_test.go","function","TestPromptIfNotStarred_NonInteractive_SilentNoOp"): ("Xác minh stdin không tương tác thì im lặng bỏ qua.", ["test","star-prompt","non-interactive"]),
("clients/launcher/internal/starprompt/starprompt_test.go","function","TestPromptIfNotStarred_GhAlreadyStarred_SilentAck"): ("Xác minh đã star rồi thì chỉ ghi ack mà không nhắc.", ["test","star-prompt","ack"]),
("clients/launcher/internal/starprompt/starprompt_test.go","function","TestPromptIfNotStarred_GhNotStarred_YesStarsInPlace"): ("Xác minh đồng ý thì star tại chỗ qua gh.", ["test","star-prompt","github-cli"]),
("clients/launcher/internal/starprompt/starprompt_test.go","function","TestPromptIfNotStarred_GhNotStarred_SkipAcksOnly"): ("Xác minh bỏ qua thì chỉ ghi ack, không star.", ["test","star-prompt","skip"]),
("clients/launcher/internal/starprompt/starprompt_test.go","function","TestPromptIfNotStarred_GhPutFails_FallsBackToBrowser"): ("Xác minh star qua gh lỗi thì dự phòng mở trình duyệt.", ["test","star-prompt","fallback"]),
("clients/launcher/internal/starprompt/starprompt_test.go","function","TestPromptIfNotStarred_StatusUnknown_BrowserPath"): ("Xác minh trạng thái không xác định thì đi nhánh trình duyệt.", ["test","star-prompt","fallback"]),
("clients/launcher/internal/starprompt/starprompt_test.go","function","TestPromptIfNotStarred_NoGh_YesOpensBrowser"): ("Xác minh không có gh mà đồng ý thì mở trình duyệt.", ["test","star-prompt","browser"]),
("clients/launcher/internal/starprompt/starprompt_test.go","function","TestPromptIfNotStarred_NoGh_SkipAcksOnly"): ("Xác minh không có gh mà bỏ qua thì chỉ ghi ack.", ["test","star-prompt","skip"]),
("clients/launcher/internal/starprompt/starprompt_test.go","function","TestPromptIfNotStarred_NoGh_BrowserOpenFails_StillAcks"): ("Xác minh mở trình duyệt lỗi vẫn ghi ack để không nhắc lại.", ["test","star-prompt","ack"]),
("clients/launcher/internal/starprompt/starprompt_test.go","function","TestPromptIfNotStarred_GhPath_TitleSet"): ("Xác minh tiêu đề nhắc dùng đúng đường dẫn gh đã cấu hình.", ["test","star-prompt","github-cli"]),
("clients/launcher/internal/starprompt/starprompt_test.go","function","TestStarStatus_DistinctEnum"): ("Xác minh các giá trị trạng thái star phân biệt nhau.", ["test","star-prompt","enum"]),
# theme.go
("clients/launcher/internal/ui/theme.go","function","RenderBanner"): ("Vẽ banner Raptix co giãn theo chiều rộng terminal.", ["banner","cli-ui","display"]),
("clients/launcher/internal/ui/theme.go","function","Success"): ("In thông báo thành công với màu xanh.", ["cli-ui","logging","colors"]),
("clients/launcher/internal/ui/theme.go","function","Warning"): ("In cảnh báo với màu vàng.", ["cli-ui","logging","colors"]),
("clients/launcher/internal/ui/theme.go","function","Error"): ("In thông báo lỗi với màu đỏ.", ["cli-ui","logging","colors"]),
("clients/launcher/internal/ui/theme.go","function","Info"): ("In thông tin với màu cyan.", ["cli-ui","logging","colors"]),
("clients/launcher/internal/ui/theme.go","function","DimText"): ("In chữ mờ cho thông tin phụ.", ["cli-ui","logging","colors"]),
("clients/launcher/internal/ui/theme.go","function","RaptixTheme"): ("Dựng theme huh/charm với điểm nhấn đỏ cho form tương tác.", ["theme","forms","styling"]),
# checksums_test.go
("clients/launcher/internal/updater/checksums_test.go","function","TestParseChecksumManifest"): ("Xác minh phân tích manifest checksum thành map file-hash.", ["test","checksum","parsing"]),
("clients/launcher/internal/updater/checksums_test.go","function","TestParseChecksumManifestRejectsMalformed"): ("Xác minh dòng sai định dạng khiến phân tích thất bại.", ["test","checksum","validation"]),
("clients/launcher/internal/updater/checksums_test.go","function","TestSha256FileAndVerify"): ("Xác minh băm file và đối chiếu manifest cho cả hash đúng và sai.", ["test","sha256","verification"]),
# reexec
("clients/launcher/internal/updater/reexec_unix.go","function","reexecSelf"): ("Thay tiến trình hiện tại bằng binary mới qua syscall.Exec.", ["reexec","self-update","unix"]),
("clients/launcher/internal/updater/reexec_windows.go","function","reexecSelf"): ("Khởi chạy binary mới rồi thoát tiến trình cũ trên Windows.", ["reexec","self-update","windows"]),
# updater.go
("clients/launcher/internal/updater/updater.go","class","Release"): ("Metadata một GitHub release gồm tag và thời điểm publish.", ["type-definition","release","github"]),
("clients/launcher/internal/updater/updater.go","class","Asset"): ("Metadata file đính kèm của release để tải binary.", ["type-definition","release","asset"]),
("clients/launcher/internal/updater/updater.go","function","resolveStableSoak"): ("Đọc thời gian soak của kênh stable từ biến môi trường.", ["release-channel","config","soak"]),
("clients/launcher/internal/updater/updater.go","function","ResolveChannel"): ("Chuẩn hóa tên kênh cập nhật từ chuỗi cấu hình.", ["release-channel","normalization","config"]),
("clients/launcher/internal/updater/updater.go","function","FetchRelease"): ("Lấy release theo kênh, ưu tiên bản stable đã soak đủ lâu.", ["release","fetching","channel"]),
("clients/launcher/internal/updater/updater.go","function","FetchLatestRelease"): ("Lấy release mới nhất mà không lọc soak.", ["release","fetching","latest"]),
("clients/launcher/internal/updater/updater.go","function","fetchLatestFinal"): ("Gọi API releases/latest và giải mã JSON release.", ["github-api","release","http"]),
("clients/launcher/internal/updater/updater.go","function","fetchSoakedStable"): ("Chọn bản stable đã publish đủ lâu, dự phòng về latest.", ["stable","soak","release"]),
("clients/launcher/internal/updater/updater.go","function","listReleases"): ("Liệt kê các release qua API GitHub để xét soak.", ["github-api","listing","release"]),
("clients/launcher/internal/updater/updater.go","function","pickSoakedStable"): ("Chọn bản stable mới nhất thỏa thời gian soak và semver.", ["stable","selection","semver"]),
("clients/launcher/internal/updater/updater.go","function","CompareVersions"): ("So sánh hai phiên bản, tự bỏ tiền tố v.", ["semver","comparison","version"]),
("clients/launcher/internal/updater/updater.go","function","compareSemver"): ("So sánh base số và prerelease theo quy tắc semver.", ["semver","comparison","algorithm"]),
("clients/launcher/internal/updater/updater.go","function","compareNumericBase"): ("So sánh từng cụm số của phần base phiên bản.", ["semver","numeric","comparison"]),
("clients/launcher/internal/updater/updater.go","function","comparePrerelease"): ("So sánh chuỗi prerelease gồm định danh số và chữ.", ["semver","prerelease","comparison"]),
("clients/launcher/internal/updater/updater.go","function","parseUint"): ("Phân tích số nguyên không dấu, báo lỗi khi sai định dạng.", ["parsing","uint","utility"]),
("clients/launcher/internal/updater/updater.go","function","SyncConfigFiles"): ("Tải manifest, tải từng config, xác thực checksum rồi thay thế nguyên tử.", ["config-sync","checksum","atomic-replace"]),
("clients/launcher/internal/updater/updater.go","function","fetchManifest"): ("Tải và phân tích manifest checksum của release.", ["manifest","download","checksum"]),
("clients/launcher/internal/updater/updater.go","function","parseChecksumManifest"): ("Phân tích manifest dạng dòng hash-tên-file thành map.", ["manifest","parsing","checksum"]),
("clients/launcher/internal/updater/updater.go","function","verifyAgainstManifest"): ("Băm file và đối chiếu với hash ghi trong manifest.", ["verification","sha256","checksum"]),
("clients/launcher/internal/updater/updater.go","function","sha256File"): ("Tính hash SHA-256 dạng hex của một file.", ["sha256","hashing","utility"]),
("clients/launcher/internal/updater/updater.go","function","assetURL"): ("Dựng URL tải asset theo tên file và tag release.", ["url-builder","release","download"]),
("clients/launcher/internal/updater/updater.go","function","downloadFile"): ("Tải URL về đường dẫn đích, tự tạo thư mục cha.", ["download","http","filesystem"]),
("clients/launcher/internal/updater/updater.go","function","CleanupOldBinary"): ("Xóa file backup của binary cũ sau cập nhật thành công.", ["cleanup","binary","update"]),
("clients/launcher/internal/updater/updater.go","function","replaceExecutable"): ("Thay binary đang chạy bằng file mới, rollback khi lỗi.", ["binary-replace","rollback","update"]),
("clients/launcher/internal/updater/updater.go","function","SelfUpdate"): ("Tải asset đúng nền tảng, xác thực checksum rồi thay binary hiện tại.", ["self-update","binary","checksum"]),
("clients/launcher/internal/updater/updater.go","function","WriteVersion"): ("Ghi phiên bản đã cài (bỏ tiền tố v) vào file version.", ["version","persistence","update"]),
("clients/launcher/internal/updater/updater.go","function","NotifyIfUpdateAvailable"): ("Thông báo khi có bản mới hơn bản đang chạy.", ["notification","update","version"]),
("clients/launcher/internal/updater/updater.go","function","ApplyUpdate"): ("Đồng bộ config, pull image compose, tự cập nhật binary và ghi version.", ["update","orchestration","deployment"]),
("clients/launcher/internal/updater/updater.go","function","PromptIfUpdateAvailable"): ("Hỏi người dùng có cài bản mới ngay, bỏ qua ở build dev hoặc non-interactive.", ["prompt","update","interactive"]),
("clients/launcher/internal/updater/updater.go","function","resolveUpdateRef"): ("Xác định ref cập nhật từ env hiện tại.", ["update-ref","env","config"]),
("clients/launcher/internal/updater/updater.go","function","applyAndReexec"): ("Áp dụng cập nhật rồi thực thi lại binary mới.", ["update","reexec","lifecycle"]),
("clients/launcher/internal/updater/updater.go","function","AutoUpdateIfAvailable"): ("Tự cập nhật khi có bản mới, bỏ qua build dev.", ["auto-update","update","background"]),
# updater_test.go
("clients/launcher/internal/updater/updater_test.go","function","TestCompareVersions"): ("Xác minh so sánh phiên bản đúng cho base, prerelease và tiền tố v.", ["test","semver","comparison"]),
("clients/launcher/internal/updater/updater_test.go","function","TestResolveChannel"): ("Xác minh chuẩn hóa tên kênh cập nhật.", ["test","release-channel","normalization"]),
("clients/launcher/internal/updater/updater_test.go","function","TestDisplayVersion"): ("Xác minh hiển thị phiên bản đã trim và giữ nguyên khi không có v.", ["test","version","display"]),
("clients/launcher/internal/updater/updater_test.go","function","TestFetchLatestRelease_Mock"): ("Xác minh fetch latest qua server HTTP giả.", ["test","release","http-mock"]),
("clients/launcher/internal/updater/updater_test.go","function","TestFetchRelease_LatestUsesReleasesLatestEndpoint"): ("Xác minh kênh latest gọi đúng endpoint releases/latest.", ["test","release","endpoint"]),
("clients/launcher/internal/updater/updater_test.go","function","TestFetchRelease_StableSoaksByPublishedAt"): ("Xác minh kênh stable chọn bản đã soak đủ theo thời gian publish.", ["test","stable","soak"]),
("clients/launcher/internal/updater/updater_test.go","function","TestFetchRelease_StableFallsBackToLatestWhenNoneSoaked"): ("Xác minh không có bản soak đủ thì stable dự phòng về latest.", ["test","stable","fallback"]),
("clients/launcher/internal/updater/updater_test.go","function","TestPickSoakedStable"): ("Xác minh chọn bản stable soak tốt nhất theo semver.", ["test","stable","selection"]),
("clients/launcher/internal/updater/updater_test.go","function","TestPromptIfUpdateAvailable_SkipsDevBuilds"): ("Xác minh build dev thì bỏ qua nhắc cập nhật.", ["test","prompt","dev-build"]),
("clients/launcher/internal/updater/updater_test.go","function","TestPromptIfUpdateAvailable_SkipsNonInteractive"): ("Xác minh non-interactive thì bỏ qua nhắc cập nhật.", ["test","prompt","non-interactive"]),
("clients/launcher/internal/updater/updater_test.go","function","TestApplyUpdate_NilRelease"): ("Xác minh ApplyUpdate với release rỗng báo lỗi.", ["test","update","validation"]),
("clients/launcher/internal/updater/updater_test.go","function","TestDownloadFile_Success"): ("Xác minh tải file thành công và ghi đúng nội dung.", ["test","download","success"]),
("clients/launcher/internal/updater/updater_test.go","function","TestDownloadFile_HTTPError"): ("Xác minh lỗi HTTP khi tải được báo lỗi rõ ràng.", ["test","download","http-error"]),
("clients/launcher/internal/updater/updater_test.go","function","TestDownloadFile_CreatesParentDirectory"): ("Xác minh thư mục cha được tạo khi tải file.", ["test","download","filesystem"]),
("clients/launcher/internal/updater/updater_test.go","function","TestDownloadFile_NetworkError"): ("Xác minh lỗi mạng khi tải được xử lý.", ["test","download","network-error"]),
("clients/launcher/internal/updater/updater_test.go","function","TestSelfUpdate_NoMatchingAsset"): ("Xác minh không có asset phù hợp thì self-update báo lỗi.", ["test","self-update","asset"]),
("clients/launcher/internal/updater/updater_test.go","function","TestSelfUpdate_DownloadHTTPError"): ("Xác minh lỗi HTTP khi tải asset khiến self-update thất bại.", ["test","self-update","http-error"]),
("clients/launcher/internal/updater/updater_test.go","function","TestSelfUpdate_WritesAndRenames"): ("Xác minh self-update ghi và đổi tên binary đúng nội dung.", ["test","self-update","binary"]),
("clients/launcher/internal/updater/updater_test.go","function","TestReplaceExecutable_WindowsRollsBackFailedInstall"): ("Xác minh thay binary lỗi trên Windows thì rollback.", ["test","binary-replace","rollback"]),
("clients/launcher/internal/updater/updater_test.go","function","TestCleanupOldBinary_WindowsRemovesStaleBackup"): ("Xác minh backup cũ trên Windows bị xóa sau cập nhật.", ["test","cleanup","binary"]),
("clients/launcher/internal/updater/updater_test.go","function","TestWriteVersion_StripsVPrefix"): ("Xác minh ghi version bỏ tiền tố v.", ["test","version","formatting"]),
("clients/launcher/internal/updater/updater_test.go","function","TestWriteVersion_NoPrefix"): ("Xác minh ghi version giữ nguyên khi không có tiền tố.", ["test","version","formatting"]),
("clients/launcher/internal/updater/updater_test.go","function","TestApplyUpdate_ConfigFailurePreventsVersionChange"): ("Xác minh lỗi đồng bộ config thì không ghi version mới.", ["test","update","config-sync"]),
("clients/launcher/internal/updater/updater_test.go","function","TestAutoUpdateIfAvailable_SkipsDevBuilds"): ("Xác minh build dev thì tự cập nhật bị bỏ qua.", ["test","auto-update","dev-build"]),
# web_config_test.go
("clients/launcher/internal/updater/web_config_test.go","function","TestWebConfigSyncVerifiesAllFilesBeforeReplacementAndRetainsEnv"): ("Xác minh đồng bộ web kiểm tra mọi file trước khi thay và giữ nguyên env.", ["test","config-sync","web"]),
}

import os

def base(p):
    return p.rsplit("/", 1)[-1]

nodes = []
edges = []
def add_edge(s, t, typ, w):
    if s == t:
        return
    edges.append({"source": s, "target": t, "type": typ, "direction": "forward", "weight": w})

# File nodes
for f in batch_files:
    p = f["path"]
    summ, tags, notes = FILES[p]
    n = {"id": "file:" + p, "type": "file", "name": base(p), "filePath": p,
         "summary": summ, "tags": tags, "complexity": fcx(nonempty.get(p, f["sizeLines"]))}
    if notes:
        n["languageNotes"] = notes
    nodes.append(n)

# exports lookup
exports_by_file = {}
for p, r in results.items():
    exports_by_file[p] = set(e["name"] for e in r.get("exports", []))

# kept symbol nodes: (path, kind, name) -> (startLine, endLine)
kept = {}
for p, r in results.items():
    for fn in r.get("functions", []):
        nm, s, e = fn["name"], fn["startLine"], fn["endLine"]
        if (e - s + 1) >= 10 or nm in exports_by_file.get(p, set()):
            kept[(p, "function", nm)] = (s, e)
    for cl in r.get("classes", []):
        nm, s, e = cl.get("name"), cl.get("startLine"), cl.get("endLine")
        methods = cl.get("methods", []) or []
        if len(methods) >= 2 or (e - s + 1) >= 20 or nm in exports_by_file.get(p, set()):
            kept[(p, "class", nm)] = (s, e)

# symbol nodes + contains/exports edges
for (p, kind, nm), (s, e) in sorted(kept.items()):
    key = (p, kind, nm)
    if key not in S:
        raise KeyError("Thieu mo ta cho node: %s" % (key,))
    summ, tags = S[key]
    nid = "%s:%s:%s" % ("function" if kind == "function" else "class", p, nm)
    node = {"id": nid, "type": kind, "name": nm, "filePath": p,
            "lineRange": [s, e], "summary": summ, "tags": tags,
            "complexity": fncx(s, e) if kind == "function" else ("complex" if len(results[p].get("classes", [])) and False else fncx(s, e))}
    if kind == "class":
        nlines = e - s + 1
        nmethods = len([c for c in results[p].get("classes", []) if c.get("name") == nm][0].get("methods", []) or [])
        node["complexity"] = "complex" if (nmethods >= 6 or nlines > 40) else ("moderate" if (nmethods >= 2 or nlines >= 10) else "simple")
    nodes.append(node)
    add_edge("file:" + p, nid, "contains", 1.0)
    if nm in exports_by_file.get(p, set()):
        add_edge("file:" + p, nid, "exports", 0.8)

# imports edges 1:1 (khong bo sot)
for f in batch_files:
    p = f["path"]
    for dst in batch_import.get(p, []):
        add_edge("file:" + p, "file:" + dst, "imports", 0.7)

# tested_by (production -> test)
TESTED = [
 ("clients/launcher/internal/opscontrol/allowlist.go","clients/launcher/internal/opscontrol/allowlist_test.go"),
 ("clients/launcher/internal/opscontrol/server.go","clients/launcher/internal/opscontrol/server_test.go"),
 ("clients/launcher/internal/opscontrol/service.go","clients/launcher/internal/opscontrol/service_test.go"),
 ("clients/launcher/internal/opscontrol/paths.go","clients/launcher/internal/opscontrol/service_test.go"),
 ("clients/launcher/internal/opscontrol/systemd.go","clients/launcher/internal/opscontrol/systemd_test.go"),
 ("clients/launcher/internal/platform/platform.go","clients/launcher/internal/platform/platform_test.go"),
 ("clients/launcher/internal/platform/system.go","clients/launcher/internal/platform/system_test.go"),
 ("clients/launcher/internal/runtime/runtime.go","clients/launcher/internal/runtime/runtime_test.go"),
 ("clients/launcher/internal/starprompt/starprompt.go","clients/launcher/internal/starprompt/starprompt_test.go"),
 ("clients/launcher/internal/updater/updater.go","clients/launcher/internal/updater/updater_test.go"),
 ("clients/launcher/internal/updater/updater.go","clients/launcher/internal/updater/checksums_test.go"),
 ("clients/launcher/internal/updater/updater.go","clients/launcher/internal/updater/web_config_test.go"),
 ("clients/launcher/internal/opscontrol/docker_compose_backend.go","clients/launcher/internal/opscontrol/docker_compose_labels_test.go"),
 ("clients/launcher/internal/migrate/steps.go","clients/launcher/internal/migrate/migrate_test.go"),
]
for a, b in TESTED:
    add_edge("file:" + a, "file:" + b, "tested_by", 0.5)

# implements (Go struct -> interface, cung batch)
IMPL = [
 ("clients/launcher/internal/opscontrol/docker_compose_backend.go","DockerComposeBackend","clients/launcher/internal/opscontrol/backend.go","Backend"),
 ("clients/launcher/internal/opscontrol/launchd.go","LaunchdManager","clients/launcher/internal/opscontrol/service.go","ServiceManager"),
 ("clients/launcher/internal/opscontrol/systemd.go","SystemdManager","clients/launcher/internal/opscontrol/service.go","ServiceManager"),
 ("clients/launcher/internal/opscontrol/service.go","noopManager","clients/launcher/internal/opscontrol/service.go","ServiceManager"),
 ("clients/launcher/internal/opscontrol/server_test.go","fakeBackend","clients/launcher/internal/opscontrol/backend.go","Backend"),
]
for fp, fc, tp, tc in IMPL:
    add_edge("class:%s:%s" % (fp, fc), "class:%s:%s" % (tp, tc), "implements", 0.9)

# calls: dan xuat tu callGraph (chi khi chac chan)
import re
BUILTINS = {"len","make","append","delete","new","cap","copy","panic","string","int","len"}
CONFIG_FUNCS = {"BackfillEnvFromEmbed","LoadEnv","SetEnvKey","EnvExists","EnvPath","RaptixHome"}
def dir_of(p):
    return p.rsplit("/", 1)[0]
# kept function/class names theo dir
names_in_dir = {}
for (p, kind, nm) in kept:
    names_in_dir.setdefault(dir_of(p), {}).setdefault(nm, []).append((p, kind))
theme_funcs = set(nm for (p, k, nm) in kept if p == "clients/launcher/internal/ui/theme.go" and k == "function")

def norm_callee(raw):
    raw = raw.strip()
    if not raw or " " in raw or raw.startswith("func("):
        return None
    raw = raw.split("(")[0]
    if not raw or " " in raw:
        return None
    return raw

calls_added = 0
for p, r in results.items():
    for cg in r.get("callGraph", []):
        caller, raw = cg["caller"], cg["callee"]
        caller_id = "function:%s:%s" % (p, caller)
        if (p, "function", caller) not in kept:
            continue
        cal = norm_callee(raw)
        if not cal:
            continue
        if "." in cal:
            head, sym = cal.split(".", 1)[0], cal.rsplit(".", 1)[-1]
            if not sym or sym in BUILTINS:
                continue
            if head == "ui" and sym in theme_funcs:
                add_edge(caller_id, "function:clients/launcher/internal/ui/theme.go:" + sym, "calls", 0.8)
                calls_added += 1
                continue
            if head == "config" and sym in CONFIG_FUNCS:
                syms = set()
                for nb in neighbor.get(p, []):
                    if nb["path"] == "clients/launcher/internal/config/config.go":
                        syms = set(nb["symbols"])
                if sym in syms:
                    add_edge(caller_id, "function:clients/launcher/internal/config/config.go:" + sym, "calls", 0.8)
                    calls_added += 1
                continue
            if cal == "compose.New":
                add_edge(caller_id, "function:clients/launcher/internal/compose/compose.go:New", "calls", 0.8)
                calls_added += 1
                continue
            if cal == "cmd.Execute":
                add_edge(caller_id, "function:clients/launcher/cmd/root.go:Execute", "calls", 0.8)
                calls_added += 1
                continue
            # receiver call cung package: chi khi duy nhat trong dir
            cands = names_in_dir.get(dir_of(p), {}).get(sym, [])
            if len(cands) == 1 and cands[0][1] == "function":
                tp, _ = cands[0][0], None
                add_edge(caller_id, "function:%s:%s" % (cands[0][0], sym), "calls", 0.8)
                calls_added += 1
            continue
        else:
            sym = cal
            if sym in BUILTINS:
                continue
            # goi truc tiep: cung file truoc
            if (p, "function", sym) in kept:
                add_edge(caller_id, "function:%s:%s" % (p, sym), "calls", 0.8)
                calls_added += 1
                continue
            cands = names_in_dir.get(dir_of(p), {}).get(sym, [])
            if len(cands) == 1 and cands[0][1] == "function":
                add_edge(caller_id, "function:%s:%s" % (cands[0][0], sym), "calls", 0.8)
                calls_added += 1

# dedup edges
seen = set()
uniq = []
for e in edges:
    k = (e["source"], e["target"], e["type"])
    if k in seen:
        continue
    seen.add(k)
    uniq.append(e)
edges = uniq

# tu kiem tra
n_import_expect = sum(len(v) for v in batch_import.values())
n_import_got = sum(1 for e in edges if e["type"] == "imports")
assert n_import_got == n_import_expect, "imports %d != %d" % (n_import_got, n_import_expect)
ids = set(n["id"] for n in nodes)
assert len(ids) == len(nodes), "trung node id"
allowed_file_targets = set("file:" + f["path"] for f in batch_files)
allowed_file_targets.update("file:" + d for v in batch_import.values() for d in v)
for nb in neighbor.values():
    for x in nb:
        allowed_file_targets.add("file:" + x["path"])
for e in edges:
    for end in ("source", "target"):
        v = e[end]
        if v.startswith("file:"):
            assert v in ids or v in allowed_file_targets, "file ref la: %s" % v
print("nodes:", len(nodes), "| edges:", len(edges), "| imports:", n_import_got, "| calls_added:", calls_added)

out = {"batchIndex": 5,
       "batchFiles": [{"path": f["path"], "language": f["language"], "sizeLines": f["sizeLines"], "fileCategory": f["fileCategory"]} for f in batch_files],
       "nodes": nodes, "edges": edges}
os.makedirs(UA + "/intermediate", exist_ok=True)
json.dump(out, open(UA + "/intermediate/batch-5.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)
print("wrote batch-5.json")
