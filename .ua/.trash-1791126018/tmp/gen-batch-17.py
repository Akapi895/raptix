#!/usr/bin/env python3
"""Generate UA batch-17.json (sandbox stack: http backend, notifications middleware, kernel, server + tests)."""
import io
import json
import os
import re

UA = r"D:\.VTNet\redteam\raptix\.ua"
ROOT = r"D:\.VTNet\redteam\raptix"
IDX = 17
batches = json.load(io.open(os.path.join(UA, "intermediate", "batches.json"), encoding="utf-8"))
b = [x for x in batches["batches"] if x.get("batchIndex") == IDX][0]
ext = json.load(io.open(os.path.join(UA, "tmp", "ua-file-extract-results-%d.json" % IDX), encoding="utf-8"))
results = {r["path"]: r for r in ext["results"]}

FILE_META = {
    "packages/raptix/raptix/backends/http_sandbox.py": ("Backend sandbox qua HTTP: chuẩn hóa workspace, mirror key chống va chạm job, client httpx lười có cache, header Bearer và retry cho boot window.", ["sandbox", "backend", "http-client"], "Python: client lười khởi tạo một lần, retry lỗi kết nối khi daemon đang boot."),
    "packages/raptix/raptix/middleware/notifications.py": ("Middleware nhắc job nền hoàn thành: gom completions thành một Human/system reminder, mỗi session báo một lần, chịu lỗi poll.", ["middleware", "thông-báo", "job-nền"], ""),
    "packages/raptix/raptix/sandbox_kernel/__init__.py": ("Barrel lớp thấp nhất của stack sandbox: re-export tracker job nền, session manager tmux và hằng số dùng chung cho cả agent và daemon.", ["barrel", "entry-point", "sandbox"], ""),
    "packages/raptix/raptix/sandbox_kernel/base.py": ("Lớp cơ sở SandboxBase: chuẩn hóa workspace path fail-closed, liệt kê và dọn tmux socket mồ côi, offsets log và tracker job.", ["sandbox", "lớp-cơ-sở", "tmux"], ""),
    "packages/raptix/raptix/sandbox_kernel/daemon.py": ("DaemonSandbox chạy trong container: upload/download file với kiểm tra path tuyệt đối và tạo thư mục cha.", ["sandbox", "daemon", "file-io"], ""),
    "packages/raptix/raptix/sandbox_kernel/jobs.py": ("Theo dõi job nền: BackgroundJob và BackgroundJobTracker với register/complete/consume và liệt kê pending.", ["job-nền", "theo-dõi", "đồng-thời"], "Python: khóa RLock bảo vệ map job đa luồng."),
    "packages/raptix/raptix/sandbox_kernel/tmux.py": ("Quản lý phiên tmux: làm sạch noise terminal, poll backoff, phát hiện prompt tương tác, allowlist env proxy, marker PS1 và log theo engagement.", ["tmux", "phiên-làm-việc", "polling", "làm-sạch-log"], "Python: đếm marker PS1 để tách output, backoff hình học có chặn trên."),
    "packages/raptix/raptix/sandbox_server/__init__.py": ("Barrel sandbox daemon: re-export FastAPI app, entry là python -m raptix.sandbox_server.", ["barrel", "entry-point", "server"], ""),
    "packages/raptix/raptix/sandbox_server/__main__.py": ("Điểm vào chạy daemon sandbox bằng uvicorn, host/port đọc từ biến môi trường.", ["entry-point", "server", "daemon"], ""),
    "packages/raptix/raptix/sandbox_server/app.py": ("FastAPI daemon trong container: xác thực token, lifespan backend, endpoint execute/upload/download/tmux/background/poll/kill/log-diff.", ["api-server", "fastapi", "sandbox"], ""),
    "packages/raptix/tests/unit/backends/conftest.py": ("Fixture reset trạng thái class-level của sandbox (log offsets, tracker, tmux initialized) cho kiểm thử backends.", ["test", "pytest", "fixture"], ""),
    "packages/raptix/tests/unit/backends/test_background_jobs.py": ("Kiểm thử BackgroundJobTracker: register/complete/consume, pending completions và đường start_background/poll_completion.", ["test", "pytest", "job-nền"], ""),
    "packages/raptix/tests/unit/backends/test_docker_sandbox_helpers.py": ("Kiểm thử helpers tmux: diễn giải exit code, PS1 pattern, trích output, cắt ngắn và khóa manager.", ["test", "pytest", "tmux"], ""),
    "packages/raptix/tests/unit/backends/test_http_sandbox.py": ("Kiểm thử HTTPSandbox: id client, header auth, close idempotent và retry lỗi kết nối.", ["test", "pytest", "http-sandbox"], ""),
    "packages/raptix/tests/unit/backends/test_http_sandbox_job_key.py": ("Kiểm thử mirror key theo workspace: key composite chống va chạm job giữa các workspace cùng session.", ["test", "pytest", "job-nền"], ""),
    "packages/raptix/tests/unit/backends/test_session_log.py": ("Kiểm thử session log theo engagement workspace: init pipe pane, đọc diff, phục hồi truncate và reset offset.", ["test", "pytest", "session-log"], ""),
    "packages/raptix/tests/unit/middleware/test_notifications.py": ("Kiểm thử middleware thông báo job nền: gom reminder, chống trùng, evict khi đầy và chịu lỗi poll.", ["test", "pytest", "middleware"], ""),
    "packages/raptix/tests/unit/sandbox_kernel/test_daemon_fileio.py": ("Kiểm thử upload/download của DaemonSandbox: ghi file, tạo thư mục cha, từ chối path tương đối, batch có thứ tự.", ["test", "pytest", "file-io"], ""),
    "packages/raptix/tests/unit/sandbox_kernel/test_interactive_prompt_detection.py": ("Kiểm thử phát hiện đuôi prompt tương tác của tmux.", ["test", "pytest", "prompt"], ""),
    "packages/raptix/tests/unit/sandbox_kernel/test_log_sanitize.py": ("Kiểm thử làm sạch log terminal: strip OSC/CSI/C0, marker PS1 và chuẩn hóa CRLF.", ["test", "pytest", "làm-sạch-log"], ""),
    "packages/raptix/tests/unit/sandbox_kernel/test_orphan_reap.py": ("Kiểm thử tính và dọn session tmux mồ côi bằng discovered trừ tracked.", ["test", "pytest", "tmux"], ""),
    "packages/raptix/tests/unit/sandbox_kernel/test_poll_backoff.py": ("Kiểm thử backoff poll hình học có chặn trên cho vòng sync và async.", ["test", "pytest", "polling"], ""),
    "packages/raptix/tests/unit/sandbox_kernel/test_poll_capture_failures.py": ("Kiểm thử giới hạn số lần capture thất bại liên tiếp của poll.", ["test", "pytest", "polling"], ""),
    "packages/raptix/tests/unit/sandbox_kernel/test_ps1_marker_collision.py": ("Kiểm thử hình dạng PS1 marker và va chạm ngoặc trong payload output.", ["test", "pytest", "marker"], ""),
    "packages/raptix/tests/unit/sandbox_kernel/test_tmux_lifecycle.py": ("Kiểm thử vòng đời tmux: đếm marker, trích output, cắt ngắn, bookkeeping, send/clear và read screen.", ["test", "pytest", "tmux"], ""),
    "packages/raptix/tests/unit/sandbox_kernel/test_workspace_path.py": ("Kiểm thử chuẩn hóa workspace path: giữ path hợp lệ, fail-closed với traversal, mặc định workspace.", ["test", "pytest", "workspace"], ""),
    "packages/raptix/tests/unit/tools/bash/test_bash_output.py": ("Kiểm thử tool bash output: job running/done/idle, kill, status, workspace engagement và cô lập session.", ["test", "pytest", "bash-tool"], ""),
    "packages/raptix/tests/unit/tools/bash/test_offload_bracket_prefix.py": ("Kiểm thử offload output lớn: prefix ngoặc thì offload, output tổng hợp status thì không.", ["test", "pytest", "offload"], ""),
    "packages/raptix/tests/unit/tools/bash/test_passive_read_stale_guard.py": ("Kiểm thử bảo vệ stale khi đọc thụ động: ngưỡng hint, reset khi output đổi, cô lập session/workspace.", ["test", "pytest", "stale-guard"], ""),
    "packages/raptix/tests/unit/tools/bash/test_proxy_env.py": ("Kiểm thử allowlist env proxy/decepticon: lọc biến, dựng lệnh export an toàn shlex và đồng bộ vào tmux.", ["test", "pytest", "proxy-env"], ""),
}

FN_META = {
    ("packages/raptix/raptix/backends/http_sandbox.py", "_normalize_workspace"): ("Chuẩn hóa workspace path về slug an toàn, fail-closed với traversal và escape.", ["workspace", "chuẩn-hóa", "bảo-mật"]),
    ("packages/raptix/raptix/backends/http_sandbox.py", "_workspace_slug"): ("Suy diễn slug workspace từ path đã chuẩn hóa.", ["workspace", "slug", "tiện-ích"]),
    ("packages/raptix/raptix/backends/http_sandbox.py", "_mirror_key"): ("Khóa mirror job theo session và workspace: mặc định bằng session, workspace khác thì key composite.", ["job-nền", "khóa", "workspace"]),
    ("packages/raptix/raptix/backends/http_sandbox.py", "_retry_on_connection_error"): ("Decorator retry lỗi kết nối với backoff, chịu được boot window của daemon.", ["retry", "kết-nối", "backoff"]),
    ("packages/raptix/raptix/middleware/notifications.py", "_sanitize"): ("Làm sạch text output trước khi đưa vào reminder.", ["làm-sạch", "middleware", "văn-bản"]),
    ("packages/raptix/raptix/middleware/notifications.py", "_format_output"): ("Định dạng diff output dạng head/tail gọn cho reminder.", ["định-dạng", "diff", "reminder"]),
    ("packages/raptix/raptix/middleware/notifications.py", "_get_stream_writer"): ("Lấy stream writer của LangGraph để phát reminder.", ["streaming", "middleware", "writer"]),
    ("packages/raptix/raptix/sandbox_kernel/base.py", "_compute_orphan_tmux_sessions"): ("Tính session mồ côi bằng discovered trừ tracked.", ["tmux", "mồ-côi", "dọn-dẹp"]),
    ("packages/raptix/raptix/sandbox_kernel/base.py", "_list_decepticon_tmux_sockets"): ("Liệt kê socket tmux của decepticon theo uid hiện tại.", ["tmux", "socket", "liệt-kê"]),
    ("packages/raptix/raptix/sandbox_kernel/base.py", "_kill_tmux_socket"): ("Giết socket tmux mồ côi bằng subprocess.", ["tmux", "dọn-dẹp", "subprocess"]),
    ("packages/raptix/raptix/sandbox_kernel/tmux.py", "strip_terminal_noise"): ("Loại bỏ escape OSC/CSI/C0, marker PS1 và chuẩn hóa CRLF khỏi output terminal.", ["làm-sạch-log", "terminal", "tmux"]),
    ("packages/raptix/raptix/sandbox_kernel/tmux.py", "_next_poll_interval"): ("Khoảng poll tiếp theo theo backoff hình học có chặn trên.", ["polling", "backoff", "khoảng-cách"]),
    ("packages/raptix/raptix/sandbox_kernel/tmux.py", "_looks_like_interactive_prompt"): ("Nhận biết đuôi output có phải prompt tương tác đang chờ nhập.", ["prompt", "phát-hiện", "tương-tác"]),
    ("packages/raptix/raptix/sandbox_kernel/tmux.py", "_allowed_passthrough_env"): ("Lọc biến môi trường proxy/decepticon được phép đưa vào tmux.", ["proxy-env", "allowlist", "bảo-mật"]),
    ("packages/raptix/raptix/sandbox_kernel/tmux.py", "_shell_export_command"): ("Dựng lệnh export shell an toàn shlex từ allowlist env.", ["shell", "export", "an-toàn"]),
    ("packages/raptix/raptix/sandbox_kernel/tmux.py", "_safe_log"): ("Ghi log đã che thông tin nhạy cảm.", ["logging", "che-dấu", "an-toàn"]),
    ("packages/raptix/raptix/sandbox_kernel/tmux.py", "_interpret_exit_code"): ("Diễn giải exit code thành thông báo, gồm signal trên 128.", ["exit-code", "diễn-giải", "tmux"]),
    ("packages/raptix/raptix/sandbox_kernel/tmux.py", "_extract_interactive_output"): ("Trích output của phiên tương tác tới trước prompt.", ["trích-xuất", "tương-tác", "tmux"]),
    ("packages/raptix/raptix/sandbox_kernel/tmux.py", "_extract_output"): ("Trích output mới giữa các marker PS1.", ["trích-xuất", "marker", "tmux"]),
    ("packages/raptix/raptix/sandbox_kernel/tmux.py", "_truncate"): ("Cắt ngắn output vượt ngưỡng ký tự.", ["cắt-ngắn", "output", "giới-hạn"]),
    ("packages/raptix/raptix/sandbox_server/__main__.py", "main"): ("Đọc host/port từ env và chạy daemon uvicorn.", ["entry-point", "server", "uvicorn"]),
    ("packages/raptix/raptix/sandbox_server/app.py", "_get_backend"): ("Khởi tạo DaemonSandbox từ biến môi trường cho lifespan.", ["khởi-tạo", "backend", "daemon"]),
    ("packages/raptix/raptix/sandbox_server/app.py", "_verify_token"): ("Xác thực Bearer token bằng compare_digest.", ["xác-thực", "token", "bảo-mật"]),
}

CLASS_META = {
    ("packages/raptix/raptix/backends/http_sandbox.py", "SandboxError"): ("Lỗi backend sandbox HTTP.", ["lỗi", "sandbox", "http"]),
    ("packages/raptix/raptix/backends/http_sandbox.py", "HTTPSandbox"): ("Backend sandbox phía agent qua HTTP: client lười, auth Bearer, retry, thực thi tmux, job nền và log diff theo engagement workspace.", ["sandbox", "backend", "http-client"]),
    ("packages/raptix/raptix/middleware/notifications.py", "SandboxNotificationMiddleware"): ("Middleware before/after model: báo job nền hoàn thành đúng một lần mỗi session, gom nhiều completion thành một reminder.", ["middleware", "thông-báo", "job-nền"]),
    ("packages/raptix/raptix/sandbox_kernel/base.py", "SandboxBase"): ("Lớp cơ sở sandbox: chuẩn hóa workspace, quản lý socket tmux, offsets log và tracker job.", ["sandbox", "lớp-cơ-sở", "tmux"]),
    ("packages/raptix/raptix/sandbox_kernel/daemon.py", "DaemonSandbox"): ("Sandbox trong container: thực thi lệnh, upload/download file an toàn theo workspace.", ["sandbox", "daemon", "thực-thi"]),
    ("packages/raptix/raptix/sandbox_kernel/jobs.py", "BackgroundJob"): ("Bản ghi job nền: session, key, lệnh, marker, trạng thái và exit code.", ["job-nền", "bản-ghi", "dữ-liệu"]),
    ("packages/raptix/raptix/sandbox_kernel/jobs.py", "BackgroundJobTracker"): ("Tracker job nền thread-safe: register, hoàn thành, đánh dấu đã đọc, liệt kê pending và xóa.", ["job-nền", "theo-dõi", "đồng-thời"]),
    ("packages/raptix/raptix/sandbox_kernel/tmux.py", "TmuxCommandError"): ("Lỗi lệnh tmux kèm ngữ cảnh session.", ["lỗi", "tmux", "lệnh"]),
    ("packages/raptix/raptix/sandbox_kernel/tmux.py", "TmuxSessionManager"): ("Quản lý vòng đời phiên tmux: init, gửi lệnh, poll output, job nền, log sessions và dọn dẹp.", ["tmux", "phiên-làm-việc", "quản-lý"]),
}

TEST_PAIRS = [
    ("packages/raptix/raptix/sandbox_kernel/jobs.py", "packages/raptix/tests/unit/backends/test_background_jobs.py"),
    ("packages/raptix/raptix/sandbox_kernel/tmux.py", "packages/raptix/tests/unit/backends/test_docker_sandbox_helpers.py"),
    ("packages/raptix/raptix/backends/http_sandbox.py", "packages/raptix/tests/unit/backends/test_http_sandbox.py"),
    ("packages/raptix/raptix/backends/http_sandbox.py", "packages/raptix/tests/unit/backends/test_http_sandbox_job_key.py"),
    ("packages/raptix/raptix/sandbox_kernel/base.py", "packages/raptix/tests/unit/backends/test_session_log.py"),
    ("packages/raptix/raptix/sandbox_kernel/tmux.py", "packages/raptix/tests/unit/backends/test_session_log.py"),
    ("packages/raptix/raptix/middleware/notifications.py", "packages/raptix/tests/unit/middleware/test_notifications.py"),
    ("packages/raptix/raptix/sandbox_kernel/daemon.py", "packages/raptix/tests/unit/sandbox_kernel/test_daemon_fileio.py"),
    ("packages/raptix/raptix/sandbox_kernel/tmux.py", "packages/raptix/tests/unit/sandbox_kernel/test_interactive_prompt_detection.py"),
    ("packages/raptix/raptix/sandbox_kernel/tmux.py", "packages/raptix/tests/unit/sandbox_kernel/test_log_sanitize.py"),
    ("packages/raptix/raptix/sandbox_kernel/base.py", "packages/raptix/tests/unit/sandbox_kernel/test_orphan_reap.py"),
    ("packages/raptix/raptix/sandbox_kernel/tmux.py", "packages/raptix/tests/unit/sandbox_kernel/test_poll_backoff.py"),
    ("packages/raptix/raptix/sandbox_kernel/tmux.py", "packages/raptix/tests/unit/sandbox_kernel/test_poll_capture_failures.py"),
    ("packages/raptix/raptix/sandbox_kernel/tmux.py", "packages/raptix/tests/unit/sandbox_kernel/test_ps1_marker_collision.py"),
    ("packages/raptix/raptix/sandbox_kernel/tmux.py", "packages/raptix/tests/unit/sandbox_kernel/test_tmux_lifecycle.py"),
    ("packages/raptix/raptix/sandbox_kernel/base.py", "packages/raptix/tests/unit/sandbox_kernel/test_workspace_path.py"),
]

TEST_FILE_PROD = {t: p for (p, t) in TEST_PAIRS}


def camel_words(s):
    return re.sub(r"(?<!^)(?=[A-Z])", " ", s).lower()


def test_fn_summary(name):
    body = name[5:] if name.startswith("test_") else name
    if "_" in body:
        subj, scen = body.split("_", 1)
        return "Kiểm thử %s với kịch bản %s." % (subj.replace("_", " "), scen.replace("_", " "))
    return "Kiểm thử %s." % body.replace("_", " ")


def test_fn_tags(name):
    body = name[5:] if name.startswith("test_") else name
    slug = re.sub(r"[^a-z0-9]+", "-", body.split("_", 1)[0].lower()).strip("-") or "case"
    return ["test", "pytest", slug]


def test_class_summary(name, path):
    prod = TEST_FILE_PROD.get(path, "")
    prod_base = prod.split("/")[-1] if prod else path.split("/")[-1]
    words = camel_words(name[4:] if name.startswith("Test") else name)
    return "Nhóm kiểm thử %s cho %s." % (words, prod_base)


def test_class_tags(name):
    slug = re.sub(r"(?<!^)(?=[A-Z])", "-", name[4:] if name.startswith("Test") else name).lower()
    return ["test", "pytest", slug]


def fallback_fn(path, name, lines, is_test):
    base = path.split("/")[-1]
    if is_test or name.startswith("test_"):
        return test_fn_summary(name), test_fn_tags(name)
    if name.startswith("_"):
        return ("Hàm nội bộ %s (%d dòng) trong %s." % (name, lines, base),
                ["nội-bộ", "python", path.split("/")[-2]])
    return ("Hàm %s (%d dòng) trong %s." % (name, lines, base),
            ["tiện-ích", "python", path.split("/")[-2]])


def fallback_class(path, name, lines, methods, is_test):
    base = path.split("/")[-1]
    if is_test or name.startswith("Test"):
        return test_class_summary(name, path), test_class_tags(name)
    if name.endswith(("Request", "Response", "Model")) or "Model" in name:
        return ("Model dữ liệu %s (%d dòng) cho API sandbox." % (name, lines), ["data-model", "pydantic", "api"])
    if name.endswith("Error"):
        return ("Ngoại lệ %s (%d dòng) trong %s." % (name, lines, base), ["lỗi", "ngoại-lệ", "python"])
    return ("Lớp %s (%d phương thức, %d dòng) trong %s." % (name, len(methods), lines, base),
            ["data-model", "python", path.split("/")[-2]])


def file_complexity(ne):
    if ne < 50:
        return "simple"
    if ne <= 200:
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
func_index = {}
names_in_file = {}
exported = {}
is_test_file = {}
for f in b["files"]:
    p = f["path"]
    r = results[p]
    exported[p] = set(e["name"] for e in r.get("exports", []))
    names_in_file[p] = set()
    is_test_file[p] = "/tests/" in p or "test_" in p.split("/")[-1]

for f in b["files"]:
    p = f["path"]
    r = results[p]
    ne = r.get("nonEmptyLines", f["sizeLines"])
    summary, tags, notes = FILE_META[p]
    node = {"id": "file:" + p, "type": "file", "name": p.split("/")[-1],
            "filePath": p, "summary": summary, "tags": tags, "complexity": file_complexity(ne)}
    if notes:
        node["languageNotes"] = notes
    nodes.append(node)

    for fn in r.get("functions", []):
        lines = fn["endLine"] - fn["startLine"] + 1
        is_exp = fn["name"] in exported[p]
        if not (lines >= 10 or is_exp):
            continue
        key = (p, fn["name"])
        if key in FN_META:
            s, t = FN_META[key]
        else:
            s, t = fallback_fn(p, fn["name"], lines, is_test_file[p])
        nid = "function:%s:%s" % (p, fn["name"])
        nodes.append({"id": nid, "type": "function", "name": fn["name"], "filePath": p,
                      "lineRange": [fn["startLine"], fn["endLine"]],
                      "summary": s, "tags": t, "complexity": fn_complexity(lines)})
        func_index[key] = nid
        names_in_file[p].add(fn["name"])
        edges.append({"source": "file:" + p, "target": nid, "type": "contains", "direction": "forward", "weight": 1.0})
        if is_exp:
            edges.append({"source": "file:" + p, "target": nid, "type": "exports", "direction": "forward", "weight": 0.8})

    for cl in r.get("classes", []):
        lines = cl["endLine"] - cl["startLine"] + 1
        methods = cl.get("methods", [])
        is_exp = cl["name"] in exported[p]
        if not (len(methods) >= 2 or lines >= 20 or is_exp):
            continue
        key = (p, cl["name"])
        if key in CLASS_META:
            s, t = CLASS_META[key]
        else:
            s, t = fallback_class(p, cl["name"], lines, methods, is_test_file[p])
        nid = "class:%s:%s" % (p, cl["name"])
        nodes.append({"id": nid, "type": "class", "name": cl["name"], "filePath": p,
                      "lineRange": [cl["startLine"], cl["endLine"]],
                      "summary": s, "tags": t, "complexity": fn_complexity(lines)})
        func_index[key] = nid
        names_in_file[p].add(cl["name"])
        edges.append({"source": "file:" + p, "target": nid, "type": "contains", "direction": "forward", "weight": 1.0})
        if is_exp:
            edges.append({"source": "file:" + p, "target": nid, "type": "exports", "direction": "forward", "weight": 0.8})

bid = b.get("batchImportData", {})
expected_imports = sum(len(v) for v in bid.values())
for src, dsts in bid.items():
    for d in dsts:
        edges.append({"source": "file:" + src, "target": "file:" + d, "type": "imports", "direction": "forward", "weight": 0.7})
n_imports = sum(1 for e in edges if e["type"] == "imports")
assert n_imports == expected_imports, (n_imports, expected_imports)

name_to_paths = {}
for (pp, n) in func_index:
    name_to_paths.setdefault(n, []).append(pp)

seen_calls = set()


def pick_target(src, sym, imported):
    if sym in names_in_file.get(src, set()):
        return (src, sym)
    # imported files plus one-level re-export closure (barrels re-export prod symbols)
    closure = set(imported)
    for pp in list(imported):
        closure.update(bid.get(pp, []))
    cands = [(pp, sym) for pp in closure if (pp, sym) in func_index]
    if len(cands) == 1:
        return cands[0]
    if cands:
        non_test = [x for x in cands if not is_test_file[x[0]]]
        if len(non_test) == 1:
            return non_test[0]
    return None


for src, r in results.items():
    imported = set(bid.get(src, []))
    for c in r.get("callGraph", []):
        caller, callee = c.get("caller"), c.get("callee")
        if not caller or not callee or "\n" in callee or " " in callee or "(" in callee:
            continue
        caller_id = func_index.get((src, caller))
        if caller_id is None:
            continue
        # Bỏ qua callee có dấu chấm: đầu dotted là object/module ngoài, không phải file project
        if "." in callee:
            continue
        sym = callee
        if not sym or not re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", sym):
            continue
        if sym in ("self", "cls"):
            continue
        target = pick_target(src, sym, imported)
        if target is None or target == (src, caller):
            continue
        pair = (caller_id, func_index[target])
        if pair not in seen_calls:
            seen_calls.add(pair)
            edges.append({"source": pair[0], "target": pair[1], "type": "calls", "direction": "forward", "weight": 0.8})

# inherits: scan class bases, keep only in-batch class targets
class_nodes = {n for (pp, n) in func_index if func_index[(pp, n)].startswith("class:")}
for f in b["files"]:
    p = f["path"]
    if not p.endswith(".py"):
        continue
    try:
        text = io.open(os.path.join(ROOT, p.replace("/", os.sep)), encoding="utf-8").read()
    except Exception:
        continue
    for m in re.finditer(r"^\s*class\s+(\w+)\s*\(([^)]*)\)\s*:", text, re.M):
        child, bases = m.group(1), [x.strip().split("[")[0].split(".")[-1] for x in m.group(2).split(",")]
        if (p, child) not in func_index:
            continue
        for base in bases:
            if not base or base in ("object", "Exception", "BaseException", "ABC"):
                continue
            hit = [pp for (pp, n) in func_index if n == base and func_index[(pp, n)].startswith("class:")]
            if len(hit) == 1:
                edges.append({"source": func_index[(p, child)], "target": func_index[(hit[0], base)],
                                  "type": "inherits", "direction": "forward", "weight": 0.9})

for prod, test in TEST_PAIRS:
    edges.append({"source": "file:" + prod, "target": "file:" + test, "type": "tested_by", "direction": "forward", "weight": 0.5})

out = {"batchIndex": IDX, "batchFiles": b["files"], "nodes": nodes, "edges": edges}
with io.open(os.path.join(UA, "intermediate", "batch-%d.json" % IDX), "w", encoding="utf-8") as fh:
    json.dump(out, fh, ensure_ascii=False, indent=2)

from collections import Counter
print("nodes:", len(nodes), Counter(n["type"] for n in nodes))
print("edges:", len(edges), Counter(e["type"] for e in edges))
print("imports expected:", expected_imports)
ids = {n["id"] for n in nodes}
bad = [e for e in edges if e["type"] != "imports" and (e["source"] not in ids or e["target"] not in ids)]
print("non-imports edges with missing endpoints:", len(bad))
for e in bad[:10]:
    print("  BAD:", e)
empty = [n["id"] for n in nodes if not n.get("summary") or not n.get("tags")]
print("nodes missing summary/tags:", len(empty))
