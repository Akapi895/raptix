#!/usr/bin/env python3
"""Generate UA batch-20.json (web-raptix server services, security policies, runtime projections + tests)."""
import io
import json
import os
import re

UA = r"D:\.VTNet\redteam\raptix\.ua"
ROOT = r"D:\.VTNet\redteam\raptix"
IDX = 20
batches = json.load(io.open(os.path.join(UA, "intermediate", "batches.json"), encoding="utf-8"))
b = [x for x in batches["batches"] if x.get("batchIndex") == IDX][0]
ext = json.load(io.open(os.path.join(UA, "tmp", "ua-file-extract-results-%d.json" % IDX), encoding="utf-8"))
results = {r["path"]: r for r in ext["results"]}

S = "clients/web-raptix/server/src/"
T = "clients/web-raptix/server/tests/"

FILE_META = {
    S + "security/request-fingerprint.ts": ("Fingerprint request: chuẩn hóa JSON (sắp xếp key, chặn lồng sâu, giới hạn 64KiB) rồi hash sha256.", ["bảo-mật", "fingerprint", "hash"], "TypeScript: canonical JSON sắp xếp key để fingerprint ổn định."),
    S + "security/run-policy.ts": ("Parse yêu cầu runtime theo phạm vi: thread/run/page/resume/approval với requestId và giới hạn chặt.", ["chính-sách", "kiểm-chứng", "runtime"], ""),
    S + "security/workspace-policy.ts": ("Giải quyết thư mục workspace engagement: kiểm tra slug, chặn escape root và tạo plan dir.", ["workspace", "bảo-mật", "đường-dẫn"], "TypeScript: realpath và assertInsideRoot chống path traversal."),
    S + "services/approvals-service.ts": ("Phê duyệt HITL dựa file: đọc approval_request JSONL, append decision có mutex, re-check trong lock.", ["hitl", "phê-duyệt", "service"], "TypeScript: quyết định concurrent được serialize bằng mutex tiến trình."),
    S + "services/artifacts-service.ts": ("Trình duyệt artifact theo engagement: liệt kê allowlist không đệ quy, đọc text/JSON có cap, chặn symlink.", ["artifact", "service", "bảo-mật"], ""),
    S + "services/c2-service.ts": ("Service C2: ủy quyền engagement, liệt kê sessions/listeners/profiles Sliver và audit lệnh bền.", ["c2", "sliver", "service"], ""),
    S + "services/campaign-deployment-service.ts": ("Triển khai campaign GoPhish: reserve ledger, khóa version, deploy lab không gửi lại mail.", ["campaign", "triển-khai", "gophish"], ""),
    S + "services/campaign-job-ledger.ts": ("Sổ ledger job campaign: parse request và reserve idempotent theo requestId.", ["campaign", "ledger", "idempotent"], ""),
    S + "services/campaign-service.ts": ("Service campaign: bản nháp scoped, chuẩn bị tài sản GoPhish và điều phối evilginx.", ["campaign", "service", "phishing"], ""),
    S + "services/evilginx-campaign-service.ts": ("Chạy và đối soát campaign evilginx2 lab: reserve ledger, persist manifest.", ["campaign", "evilginx", "service"], ""),
    S + "services/export-service.ts": ("Export engagement JSON/Markdown: DTO thật, tài liệu plan và FIND-*.md thô, validate format strict.", ["export", "báo-cáo", "service"], ""),
    S + "services/findings-service.ts": ("Chiếu findings: parse FIND-*.md trong workspace, gắn cờ chất lượng parser, mặc định bị gắn cờ.", ["findings", "service", "chiếu"], ""),
    S + "services/graph-service.ts": ("Service đồ thị tấn công qua HTTP Neo4j: whitelist thuộc tính public, che credential, chặn payload.", ["đồ-thị", "neo4j", "che-dấu"], "TypeScript: redaction credential diễn ra trước khi trả response."),
    S + "services/members-service.ts": ("Service thành viên đơn người dùng trung thực: liệt kê operator local, invite/xóa trả 503 kèm lý do.", ["thành-viên", "service", "single-user"], ""),
    S + "services/planning-service.ts": ("Đọc tài liệu planning: validate Ajv theo schema sinh từ Pydantic, chỉ chiếu field public.", ["planning", "tài-liệu", "kiểm-chứng"], ""),
    S + "services/projects-service.ts": ("Service dự án: CRUD engagement, guard target lifecycle, ánh xạ sang ProjectViewModel.", ["dự-án", "service", "engagement"], ""),
    S + "services/runtime-ownership.ts": ("Sở hữu runtime: binding thread, reservation request idempotent và recovery view.", ["runtime", "sở-hữu", "binding"], ""),
    S + "services/runtime/history-projection.ts": ("Chiếu lịch sử transcript checkpoint: hợp nhất theo provenance key, đánh dấu truncated trung thực.", ["lịch-sử", "transcript", "chiếu"], ""),
    S + "services/runtime/interrupt-projection.ts": ("Chiếu interrupt chờ: tìm câu hỏi ask_user_question và kiểm tra đáp án resume.", ["interrupt", "câu-hỏi", "chiếu"], ""),
    S + "services/runtime/run-service.ts": ("Service run: tạo thread, gửi tin nhắn, resume/hủy, trạng thái terminal và history.", ["run", "service", "runtime"], ""),
    S + "services/runtime/runtime-context.ts": ("Ngữ cảnh runtime tin cậy: parse selection, hydrate từ engagement và hash binding.", ["runtime", "ngữ-cảnh", "binding"], ""),
    S + "services/runtime/stream-projection.ts": ("Chiếu frame stream public: chuẩn hóa sub-agent event, che secret trong preview/args.", ["stream", "chiếu", "che-dấu"], "TypeScript: che Bearer/sk-/password/token cả trong text lẫn args."),
    S + "services/runtime/stream-service.ts": ("Mở stream SSE: kiểm tra cursor, join runtime và publish frame có heartbeat.", ["stream", "sse", "service"], ""),
    S + "services/settings-service.ts": ("Cài đặt engagement: view field đã persist, xóa là action nguy hiểm có guard in-flight.", ["cài-đặt", "service", "engagement"], ""),
    S + "services/timeline-service.ts": ("Timeline thao tác: hợp nhất run states, transcript checkpoint và marker mtime artifact, newest-first.", ["timeline", "service", "hợp-nhất"], ""),
    S + "services/vault-service.ts": ("Vault credentials: mã hóa AES-256-GCM bằng key operator, view redacted, audit reveal.", ["vault", "mã-hóa", "bí-mật"], "TypeScript: thiếu key thì 503, không bao giờ lưu plaintext."),
    T + "approvals-service.test.ts": ("Kiểm thử service approvals qua Fastify: request/decision JSONL và guard dự án.", ["test", "vitest", "hitl"], ""),
    T + "bootstrap.test.ts": ("Kiểm thử bootstrap app: repository in-memory, services dự án và wiring buildApp.", ["test", "vitest", "bootstrap"], ""),
}

FN_META = {
    (S + "security/request-fingerprint.ts", "requestFingerprint"): ("Băm sha256 payload sau chuẩn hóa JSON canonical.", ["fingerprint", "hash", "bảo-mật"]),
    (S + "security/run-policy.ts", "parseThreadCreate"): ("Parse tạo thread: requestId và selection context.", ["parse", "thread", "kiểm-chứng"]),
    (S + "security/run-policy.ts", "parseRunCreate"): ("Parse tạo run: requestId và message giới hạn 16k.", ["parse", "run", "kiểm-chứng"]),
    (S + "security/run-policy.ts", "parseRunPage"): ("Parse phân trang run: offset/limit.", ["parse", "phân-trang", "kiểm-chứng"]),
    (S + "security/run-policy.ts", "parseResumeCreate"): ("Parse resume run từ interrupt.", ["parse", "resume", "kiểm-chứng"]),
    (S + "security/run-policy.ts", "parseApprovalDecision"): ("Parse quyết định approval HITL.", ["parse", "phê-duyệt", "kiểm-chứng"]),
    (S + "security/workspace-policy.ts", "resolveEngagementWorkspaceDir"): ("Giải quyết và kiểm tra thư mục workspace của engagement.", ["workspace", "đường-dẫn", "bảo-mật"]),
    (S + "security/workspace-policy.ts", "prepareEngagementPlanDir"): ("Tạo thư mục plan trong workspace engagement.", ["workspace", "plan", "khởi-tạo"]),
    (S + "services/campaign-job-ledger.ts", "parseCampaignJobRequest"): ("Parse request job campaign: requestId và version.", ["parse", "campaign", "kiểm-chứng"]),
    (S + "services/campaign-service.ts", "toCampaignView"): ("Ánh xạ campaign sang view public.", ["ánh-xạ", "campaign", "view"]),
    (S + "services/export-service.ts", "isExportFormat"): ("Kiểm tra định dạng export hợp lệ.", ["kiểm-tra", "export", "định-dạng"]),
    (S + "services/findings-service.ts", "parseFindingMarkdown"): ("Parse FIND-*.md thành view kèm cờ chất lượng.", ["parse", "findings", "markdown"]),
    (S + "services/graph-service.ts", "toAssetSummaries"): ("Tóm tắt tài sản từ node đồ thị đã redaction.", ["tóm-tắt", "tài-sản", "đồ-thị"]),
    (S + "services/planning-service.ts", "readPlanningView"): ("Đọc và validate planning view theo schema.", ["planning", "đọc", "kiểm-chứng"]),
    (S + "services/runtime/history-projection.ts", "projectThreadHistory"): ("Chiếu transcript thread từ checkpoint values.", ["lịch-sử", "chiếu", "transcript"]),
    (S + "services/runtime/interrupt-projection.ts", "findPendingQuestion"): ("Tìm câu hỏi interrupt đang chờ.", ["interrupt", "câu-hỏi", "tìm-kiếm"]),
    (S + "services/runtime/interrupt-projection.ts", "assertResumeValue"): ("Kiểm tra đáp án resume hợp lệ với options.", ["resume", "kiểm-chứng", "interrupt"]),
    (S + "services/runtime/runtime-context.ts", "parseContextSelection"): ("Parse lựa chọn context runtime.", ["parse", "ngữ-cảnh", "runtime"]),
    (S + "services/runtime/stream-projection.ts", "projectCustomPayload"): ("Chiếu custom payload sub-agent thành public.", ["chiếu", "payload", "stream"]),
    (S + "services/runtime/stream-projection.ts", "projectStreamFrame"): ("Chiếu một frame stream thành sự kiện public.", ["chiếu", "frame", "stream"]),
    (S + "services/runtime/stream-service.ts", "streamCursor"): ("Kiểm tra cursor replay stream.", ["cursor", "stream", "kiểm-chứng"]),
    (S + "services/settings-service.ts", "toSettingsView"): ("Ánh xạ sang settings view.", ["ánh-xạ", "cài-đặt", "view"]),
}

CLASS_META = {
    (S + "services/approvals-service.ts", "ApprovalsService"): ("Service phê duyệt HITL dựa file với mutex tiến trình.", ["hitl", "phê-duyệt", "service"]),
    (S + "services/artifacts-service.ts", "ArtifactsService"): ("Service liệt kê và đọc artifact scoped theo engagement.", ["artifact", "service", "bảo-mật"]),
    (S + "services/c2-service.ts", "ProviderUnavailableError"): ("Lỗi provider C2 chưa cấu hình (503).", ["lỗi", "c2", "provider"]),
    (S + "services/c2-service.ts", "C2Service"): ("Service C2 engagement-owned qua Sliver.", ["c2", "sliver", "service"]),
    (S + "services/campaign-deployment-service.ts", "CampaignDeploymentService"): ("Triển khai campaign GoPhish idempotent.", ["campaign", "triển-khai", "service"]),
    (S + "services/campaign-job-ledger.ts", "CampaignJobLedger"): ("Sổ reserve job campaign theo requestId.", ["campaign", "ledger", "service"]),
    (S + "services/campaign-service.ts", "CampaignValidationError"): ("Lỗi kiểm tra campaign (400).", ["lỗi", "campaign", "kiểm-chứng"]),
    (S + "services/campaign-service.ts", "CampaignService"): ("Service campaign scoped: draft, prepare, deploy.", ["campaign", "service", "phishing"]),
    (S + "services/evilginx-campaign-service.ts", "EvilginxCampaignService"): ("Service chạy campaign evilginx2 lab.", ["campaign", "evilginx", "service"]),
    (S + "services/export-service.ts", "ExportService"): ("Service export JSON/Markdown engagement.", ["export", "service", "báo-cáo"]),
    (S + "services/findings-service.ts", "FindingsService"): ("Service chiếu findings từ workspace.", ["findings", "service", "chiếu"]),
    (S + "services/graph-service.ts", "GraphUnavailableError"): ("Lỗi graph không khả dụng.", ["lỗi", "đồ-thị", "ngoại-lệ"]),
    (S + "services/graph-service.ts", "GraphService"): ("Service đồ thị tấn công scoped qua Neo4j HTTP.", ["đồ-thị", "neo4j", "service"]),
    (S + "services/members-service.ts", "MembersUnsupportedError"): ("Lỗi tính năng members chưa hỗ trợ (503).", ["lỗi", "thành-viên", "ngoại-lệ"]),
    (S + "services/members-service.ts", "MembersService"): ("Service members single-user trung thực.", ["thành-viên", "service", "single-user"]),
    (S + "services/projects-service.ts", "ProjectApiError"): ("Lỗi API dự án kèm status.", ["lỗi", "dự-án", "api"]),
    (S + "services/projects-service.ts", "ProjectNotFoundError"): ("Lỗi không tìm thấy dự án.", ["lỗi", "dự-án", "not-found"]),
    (S + "services/projects-service.ts", "ProjectNameConflictError"): ("Lỗi trùng tên dự án.", ["lỗi", "xung-đột", "dự-án"]),
    (S + "services/projects-service.ts", "ProjectsService"): ("Service CRUD engagement và ánh xạ view.", ["dự-án", "service", "engagement"]),
    (S + "services/runtime-ownership.ts", "RuntimeOwnershipService"): ("Service sở hữu runtime: binding và reservation.", ["runtime", "sở-hữu", "service"]),
    (S + "services/runtime/run-service.ts", "RunService"): ("Service vòng đời thread/run runtime.", ["run", "service", "runtime"]),
    (S + "services/runtime/runtime-context.ts", "RuntimeContextService"): ("Service hydrate ngữ cảnh runtime tin cậy.", ["runtime", "ngữ-cảnh", "service"]),
    (S + "services/runtime/stream-service.ts", "StreamService"): ("Service mở stream SSE runtime.", ["stream", "sse", "service"]),
    (S + "services/settings-service.ts", "EngagementDeleteConflictError"): ("Lỗi xóa engagement khi còn in-flight (409).", ["lỗi", "xóa", "xung-đột"]),
    (S + "services/settings-service.ts", "SettingsService"): ("Service cài đặt và xóa engagement.", ["cài-đặt", "service", "engagement"]),
    (S + "services/timeline-service.ts", "TimelineService"): ("Service timeline thao tác hợp nhất 3 nguồn.", ["timeline", "service", "hợp-nhất"]),
    (S + "services/vault-service.ts", "VaultService"): ("Service vault mã hóa AES-256-GCM.", ["vault", "mã-hóa", "service"]),
}

TEST_PAIRS = [
    (S + "services/approvals-service.ts", T + "approvals-service.test.ts"),
    (S + "services/projects-service.ts", T + "bootstrap.test.ts"),
]


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
