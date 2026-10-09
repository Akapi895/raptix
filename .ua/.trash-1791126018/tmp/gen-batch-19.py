#!/usr/bin/env python3
"""Generate UA batch-19.json (web-raptix server: app bootstrap, routes, integrations, repository, policy)."""
import io
import json
import os
import re

UA = r"D:\.VTNet\redteam\raptix\.ua"
ROOT = r"D:\.VTNet\redteam\raptix"
IDX = 19
batches = json.load(io.open(os.path.join(UA, "intermediate", "batches.json"), encoding="utf-8"))
b = [x for x in batches["batches"] if x.get("batchIndex") == IDX][0]
ext = json.load(io.open(os.path.join(UA, "tmp", "ua-file-extract-results-%d.json" % IDX), encoding="utf-8"))
results = {r["path"]: r for r in ext["results"]}

P = "clients/web-raptix/server/src/"

FILE_META = {
    P + "app.ts": ("Dựng Fastify app: đăng ký error handler, identity local, toàn bộ routes domain và services đã nối.", ["entry-point", "fastify", "bootstrap"], ""),
    P + "auth/identity-provider.ts": ("Danh tính operator local duy nhất cho server đơn người dùng.", ["xác-thực", "danh-tính", "local"], ""),
    P + "config/env.ts": ("Đọc và kiểm tra env server: host/port, database, workspace, graph, vault key, GoPhish/Sliver.", ["cấu-hình", "env", "kiểm-chứng"], "TypeScript: đọc từng biến có regex biên và giá trị mặc định an toàn."),
    P + "config/runtime.ts": ("Nạp cấu hình runtime: chuẩn hóa URL và workspace root chống escape.", ["cấu-hình", "runtime", "bảo-mật"], ""),
    P + "db/client.ts": ("Tạo và ngắt Prisma client cho server.", ["cơ-sở-dữ-liệu", "prisma", "client"], ""),
    P + "http/error-handler.ts": ("Chuẩn hóa lỗi API: ánh xạ status sang mã lỗi và đăng ký handler Fastify.", ["xử-lý-lỗi", "http", "fastify"], ""),
    P + "http/routes/approvals.routes.ts": ("Routes phê duyệt HITL: liệt kê và quyết định approval.", ["routes", "hitl", "phê-duyệt"], ""),
    P + "http/routes/campaign.routes.ts": ("Routes chiến dịch: capabilities, danh sách, tạo và chạy job.", ["routes", "chiến-dịch", "api"], ""),
    P + "http/routes/capabilities.routes.ts": ("Routes capabilities: dựng đáp ứng khả dụng từ probe database và runtime context.", ["routes", "khả-dụng", "api"], ""),
    P + "http/routes/events.routes.ts": ("Routes sự kiện SSE: mở stream theo scope engagement.", ["routes", "sse", "sự-kiện"], ""),
    P + "http/routes/findings.routes.ts": ("Routes findings và artifact: liệt kê findings và nội dung artifact.", ["routes", "findings", "artifact"], ""),
    P + "http/routes/graph.routes.ts": ("Routes đồ thị tấn công và tài sản theo engagement.", ["routes", "đồ-thị", "tài-sản"], ""),
    P + "http/routes/health.routes.ts": ("Routes sức khỏe: probe database và trạng thái runtime agents.", ["routes", "sức-khỏe", "giám-sát"], ""),
    P + "http/routes/members.routes.ts": ("Routes thành viên: liệt kê, mời và xóa.", ["routes", "thành-viên", "api"], ""),
    P + "http/routes/projects.routes.ts": ("Routes dự án: CRUD engagement, guard chạy theo dự án và đọc id.", ["routes", "dự-án", "engagement"], ""),
    P + "http/routes/runs.routes.ts": ("Routes run: tạo thread, gửi tin nhắn và điều khiển run.", ["routes", "run", "thread"], ""),
    P + "http/routes/settings.routes.ts": ("Routes cài đặt engagement và xóa engagement.", ["routes", "cài-đặt", "api"], ""),
    P + "http/routes/timeline.routes.ts": ("Routes timeline thao tác và export timeline.", ["routes", "timeline", "api"], ""),
    P + "http/routes/vault.routes.ts": ("Routes vault: liệt kê, tạo và reveal secret.", ["routes", "vault", "bí-mật"], ""),
    P + "integrations/c2/sliver-client.ts": ("Client HTTP Sliver C2: gọi có timeout và hủy body an toàn.", ["c2", "sliver", "http-client"], ""),
    P + "integrations/campaigns/evilginx-client.ts": ("Client bridge evilginx2 cho lab campaign.", ["campaign", "evilginx", "http-client"], ""),
    P + "integrations/campaigns/gophish-client.ts": ("Client GoPhish: chuẩn bị bundle tài sản có fingerprint sha256.", ["campaign", "gophish", "http-client"], "TypeScript: fingerprint bundle bằng sha256 để phát hiện đổi tài sản."),
    P + "integrations/runtime/execution-client.ts": ("Client thực thi runtime: kiểm tra id/metadata và gọi runtime.", ["runtime", "thực-thi", "client"], ""),
    P + "integrations/runtime/join-client.ts": ("Client join stream runtime: mở subscription có abort và heartbeat.", ["runtime", "stream", "client"], ""),
    P + "integrations/runtime/read-client.ts": ("Client đọc runtime: state checkpoint có timeout, lỗi unavailable/rejected/missing.", ["runtime", "đọc", "client"], ""),
    P + "main.ts": ("Điểm vào server: đọc env, nối database, nạp services và listen.", ["entry-point", "server", "bootstrap"], ""),
    P + "repositories/engagements-repository.ts": ("Repository engagement qua Prisma: liệt kê, tìm, tạo và cập nhật, báo xung đột tên.", ["repository", "prisma", "engagement"], ""),
    P + "security/project-policy.ts": ("Chính sách tạo/sửa dự án: slug, target web/ip-range, display name và đổi target.", ["chính-sách", "kiểm-chứng", "dự-án"], "TypeScript: chỉ dùng parser stdlib, không resolve mạng hay suy diễn."),
}

FN_META = {
    (P + "app.ts", "buildApp"): ("Dựng Fastify app với error handler, identity và toàn bộ routes/services.", ["bootstrap", "fastify", "entry-point"]),
    (P + "auth/identity-provider.ts", "getLocalIdentity"): ("Trả về danh tính operator local.", ["danh-tính", "local", "xác-thực"]),
    (P + "config/env.ts", "loadServerEnv"): ("Đọc và kiểm tra toàn bộ env server, ném EnvValidationError khi sai.", ["cấu-hình", "env", "kiểm-chứng"]),
    (P + "config/env.ts", "readServerEnv"): ("Đọc env server đã kiểm chứng cho bootstrap.", ["cấu-hình", "env", "đọc"]),
    (P + "config/runtime.ts", "loadRuntimeConfig"): ("Nạp runtime config, chặn workspace root escape.", ["runtime", "cấu-hình", "bảo-mật"]),
    (P + "db/client.ts", "createDbClient"): ("Tạo Prisma client.", ["cơ-sở-dữ-liệu", "prisma", "khởi-tạo"]),
    (P + "db/client.ts", "disconnectDb"): ("Ngắt Prisma client.", ["cơ-sở-dữ-liệu", "prisma", "dọn-dẹp"]),
    (P + "http/error-handler.ts", "apiErrorBody"): ("Dựng body lỗi API chuẩn từ status.", ["lỗi", "api", "định-dạng"]),
    (P + "http/error-handler.ts", "registerErrorHandler"): ("Đăng ký not-found và error handler cho Fastify.", ["lỗi", "fastify", "đăng-ký"]),
    (P + "http/routes/approvals.routes.ts", "registerApprovalRoutes"): ("Đăng ký routes liệt kê và quyết định approval.", ["routes", "hitl", "đăng-ký"]),
    (P + "http/routes/campaign.routes.ts", "registerCampaignRoutes"): ("Đăng ký routes capabilities/list/tạo/chạy job campaign.", ["routes", "chiến-dịch", "đăng-ký"]),
    (P + "http/routes/capabilities.routes.ts", "buildCapabilitiesResponse"): ("Dựng đáp ứng capabilities từ probe và runtime context.", ["khả-dụng", "đáp-ứng", "probe"]),
    (P + "http/routes/capabilities.routes.ts", "registerCapabilitiesRoutes"): ("Đăng ký route capabilities.", ["routes", "khả-dụng", "đăng-ký"]),
    (P + "http/routes/events.routes.ts", "registerEventRoutes"): ("Đăng ký route stream sự kiện SSE có abort.", ["routes", "sse", "đăng-ký"]),
    (P + "http/routes/findings.routes.ts", "registerFindingsRoutes"): ("Đăng ký routes findings và artifact.", ["routes", "findings", "đăng-ký"]),
    (P + "http/routes/graph.routes.ts", "registerGraphRoutes"): ("Đăng ký routes graph và assets.", ["routes", "đồ-thị", "đăng-ký"]),
    (P + "http/routes/health.routes.ts", "probeDatabase"): ("Probe database cho health check.", ["sức-khỏe", "probe", "cơ-sở-dữ-liệu"]),
    (P + "http/routes/health.routes.ts", "registerHealthRoutes"): ("Đăng ký routes sức khỏe.", ["routes", "sức-khỏe", "đăng-ký"]),
    (P + "http/routes/members.routes.ts", "registerMembersRoutes"): ("Đăng ký routes liệt kê/mời/xóa thành viên.", ["routes", "thành-viên", "đăng-ký"]),
    (P + "http/routes/projects.routes.ts", "runProjectsHandler"): ("Guard chạy handler trong phạm vi dự án đã xác thực.", ["guard", "dự-án", "phạm-vi"]),
    (P + "http/routes/projects.routes.ts", "registerProjectRoutes"): ("Đăng ký routes CRUD dự án.", ["routes", "dự-án", "đăng-ký"]),
    (P + "http/routes/runs.routes.ts", "registerRunRoutes"): ("Đăng ký routes thread và run.", ["routes", "run", "đăng-ký"]),
    (P + "http/routes/settings.routes.ts", "registerSettingsRoutes"): ("Đăng ký routes cài đặt và xóa engagement.", ["routes", "cài-đặt", "đăng-ký"]),
    (P + "http/routes/timeline.routes.ts", "registerTimelineRoutes"): ("Đăng ký routes timeline và export.", ["routes", "timeline", "đăng-ký"]),
    (P + "http/routes/vault.routes.ts", "registerVaultRoutes"): ("Đăng ký routes vault.", ["routes", "vault", "đăng-ký"]),
    (P + "integrations/runtime/execution-client.ts", "run"): ("Thực thi run sau khi kiểm tra id và metadata.", ["runtime", "thực-thi", "kiểm-chứng"]),
    (P + "main.ts", "main"): ("Bootstrap server: env, database, services rồi listen.", ["bootstrap", "server", "entry-point"]),
    (P + "security/project-policy.ts", "assertProjectTarget"): ("Khẳng định target dự án hợp lệ theo loại.", ["kiểm-chứng", "target", "dự-án"]),
    (P + "security/project-policy.ts", "parseCreateProject"): ("Parse và kiểm tra payload tạo dự án.", ["kiểm-chứng", "tạo-dự-án", "parse"]),
    (P + "security/project-policy.ts", "parseProjectPatch"): ("Parse và kiểm tra payload sửa dự án.", ["kiểm-chứng", "sửa-dự-án", "parse"]),
    (P + "security/project-policy.ts", "assertProjectTargetChangeAllowed"): ("Khẳng định được phép đổi target theo lifecycle.", ["kiểm-chứng", "target", "lifecycle"]),
}

CLASS_META = {
    (P + "config/env.ts", "EnvValidationError"): ("Lỗi kiểm tra env server.", ["lỗi", "env", "kiểm-chứng"]),
    (P + "integrations/c2/sliver-client.ts", "SliverClient"): ("Client gọi Sliver C2 qua HTTP có timeout.", ["c2", "sliver", "http-client"]),
    (P + "integrations/campaigns/evilginx-client.ts", "EvilginxBridgeError"): ("Lỗi bridge evilginx2.", ["lỗi", "evilginx", "bridge"]),
    (P + "integrations/campaigns/evilginx-client.ts", "EvilginxClient"): ("Client vận hành lab evilginx2.", ["campaign", "evilginx", "client"]),
    (P + "integrations/campaigns/gophish-client.ts", "GoPhishError"): ("Lỗi GoPhish.", ["lỗi", "gophish", "ngoại-lệ"]),
    (P + "integrations/campaigns/gophish-client.ts", "GoPhishClient"): ("Client chuẩn bị và triển khai GoPhish.", ["campaign", "gophish", "client"]),
    (P + "integrations/runtime/execution-client.ts", "RuntimeExecutionClient"): ("Client thực thi run trên runtime.", ["runtime", "thực-thi", "client"]),
    (P + "integrations/runtime/join-client.ts", "RuntimeJoinClient"): ("Client mở subscription stream runtime.", ["runtime", "stream", "client"]),
    (P + "integrations/runtime/read-client.ts", "RuntimeUnavailableError"): ("Lỗi runtime không khả dụng.", ["lỗi", "runtime", "ngoại-lệ"]),
    (P + "integrations/runtime/read-client.ts", "RuntimeCheckpointMissingError"): ("Lỗi thiếu checkpoint runtime.", ["lỗi", "checkpoint", "ngoại-lệ"]),
    (P + "integrations/runtime/read-client.ts", "RuntimeRejectedError"): ("Lỗi runtime từ chối yêu cầu.", ["lỗi", "runtime", "ngoại-lệ"]),
    (P + "integrations/runtime/read-client.ts", "RuntimeReadClient"): ("Client đọc state runtime có timeout và abort.", ["runtime", "đọc", "client"]),
    (P + "repositories/engagements-repository.ts", "EngagementNameConflictError"): ("Lỗi trùng tên engagement.", ["lỗi", "xung-đột", "engagement"]),
    (P + "repositories/engagements-repository.ts", "EngagementsRepository"): ("Repository engagement: CRUD qua Prisma, ánh xạ xung đột unique.", ["repository", "prisma", "engagement"]),
    (P + "security/project-policy.ts", "ProjectPolicyError"): ("Lỗi chính sách dự án kèm mã và field.", ["lỗi", "chính-sách", "dự-án"]),
}

TEST_PAIRS = []


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


def fallback_fn(path, name, lines):
    base = path.split("/")[-1]
    return ("Hàm %s (%d dòng) trong %s." % (name, lines, base),
            ["tiện-ích", "typescript", path.split("/")[-2]])


def fallback_class(path, name, lines, methods):
    base = path.split("/")[-1]
    if name.endswith("Error"):
        return ("Ngoại lệ %s (%d dòng) trong %s." % (name, lines, base), ["lỗi", "ngoại-lệ", "typescript"])
    return ("Lớp %s (%d phương thức, %d dòng) trong %s." % (name, len(methods), lines, base),
            ["data-model", "typescript", path.split("/")[-2]])


nodes = []
edges = []
func_index = {}
names_in_file = {}
exported = {}
for f in b["files"]:
    p = f["path"]
    r = results[p]
    exported[p] = set(e["name"] for e in r.get("exports", []))
    names_in_file[p] = set()

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
            s, t = fallback_fn(p, fn["name"], lines)
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
            s, t = fallback_class(p, cl["name"], lines, methods)
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

seen_calls = set()


def pick_target(src, sym, imported):
    if sym in names_in_file.get(src, set()):
        return (src, sym)
    closure = set(imported)
    for pp in list(imported):
        closure.update(bid.get(pp, []))
    cands = [(pp, sym) for pp in closure if (pp, sym) in func_index]
    if len(cands) == 1:
        return cands[0]
    if cands:
        non_test = [x for x in cands if "test" not in x[0].lower()]
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
        if "." in callee:
            continue
        sym = callee
        if not sym or not re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", sym):
            continue
        target = pick_target(src, sym, imported)
        if target is None or target == (src, caller):
            continue
        pair = (caller_id, func_index[target])
        if pair not in seen_calls:
            seen_calls.add(pair)
            edges.append({"source": pair[0], "target": pair[1], "type": "calls", "direction": "forward", "weight": 0.8})

# inherits: class extends, chỉ giữ target là class trong batch
for f in b["files"]:
    p = f["path"]
    if not p.endswith(".ts"):
        continue
    try:
        text = io.open(os.path.join(ROOT, p.replace("/", os.sep)), encoding="utf-8").read()
    except Exception:
        continue
    for m in re.finditer(r"class\s+(\w+)(?:\s+extends\s+(\w+))?", text):
        child, base = m.group(1), m.group(2)
        if not base or (p, child) not in func_index:
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
