#!/usr/bin/env python3
"""Generate UA batch-16.json (clients/cli Ink UI: messages, shell contexts, hooks, REPL, state, utils)."""
import io
import json
import os
import re

UA = r"D:\.VTNet\redteam\raptix\.ua"
IDX = 16
batches = json.load(io.open(os.path.join(UA, "intermediate", "batches.json"), encoding="utf-8"))
b = [x for x in batches["batches"] if x.get("batchIndex") == IDX][0]
ext = json.load(io.open(os.path.join(UA, "tmp", "ua-file-extract-results-%d.json" % IDX), encoding="utf-8"))
results = {r["path"]: r for r in ext["results"]}

FILE_META = {
    "clients/cli/src/components/messages/DiffResult.tsx": ("Hiển thị diff kiểu Claude Code cho kết quả tool edit_file: dựng dòng diff theo package diff và tóm tắt thêm/xóa cho chế độ prompt gọn.", ["giao-diện", "diff", "component", "react"], ""),
    "clients/cli/src/components/messages/ErrorMessage.tsx": ("Hiển thị lỗi có cắt ngắn head/tail khi vượt 1000 ký tự, kèm gợi ý mở rộng ctrl+o.", ["giao-diện", "lỗi", "component"], ""),
    "clients/cli/src/components/messages/QAMessage.tsx": ("Cặp component câu hỏi và câu trả lời của luồng hỏi-đáp HITL (QAQuestionMessage/QAAnswerMessage).", ["giao-diện", "hitl", "câu-hỏi", "component"], ""),
    "clients/cli/src/components/messages/SystemMessage.tsx": ("Dòng tin hệ thống hiển thị mờ trong transcript.", ["giao-diện", "hệ-thống", "component"], ""),
    "clients/cli/src/components/messages/ToolCallMessage.tsx": ("Render một lượt gọi tool: tiêu đề args, nội dung kết quả, nhúng TodoList và DiffResult, phản ứng theo chế độ màn hình.", ["giao-diện", "tool-call", "component", "react"], "TSX: component lớn phân nhánh theo loại tool và ScreenContext."),
    "clients/cli/src/components/messages/ToolGroupSummary.tsx": ("Dòng tóm tắt gọn cho nhóm thao tác đọc/tìm kiếm liên tiếp đã được gom lại.", ["giao-diện", "tóm-tắt", "component"], ""),
    "clients/cli/src/components/messages/UserMessage.tsx": ("Bong bóng tin nhắn operator với cắt ngắn head 8000/tail 2000 ký tự.", ["giao-diện", "tin-nhắn", "component"], ""),
    "clients/cli/src/components/shell/CtrlOToExpand.tsx": ("Gợi ý mở rộng (ctrl+o to expand) cho nội dung bị cắt, tự ẩn ở transcript và trong view sub-agent.", ["giao-diện", "gợi-ý", "component"], ""),
    "clients/cli/src/components/shell/ExpandOutputContext.tsx": ("React context điều khiển mở rộng output bash/tool: transcript mở hết, prompt chỉ mở output mới nhất.", ["react", "context", "trạng-thái", "hiển-thị"], ""),
    "clients/cli/src/components/shell/ScreenContext.tsx": ("Context lan truyền chế độ màn hình prompt/transcript cho component lồng sâu (ScreenProvider/useScreen).", ["react", "context", "màn-hình"], ""),
    "clients/cli/src/components/shell/SubAgentContext.tsx": ("Context đánh dấu đang render trong view sub-agent để ẩn gợi ý mở rộng, giảm nhiễu.", ["react", "context", "sub-agent"], ""),
    "clients/cli/src/hooks/useAgent.ts": ("Hook streaming agent LangGraph cho Ink: snapshot values, sự kiện custom của sub-agent, thread store, vòng đời interrupt/cancel/resume và hàng đợi tin nhắn.", ["hook", "langgraph", "streaming", "vòng-đời"], "TypeScript: dùng stream_mode values để diff messages và stream_mode custom cho sub-agent events."),
    "clients/cli/src/hooks/useGlobalKeybindings.ts": ("Đăng ký phím tắt toàn cục qua Ink useInput: ctrl+o chuyển transcript, ctrl+c interrupt/cancel/exit theo ngữ cảnh, Escape thoát.", ["hook", "phím-tắt", "ink"], ""),
    "clients/cli/src/hooks/useOpplan.ts": ("Suy diễn trạng thái OPPLAN (bảng objectives) từ toolArgs có cấu trúc của list/add/update_objective.", ["hook", "opplan", "objectives", "trạng-thái"], ""),
    "clients/cli/src/hooks/useSpinnerFrame.ts": ("Khung spinner hoạt hình theo interval cho chỉ báo đang xử lý.", ["hook", "spinner", "hoạt-hình"], ""),
    "clients/cli/src/hooks/useSubAgentSessions.ts": ("Suy diễn phiên sub-agent có cấu trúc từ luồng sự kiện phẳng, bọc deriveSubAgentSessions của @raptix/streaming trong useMemo.", ["hook", "sub-agent", "phiên-làm-việc"], ""),
    "clients/cli/src/hooks/useTerminalSize.ts": ("Theo dõi kích thước terminal và cập nhật khi có sự kiện resize.", ["hook", "terminal", "kích-thước"], ""),
    "clients/cli/src/index.tsx": ("Điểm vào CLI: render App Ink với patchConsole, hỗ trợ cờ --resume và RAPTIX_INITIAL_MESSAGE.", ["entry-point", "cli", "ink"], ""),
    "clients/cli/src/screens/REPL.tsx": ("Màn hình REPL chính hai chế độ prompt/transcript: điều phối agent stream, opplan, keybindings, phiên sub-agent và render transcript.", ["màn-hình", "repl", "điều-phối", "react"], "TSX: màn hình lớn nhất CLI, ghép nhiều hooks và components con."),
    "clients/cli/src/state/AppState.ts": ("Trạng thái toàn cục CLI: giá trị mặc định, provider giữ store và hook đọc/ghi theo selector.", ["trạng-thái", "provider", "react", "store"], ""),
    "clients/cli/src/state/store.ts": ("Store subscribe tối giản: get/set có so sánh Object.is và thông báo listeners.", ["store", "trạng-thái", "tiện-ích"], ""),
    "clients/cli/src/types.ts": ("Kiểu dùng chung của CLI: sự kiện agent, phiên sub-agent, chế độ màn hình và trạng thái run.", ["kiểu-dữ-liệu", "định-nghĩa", "dùng-chung"], ""),
    "clients/cli/src/utils/agents.ts": ("Nhãn hiển thị thân thiện cho tên agent kèm bảng AGENT_LABELS.", ["tiện-ích", "nhãn", "agent"], ""),
    "clients/cli/src/utils/format.test.ts": ("Kiểm thử vitest cho các hàm định dạng hiển thị của CLI.", ["test", "vitest", "định-dạng"], ""),
    "clients/cli/src/utils/format.ts": ("Hàm định dạng hiển thị: rút gọn path, thời lượng, số, tên skill, cắt dòng và dòng tool gọn.", ["tiện-ích", "định-dạng", "hiển-thị"], ""),
    "clients/cli/src/utils/groupEvents.ts": ("Gom sự kiện tool đọc/tìm kiếm liên tiếp thành nhóm và định dạng dòng tóm tắt nhóm.", ["tiện-ích", "nhóm-sự-kiện", "hiển-thị"], ""),
    "clients/cli/src/utils/markdown.ts": ("Render markdown ra terminal qua marked và marked-terminal.", ["tiện-ích", "markdown", "terminal"], ""),
    "clients/cli/src/utils/theme.ts": ("Hằng số glyph, biểu tượng trạng thái/todo và bảng màu agent cho CLI.", ["chủ-đề", "hằng-số", "giao-diện"], ""),
    "clients/cli/src/utils/threadStore.ts": ("Lưu/tải thread qua LangGraph client: lưu, chạm thời gian, liệt kê và tải theo chỉ số.", ["lưu-trữ", "thread", "langgraph-client"], ""),
    "clients/cli/src/utils/version.ts": ("Đọc version CLI từ package.json để hiển thị (CLI_VERSION).", ["tiện-ích", "phiên-bản"], ""),
}

FN_META = {
    ("clients/cli/src/components/messages/DiffResult.tsx", "buildDiffLines"): ("Dựng danh sách dòng diff có đánh dấu thêm/xóa từ change của package diff, chuẩn hóa newline.", ["diff", "dựng-dòng", "hiển-thị"]),
    ("clients/cli/src/components/messages/DiffResult.tsx", "summaryText"): ("Tóm tắt số dòng thêm/xóa/sửa của diff cho chế độ prompt gọn.", ["diff", "tóm-tắt", "hiển-thị"]),
    ("clients/cli/src/components/messages/ToolCallMessage.tsx", "ToolCallHeader"): ("Tiêu đề lượt gọi tool: tên tool, args đã gọn, path rút gọn và trạng thái thực thi.", ["tool-call", "tiêu-đề", "hiển-thị"]),
    ("clients/cli/src/components/messages/ToolCallMessage.tsx", "ResultContent"): ("Nội dung kết quả tool: phân nhánh diff/todo/output văn bản, cắt ngắn theo chế độ màn hình.", ["tool-call", "kết-quả", "hiển-thị"]),
    ("clients/cli/src/components/shell/ExpandOutputContext.tsx", "useExpandOutput"): ("Đọc cờ mở rộng output từ context, mặc định thu gọn ở prompt mode.", ["hook", "context", "hiển-thị"]),
    ("clients/cli/src/components/shell/ScreenContext.tsx", "useScreen"): ("Đọc chế độ màn hình hiện tại, prompt hoặc transcript.", ["hook", "context", "màn-hình"]),
    ("clients/cli/src/components/shell/SubAgentContext.tsx", "useIsInSubAgent"): ("Cho biết component có đang render bên trong view sub-agent hay không.", ["hook", "context", "sub-agent"]),
    ("clients/cli/src/hooks/useAgent.ts", "useAgent"): ("Quản lý toàn bộ vòng đời agent stream: kết nối LangGraph, diff snapshot messages, sự kiện custom sub-agent, thread store, interrupt/cancel/resume và hàng đợi.", ["hook", "langgraph", "streaming", "vòng-đời"]),
    ("clients/cli/src/hooks/useGlobalKeybindings.ts", "useGlobalKeybindings"): ("Đăng ký phím tắt toàn cục và điều hướng interrupt/cancel/exit theo trạng thái run hiện tại.", ["hook", "phím-tắt", "ink"]),
    ("clients/cli/src/hooks/useOpplan.ts", "useOpplan"): ("Suy diễn engagement và objectives OPPLAN từ toolArgs, thay toàn bảng khi list và vá từng phần khi add/update.", ["hook", "opplan", "objectives"]),
    ("clients/cli/src/hooks/useSpinnerFrame.ts", "useSpinnerFrame"): ("Trả về khung spinner hiện tại, xoay theo interval.", ["hook", "spinner", "hoạt-hình"]),
    ("clients/cli/src/hooks/useSubAgentSessions.ts", "useSubAgentSessions"): ("Suy diễn danh sách phiên sub-agent từ mảng sự kiện agent, memo theo events.", ["hook", "sub-agent", "phiên-làm-việc"]),
    ("clients/cli/src/hooks/useTerminalSize.ts", "useTerminalSize"): ("Trả về số cột/dòng terminal, đăng ký và hủy lắng nghe resize.", ["hook", "terminal", "kích-thước"]),
    ("clients/cli/src/screens/REPL.tsx", "REPL"): ("Điều phối màn hình chính: ghép useAgent, opplan, keybindings, phiên sub-agent, chuyển chế độ prompt/transcript và gửi tin nhắn.", ["màn-hình", "repl", "điều-phối"]),
    ("clients/cli/src/screens/REPL.tsx", "TranscriptSessionHeader"): ("Tiêu đề phiên trong transcript: tên phiên và thread đang xem.", ["transcript", "tiêu-đề", "hiển-thị"]),
    ("clients/cli/src/screens/REPL.tsx", "TranscriptSessionFooter"): ("Chân phiên trong transcript: trạng thái kết thúc và gợi ý thao tác.", ["transcript", "chân-trang", "hiển-thị"]),
    ("clients/cli/src/screens/REPL.tsx", "RunningSessionFooter"): ("Chân phiên khi run đang chạy: spinner, trạng thái và phím tắt interrupt.", ["transcript", "trạng-thái", "hiển-thị"]),
    ("clients/cli/src/screens/REPL.tsx", "TranscriptView"): ("Render toàn bộ sự kiện ở chế độ mở rộng cho transcript.", ["transcript", "render", "hiển-thị"]),
    ("clients/cli/src/state/AppState.ts", "getDefaultAppState"): ("Trả về trạng thái mặc định của ứng dụng CLI.", ["trạng-thái", "khởi-tạo", "mặc-định"]),
    ("clients/cli/src/state/AppState.ts", "AppStateProvider"): ("Provider giữ store dùng chung cho toàn bộ cây CLI.", ["provider", "trạng-thái", "react"]),
    ("clients/cli/src/state/AppState.ts", "useAppState"): ("Hook đọc lát cắt AppState theo selector qua useSyncExternalStore.", ["hook", "trạng-thái", "react"]),
    ("clients/cli/src/state/AppState.ts", "useSetAppState"): ("Hook trả về hàm cập nhật AppState.", ["hook", "trạng-thái", "react"]),
    ("clients/cli/src/state/store.ts", "createStore"): ("Tạo store subscribe tối giản với get, set có so sánh Object.is và subscribe/unsubscribe.", ["store", "trạng-thái", "tiện-ích"]),
    ("clients/cli/src/utils/agents.ts", "labelForAgent"): ("Nhãn hiển thị thân thiện cho tên agent, chuyển snake_case thành Title Case khi không có trong bảng.", ["nhãn", "agent", "hiển-thị"]),
    ("clients/cli/src/utils/format.ts", "shortPath"): ("Rút gọn đường dẫn tuyệt đối thành tương đối khi nằm trong cwd.", ["định-dạng", "đường-dẫn", "hiển-thị"]),
    ("clients/cli/src/utils/format.ts", "formatDuration"): ("Định dạng mili-giây thành chuỗi thời lượng đọc được.", ["định-dạng", "thời-lượng", "hiển-thị"]),
    ("clients/cli/src/utils/format.ts", "formatNumber"): ("Định dạng số gọn với hậu tố nghìn/triệu.", ["định-dạng", "số", "hiển-thị"]),
    ("clients/cli/src/utils/format.ts", "extractSkillName"): ("Trích tên skill từ đường dẫn file skill.", ["định-dạng", "skill", "hiển-thị"]),
    ("clients/cli/src/utils/format.ts", "truncateLines"): ("Cắt văn bản theo số dòng tối đa kèm dấu báo cắt.", ["định-dạng", "cắt-ngắn", "hiển-thị"]),
    ("clients/cli/src/utils/format.ts", "compactToolLine"): ("Dựng một dòng mô tả gọn cho lượt gọi tool.", ["định-dạng", "tool-call", "hiển-thị"]),
    ("clients/cli/src/utils/format.ts", "primaryArg"): ("Chọn tham số chính của tool để hiển thị trong dòng gọn.", ["định-dạng", "tool-call", "hiển-thị"]),
    ("clients/cli/src/utils/groupEvents.ts", "groupConsecutiveTools"): ("Gom sự kiện tool đọc/tìm kiếm liên tiếp thành nhóm hiển thị.", ["nhóm-sự-kiện", "gom-nhóm", "hiển-thị"]),
    ("clients/cli/src/utils/groupEvents.ts", "formatToolGroup"): ("Định dạng một nhóm tool thành dòng tóm tắt duy nhất.", ["nhóm-sự-kiện", "tóm-tắt", "hiển-thị"]),
    ("clients/cli/src/utils/markdown.ts", "renderMarkdown"): ("Render markdown thành văn bản terminal có màu qua marked-terminal.", ["markdown", "terminal", "hiển-thị"]),
    ("clients/cli/src/utils/threadStore.ts", "saveThread"): ("Lưu thread của LangGraph kèm tiêu đề cắt ngắn và thời gian.", ["lưu-trữ", "thread", "persist"]),
    ("clients/cli/src/utils/threadStore.ts", "touchThread"): ("Cập nhật thời gian chạm thread để sắp xếp recent.", ["lưu-trữ", "thread", "persist"]),
    ("clients/cli/src/utils/threadStore.ts", "listThreads"): ("Liệt kê thread đã lưu từ LangGraph client.", ["lưu-trữ", "thread", "truy-xuất"]),
    ("clients/cli/src/utils/threadStore.ts", "loadThreadByIndex"): ("Tải thread theo chỉ số trong danh sách đã lưu.", ["lưu-trữ", "thread", "truy-xuất"]),
}

CLASS_META = {}

TEST_PAIRS = [
    ("clients/cli/src/utils/format.ts", "clients/cli/src/utils/format.test.ts"),
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
            s, t = ("Lớp %s (%d dòng) trong %s." % (cl["name"], lines, p.split("/")[-1]),
                    ["data-model", "typescript", p.split("/")[-2]])
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

# calls in-batch, confident only
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
        # Bỏ qua callee có dấu chấm: đầu dotted là object/module ngoài, không phải file project
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
