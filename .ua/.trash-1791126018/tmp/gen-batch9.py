#!/usr/bin/env python3
"""Generate batch-9.json for Raptix UA file-analyzer (batchIndex=9)."""
import json, os, re

PROJECT_ROOT = r"D:\.VTNet\redteam\raptix"
UA_DIR = os.path.join(PROJECT_ROOT, ".ua")
BATCH_INDEX = 9

batches = json.load(open(os.path.join(UA_DIR, "intermediate", "batches.json"), encoding="utf-8"))
batch = [x for x in batches["batches"] if x.get("batchIndex") == BATCH_INDEX][0]
batchFiles = batch["files"]
batchImportData = batch["batchImportData"]
neighborMap = batch.get("neighborMap", {})

ext = json.load(open(os.path.join(UA_DIR, "tmp", "ua-file-analyzer-output-9.json"), encoding="utf-8"))
results = ext["results"]
res_by_path = {r["path"]: r for r in results}

FILE_SUMMARIES = {
 "packages/raptix/tests/unit/middleware/test_budget_internals.py": "Bộ kiểm thử nội bộ cho middleware ngân sách: phân tích biến môi trường, TTL của bộ nhớ đệm chi tiêu, khóa phạm vi và bao bọc gọi mô hình khi vượt trần chi phí.",
 "packages/raptix/tests/unit/middleware/test_command_targets.py": "Bộ kiểm thử trích xuất mục tiêu lệnh: xác thực IP, CIDR, hostname và các giới hạn độ dài cho cổng kiểm soát mục tiêu lệnh.",
 "packages/raptix/tests/unit/middleware/test_command_targets_scope_bypass.py": "Bộ kiểm thử chống lách phạm vi khi trích xuất mục tiêu: bẫy userinfo, mật khẩu giả và nhãn in-scope đánh lừa trong lệnh.",
 "packages/raptix/tests/unit/middleware/test_engagement.py": "Bộ kiểm thử middleware bối cảnh engagement: hydrate trạng thái, chèn workspace, autohunt, deconfliction và chế độ benchmark.",
 "packages/raptix/tests/unit/middleware/test_event_logging.py": "Bộ kiểm thử middleware ghi nhật ký sự kiện: tóm tắt giá trị, che giấu tham số, nhận diện công cụ phát hiện và trích xuất văn bản hội thoại.",
 "packages/raptix/tests/unit/middleware/test_filesystem.py": "Bộ kiểm thử middleware hệ tệp engagement: chuẩn hóa workspace, ràng buộc lại sandbox theo từng lượt chạy và ủy quyền qua HTTP sandbox.",
 "packages/raptix/tests/unit/middleware/test_hitl.py": "Bộ kiểm thử middleware phê duyệt con người trong vòng lặp (HITL): quy tắc chính sách, yêu cầu phê duyệt và các kênh vận chuyển đồng ý.",
 "packages/raptix/tests/unit/middleware/test_injection_detector.py": "Bộ kiểm thử bộ phát hiện prompt injection: phân loại, đối sánh mẫu và vô hiệu hóa token đặc biệt trong đầu vào không tin cậy.",
 "packages/raptix/tests/unit/middleware/test_model_override.py": "Bộ kiểm thử middleware ghi đè mô hình: đọc cấu hình override và dựng LLM ủy nhiệm qua proxy cho từng vai trò agent.",
 "packages/raptix/tests/unit/middleware/test_opplan_inject_format.py": "Bộ kiểm thử định dạng chèn OPPLAN vào prompt: rút gọn tên engagement, đường dẫn workspace và hiển thị trạng thái kế hoạch tác chiến.",
 "packages/raptix/tests/unit/middleware/test_opplan_persistence.py": "Bộ kiểm thử bền vững hóa OPPLAN: phối hợp middleware filesystem, trạng thái OPPLAN và công cụ opplan khi ghi/đọc backend.",
 "packages/raptix/tests/unit/middleware/test_prompt_injection_shield.py": "Bộ kiểm thử khiên chắn prompt injection: chặn, cảnh báo và làm sạch指令 độc hại trước khi tới mô hình.",
 "packages/raptix/tests/unit/middleware/test_proxy_key_override.py": "Bộ kiểm thử ghi đè khóa API qua proxy: luân chuyển khóa theo phạm vi và ưu tiên khóa ủy nhiệm.",
 "packages/raptix/tests/unit/middleware/test_roe.py": "Bộ kiểm thử toàn diện hàng rào Quy tắc Tác chiến (RoE): lược đồ machine-enforcement, đánh giá mục tiêu/lệnh/khung giờ, TLD nhạy cảm và kiểm toán.",
 "packages/raptix/tests/unit/middleware/test_skillogy.py": "Bộ kiểm thử middleware Skillogy: phân giải tiền tố đường dẫn cho phép, cài đặt middleware và điều phối truy vấn kỹ năng.",
 "packages/raptix/tests/unit/middleware/test_skills.py": "Bộ kiểm thử middleware Skills truyền thống: lọc kỹ năng theo vai trò và kiểm soát truy cập nguồn legacy.",
 "packages/raptix/tests/unit/middleware/test_summarization_fallback.py": "Bộ kiểm thử cơ chế tóm tắt dự phòng: chuyển khe middleware khi bộ tóm tắt chính thất bại hoặc vượt giới hạn ngữ cảnh.",
 "packages/raptix/tests/unit/middleware/test_untrusted_output.py": "Bộ kiểm thử xử lý đầu ra không tin cậy: kết hợp bộ phát hiện injection để gắn cờ, chặn và trung hòa nội dung công cụ trả về.",
 "packages/raptix/tests/unit/middleware/test_untrusted_output_envelope.py": "Bộ kiểm thử phong bì đầu ra không tin cậy: đóng gói, gắn nhãn nguồn và bảo toàn ngữ cảnh kiểm chứng cho nội dung công cụ.",
 "packages/raptix/tests/unit/ops/test_client.py": "Bộ kiểm thử client vận hành (ops): kết nối, xác thực và gọi API điều phối chiến dịch qua lớp client.",
 "packages/raptix/tests/unit/ops/test_tools.py": "Bộ kiểm thử bộ công cụ vận hành: đăng ký tool, định tuyến lệnh và ủy quyền qua ops client.",
 "packages/raptix/tests/unit/runtime/test_event_log.py": "Bộ kiểm thử nhật ký sự kiện runtime: ghi sự kiện engagement, đọc lại và định dạng đường dẫn lưu trữ theo phiên.",
 "packages/raptix/tests/unit/runtime/test_event_log_retry_lock.py": "Bộ kiểm thử khóa thử lại của nhật ký sự kiện: tranh chấp khóa liên tiến trình và cơ chế retry khi ghi đồng thời.",
 "packages/raptix/tests/unit/runtime/test_event_log_winlock.py": "Bộ kiểm thử khóa tệp nhật ký trên Windows: tương đương winlock cho ghi sự kiện an toàn đa tiến trình.",
 "packages/raptix/tests/unit/skillogy/test_acl.py": "Bộ kiểm thử hồi quy ACL cho SkillogyMiddleware (ADR-0008): danh sách cho phép tiền tố đường dẫn theo vai trò trên find/load/traverse.",
 "packages/raptix/tests/unit/skillogy/test_middleware.py": "Bộ kiểm thử middleware Skillogy ở biên: chuyển tiếp ngữ cảnh vai trò xuống backend và thống nhất hiển thị kỹ năng theo vai trò.",
 "packages/raptix/tests/unit/tools/test_evidence.py": "Bộ kiểm thử xuất chứng cứ asciicast: ghi khung terminal, mốc thời gian và đóng gói bản ghi phát lại.",
 "packages/raptix/tests/unit/tools/test_evidence_tools.py": "Bộ kiểm thử công cụ chứng cứ: đăng ký tool thu thập hiện vật, liệt kê và đọc nội dung phục vụ báo cáo.",
 "packages/raptix/tests/unit/tools/test_foothold_shadow.py": "Bộ kiểm thử bóng chỗ đứng (foothold shadow) trong OPPLAN: đồng bộ trạng thái chiếm chỗ mà không làm lộ kế hoạch chi tiết.",
 "packages/raptix/tests/unit/tools/test_opplan_tool.py": "Bộ kiểm thử công cụ OPPLAN: tạo, cập nhật và truy vấn kế hoạch tác chiến qua backend có kiểm soát phạm vi.",
 "packages/raptix/tests/unit/tools/test_skills.py": "Bộ kiểm thử công cụ kỹ năng: tải nội dung SKILL.md, liệt kê thư mục và kiểm tra đường dẫn hợp lệ qua registry.",
 "packages/raptix/tests/unit/tools/test_skills_loader.py": "Bộ kiểm thử bộ tải kỹ năng: đọc qua backend, tách frontmatter, định dạng thân skill và xử lý lỗi đọc/liệt kê.",
 "packages/raptix/tests/unit/tools/test_skills_registry.py": "Bộ kiểm thử registry kỹ năng: đăng ký, tra cứu và giải quyết xung đột tên/phiên bản skill.",
 "packages/raptix/tests/unit/tools/web/test_search.py": "Bộ kiểm thử công cụ tìm kiếm web: điều phối engine trong sandbox, bóc JSON, cắt ngắn đầu ra và áp hàng rào RoE.",
}

FILE_TAGS = {
 "packages/raptix/tests/unit/middleware/test_budget_internals.py": ["test", "unit-test", "budget", "middleware", "spend-cap"],
 "packages/raptix/tests/unit/middleware/test_command_targets.py": ["test", "unit-test", "command-targets", "middleware", "validation"],
 "packages/raptix/tests/unit/middleware/test_command_targets_scope_bypass.py": ["test", "unit-test", "scope-bypass", "security", "validation"],
 "packages/raptix/tests/unit/middleware/test_engagement.py": ["test", "unit-test", "engagement", "middleware", "workspace"],
 "packages/raptix/tests/unit/middleware/test_event_logging.py": ["test", "unit-test", "event-log", "middleware", "redaction"],
 "packages/raptix/tests/unit/middleware/test_filesystem.py": ["test", "unit-test", "filesystem", "middleware", "sandbox"],
 "packages/raptix/tests/unit/middleware/test_hitl.py": ["test", "unit-test", "hitl", "approval", "middleware"],
 "packages/raptix/tests/unit/middleware/test_injection_detector.py": ["test", "unit-test", "injection-detector", "security", "middleware"],
 "packages/raptix/tests/unit/middleware/test_model_override.py": ["test", "unit-test", "model-override", "middleware", "proxy"],
 "packages/raptix/tests/unit/middleware/test_opplan_inject_format.py": ["test", "unit-test", "opplan", "middleware", "prompt-format"],
 "packages/raptix/tests/unit/middleware/test_opplan_persistence.py": ["test", "unit-test", "opplan", "persistence", "middleware"],
 "packages/raptix/tests/unit/middleware/test_prompt_injection_shield.py": ["test", "unit-test", "prompt-shield", "security", "middleware"],
 "packages/raptix/tests/unit/middleware/test_proxy_key_override.py": ["test", "unit-test", "proxy-keys", "middleware", "api-keys"],
 "packages/raptix/tests/unit/middleware/test_roe.py": ["test", "unit-test", "roe", "guardrail", "middleware"],
 "packages/raptix/tests/unit/middleware/test_skillogy.py": ["test", "unit-test", "skillogy", "middleware", "skills"],
 "packages/raptix/tests/unit/middleware/test_skills.py": ["test", "unit-test", "skills", "middleware", "acl"],
 "packages/raptix/tests/unit/middleware/test_summarization_fallback.py": ["test", "unit-test", "summarization", "fallback", "middleware"],
 "packages/raptix/tests/unit/middleware/test_untrusted_output.py": ["test", "unit-test", "untrusted-output", "security", "middleware"],
 "packages/raptix/tests/unit/middleware/test_untrusted_output_envelope.py": ["test", "unit-test", "output-envelope", "security", "provenance"],
 "packages/raptix/tests/unit/ops/test_client.py": ["test", "unit-test", "ops-client", "tools", "api-client"],
 "packages/raptix/tests/unit/ops/test_tools.py": ["test", "unit-test", "ops-tools", "tools", "routing"],
 "packages/raptix/tests/unit/runtime/test_event_log.py": ["test", "unit-test", "event-log", "runtime", "persistence"],
 "packages/raptix/tests/unit/runtime/test_event_log_retry_lock.py": ["test", "unit-test", "event-log", "locking", "concurrency"],
 "packages/raptix/tests/unit/runtime/test_event_log_winlock.py": ["test", "unit-test", "event-log", "windows-lock", "concurrency"],
 "packages/raptix/tests/unit/skillogy/test_acl.py": ["test", "unit-test", "skillogy", "acl", "per-role"],
 "packages/raptix/tests/unit/skillogy/test_middleware.py": ["test", "unit-test", "skillogy", "middleware", "wiring"],
 "packages/raptix/tests/unit/tools/test_evidence.py": ["test", "unit-test", "evidence", "asciicast", "tools"],
 "packages/raptix/tests/unit/tools/test_evidence_tools.py": ["test", "unit-test", "evidence", "artifacts", "tools"],
 "packages/raptix/tests/unit/tools/test_foothold_shadow.py": ["test", "unit-test", "opplan", "foothold", "tools"],
 "packages/raptix/tests/unit/tools/test_opplan_tool.py": ["test", "unit-test", "opplan", "tools", "planning"],
 "packages/raptix/tests/unit/tools/test_skills.py": ["test", "unit-test", "skills", "tools", "loader"],
 "packages/raptix/tests/unit/tools/test_skills_loader.py": ["test", "unit-test", "skills-loader", "tools", "backend"],
 "packages/raptix/tests/unit/tools/test_skills_registry.py": ["test", "unit-test", "skills-registry", "tools", "lookup"],
 "packages/raptix/tests/unit/tools/web/test_search.py": ["test", "unit-test", "web-search", "tools", "sandbox"],
}

def file_complexity(nonempty):
    if nonempty < 50:
        return "simple"
    if nonempty < 200:
        return "moderate"
    return "complex"

def fn_complexity(nlines):
    if nlines <= 10:
        return "simple"
    if nlines <= 30:
        return "moderate"
    return "complex"

def class_complexity(nlines, nmethods):
    if nlines > 100 or nmethods > 6:
        return "complex"
    if nlines > 30 or nmethods >= 2:
        return "moderate"
    return "simple"

def humanize(name):
    s = re.sub(r"^test_", "", name)
    s = s.replace("_", " ")
    return s

def fn_summary(name, path):
    h = humanize(name)
    if name.startswith("test_"):
        return f"Ca kiểm thử {h}: xác minh hành vi kỳ vọng và chặn hồi quy cho module liên quan."
    if name.startswith("_"):
        return f"Hàm trợ giúp `{name}` dựng fixture và rút gọn thiết lập dùng chung trong kiểm thử."
    return f"Hàm kiểm thử `{name}` kiểm tra {h}."

def class_summary(name, methods, path):
    if name.startswith("Test"):
        core = re.sub(r"^Test", "", name).replace("_", " ").strip()
        words = re.sub(r"(?<!^)(?=[A-Z])", " ", core).strip()
        if not words:
            words = name
        return f"Nhóm kiểm thử `{words}`: gom các ca kiểm tra cùng chủ đề nhằm khóa hành vi và chống hồi quy."
    if name.startswith(("_Fake", "_Stub", "_Recording", "_Dummy", "_Mock", "_Memory", "_InMemory", "_Test")) or "Fake" in name or "Stub" in name or "Recording" in name:
        return f"Lớp giả lập `{name}` phục vụ kiểm thử (fake/stub ghi nhận tương tác để khẳng định)."
    return f"Lớp hỗ trợ kiểm thử `{name}` với {len(methods)} phương thức dùng chung cho các ca kiểm tra."

def is_class_symbol(sym):
    if not sym:
        return False
    c = sym[0]
    return c.isupper() or sym.startswith("Test")

nodes = []
edges = []
seen_nodes = set()

def add_node(n):
    if n["id"] in seen_nodes:
        return
    seen_nodes.add(n["id"])
    nodes.append(n)

# 1) file nodes
for bf in batchFiles:
    path = bf["path"]
    r = res_by_path.get(path, {})
    nonempty = r.get("nonEmptyLines", bf.get("sizeLines", 0))
    name = path.split("/")[-1]
    add_node({
        "id": f"file:{path}",
        "type": "file",
        "name": name,
        "filePath": path,
        "summary": FILE_SUMMARIES.get(path, f"Bộ kiểm thử đơn vị cho `{name}`: khóa hành vi module tương ứng và chống hồi quy."),
        "tags": FILE_TAGS.get(path, ["test", "unit-test", "regression"]),
        "complexity": file_complexity(nonempty or 0),
    })

# 2) function/class nodes + contains/exports
export_names_by_file = {}
for r in results:
    s = set(e["name"] for e in r.get("exports", []))
    export_names_by_file[r["path"]] = s

for r in results:
    path = r["path"]
    fid = f"file:{path}"
    exps = export_names_by_file.get(path, set())
    for f in r.get("functions", []):
        fname = f["name"]
        sl, el = f["startLine"], f["endLine"]
        nl = max(1, el - sl + 1)
        nid = f"function:{path}:{fname}"
        is_helper = fname.startswith("_") and not fname.startswith("test_")
        add_node({
            "id": nid,
            "type": "function",
            "name": fname,
            "filePath": path,
            "lineRange": [sl, el],
            "summary": fn_summary(fname, path),
            "tags": ["test-helper", "fixture", "utility"] if is_helper else ["test", "unit-test", "regression"],
            "complexity": fn_complexity(nl),
        })
        edges.append({"source": fid, "target": nid, "type": "contains", "direction": "forward", "weight": 1.0})
        if fname in exps:
            edges.append({"source": fid, "target": nid, "type": "exports", "direction": "forward", "weight": 0.8})
    for c in r.get("classes", []):
        cname = c["name"]
        sl, el = c["startLine"], c["endLine"]
        nl = max(1, el - sl + 1)
        methods = c.get("methods", [])
        nid = f"class:{path}:{cname}"
        is_double = cname.startswith(("_Fake", "_Stub", "_Recording", "_Dummy", "_Mock", "_Memory")) or ("Fake" in cname or "Stub" in cname or "Recording" in cname)
        add_node({
            "id": nid,
            "type": "class",
            "name": cname,
            "filePath": path,
            "lineRange": [sl, el],
            "summary": class_summary(cname, methods, path),
            "tags": ["test-double", "fixture", "stub"] if is_double else ["test-suite", "unit-test", "grouped"],
            "complexity": class_complexity(nl, len(methods)),
        })
        edges.append({"source": fid, "target": nid, "type": "contains", "direction": "forward", "weight": 1.0})
        if cname in exps:
            edges.append({"source": fid, "target": nid, "type": "exports", "direction": "forward", "weight": 0.8})

# 3) imports 1:1 + tested_by
for path, targets in batchImportData.items():
    for t in targets:
        edges.append({"source": f"file:{path}", "target": f"file:{t}", "type": "imports", "direction": "forward", "weight": 0.7})
        edges.append({"source": f"file:{t}", "target": f"file:{path}", "type": "tested_by", "direction": "forward", "weight": 0.5})

# 4) calls
# Build per-file lookup
lookup = {}
for r in results:
    path = r["path"]
    funcs = {f["name"]: f"function:{path}:{f['name']}" for f in r.get("functions", [])}
    classes = {c["name"]: f"class:{path}:{c['name']}" for c in r.get("classes", [])}
    method_to_class = {}
    for c in r.get("classes", []):
        for m in c.get("methods", []):
            # first owner wins
            if m not in method_to_class and m not in funcs:
                method_to_class[m] = f"class:{path}:{c['name']}"
    lookup[path] = (funcs, classes, method_to_class)

# neighbor symbol -> file per test file
neigh_sym_path = {}
for path, entries in neighborMap.items():
    m = {}
    for e in entries:
        npath = e["path"]
        for s in e.get("symbols", []):
            if s not in m:
                m[s] = npath
    neigh_sym_path[path] = m

seen_call_edges = set()
for r in results:
    path = r["path"]
    funcs, classes, method_to_class = lookup[path]
    symmap = neigh_sym_path.get(path, {})
    for cg in r.get("callGraph", []):
        caller = cg.get("caller", "")
        callee = cg.get("callee", "")
        if not caller or not callee:
            continue
        # resolve caller
        if caller in funcs:
            src = funcs[caller]
        elif caller in classes:
            src = classes[caller]
        elif caller in method_to_class:
            src = method_to_class[caller]
        else:
            continue  # nested helper (worker/fake_emit/...) -> skip
        base = callee.split(".")[-1].split("(")[0].strip()
        if not base:
            continue
        tgt = None
        if base in funcs:
            tgt = funcs[base]
        elif base in classes:
            tgt = classes[base]
        elif base in method_to_class:
            # call to sibling method -> owning class? use class node
            tgt = method_to_class[base]
            # avoid self edge (same class calling own method aggregated)
            if tgt == src:
                continue
        elif base in symmap:
            npath = symmap[base]
            prefix = "class" if is_class_symbol(base) else "function"
            tgt = f"{prefix}:{npath}:{base}"
        else:
            continue
        if tgt == src:
            continue
        key = (src, tgt, "calls")
        if key in seen_call_edges:
            continue
        seen_call_edges.add(key)
        edges.append({"source": src, "target": tgt, "type": "calls", "direction": "forward", "weight": 0.8})

# dedupe edges (source,target,type)
ded = []
seen_e = set()
for e in edges:
    k = (e["source"], e["target"], e["type"])
    if k in seen_e:
        continue
    seen_e.add(k)
    ded.append(e)
edges = ded

out = {"batchIndex": BATCH_INDEX, "batchFiles": batchFiles, "nodes": nodes, "edges": edges}
op = os.path.join(UA_DIR, "intermediate", "batch-9.json")
json.dump(out, open(op, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
print(f"nodes={len(nodes)} edges={len(edges)} files={len(batchFiles)}")
from collections import Counter
print(dict(Counter(n['type'] for n in nodes)))
print(dict(Counter(e['type'] for e in edges)))
imp = sum(len(v) for v in batchImportData.values())
nimp = sum(1 for e in edges if e['type']=='imports')
print(f"imports check: expected={imp} actual={nimp}")
