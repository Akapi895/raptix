#!/usr/bin/env python3
"""Generate UA batch-1.json (raptix launcher, Go) with Vietnamese summaries."""
import io
import json
import os
import re

UA = r"D:\.VTNet\redteam\raptix\.ua"
batches = json.load(io.open(os.path.join(UA, "intermediate", "batches.json"), encoding="utf-8"))
b = [x for x in batches["batches"] if x.get("batchIndex") == 1][0]
ext = json.load(io.open(os.path.join(UA, "tmp", "ua-file-extract-results-1.json"), encoding="utf-8"))
results = {r["path"]: r for r in ext["results"]}

# ---------- file metadata (Vietnamese) ----------
FILE_META = {
 "clients/launcher/cmd/health.go": ("Lệnh kiểm tra sức khỏe các dịch vụ; đăng ký subcommand health vào rootCmd.", ["cli", "cobra-command", "health-check"], ""),
 "clients/launcher/cmd/logs.go": ("Lệnh xem log các dịch vụ Raptix thông qua docker compose.", ["cli", "cobra-command", "logs"], ""),
 "clients/launcher/cmd/ollama_models.go": ("Dò tìm Ollama trên host và lọc ra các model đã pull có hỗ trợ gọi tool cho bước onboard.", ["cli", "ollama", "model-probe"], "Go: dùng goroutine + WaitGroup để kiểm tra capability của nhiều model song song."),
 "clients/launcher/cmd/ollama_models_test.go": ("Kiểm thử logic dò tìm và lọc model Ollama bằng HTTP server giả lập.", ["test", "go-test", "ollama"], ""),
 "clients/launcher/cmd/onboard.go": ("Wizard onboard tương tác (dùng huh form) cấu hình credentials, model profile, ngôn ngữ và telemetry rồi ghi file .env.", ["cli", "onboarding", "interactive-wizard"], "Go: form huh nhiều bước với WithHideFunc hiển thị động theo phương thức auth đã chọn."),
 "clients/launcher/cmd/onboard_secrets_test.go": ("Kiểm thử hàm sinh credentials cài đặt, đảm bảo giữ nguyên giá trị đã tồn tại.", ["test", "go-test", "onboarding"], ""),
 "clients/launcher/cmd/opscontrol/daemon.go": ("Chạy daemon opscontrol: nạp allowlist, khởi tạo backend compose và phục vụ qua socket.", ["cli", "daemon", "opscontrol"], ""),
 "clients/launcher/cmd/opscontrol/install.go": ("Lệnh cài đặt service opscontrol (EnsureInstalled) và chờ service chuyển active.", ["cli", "service-install", "opscontrol"], ""),
 "clients/launcher/cmd/opscontrol/opscontrol.go": ("Định nghĩa lệnh gốc opscontrol nhóm các subcommand daemon/install/status.", ["cli", "cobra-command", "opscontrol"], ""),
 "clients/launcher/cmd/opscontrol/status.go": ("Lệnh xem trạng thái service manager và sức khỏe daemon opscontrol.", ["cli", "status", "opscontrol"], ""),
 "clients/launcher/cmd/opscontrol/supervisor.go": ("Giám sát tiến trình daemon: đảm bảo đang chạy, spawn launcher, chờ socket và đọc PID.", ["cli", "supervisor", "process-management"], ""),
 "clients/launcher/cmd/opscontrol/supervisor_unix.go": ("Hàm quản lý tiến trình daemon dành riêng cho Unix (tín hiệu kill, tách tiến trình).", ["cli", "unix", "process-management"], "Go: file có build constraint cho Unix (supervisor_unix)."),
 "clients/launcher/cmd/opscontrol/supervisor_windows.go": ("Hàm quản lý tiến trình daemon dành riêng cho Windows.", ["cli", "windows", "process-management"], "Go: file có build constraint cho Windows (supervisor_windows)."),
 "clients/launcher/cmd/opscontrol/uninstall.go": ("Lệnh gỡ cài đặt service opscontrol khỏi service manager.", ["cli", "uninstall", "opscontrol"], ""),
 "clients/launcher/cmd/opscontrol_register.go": ("Đăng ký nhóm lệnh opscontrol vào rootCmd của CLI.", ["cli", "cobra-command", "opscontrol"], ""),
 "clients/launcher/cmd/remove.go": ("Lệnh gỡ bỏ Raptix: xác nhận tương tác, dừng services, dọn shell RC và sao lưu workspace.", ["cli", "uninstall", "cleanup"], ""),
 "clients/launcher/cmd/root.go": ("Điểm vào CLI: cấu hình rootCmd, dọn binary cập nhật cũ rồi thực thi lệnh.", ["cli", "entry-point", "cobra-command"], ""),
 "clients/launcher/cmd/start.go": ("Lệnh khởi động stack Raptix: cập nhật tự động, kiểm tra credentials, probe Ollama rồi Up compose.", ["cli", "startup", "orchestration"], ""),
 "clients/launcher/cmd/start_test.go": ("Kiểm thử dựng URL probe Ollama, định tuyến auto-update và chặn credentials mặc định.", ["test", "go-test", "startup"], ""),
 "clients/launcher/cmd/status.go": ("Lệnh status mỏng, chỉ đăng ký subcommand vào rootCmd.", ["cli", "cobra-command", "status"], ""),
 "clients/launcher/cmd/stop.go": ("Lệnh dừng stack Raptix, đăng ký subcommand vào rootCmd.", ["cli", "cobra-command", "lifecycle"], ""),
 "clients/launcher/cmd/update.go": ("Lệnh cập nhật Raptix: nạp env, pull image mới và đồng bộ file cấu hình.", ["cli", "update", "lifecycle"], ""),
 "clients/launcher/cmd/web.go": ("Lệnh quản lý web profile: khởi tạo compose client và pull image web.", ["cli", "web", "compose"], ""),
 "clients/launcher/internal/compose/compose.go": ("Client bao bọc docker compose: dựng args, quản lý vòng đời Up/Down/Pull/Logs/Exec.", ["compose", "docker", "orchestration"], "Go: struct Compose với methods bao phủ toàn bộ vòng đời stack."),
 "clients/launcher/internal/compose/compose_test.go": ("Kiểm thử khởi tạo Compose, liệt kê profiles và dựng args compose.", ["test", "go-test", "compose"], ""),
 "clients/launcher/internal/compose/web_test.go": ("Kiểm thử web project không trộn lẫn service base hay opscontrol.", ["test", "go-test", "compose"], ""),
 "clients/launcher/internal/config/config.go": ("Quản lý cấu hình .env: đường dẫn, đọc/ghi file, validate API key và auth, migrate profiles.", ["configuration", "env-management", "validation"], "Go: hàm package-level thao tác trực tiếp file .env với ghi file quyền riêng tư."),
 "clients/launcher/internal/config/config_test.go": ("Kiểm thử toàn diện parse env, validate key/auth và migrate compose profiles.", ["test", "go-test", "configuration"], ""),
 "clients/launcher/internal/config/secrets.go": ("Sinh bộ credentials ngẫu nhiên cho lần cài đặt (InstallationSecrets).", ["security", "secrets", "installation"], "Go: dùng crypto/rand sinh hex cho credentials."),
 "clients/launcher/internal/config/secrets_test.go": ("Kiểm thử sinh secrets không trùng giá trị mặc định và độc lập giữa các lần gọi.", ["test", "go-test", "security"], ""),
 "clients/launcher/internal/engagement/picker.go": ("Bộ chọn engagement dạng TUI (bubbletea): quét workspace, lọc, validate slug và tạo mới.", ["tui", "engagement", "selection"], "Go: dùng bubbletea (Init/Update/View) và bubbles list cho picker tương tác."),
 "clients/launcher/internal/engagement/picker_test.go": ("Kiểm thử quét engagement, sắp xếp ready và validate slug.", ["test", "go-test", "engagement"], ""),
 "clients/launcher/internal/health/health.go": ("Kiểm tra sức khỏe LangGraph, LiteLLM, Neo4j, Web và chờ services sẵn sàng.", ["health-check", "services", "readiness"], ""),
 "clients/launcher/internal/health/health_test.go": ("Kiểm thử các probe sức khỏe dịch vụ bằng httptest server.", ["test", "go-test", "health-check"], ""),
 "clients/launcher/internal/migrate/migrate.go": ("Khung migration: chạy các bước theo ack, hoãn bước tương tác khi không có TTY.", ["migration", "upgrade", "steps"], ""),
}

# ---------- explicit function metadata: (path, name) -> (summary, tags) ----------
FN_META = {
 ("clients/launcher/cmd/ollama_models.go", "probeOllamaForOnboard"): ("Dò tìm Ollama tại baseURL qua các URL ứng viên, trả về trạng thái reachable và danh sách model hỗ trợ tool.", ["ollama", "model-probe", "detection"]),
 ("clients/launcher/cmd/ollama_models.go", "filterToolCapable"): ("Lọc song song danh sách model, chỉ giữ những model hỗ trợ gọi tool.", ["ollama", "filtering", "concurrency"]),
 ("clients/launcher/cmd/ollama_models.go", "fetchOllamaTags"): ("Gọi endpoint /api/tags của Ollama để lấy danh sách model đã pull.", ["ollama", "http-client", "tags"]),
 ("clients/launcher/cmd/ollama_models.go", "hasOllamaToolsCapability"): ("Gọi /api/show để kiểm tra một model có khai báo khả năng tool-calling không.", ["ollama", "capability-check", "http-client"]),
 ("clients/launcher/cmd/ollama_models_test.go", "ollamaTestServer"): ("Dựng HTTP server giả lập các endpoint /api/tags và /api/show cho kiểm thử probe.", ["test", "go-test", "http-mock"]),
 ("clients/launcher/cmd/onboard.go", "systemCheckGroup"): ("Tạo nhóm hiển thị kết quả kiểm tra hệ thống (OS, Docker) trong wizard onboard.", ["onboarding", "system-check", "wizard"]),
 ("clients/launcher/cmd/onboard.go", "runOnboard"): ("Chạy toàn bộ wizard onboard 5 bước: credentials, model profile, ngôn ngữ, observability rồi ghi file .env.", ["onboarding", "wizard", "configuration"]),
 ("clients/launcher/cmd/onboard.go", "onboardingInstallationSecrets"): ("Sinh credentials cài đặt mới nhưng giữ nguyên giá trị đã tồn tại.", ["onboarding", "secrets", "installation"]),
 ("clients/launcher/cmd/onboard.go", "optionalClaudeOAuthToken"): ("Validate token Claude OAuth tùy chọn (rỗng hoặc đúng định dạng).", ["validation", "oauth", "onboarding"]),
 ("clients/launcher/cmd/onboard.go", "buildOllamaModelField"): ("Dựng trường chọn model Ollama cho form từ kết quả probe (dạng Select khi có model, Note hướng dẫn khi không).", ["ollama", "wizard", "form"]),
 ("clients/launcher/cmd/onboard.go", "ollamaUnusableError"): ("Tạo thông báo lỗi khi Ollama không dùng được (chưa chạy hoặc thiếu model tool-capable).", ["ollama", "error-handling", "onboarding"]),
 ("clients/launcher/cmd/opscontrol/daemon.go", "runDaemon"): ("Chạy daemon opscontrol: nạp allowlist, khởi tạo backend compose và phục vụ qua socket.", ["daemon", "opscontrol", "lifecycle"]),
 ("clients/launcher/cmd/opscontrol/install.go", "EnsureInstalled"): ("Cài đặt service manager (systemd/launchd) cho opscontrol và xác nhận sẵn sàng.", ["service-install", "opscontrol", "setup"]),
 ("clients/launcher/cmd/opscontrol/install.go", "waitForActive"): ("Chờ service chuyển sang trạng thái active trong giới hạn timeout.", ["service", "readiness", "polling"]),
 ("clients/launcher/cmd/opscontrol/status.go", "runStatus"): ("In trạng thái service manager (tên, khả dụng, đã cài, đang chạy).", ["status", "opscontrol", "cli"]),
 ("clients/launcher/cmd/opscontrol/status.go", "probeHealth"): ("Kiểm tra sức khỏe daemon qua socket health.", ["health-check", "opscontrol", "daemon"]),
 ("clients/launcher/cmd/opscontrol/supervisor.go", "EnsureRunning"): ("Đảm bảo daemon đang chạy: ghi overlay compose, phát hiện service manager và spawn khi cần.", ["supervisor", "daemon", "lifecycle"]),
 ("clients/launcher/cmd/opscontrol/supervisor.go", "Stop"): ("Dừng daemon opscontrol đang chạy.", ["supervisor", "daemon", "lifecycle"]),
 ("clients/launcher/cmd/opscontrol/supervisor.go", "ensureRunningLauncherSpawn"): ("Spawn tiến trình launcher tách biệt và chờ socket sẵn sàng.", ["supervisor", "process-spawn", "readiness"]),
 ("clients/launcher/cmd/opscontrol/supervisor.go", "stopLauncherSpawn"): ("Dừng tiến trình launcher đã spawn.", ["supervisor", "process-management", "lifecycle"]),
 ("clients/launcher/cmd/opscontrol/supervisor.go", "waitForSocket"): ("Chờ file socket xuất hiện trong khoảng timeout.", ["supervisor", "readiness", "polling"]),
 ("clients/launcher/cmd/opscontrol/supervisor.go", "readPID"): ("Đọc PID daemon từ PID file.", ["supervisor", "process-management", "pid-file"]),
 ("clients/launcher/cmd/opscontrol/uninstall.go", "runUninstall"): ("Gỡ cài đặt service opscontrol nếu khả dụng và đã được cài.", ["uninstall", "opscontrol", "service"]),
 ("clients/launcher/cmd/remove.go", "runRemove"): ("Chạy gỡ bỏ Raptix sau xác nhận: dừng services, xóa images và dọn cấu hình.", ["uninstall", "cleanup", "confirmation"]),
 ("clients/launcher/cmd/remove.go", "cleanShellRC"): ("Xóa dòng PATH của Raptix khỏi file cấu hình shell.", ["cleanup", "shell", "path"]),
 ("clients/launcher/cmd/remove.go", "cleanPathFromFile"): ("Xóa dòng đường dẫn cài đặt khỏi một file cụ thể.", ["cleanup", "file-edit", "path"]),
 ("clients/launcher/cmd/remove.go", "backupWorkspace"): ("Sao lưu workspace sang thư mục đích trước khi xóa.", ["backup", "workspace", "safety"]),
 ("clients/launcher/cmd/remove.go", "copyDirRecursive"): ("Sao chép đệ quy thư mục nguồn sang thư mục đích.", ["backup", "file-copy", "utility"]),
 ("clients/launcher/cmd/root.go", "Execute"): ("Điểm vào CLI: dọn binary cập nhật cũ rồi thực thi rootCmd.", ["entry-point", "cli", "startup"]),
 ("clients/launcher/cmd/start.go", "applyAutoUpdate"): ("Áp dụng cập nhật tự động theo kênh cấu hình, trừ khi có cờ bỏ qua.", ["auto-update", "startup", "configuration"]),
 ("clients/launcher/cmd/start.go", "init"): ("Đăng ký cờ dòng lệnh và khởi tạo lệnh start vào rootCmd.", ["cli", "initialization", "cobra-command"]),
 ("clients/launcher/cmd/start.go", "runStart"): ("Khởi động stack: migrate, kiểm tra credentials, probe Ollama, Up compose và chờ services.", ["startup", "orchestration", "lifecycle"]),
 ("clients/launcher/cmd/start.go", "checkDefaultCredentials"): ("Từ chối credentials mặc định để tránh cấu hình không an toàn.", ["security", "validation", "credentials"]),
 ("clients/launcher/cmd/start.go", "probeOllamaIfSelected"): ("Dò tìm Ollama khi người dùng chọn LLM local.", ["ollama", "startup", "detection"]),
 ("clients/launcher/cmd/start.go", "candidateProbeURLs"): ("Dựng danh sách URL probe Ollama (xử lý WSL, Docker host, loopback và dedupe).", ["ollama", "networking", "url"]),
 ("clients/launcher/cmd/start_test.go", "withProbeStubs"): ("Stub phát hiện WSL và IP host cho kiểm thử dựng URL probe.", ["test", "go-test", "stub"]),
 ("clients/launcher/cmd/start_test.go", "withUpdateStubs"): ("Stub hàm cập nhật và cấu hình cho kiểm thử định tuyến auto-update.", ["test", "go-test", "stub"]),
 ("clients/launcher/cmd/update.go", "runUpdate"): ("Chạy cập nhật: nạp env, pull image mới và đồng bộ file cấu hình.", ["update", "lifecycle", "cli"]),
 ("clients/launcher/cmd/web.go", "init"): ("Đăng ký lệnh web: khởi tạo compose client, pull image và điều phối web profile.", ["cli", "web", "compose"]),
 ("clients/launcher/internal/compose/compose.go", "New"): ("Khởi tạo client Compose từ Raptix home và runtime detector.", ["compose", "constructor", "docker"]),
 ("clients/launcher/internal/compose/compose.go", "AllProfiles"): ("Liệt kê toàn bộ compose profiles khả dụng.", ["compose", "profiles", "configuration"]),
 ("clients/launcher/internal/compose/compose.go", "baseArgs"): ("Dựng tham số dòng lệnh compose cơ sở (project name, file compose).", ["compose", "cli-args", "docker"]),
 ("clients/launcher/internal/compose/compose.go", "ContainerName"): ("Tính tên container cho một service.", ["compose", "naming", "docker"]),
 ("clients/launcher/internal/compose/compose.go", "composeEnv"): ("Dựng biến môi trường truyền cho tiến trình compose.", ["compose", "environment", "docker"]),
 ("clients/launcher/internal/compose/compose.go", "run"): ("Thực thi lệnh compose, hỗ trợ chế độ tương tác.", ["compose", "execution", "docker"]),
 ("clients/launcher/internal/compose/compose.go", "Up"): ("Khởi động stack compose ở chế độ detached.", ["compose", "lifecycle", "docker"]),
 ("clients/launcher/internal/compose/compose.go", "Down"): ("Dừng và gỡ stack compose.", ["compose", "lifecycle", "docker"]),
 ("clients/launcher/internal/compose/compose.go", "DownAndPurge"): ("Dừng stack và xóa volumes/images liên quan.", ["compose", "cleanup", "docker"]),
 ("clients/launcher/internal/compose/compose.go", "Pull"): ("Pull image compose theo phiên bản.", ["compose", "image-pull", "docker"]),
 ("clients/launcher/internal/compose/compose.go", "Ps"): ("Liệt kê container của stack.", ["compose", "inspection", "docker"]),
 ("clients/launcher/internal/compose/compose.go", "Logs"): ("Lấy log của một service.", ["compose", "logs", "inspection"]),
 ("clients/launcher/internal/compose/compose.go", "Exec"): ("Thực thi lệnh trong container của service.", ["compose", "exec", "docker"]),
 ("clients/launcher/internal/compose/compose.go", "Web"): ("Trả về client giới hạn cho web profile.", ["compose", "web", "scoping"]),
 ("clients/launcher/internal/compose/compose.go", "EnsureWebDatabase"): ("Đảm bảo database cho web profile tồn tại.", ["compose", "web", "database"]),
 ("clients/launcher/internal/compose/compose.go", "RunInteractive"): ("Chạy service tương tác với profiles và env cho trước.", ["compose", "interactive", "execution"]),
 ("clients/launcher/internal/compose/compose.go", "CleanScratch"): ("Dọn thư mục scratch của stack.", ["compose", "cleanup", "workspace"]),
 ("clients/launcher/internal/compose/compose.go", "RemoveOrphanedCLI"): ("Gỡ container CLI mồ côi khỏi project.", ["compose", "cleanup", "docker"]),
 ("clients/launcher/internal/config/config.go", "RaptixHome"): ("Trả về thư mục home của Raptix (biến môi trường hoặc ~/.raptix).", ["configuration", "paths", "home"]),
 ("clients/launcher/internal/config/config.go", "EnvPath"): ("Trả về đường dẫn file .env trong Raptix home.", ["configuration", "paths", "env"]),
 ("clients/launcher/internal/config/config.go", "EnvExists"): ("Kiểm tra file .env đã tồn tại chưa.", ["configuration", "env", "existence"]),
 ("clients/launcher/internal/config/config.go", "LoadEnv"): ("Nạp file .env thành map key-giá trị.", ["configuration", "env", "parsing"]),
 ("clients/launcher/internal/config/config.go", "parseEnvLine"): ("Phân tích một dòng KEY=VALUE của file env.", ["configuration", "parsing", "env"]),
 ("clients/launcher/internal/config/config.go", "WriteEnvFromEmbed"): ("Ghi file .env từ template nhúng kèm map giá trị.", ["configuration", "env", "templating"]),
 ("clients/launcher/internal/config/config.go", "WriteEnv"): ("Ghi file .env từ template và map giá trị.", ["configuration", "env", "templating"]),
 ("clients/launcher/internal/config/config.go", "writeEnvFromString"): ("Render template env và ghi file với quyền riêng tư.", ["configuration", "templating", "file-write"]),
 ("clients/launcher/internal/config/config.go", "writePrivateFile"): ("Ghi file với quyền chỉ chủ sở hữu đọc được.", ["security", "file-write", "permissions"]),
 ("clients/launcher/internal/config/config.go", "IsPlaceholder"): ("Nhận biết giá trị còn là placeholder chưa được điền.", ["validation", "configuration", "placeholder"]),
 ("clients/launcher/internal/config/config.go", "validateKeyFormat"): ("Kiểm tra định dạng API key theo từng nhà cung cấp.", ["validation", "api-key", "format"]),
 ("clients/launcher/internal/config/config.go", "ValidateAPIKeys"): ("Validate toàn bộ API key trong env, báo lỗi định dạng sai.", ["validation", "api-key", "configuration"]),
 ("clients/launcher/internal/config/config.go", "ValidateAuth"): ("Xác thực cấu hình auth (OAuth subscription, API key, Ollama local) đủ dùng.", ["validation", "auth", "configuration"]),
 ("clients/launcher/internal/config/config.go", "validateOllamaCredentials"): ("Validate cấu hình Ollama local (API base và model).", ["validation", "ollama", "credentials"]),
 ("clients/launcher/internal/config/config.go", "validateClaudeCredentials"): ("Validate credentials Claude (OAuth token hoặc file credentials).", ["validation", "claude", "credentials"]),
 ("clients/launcher/internal/config/config.go", "validateSubscriptionCredentials"): ("Validate credentials subscription (token paths, session cookie) theo từng loại.", ["validation", "subscription", "oauth"]),
 ("clients/launcher/internal/config/config.go", "subscriptionTokenPaths"): ("Liệt kê đường dẫn file token cho từng subscription.", ["subscription", "paths", "oauth"]),
 ("clients/launcher/internal/config/config.go", "dedupeStrings"): ("Loại bỏ chuỗi trùng lặp giữ nguyên thứ tự.", ["utility", "slice", "dedupe"]),
 ("clients/launcher/internal/config/config.go", "extractClaudeAccessToken"): ("Trích access token từ blob credentials Claude.", ["claude", "token", "parsing"]),
 ("clients/launcher/internal/config/config.go", "AppendEnvLine"): ("Thêm một dòng KEY=VALUE vào file env.", ["configuration", "env", "file-edit"]),
 ("clients/launcher/internal/config/config.go", "BackfillEnvFromEmbed"): ("Bổ sung key còn thiếu vào .env từ template nhúng.", ["configuration", "env", "backfill"]),
 ("clients/launcher/internal/config/config.go", "SetEnvKey"): ("Đặt hoặc cập nhật một key trong file env.", ["configuration", "env", "file-edit"]),
 ("clients/launcher/internal/config/config.go", "Get"): ("Lấy giá trị key trong env kèm fallback.", ["configuration", "env", "getter"]),
 ("clients/launcher/internal/config/config.go", "MigrateActiveComposeProfiles"): ("Migrate dòng ACTIVE profiles trong env sang định dạng mới (idempotent).", ["migration", "compose", "env"]),
 ("clients/launcher/internal/config/secrets.go", "NewInstallationSecrets"): ("Sinh bộ credentials cài đặt ngẫu nhiên (hex) kèm kiểm tra lỗi.", ["security", "secrets", "random"]),
 ("clients/launcher/internal/engagement/picker.go", "ScanEngagements"): ("Quét workspace liệt kê engagement kèm trạng thái ready/in-progress.", ["engagement", "scanning", "workspace"]),
 ("clients/launcher/internal/engagement/picker.go", "listAllSlugs"): ("Liệt kê toàn bộ slug engagement trong workspace.", ["engagement", "listing", "workspace"]),
 ("clients/launcher/internal/engagement/picker.go", "validateSlug"): ("Validate slug mới (định dạng và không trùng thư mục đã có).", ["validation", "engagement", "slug"]),
 ("clients/launcher/internal/engagement/picker.go", "FilterValue"): ("Trả về giá trị dùng để lọc item trong picker.", ["tui", "filtering", "picker"]),
 ("clients/launcher/internal/engagement/picker.go", "Title"): ("Trả về tiêu đề hiển thị của item engagement.", ["tui", "display", "picker"]),
 ("clients/launcher/internal/engagement/picker.go", "Description"): ("Trả về mô tả hiển thị của item engagement.", ["tui", "display", "picker"]),
 ("clients/launcher/internal/engagement/picker.go", "resizeList"): ("Chỉnh kích thước list theo cửa sổ terminal.", ["tui", "layout", "terminal"]),
 ("clients/launcher/internal/engagement/picker.go", "newPickerModel"): ("Khởi tạo model bubbletea cho picker từ danh sách entries.", ["tui", "model", "initialization"]),
 ("clients/launcher/internal/engagement/picker.go", "buildItems"): ("Dựng item hiển thị từ danh sách engagement entries.", ["tui", "list", "picker"]),
 ("clients/launcher/internal/engagement/picker.go", "Init"): ("Trả về lệnh khởi tạo ban đầu của model picker (bubbletea).", ["tui", "bubbletea", "initialization"]),
 ("clients/launcher/internal/engagement/picker.go", "Update"): ("Xử lý message (phím, resize, xác nhận) và cập nhật trạng thái picker.", ["tui", "bubbletea", "event-handler"]),
 ("clients/launcher/internal/engagement/picker.go", "View"): ("Render giao diện picker (danh sách và overlay xác nhận).", ["tui", "bubbletea", "rendering"]),
 ("clients/launcher/internal/engagement/picker.go", "Select"): ("Chạy picker tương tác và trả về engagement được chọn hoặc slug mới.", ["tui", "selection", "engagement"]),
 ("clients/launcher/internal/engagement/picker.go", "promptNewSlug"): ("Nhắc người dùng nhập slug khi tạo engagement mới.", ["tui", "prompt", "engagement"]),
 ("clients/launcher/internal/engagement/picker_test.go", "mkPlan"): ("Tạo engagement mẫu có plan trong home tạm cho kiểm thử.", ["test", "go-test", "fixture"]),
 ("clients/launcher/internal/health/health.go", "CheckLangGraph"): ("Kiểm tra LangGraph API phản hồi và body không rỗng.", ["health-check", "langgraph", "http"]),
 ("clients/launcher/internal/health/health.go", "CheckLiteLLM"): ("Kiểm tra gateway LiteLLM sẵn sàng.", ["health-check", "litellm", "http"]),
 ("clients/launcher/internal/health/health.go", "CheckNeo4j"): ("Kiểm tra Neo4j truy cập được.", ["health-check", "neo4j", "database"]),
 ("clients/launcher/internal/health/health.go", "CheckWeb"): ("Kiểm tra web dashboard phản hồi.", ["health-check", "web", "http"]),
 ("clients/launcher/internal/health/health.go", "WaitForServices"): ("Chờ toàn bộ services sẵn sàng trước khi tiếp tục.", ["health-check", "readiness", "orchestration"]),
 ("clients/launcher/internal/migrate/migrate.go", "RunAll"): ("Chạy toàn bộ bước migrate đã đăng ký cho env hiện tại.", ["migration", "upgrade", "orchestration"]),
 ("clients/launcher/internal/migrate/migrate.go", "Run"): ("Chạy danh sách bước migrate, hoãn bước tương tác khi không có TTY.", ["migration", "steps", "execution"]),
 ("clients/launcher/internal/migrate/migrate.go", "MarkAcked"): ("Đánh dấu một bước migrate đã được duyệt.", ["migration", "ack", "state"]),
 ("clients/launcher/internal/migrate/migrate.go", "Acked"): ("Kiểm tra bước migrate đã được duyệt chưa (method của Ctx).", ["migration", "ack", "state"]),
 ("clients/launcher/internal/migrate/migrate.go", "ack"): ("Ghi nhận duyệt bước migrate vào store.", ["migration", "ack", "persistence"]),
}

CLASS_META = {
 ("clients/launcher/internal/compose/compose.go", "Compose"): ("Client bao bọc docker compose, quản lý toàn bộ vòng đời stack Raptix.", ["compose", "docker", "client"]),
 ("clients/launcher/internal/config/config.go", "Config"): ("Struct cấu hình launcher, điểm mở rộng cho tùy chọn runtime.", ["configuration", "data-model", "launcher"]),
 ("clients/launcher/internal/config/secrets.go", "InstallationSecrets"): ("Bộ credentials sinh ngẫu nhiên cho lần cài đặt.", ["security", "secrets", "data-model"]),
 ("clients/launcher/internal/engagement/picker.go", "Choice"): ("Kết quả lựa chọn engagement của người dùng.", ["engagement", "selection", "data-model"]),
 ("clients/launcher/internal/engagement/picker.go", "pickerItem"): ("Item engagement trong list picker (hiện thực list.Item).", ["tui", "list-item", "picker"]),
 ("clients/launcher/internal/engagement/picker.go", "pickerModel"): ("Model bubbletea quản lý trạng thái picker engagement.", ["tui", "bubbletea", "model"]),
 ("clients/launcher/internal/migrate/migrate.go", "Ctx"): ("Ngữ cảnh migrate giữ env, home và trạng thái ack.", ["migration", "context", "state"]),
 ("clients/launcher/internal/migrate/migrate.go", "Step"): ("Một bước migrate (tương tác hoặc tự động) trong registry.", ["migration", "step", "data-model"]),
}


def camel_words(s):
    return re.sub(r"(?<!^)(?=[A-Z])", " ", s).lower()


def test_summary(name):
    if "_" in name:
        subj, scen = name.split("_", 1)
        subj_w = camel_words(subj[4:] if subj.startswith("Test") else subj)
        scen_w = scen.replace("_", " ").lower()
        scen_w = re.sub(r"(?<!^)(?=[A-Z])", " ", scen_w)
        return "Kiểm thử %s với kịch bản %s." % (subj_w, scen_w)
    w = camel_words(name[4:] if name.startswith("Test") else name)
    return "Kiểm thử %s." % w


def test_tags(name):
    subj = name.split("_", 1)[0]
    subj = subj[4:] if subj.startswith("Test") else subj
    slug = re.sub(r"(?<!^)(?=[A-Z])", "-", subj).lower()
    return ["test", "go-test", slug]


def is_exported(name):
    return bool(name) and name[0].isupper()


def file_complexity(non_empty):
    if non_empty < 50:
        return "simple"
    if non_empty <= 200:
        return "moderate"
    return "complex"


def fn_complexity(lines):
    if lines >= 60:
        return "complex"
    if lines >= 20:
        return "moderate"
    return "simple"


nodes = []
edges = []
func_index = {}   # (path, name) -> node id
names_in_file = {}  # path -> set(names)

for f in b["files"]:
    p = f["path"]
    r = results[p]
    ne = r.get("nonEmptyLines", f["sizeLines"])
    summary, tags, notes = FILE_META[p]
    node = {
        "id": "file:" + p,
        "type": "file",
        "name": p.split("/")[-1],
        "filePath": p,
        "summary": summary,
        "tags": tags,
        "complexity": file_complexity(ne),
    }
    if notes:
        node["languageNotes"] = notes
    nodes.append(node)
    names_in_file[p] = set()

    for fn in r.get("functions", []):
        lines = fn["endLine"] - fn["startLine"] + 1
        if not (lines >= 10 or is_exported(fn["name"])):
            continue
        key = (p, fn["name"])
        if key in FN_META:
            s, t = FN_META[key]
        elif fn["name"].startswith("Test"):
            s, t = test_summary(fn["name"]), test_tags(fn["name"])
        else:
            ctx = FILE_META[p][0]
            s = "Hàm %s (%d dòng) trong %s." % (fn["name"], lines, p.split("/")[-1])
            t = ["utility", "go", p.split("/")[-2]]
        nid = "function:%s:%s" % (p, fn["name"])
        nodes.append({
            "id": nid,
            "type": "function",
            "name": fn["name"],
            "filePath": p,
            "lineRange": [fn["startLine"], fn["endLine"]],
            "summary": s,
            "tags": t,
            "complexity": fn_complexity(lines),
        })
        func_index[key] = nid
        names_in_file[p].add(fn["name"])
        edges.append({"source": "file:" + p, "target": nid, "type": "contains", "direction": "forward", "weight": 1.0})
        if is_exported(fn["name"]):
            edges.append({"source": "file:" + p, "target": nid, "type": "exports", "direction": "forward", "weight": 0.8})

    for cl in r.get("classes", []):
        lines = cl["endLine"] - cl["startLine"] + 1
        methods = cl.get("methods", [])
        if not (len(methods) >= 2 or lines >= 20 or is_exported(cl["name"])):
            continue
        key = (p, cl["name"])
        if key in CLASS_META:
            s, t = CLASS_META[key]
        else:
            s = "Struct %s (%d dòng) trong %s." % (cl["name"], lines, p.split("/")[-1])
            t = ["data-model", "go", p.split("/")[-2]]
        nid = "class:%s:%s" % (p, cl["name"])
        nodes.append({
            "id": nid,
            "type": "class",
            "name": cl["name"],
            "filePath": p,
            "lineRange": [cl["startLine"], cl["endLine"]],
            "summary": s,
            "tags": t,
            "complexity": fn_complexity(lines),
        })
        func_index[key] = nid
        names_in_file[p].add(cl["name"])
        edges.append({"source": "file:" + p, "target": nid, "type": "contains", "direction": "forward", "weight": 1.0})
        if is_exported(cl["name"]):
            edges.append({"source": "file:" + p, "target": nid, "type": "exports", "direction": "forward", "weight": 0.8})

# ---------- imports (1:1 from batchImportData) ----------
bid = b.get("batchImportData", {})
expected_imports = sum(len(v) for v in bid.values())
for src, dsts in bid.items():
    for d in dsts:
        edges.append({"source": "file:" + src, "target": "file:" + d, "type": "imports", "direction": "forward", "weight": 0.7})
n_imports = sum(1 for e in edges if e["type"] == "imports")
assert n_imports == expected_imports, (n_imports, expected_imports)

# ---------- calls (in-batch, confident only) ----------
def dirname(p):
    return p.rsplit("/", 1)[0]

CONFIG_NAMES = {n for (pp, n) in func_index if pp.startswith("clients/launcher/internal/config/")}
config_file_of = {}
PKG_DIRS = {
    "config": "clients/launcher/internal/config",
    "compose": "clients/launcher/internal/compose",
    "health": "clients/launcher/internal/health",
    "migrate": "clients/launcher/internal/migrate",
    "engagement": "clients/launcher/internal/engagement",
    "opscontrol": "clients/launcher/cmd/opscontrol",
}
pkg_file_of = {}
for (pp, n) in func_index:
    for pkg, d in PKG_DIRS.items():
        if pp == d or pp.startswith(d + "/"):
            pkg_file_of.setdefault((pkg, n), pp)

seen_calls = set()
for src, r in results.items():
    srcdir = dirname(src)
    for c in r.get("callGraph", []):
        caller, callee = c.get("caller"), c.get("callee")
        if not caller or not callee or "\n" in callee or " " in callee or "(" in callee:
            continue
        caller_id = func_index.get((src, caller))
        if caller_id is None:
            continue
        target = None
        if "." in callee:
            pkg, sym = callee.rsplit(".", 1)
            if sym in names_in_file.get(src, set()):
                target = (src, sym)
            elif (pkg, sym) in pkg_file_of:
                target = (pkg_file_of[(pkg, sym)], sym)
            else:
                continue
        else:
            sym = callee
            if sym in names_in_file.get(src, set()):
                target = (src, sym)
            else:
                cands = [(pp, n) for (pp, n) in func_index if dirname(pp) == srcdir and n == sym]
                if len(cands) == 1:
                    target = cands[0]
                elif len(cands) > 1:
                    non_test = [x for x in cands if not x[0].endswith("_test.go")]
                    target = non_test[0] if len(non_test) == 1 else None
                else:
                    continue
        if target is None or target == (src, caller):
            continue
        pair = (caller_id, func_index[target])
        if pair not in seen_calls:
            seen_calls.add(pair)
            edges.append({"source": pair[0], "target": pair[1], "type": "calls", "direction": "forward", "weight": 0.8})

# ---------- tested_by (production -> test, Go convention) ----------
TEST_PAIRS = [
 ("clients/launcher/cmd/ollama_models.go", "clients/launcher/cmd/ollama_models_test.go"),
 ("clients/launcher/cmd/onboard.go", "clients/launcher/cmd/onboard_secrets_test.go"),
 ("clients/launcher/cmd/start.go", "clients/launcher/cmd/start_test.go"),
 ("clients/launcher/internal/compose/compose.go", "clients/launcher/internal/compose/compose_test.go"),
 ("clients/launcher/internal/compose/compose.go", "clients/launcher/internal/compose/web_test.go"),
 ("clients/launcher/internal/config/config.go", "clients/launcher/internal/config/config_test.go"),
 ("clients/launcher/internal/config/secrets.go", "clients/launcher/internal/config/secrets_test.go"),
 ("clients/launcher/internal/engagement/picker.go", "clients/launcher/internal/engagement/picker_test.go"),
 ("clients/launcher/internal/health/health.go", "clients/launcher/internal/health/health_test.go"),
]
for prod, test in TEST_PAIRS:
    edges.append({"source": "file:" + prod, "target": "file:" + test, "type": "tested_by", "direction": "forward", "weight": 0.5})

out = {"batchIndex": 1, "batchFiles": b["files"], "nodes": nodes, "edges": edges}
with io.open(os.path.join(UA, "intermediate", "batch-1.json"), "w", encoding="utf-8") as fh:
    json.dump(out, fh, ensure_ascii=False, indent=2)

from collections import Counter
print("nodes:", len(nodes), Counter(n["type"] for n in nodes))
print("edges:", len(edges), Counter(e["type"] for e in edges))
print("imports expected:", expected_imports)
# validate
ids = {n["id"] for n in nodes}
bad = [e for e in edges if e["type"] != "imports" and (e["source"] not in ids or e["target"] not in ids)]
print("non-imports edges with missing endpoints:", len(bad))
for e in bad[:10]:
    print("  BAD:", e)
empty = [n["id"] for n in nodes if not n.get("summary") or not n.get("tags")]
print("nodes missing summary/tags:", len(empty))
