#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Sinh batch-7.json (file-analyzer batch 7, tieng Viet)."""
import ast
import io
import json
import pathlib

PROJECT_ROOT = r"D:\.VTNet\redteam\raptix"
UA_DIR = pathlib.Path(PROJECT_ROOT) / ".ua"
BATCH_INDEX = 7

batches = json.load(io.open(UA_DIR / "intermediate" / "batches.json", encoding="utf-8"))
batch = [b for b in batches["batches"] if b.get("batchIndex") == BATCH_INDEX][0]
batch_files = batch["files"]
batch_import = batch["batchImportData"]
neighbor_map = batch.get("neighborMap", {})

ext = json.load(io.open(UA_DIR / "tmp" / "ua-file-extract-results-7.json", encoding="utf-8"))
results = {r["path"]: r for r in ext["results"]}

def get_classes(fp):
    src = (pathlib.Path(PROJECT_ROOT) / fp).read_text(encoding="utf-8")
    tree = ast.parse(src)
    out = []
    for n in tree.body:
        if isinstance(n, ast.ClassDef):
            methods = [x.name for x in n.body if isinstance(x, (ast.FunctionDef, ast.AsyncFunctionDef))]
            bases = []
            for b in n.bases:
                if isinstance(b, ast.Name):
                    bases.append(b.id)
                elif isinstance(b, ast.Attribute):
                    bases.append(b.attr)
                elif isinstance(b, ast.Subscript) and isinstance(b.value, ast.Name):
                    bases.append(b.value.id)
            out.append({"name": n.name, "start": n.lineno, "end": n.end_lineno, "methods": methods, "bases": bases})
    return out

classes_by_file = {f["path"]: get_classes(f["path"]) for f in batch_files}

FILE_META = {
"packages/raptix/raptix/agents/middleware_slots.py": ("Registry slot middleware trung tâm: định nghĩa thứ tự lắp ráp chuẩn, factory _make_* cho từng slot (RoE, HITL, KG, OPPLAN, skills, budget, shield) và proxy tóm tắt an toàn khi lỗi.", ["middleware-slots", "agent-factory", "slot-registry", "composition"], "Thứ tự enum MiddlewareSlot chính là thứ tự lắp ráp; plugin thay thế hoặc vô hiệu hóa slot theo tên."),
"packages/raptix/raptix/cli/__init__.py": ("Barrel CLI headless của Raptix (python -m raptix.cli): re-export scan_main cho môi trường CI không cần binary Go.", ["barrel", "cli", "entry-point", "headless"], None),
"packages/raptix/raptix/cli/__main__.py": ("Bộ điều phối CLI headless: định tuyến 6 subcommand scan/auth/audit/zip/export-transcript/telemetry về hàm main tương ứng.", ["cli", "dispatcher", "subcommands", "entry-point"], None),
"packages/raptix/raptix/cli/audit.py": ("Lệnh kiểm chứng ledger audit RoE: xác minh chuỗi hash JSONL và HMAC ràng buộc, kết xuất text hoặc JSON với mã thoát phân biệt.", ["cli", "audit-ledger", "roe-verification", "hmac"], None),
"packages/raptix/raptix/cli/auth.py": ("Lệnh introspection xác thực headless: báo cáo API key, subscription OAuth và endpoint local đúng như factory runtime phân giải, kèm chế độ doctor cho CI.", ["cli", "auth-status", "credentials", "diagnostics"], "Import LLM factory lười (lazy) để --help không phải tải stack nặng."),
"packages/raptix/raptix/cli/export_transcript.py": ("Lệnh kết xuất transcript engagement: đọc events.jsonl append-only và render thành Markdown theo thứ tự thời gian, ra stdout hoặc file.", ["cli", "transcript", "event-log", "markdown-export"], None),
"packages/raptix/raptix/cli/scan.py": ("Cổng scan headless/CI theo phong cách Strix: phân giải phạm vi (git diff, target), điều phối scan một lần qua LangGraph SDK, xuất SARIF và chặn theo ngưỡng severity.", ["cli", "security-scan", "sarif", "ci-gate"], "Vỏ mỏng: parse args, phân giải scope, dispatch SDK, xuất SARIF, gating."),
"packages/raptix/raptix/cli/zip.py": ("Lệnh đóng gói workspace engagement thành ZIP di động và khôi phục ở máy khác, kiểm tra traversal/symlink và tiền tố engagement.", ["cli", "workspace-archive", "zip-export", "backup"], "Mọi entry lưu dưới tiền tố <id>/ để round-trip an toàn qua import."),
"packages/raptix/raptix/core/dispatch_context.py": ("Ngữ cảnh dispatch theo tác vụ: dataclass DispatchContext bất biến kèm ContextVar, đảm bảo gọi đồng thời không chia sẻ bộ đếm role.", ["dispatch-context", "concurrency", "contextvars", "state"], None),
"packages/raptix/raptix/core/logging.py": ("Shim tương thích logging: chuyển tiếp mọi thuộc tính sang raptix_core.utils.logging kèm DeprecationWarning theo PEP 562.", ["logging", "compat-shim", "deprecation", "utility"], "Tra cứu private/dunder không phát cảnh báo để tránh nhiễu import."),
"packages/raptix/raptix/core/subagent_streaming.py": ("Streaming sub-agent trực tiếp: bọc invoke/ainvoke bằng stream/astream để phát tool call, kết quả và AI message qua renderer và LangGraph stream writer.", ["subagent", "streaming", "langgraph", "observability"], "Kế thừa RunnableBinding để with_config của deepagents không làm rơi wrapper."),
"packages/raptix/raptix/llm/factory.py": ("Factory LLM qua LiteLLM proxy: ánh xạ role sang model, quản lý credentials đa phương thức (API key, OAuth, local), fallback, kiểm tra sức khỏe và che giấu secret.", ["llm-factory", "litellm-proxy", "model-routing", "credentials"], "File lớn nhất batch (1796 dòng): gom resolve timeout/token/header, inventory auth và bọc ChatOpenAI theo provider."),
"packages/raptix/raptix/llm/router.py": ("Bộ định tuyến model mỏng: phân giải role thành model chính và chuỗi fallback đầy đủ qua LLMModelMapping.", ["model-router", "role-mapping", "fallback-chain", "llm"], None),
"packages/raptix/raptix/middleware/__init__.py": ("Barrel middleware Raptix: re-export toàn bộ AgentMiddleware tùy biến (budget, engagement, event-log, filesystem, HITL, KG, OPPLAN, RoE, skills, shield).", ["barrel", "middleware", "entry-point", "re-export"], None),
"packages/raptix/raptix/middleware/_audit_sink.py": ("Sink audit nối chuỗi HMAC cho quyết định RoE: ghi JSONL append-only với seq, prev_hash, hash SHA-256 và HMAC, kèm verify toàn file.", ["audit-log", "roe", "hash-chain", "hmac"], "Chỉ file local trong commit này; ship remote (S3/syslog/Loki) thuộc follow-up."),
"packages/raptix/raptix/middleware/_command_targets.py": ("Trích mục tiêu host/IP từ lệnh red-team bằng regex (~30 công cụ kill-chain) cộng scrape chung fail-closed, nuôi bộ đánh giá RoE.", ["roe", "target-extraction", "regex", "scope-gate"], "False positive an toàn hơn false negative; token lạ chưa biết vẫn thành candidate target."),
"packages/raptix/raptix/middleware/_injection_detector.py": ("Bộ phát hiện prompt-injection heuristic cho tool output: regex jailbreak, phân loại InjectionCategory và kết luận InjectionVerdict kèm risk.", ["prompt-injection", "detection", "heuristic", "defense"], "Tripwire phòng thủ chiều sâu; marker cấu trúc của UntrustedOutput mới là biên tin cậy chính."),
"packages/raptix/raptix/middleware/budget.py": ("Cưỡng chế ngân sách USD theo engagement và theo agent: truy vấn LiteLLM /spend/tags, cảnh báo mềm 70% và chặn cứng 100% bằng BudgetExceeded.", ["budget", "cost-control", "litellm-spend", "guardrail"], "Spend của proxy là nguồn chân lý, không đếm local; tắt khi cap không dương."),
"packages/raptix/raptix/middleware/dispatch.py": ("Middleware điều phối task bền vững: giữ ledger dispatch theo biên tác vụ, không triệt tiêu retry toàn role, bọc tool task/atask.", ["dispatch", "subagent", "task-ledger", "reliability"], "Không dùng future annotations để langchain nhận diện tham số runtime inject."),
"packages/raptix/raptix/middleware/engagement.py": ("Middleware ngữ cảnh engagement: hydrate slug và workspace từ launcher/harness vào state, tiêm benchmark/benchmark-brief và deconfliction vào prompt.", ["engagement-context", "benchmark-harness", "state-hydration", "prompt-injection"], "Mẫu state-backed injection giống OPPLANMiddleware qua wrap_model_call."),
"packages/raptix/raptix/middleware/event_logging.py": ("Middleware ghi sự kiện engagement trực tiếp ra events.jsonl: tóm tắt LLM call/response và tool call/result, gắn finding và trajectory.", ["event-log", "timeline", "observability", "persistence"], "Chỉ ghi tóm tắt, không ghi full prompt/output; lỗi workspace thành no-op câm."),
"packages/raptix/raptix/middleware/filesystem.py": ("Middleware filesystem giới hạn engagement: backend loại execute, chuẩn hóa workspace 4 trường hợp fail-closed, rebind sandbox mỗi lượt.", ["filesystem", "sandbox", "workspace-scope", "security"], "Đường traversal hoặc slug sai định dạng trả None, không ép về /workspace."),
"packages/raptix/raptix/middleware/hitl.py": ("Middleware phê duyệt con người (HITL) cho tool high-impact: khớp policy theo ATT&CK/tool-name, phát ApprovalRequest qua transport và áp allow/deny/redirect.", ["hitl", "approval", "high-impact", "safety-gate"], "Timeout mặc định deny để an toàn; transport mặc định in-process cho test, file-backed cho UI."),
"packages/raptix/raptix/middleware/model_override.py": ("Override model runtime cho lệnh /model: đọc model_override từ Runtime context/state và rebind LLM qua proxy theo từng cuộc gọi.", ["model-override", "runtime-config", "cli", "llm"], "Không tiền kiểm model id để operator thử model mới không cần release."),
"packages/raptix/raptix/middleware/opplan.py": ("Middleware mục tiêu OPPLAN cho red team: tiêm hướng dẫn và trạng thái objective vào prompt, đăng ký tools opplan, một tool call mỗi step.", ["opplan", "objectives", "kill-chain", "tracking"], "Persistence qua backend engagement tại /workspace/plan/opplan.json."),
"packages/raptix/raptix/middleware/opscontrol_notifications.py": ("Đẩy chuyển trạng thái workload opscontrol vào luồng message: poll /v1/profiles qua Unix socket, diff dedup và tiêm HumanMessage system-reminder.", ["opscontrol", "notifications", "workload", "message-stream"], "Hook before_model mỗi turn; agent không poll ops_status thủ công."),
"packages/raptix/raptix/middleware/prompt_injection_shield.py": ("Khiên chống prompt-injection: sanitize mọi tool output, bọc marker untrusted, gắn chính sách hệ thống không tuân lệnh trong marker.", ["prompt-injection", "shield", "sanitization", "self-defense"], "Đặt trên Skills và dưới SafeCommand; bỏ qua tool nội bộ tin cậy để tránh bọc kép."),
"packages/raptix/raptix/middleware/proxy_key_override.py": ("Override virtual-key LiteLLM theo lượt chạy cho multi-tenant: rebind model sang key của engagement để hạch toán chi phí theo org.", ["virtual-key", "multi-tenant", "cost-attribution", "litellm"], "Nằm trong cùng sau MODEL_FALLBACK để key đúng cả model fallback vừa đổi."),
"packages/raptix/raptix/middleware/roe.py": ("Cổng RoE cố vấn phân tích lệnh: đánh giá mọi bash/tool theo machine_enforcement của roe.json với PASS/WARN/REFUSE, ghi ledger audit.", ["roe", "guardrail", "policy-enforcement", "audit"], "Guardrail báo sớm; biên thẩm quyền thực sự là egress sandbox (DNS/nftables) từ cùng rules."),
"packages/raptix/raptix/middleware/skillogy.py": ("Middleware Skillogy: REST client mỏng cho skillogy (Neo4j-backed) với 3 tool find_skill/load_skill/traverse thay backend file.", ["skillogy", "skill-discovery", "neo4j", "rest-client"], "Agent không giữ Bolt connection; image langgraph không cần driver neo4j."),
"packages/raptix/raptix/middleware/skills.py": ("Middleware kỹ năng nhận biết red-team: nhóm skill theo subdomain, hiển thị MITRE ATT&CK và từ khóa kích hoạt gọn.", ["skills", "mitre-attack", "subdomain", "prompt"], "Workflow.md không còn ở đây; PromptBuilder ghép <role>.md lúc factory."),
"packages/raptix/raptix/middleware/state_reducers.py": ("Reducer state-channel dùng chung cho LangGraph: hợp nhất convergent last-write-wins và nối transcript tích lũy.", ["state-reducer", "langgraph", "concurrency", "merge"], None),
"packages/raptix/raptix/middleware/subagent_transcript_state.py": ("Schema SubagentTranscriptState: kênh transcript sub-agent bền vững lưu checkpoint, hiển thị được sau reconnect và khi run xong.", ["transcript", "state-schema", "observability", "checkpoint"], "Mở rộng AgentState để giữ nguyên channel messages/jump_to của deepagents."),
"packages/raptix/raptix/middleware/untrusted_output.py": ("Cách ly cấu trúc tool output: bọc envelope UNTRUSTED kèm origin/risk từ detector, ghi quarantine ledger phục vụ pháp y.", ["untrusted-output", "quarantine", "risk-tag", "defense"], "Chỉ quan sát và hạ tín nhiệm, không chặn; chặn là việc của RoE Tier 2."),
}

DOMAIN_TAG = {
"agents/middleware_slots": "middleware-slots", "cli": "cli", "core/dispatch": "dispatch",
"core/logging": "logging", "core/subagent": "subagent-streaming", "llm": "llm",
"middleware": "middleware",
}

def domain_of(path):
    for k, v in DOMAIN_TAG.items():
        if k in path:
            return v
    if "middleware" in path:
        return "middleware"
    return "utility"

VERB_VI = [
("ingest", "Nạp {o}"), ("enrich", "Làm giàu {o}"), ("dedupe", "Khử trùng lặp {o}"),
("normalize", "Chuẩn hóa {o}"), ("validate", "Kiểm chứng {o}"), ("verify", "Xác minh {o}"),
("scan", "Quét {o}"), ("detect", "Phát hiện {o}"), ("parse", "Phân tích {o}"),
("extract", "Trích xuất {o}"), ("compute", "Tính toán {o}"), ("resolve", "Phân giải {o}"),
("build", "Xây dựng {o}"), ("render", "Kết xuất {o}"), ("format", "Định dạng {o}"),
("merge", "Hợp nhất {o}"), ("query", "Truy vấn {o}"), ("lookup", "Tra cứu {o}"),
("search", "Tìm kiếm {o}"), ("suggest", "Đề xuất {o}"), ("propose", "Đề xuất {o}"),
("promote", "Thăng cấp {o}"), ("plan", "Lập kế hoạch {o}"), ("match", "Khớp {o}"),
("compile", "Biên dịch {o}"), ("evaluate", "Đánh giá {o}"), ("score", "Chấm điểm {o}"),
("rank", "Xếp hạng {o}"), ("classify", "Phân loại {o}"), ("triage", "Phân loại {o}"),
("strip", "Loại bỏ {o}"), ("sanitize", "Làm sạch {o}"), ("compress", "Nén {o}"),
("prune", "Dọn dẹp {o}"), ("track", "Theo dõi {o}"), ("record", "Ghi nhận {o}"),
("ensure", "Bảo đảm {o}"), ("load", "Tải {o}"), ("save", "Lưu {o}"),
("fetch", "Tải về {o}"), ("hydrate", "Hydrate {o}"), ("hash", "Băm {o}"),
("audit", "Kiểm toán {o}"), ("check", "Kiểm tra {o}"), ("find", "Tìm {o}"),
("walk", "Duyệt {o}"), ("create", "Tạo {o}"), ("generate", "Sinh {o}"),
("upsert", "Ghi {o}"), ("cluster", "Phân cụm {o}"), ("filter", "Lọc {o}"),
("convert", "Chuyển đổi {o}"), ("redact", "Che giấu {o}"), ("emit", "Phát {o}"),
("wrap", "Bọc {o}"), ("inject", "Tiêm {o}"), ("rebind", "Rebind {o}"),
("provision", "Cấp phát {o}"), ("gate", "Cổng kiểm soát {o}"), ("throttle", "Tiết lưu {o}"),
]

def vi_func_summary(name, path, lines, exported):
    clean = name.lstrip("_")
    low = clean.lower()
    parts = clean.split("_")
    obj = " ".join(parts[1:]) if len(parts) > 1 else clean
    obj = obj.replace("_", " ") or "kết quả"
    for verb, tmpl in VERB_VI:
        if low == verb or low.startswith(verb + "_") or low.startswith(verb):
            # chi nhan khi prefix khop tron tu dau
            if low == verb or low.startswith(verb + "_"):
                s1 = tmpl.format(o=obj) + "."
                break
    else:
        s1 = f"Thực hiện nghiệp vụ `{name}` ({lines} dòng) trong mô-đun {path.split('/')[-1]}."
    if exported:
        s2 = "Được export để agent và module khác gọi trực tiếp."
    else:
        s2 = "Hàm nội bộ, chỉ phục vụ logic trong mô-đun."
    s1 = s1[0].upper() + s1[1:]
    return s1 + " " + s2

FUNC_OVERRIDE = {
("packages/raptix/raptix/agents/middleware_slots.py", "skills_sources_for"): "Trả về danh sách sources mặc định cho SkillsMiddleware theo role, cộng benchmark và plugin entry-point.",
("packages/raptix/raptix/agents/middleware_slots.py", "_make_tried_edges"): "Dựng TriedEdgesMiddleware ghi cạnh đã thử/fail reason khi bật RAPTIX_KG_TRIED_EDGES.",
("packages/raptix/raptix/agents/middleware_slots.py", "_make_roe_guardrail"): "Dựng RoEGuardrailMiddleware với sink audit mặc định theo workspace.",
("packages/raptix/raptix/agents/middleware_slots.py", "_make_kg"): "Dựng KGMiddleware với chế độ operational-shadow đọc từ biến môi trường.",
("packages/raptix/raptix/agents/middleware_slots.py", "_make_kg_autoingest"): "Dựng KGAutoIngestMiddleware tự nạp tri thức sau tool khi bật cờ auto-ingest.",
("packages/raptix/raptix/agents/middleware_slots.py", "_make_hitl"): "Dựng HITLApprovalMiddleware khi RAPTIX_HITL__ENABLED bật, kèm policy high-impact mặc định.",
("packages/raptix/raptix/agents/middleware_slots.py", "_make_record"): "Dựng RecordingMiddleware ghi bản ghi replay khi RAPTIX_RUNTIME__RECORD_PATH được đặt.",
("packages/raptix/raptix/agents/middleware_slots.py", "_make_model_fallback"): "Dựng ModelFallbackMiddleware với chuỗi model dự phòng cho từng role.",
("packages/raptix/raptix/cli/audit.py", "main"): "Chạy verify ledger audit: kiểm file tồn tại, giải HMAC key, gọi verify_ledger và in text/JSON.",
("packages/raptix/raptix/cli/auth.py", "main"): "In báo cáo auth status/doctor: nạp .env, gọi auth_inventory và trả mã thoát cho CI.",
("packages/raptix/raptix/cli/auth.py", "_load_env_file"): "Nạp KEY=VALUE từ .env vào process env mà không ghi đè biến đang sống.",
("packages/raptix/raptix/cli/export_transcript.py", "render_transcript"): "Render toàn bộ events của engagement thành tài liệu Markdown transcript.",
("packages/raptix/raptix/cli/export_transcript.py", "main"): "Đọc events.jsonl của engagement và xuất transcript ra stdout hoặc file output.",
("packages/raptix/raptix/cli/scan.py", "main"): "Chạy scan một lần headless: parse args, validate target, dispatch SDK, xuất SARIF và gating.",
("packages/raptix/raptix/cli/scan.py", "_dispatch_scan_via_sdk"): "Điều phối scan qua LangGraph SDK và thu findings graph của engagement.",
("packages/raptix/raptix/cli/scan.py", "_write_sarif_and_gate"): "Ghi SARIF v2.1.0 và quyết định mã thoát theo ngưỡng severity fail-on.",
("packages/raptix/raptix/cli/scan.py", "_validate_targets"): "Kiểm tra target hợp lệ (đường dẫn tồn tại, URL http/git) trước khi scan.",
("packages/raptix/raptix/cli/zip.py", "export_engagement"): "Nén thư mục engagements/<id>/ thành ZIP có tiền tố tự mô tả.",
("packages/raptix/raptix/cli/zip.py", "import_engagement"): "Khôi phục ZIP vào engagements/, chặn traversal/symlink và xác minh mọi file.",
("packages/raptix/raptix/cli/zip.py", "_safe_members"): "Lọc member ZIP an toàn, loại bỏ traversal và symlink trước khi giải nén.",
("packages/raptix/raptix/core/subagent_streaming.py", "set_subagent_renderer"): "Đăng ký renderer Python-side cho sự kiện sub-agent trực tiếp.",
("packages/raptix/raptix/llm/factory.py", "auth_inventory"): "Khảo sát toàn bộ phương thức auth (API key, OAuth, local) và chuỗi fallback đã phân giải.",
("packages/raptix/raptix/llm/factory.py", "create_llm"): "Tạo instance ChatModel cho role qua LiteLLM proxy kèm mapping và fallback.",
("packages/raptix/raptix/llm/factory.py", "_resolve_credentials"): "Phân giải credentials tổng thể từ env, file token và thứ tự ưu tiên auth.",
("packages/raptix/raptix/llm/factory.py", "_reraise_with_actionable_message"): "Bọc lỗi provider thành thông điệp actionable (401/404/timeout) cho operator.",
("packages/raptix/raptix/llm/factory.py", "_classify_provider_error"): "Phân loại lỗi provider thành lớp ProviderErrorClass để retry/fallback.",
("packages/raptix/raptix/llm/factory.py", "_redact_secrets"): "Che giấu secret trong text/log trước khi ghi sự kiện hoặc lỗi.",
("packages/raptix/raptix/middleware/_audit_sink.py", "verify_ledger"): "Duyệt toàn file ledger, tính lại chuỗi prev_hash/hash và kiểm HMAC khi có key.",
("packages/raptix/raptix/middleware/_audit_sink.py", "iter_records"): "Lặp từng record JSONL trong ledger audit để verify hoặc debug.",
("packages/raptix/raptix/middleware/_command_targets.py", "extract_targets"): "Hợp nhất trích tool-specific và scrape chung thành tập target của lệnh.",
("packages/raptix/raptix/middleware/_command_targets.py", "_extract_token_hosts"): "Trích fail-closed mọi token dạng host/IP/CIDR khi không extractor nào khớp.",
("packages/raptix/raptix/middleware/_injection_detector.py", "detect_injection"): "Quét text tìm tín hiệu injection và trả verdict kèm risk và categories.",
("packages/raptix/raptix/middleware/_injection_detector.py", "neutralize_special_tokens"): "Vô hiệu hóa token đặc biệt (role/tool tag) để chống role confusion.",
("packages/raptix/raptix/middleware/roe.py", "build_default_sink"): "Dựng RoEAuditSink mặc định cho workspace, trả None khi chưa có workspace.",
("packages/raptix/raptix/middleware/state_reducers.py", "reduce_converging_value"): "Hợp nhất last-write-wins trên giá trị non-None cho channel convergent.",
("packages/raptix/raptix/middleware/state_reducers.py", "reduce_concat_transcript"): "Nối transcript tích lũy cho channel sub-agent transcript.",
("packages/raptix/raptix/middleware/dispatch.py", "merge_dispatch_ledger"): "Hợp nhất ledger dispatch theo attempt: giữ row có attempt lớn nhất mỗi key.",
("packages/raptix/raptix/middleware/opplan.py", "_format_opplan_status"): "Định dạng khối trạng thái OPPLAN (battle tracker) để tiêm vào prompt model.",
("packages/raptix/raptix/middleware/opplan.py", "_reduce_engagement_name"): "Reducer giữ tên engagement hội tụ cho channel state.",
("packages/raptix/raptix/middleware/event_logging.py", "_redact_args"): "Che giấu tham số nhạy cảm (api_key, secret) trước khi ghi event log.",
("packages/raptix/raptix/middleware/filesystem.py", "_normalize_engagement_workspace"): "Chuẩn hóa workspace engagement theo hợp đồng 4 trường hợp fail-closed nghiêm ngặt.",
("packages/raptix/raptix/middleware/filesystem.py", "_rebind_sandbox_per_run"): "Rebind backend sandbox theo runtime mỗi lượt chạy để đúng workspace.",
("packages/raptix/raptix/middleware/skillogy.py", "maybe_install_skillogy"): "Cài đặt SkillogyMiddleware khi RAPTIX_SKILL_BACKEND=skillogy_brain và đủ cấu hình.",
("packages/raptix/raptix/middleware/skills.py", "_parse_comma_field"): "Phân tích trường frontmatter dạng chuỗi/phân tách phẩy thành danh sách.",
}

CLASS_META = {
("packages/raptix/raptix/agents/middleware_slots.py", "_SafeSummarizationProxy"): ("Proxy tóm tắt an toàn: bọc middleware summarization theo phạm vi, fallback về handler khi model lỗi.", ["summarization", "proxy", "fallback", "safety"]),
("packages/raptix/raptix/core/dispatch_context.py", "DispatchContext"): ("Ngữ cảnh dispatch bất biến: định danh dispatch, objective, attempt và danh sách thất bại.", ["dispatch-context", "data-model", "concurrency", "state"]),
("packages/raptix/raptix/core/subagent_streaming.py", "StreamingRunnable"): ("Runnable bọc streaming cho sub-agent: chặn invoke/ainvoke, phát sự kiện live và giữ tương thích SubAgentMiddleware.", ["streaming", "subagent", "runnable", "observability"]),
("packages/raptix/raptix/llm/factory.py", "LLMTimeoutError"): ("Ngoại lệ timeout LLM khi gọi provider vượt ngưỡng cấu hình.", ["error-model", "timeout", "llm", "exception"]),
("packages/raptix/raptix/llm/factory.py", "AuthMethodStatus"): ("Trạng thái một phương thức auth: kind, label, env var, configured/active/detail.", ["auth-status", "data-model", "credentials", "llm"]),
("packages/raptix/raptix/llm/factory.py", "AuthInventory"): ("Bản kiểm kê auth tổng thể: danh sách statuses, chuỗi fallback, any_active và configured_but_idle.", ["auth-inventory", "credentials", "fallback-chain", "data-model"]),
("packages/raptix/raptix/llm/factory.py", "_ProxiedChatOpenAI"): ("ChatOpenAI qua proxy với log model phục vụ và xử lý đặc thù provider.", ["chat-model", "proxy", "litellm", "llm"]),
("packages/raptix/raptix/llm/factory.py", "_DeepSeekThinkingChatOpenAI"): ("Biến thể ChatOpenAI cho DeepSeek thinking: payload, generate và chuyển chunk riêng.", ["deepseek", "thinking-model", "chat-model", "llm"]),
("packages/raptix/raptix/llm/factory.py", "_NvidiaNIMChatOpenAI"): ("Biến thể ChatOpenAI cho NVIDIA NIM: tùy biến request payload theo NIM.", ["nvidia-nim", "chat-model", "provider", "llm"]),
("packages/raptix/raptix/llm/factory.py", "LLMFactory"): ("Factory trung tâm tạo ChatModel qua LiteLLM proxy theo role, profile và credentials đã phân giải.", ["llm-factory", "model-routing", "fallback", "proxy"]),
("packages/raptix/raptix/llm/router.py", "ModelRouter"): ("Bộ định tuyến role sang model: primary và chuỗi fallback đầy đủ cho middleware.", ["model-router", "role-mapping", "fallback", "llm"]),
("packages/raptix/raptix/middleware/_audit_sink.py", "AuditChainState"): ("Trạng thái chuỗi audit: seq đơn điệu và prev_hash cho lần append kế tiếp.", ["audit-state", "hash-chain", "data-model", "roe"]),
("packages/raptix/raptix/middleware/_audit_sink.py", "RoEAuditSink"): ("Sink ghi audit RoE append-only: hydrate, append kèm fsync và tính hash/HMAC.", ["audit-sink", "roe", "persistence", "integrity"]),
("packages/raptix/raptix/middleware/_audit_sink.py", "VerifyResult"): ("Kết quả verify ledger: ok, số record, first_bad_seq và reason.", ["verify-result", "audit", "data-model", "integrity"]),
("packages/raptix/raptix/middleware/_injection_detector.py", "InjectionCategory"): ("Enum loại tín hiệu injection: override, hijack role/tool, exfil markdown, leak, cypher, shell, invisible.", ["injection-category", "enum", "detection", "security"]),
("packages/raptix/raptix/middleware/_injection_detector.py", "InjectionMatch"): ("Một match injection: pattern, vị trí và category phát hiện được.", ["injection-match", "data-model", "detection", "security"]),
("packages/raptix/raptix/middleware/_injection_detector.py", "InjectionVerdict"): ("Kết luận detector: risk, tập categories và tóm tắt để gắn envelope.", ["verdict", "risk-assessment", "detection", "data-model"]),
("packages/raptix/raptix/middleware/budget.py", "BudgetExceeded"): ("Ngoại lệ vượt ngân sách: scope, số đã chi và cap, dừng engagement.", ["budget-exceeded", "exception", "cost-control", "guardrail"]),
("packages/raptix/raptix/middleware/budget.py", "_SpendCache"): ("Cache spend theo TTL để không hammer LiteLLM mỗi lần gọi model.", ["spend-cache", "ttl-cache", "cost-control", "internal"]),
("packages/raptix/raptix/middleware/budget.py", "BudgetEnforcementMiddleware"): ("Middleware cưỡng chế ngân sách: gắn tag scope, poll spend, warn mềm và chặn cứng.", ["budget", "middleware", "guardrail", "litellm"]),
("packages/raptix/raptix/middleware/dispatch.py", "DispatchState"): ("State dispatch mở rộng transcript: ledger và ngữ cảnh biên tác vụ.", ["dispatch-state", "state-schema", "transcript", "data-model"]),
("packages/raptix/raptix/middleware/dispatch.py", "DispatchTaskSchema"): ("Schema tool task cho dispatch: kế thừa TaskToolSchema của deepagents.", ["task-schema", "dispatch", "data-model", "subagent"]),
("packages/raptix/raptix/middleware/dispatch.py", "DispatchMiddleware"): ("Middleware điều phối sub-agent bền vững: chuẩn bị, kết thúc, guard tool và ledger.", ["dispatch", "middleware", "subagent", "reliability"]),
("packages/raptix/raptix/middleware/engagement.py", "EngagementContextState"): ("State ngữ cảnh engagement: slug, workspace, benchmark và deconfliction.", ["engagement-state", "state-schema", "context", "data-model"]),
("packages/raptix/raptix/middleware/engagement.py", "EngagementContextMiddleware"): ("Middleware hydrate và tiêm ngữ cảnh engagement/benchmark vào prompt mỗi lượt.", ["engagement", "middleware", "context-injection", "benchmark"]),
("packages/raptix/raptix/middleware/event_logging.py", "EventLogMiddleware"): ("Middleware persist sự kiện live ra events.jsonl với scope cache theo workspace.", ["event-log", "middleware", "observability", "persistence"]),
("packages/raptix/raptix/middleware/filesystem.py", "EngagementFilesystemBackend"): ("Backend filesystem giới hạn engagement: ánh xạ real/virtual, che lỗi và mask path.", ["filesystem-backend", "workspace-scope", "sandbox", "security"]),
("packages/raptix/raptix/middleware/filesystem.py", "FilesystemMiddleware"): ("Middleware filesystem không execute, rebind backend theo workspace mỗi run.", ["filesystem", "middleware", "workspace-scope", "sandbox"]),
("packages/raptix/raptix/middleware/hitl.py", "ApprovalPolicyRule"): ("Quy tắc phê duyệt: ánh xạ technique ATT&CK/tool pattern sang hành động approval.", ["approval-policy", "data-model", "attck", "hitl"]),
("packages/raptix/raptix/middleware/hitl.py", "ApprovalRequest"): ("Yêu cầu phê duyệt: tool, args đã redact, scope và policy khớp, serialize JSONL.", ["approval-request", "data-model", "hitl", "transport"]),
("packages/raptix/raptix/middleware/hitl.py", "ApprovalDecision"): ("Quyết định operator: allow/deny/redirect kèm args thay thế và lý do.", ["approval-decision", "data-model", "hitl", "operator"]),
("packages/raptix/raptix/middleware/hitl.py", "ApprovalTransport"): ("Giao thức transport phê duyệt: submit request và chờ decision có timeout.", ["transport", "protocol", "hitl", "abstraction"]),
("packages/raptix/raptix/middleware/hitl.py", "InProcessApprovalTransport"): ("Transport in-process cho unit test: queue bộ nhớ và decision thủ công.", ["transport", "in-process", "testing", "hitl"]),
("packages/raptix/raptix/middleware/hitl.py", "FileBackedApprovalTransport"): ("Transport file-backed: hàng đợi JSONL tương thích wire format operator UI.", ["transport", "file-backed", "jsonl", "hitl"]),
("packages/raptix/raptix/middleware/hitl.py", "HITLApprovalMiddleware"): ("Middleware cổng con người cho tool high-impact: khớp rule, phát request và áp decision.", ["hitl", "middleware", "safety-gate", "approval"]),
("packages/raptix/raptix/middleware/model_override.py", "ModelOverridesState"): ("State override model: kênh model_override cho CLI /model.", ["model-override", "state-schema", "data-model", "cli"]),
("packages/raptix/raptix/middleware/model_override.py", "ModelOverrideMiddleware"): ("Middleware rebind LLM theo model_override runtime cho từng cuộc gọi.", ["model-override", "middleware", "llm", "runtime"]),
("packages/raptix/raptix/middleware/opplan.py", "OPPLANState"): ("State OPPLAN: objectives, engagement/workspace và bộ đếm mutation.", ["opplan-state", "state-schema", "objectives", "data-model"]),
("packages/raptix/raptix/middleware/opplan.py", "OPPLANMiddleware"): ("Middleware mục tiêu OPPLAN: tiêm battle tracker, đăng ký tools và chặn song song.", ["opplan", "middleware", "objectives", "tracking"]),
("packages/raptix/raptix/middleware/opscontrol_notifications.py", "OpsControlNotificationMiddleware"): ("Middleware thông báo opscontrol: poll snapshot, diff dedup và tiêm system-reminder.", ["opscontrol", "middleware", "notifications", "workload"]),
("packages/raptix/raptix/middleware/prompt_injection_shield.py", "PromptInjectionShieldMiddleware"): ("Khiên prompt-injection: bọc untrusted, tiêm policy và phát stream event.", ["shield", "middleware", "prompt-injection", "defense"]),
("packages/raptix/raptix/middleware/proxy_key_override.py", "ProxyKeyState"): ("State virtual-key proxy cho cost attribution đa tenant.", ["proxy-key", "state-schema", "multi-tenant", "data-model"]),
("packages/raptix/raptix/middleware/proxy_key_override.py", "ProxyKeyOverrideMiddleware"): ("Middleware re-key model sang virtual-key của engagement cho từng cuộc gọi.", ["proxy-key", "middleware", "multi-tenant", "billing"]),
("packages/raptix/raptix/middleware/roe.py", "RoEGuardrailMiddleware"): ("Guardrail RoE cố vấn: parse lệnh, đánh giá PASS/WARN/REFUSE, ghi audit và điều tiết egress.", ["roe", "middleware", "guardrail", "policy-enforcement"]),
("packages/raptix/raptix/middleware/skillogy.py", "SkillogyMiddleware"): ("Middleware REST mỏng cho skillogy: discovery, load và traverse qua backend dịch vụ.", ["skillogy", "middleware", "skill-discovery", "rest-client"]),
("packages/raptix/raptix/middleware/skills.py", "SkillsMiddleware"): ("Middleware kỹ năng red-team: nhóm subdomain, MITRE inline và trigger gọn.", ["skills", "middleware", "mitre-attack", "prompt"]),
("packages/raptix/raptix/middleware/subagent_transcript_state.py", "SubagentTranscriptState"): ("Schema transcript bền vững cho sub-agent: kênh tích lũy lưu checkpoint.", ["transcript-state", "state-schema", "observability", "checkpoint"]),
("packages/raptix/raptix/middleware/untrusted_output.py", "UntrustedOutputMiddleware"): ("Middleware cách ly output: envelope UNTRUSTED, risk tag và quarantine ledger.", ["untrusted-output", "middleware", "quarantine", "defense"]),
}

def complexity_for_nonempty(n):
    if n < 50:
        return "simple"
    if n <= 200:
        return "moderate"
    return "complex"

def complexity_for_span(lines):
    if lines <= 20:
        return "simple"
    if lines <= 80:
        return "moderate"
    return "complex"

nodes = []
edges = []
seen_ids = set()

def add_node(n):
    assert n["id"] not in seen_ids, "trung id: " + n["id"]
    seen_ids.add(n["id"])
    nodes.append(n)

def add_edge(s, t, typ, weight):
    if s == t:
        return
    edges.append({"source": s, "target": t, "type": typ, "direction": "forward", "weight": weight})

exports_by_file = {}
for fp, r in results.items():
    exports_by_file[fp] = {e["name"] for e in (r.get("exports") or [])}

funcs_by_file = {}
for fp, r in results.items():
    funcs_by_file[fp] = {f["name"]: f for f in (r.get("functions") or [])}

for f in batch_files:
    fp = f["path"]
    r = results[fp]
    non_empty = r.get("nonEmptyLines", f["sizeLines"])
    summary, tags, notes = FILE_META[fp]
    fn_node = {
        "id": "file:" + fp, "type": "file", "name": fp.split("/")[-1],
        "filePath": fp, "summary": summary, "tags": tags,
        "complexity": complexity_for_nonempty(non_empty),
    }
    if notes:
        fn_node["languageNotes"] = notes
    add_node(fn_node)

    exported = exports_by_file.get(fp, set())
    for fname, fi in funcs_by_file.get(fp, {}).items():
        lines = fi["endLine"] - fi["startLine"] + 1
        is_exp = fname in exported
        key = (fp, fname)
        ov = FUNC_OVERRIDE.get(key, None)
        if ov is None:
            summ = vi_func_summary(fname, fp, lines, is_exp)
        elif ov is None and False:
            summ = ""
        else:
            # None nghia la bo qua override (giua nguyen generic) nhung truong hop nay khong xay ra
            summ = ov if isinstance(ov, str) else vi_func_summary(fname, fp, lines, is_exp)
            if isinstance(ov, str):
                # bo sung cau export khi can cho dong nhat
                if is_exp and "export" not in summ.lower():
                    summ = summ + " Được export để agent và module khác gọi trực tiếp."
        dom = domain_of(fp)
        verb = fname.lstrip("_").split("_")[0].lower() if fname.lstrip("_") else "helper"
        tag3 = "exported" if is_exp else "internal"
        ftags = [dom, verb.replace("_", "-") if verb else "helper", tag3]
        ftags = [t.replace("_", "-").lower() for t in ftags]
        add_node({
            "id": f"function:{fp}:{fname}", "type": "function", "name": fname,
            "filePath": fp, "lineRange": [fi["startLine"], fi["endLine"]],
            "summary": summ, "tags": ftags,
            "complexity": complexity_for_span(lines),
        })
        add_edge("file:" + fp, f"function:{fp}:{fname}", "contains", 1.0)
        if is_exp:
            add_edge("file:" + fp, f"function:{fp}:{fname}", "exports", 0.8)

    for c in classes_by_file.get(fp, []):
        lines = c["end"] - c["start"] + 1
        is_exp = c["name"] in exported
        key = (fp, c["name"])
        if key in CLASS_META:
            summ, ctags = CLASS_META[key]
            if is_exp and "exported" not in ctags and len(ctags) < 5:
                ctags = ctags + ["exported"]
        else:
            summ = f"Lớp `{c['name']}` trong mô-đun {fp.split('/')[-1]} với {len(c['methods'])} phương thức."
            ctags = [domain_of(fp), "data-model", "exported" if is_exp else "internal"]
        add_node({
            "id": f"class:{fp}:{c['name']}", "type": "class", "name": c["name"],
            "filePath": fp, "lineRange": [c["start"], c["end"]],
            "summary": summ, "tags": ctags,
            "complexity": complexity_for_span(lines),
        })
        add_edge("file:" + fp, f"class:{fp}:{c['name']}", "contains", 1.0)
        if is_exp:
            add_edge("file:" + fp, f"class:{fp}:{c['name']}", "exports", 0.8)

# imports 1:1
import_total = 0
for f in batch_files:
    fp = f["path"]
    for dst in batch_import.get(fp, []):
        add_edge("file:" + fp, "file:" + dst, "imports", 0.7)
        import_total += 1

# calls: trong batch, confident only (ca trong-file va lien-file qua imports)
name_kind_in_file = {}
for f in batch_files:
    fp = f["path"]
    d = {}
    for fname in funcs_by_file.get(fp, {}):
        d[fname] = "function"
    for c in classes_by_file.get(fp, []):
        d.setdefault(c["name"], "class")
    name_kind_in_file[fp] = d

neighbor_symbols = {}
for fp, neighs in neighbor_map.items():
    s = {}
    for n in neighs or []:
        for sym in n.get("symbols") or []:
            s.setdefault(sym, n.get("path"))
    neighbor_symbols[fp] = s

def dirname(p):
    return p.rsplit("/", 1)[0] if "/" in p else ""

calls_added = 0
for f in batch_files:
    fp = f["path"]
    r = results[fp]
    cg = r.get("callGraph") or []
    local_names = set(funcs_by_file.get(fp, {})) | {c["name"] for c in classes_by_file.get(fp, [])}
    imported = batch_import.get(fp, [])
    srcdir = dirname(fp)
    for e in cg:
        caller, callee = e.get("caller"), e.get("callee")
        if not caller or not callee:
            continue
        if any(ch in callee for ch in ".()[]\"' "):
            # cho phep dang Class.method hoac module.func: lay phan sau dau cham cuoi
            if "." in callee and "(" not in callee and " " not in callee:
                callee_sym = callee.rsplit(".", 1)[-1]
                # loai bo chuoi rong hoac ky tu dac biet
                if not callee_sym or not callee_sym[0].isalpha() and callee_sym[0] != "_":
                    continue
            else:
                continue
        else:
            callee_sym = callee
        if caller not in funcs_by_file.get(fp, {}):
            continue
        if callee_sym == caller:
            continue
        target_fp = None
        kind = None
        # 1) trong-file
        if callee_sym in local_names:
            target_fp = fp
            kind = name_kind_in_file[fp][callee_sym]
        else:
            # 2) lien-file qua imports (uu tien file import co export ten nay)
            for cand in imported:
                if cand in name_kind_in_file and callee_sym in name_kind_in_file[cand]:
                    target_fp = cand
                    kind = name_kind_in_file[cand][callee_sym]
                    break
            if target_fp is None:
                src_syms = neighbor_symbols.get(fp, {})
                if callee_sym in src_syms:
                    tpath = src_syms[callee_sym]
                    if tpath in imported:
                        target_fp = tpath
                        kind = "class" if callee_sym[:1].isupper() else "function"
            if target_fp is None:
                # 3) cung thu muc trong batch (ten duy nhat)
                cands = [(pp, n) for (pp, n) in [(ff, nn) for ff in name_kind_in_file for nn in name_kind_in_file[ff]] if n == callee_sym and dirname(pp) == srcdir]
                if len(cands) == 1:
                    target_fp, _ = cands[0]
                    kind = name_kind_in_file[target_fp][callee_sym]
                else:
                    continue
        if target_fp is None or kind is None:
            continue
        src_id = f"function:{fp}:{caller}"
        tgt_id = f"{kind}:{target_fp}:{callee_sym}"
        if src_id in seen_ids and tgt_id in seen_ids:
            add_edge(src_id, tgt_id, "calls", 0.8)
            calls_added += 1

# inherits trong batch tu AST bases
inherits_added = 0
for fp, clist in classes_by_file.items():
    for c in clist:
        src_id = f"class:{fp}:{c['name']}"
        for base in c.get("bases", []):
            # tim base trong cung file hoac file import
            tgt = None
            if base in name_kind_in_file.get(fp, {}):
                tgt = f"class:{fp}:{base}" if name_kind_in_file[fp][base] == "class" else f"function:{fp}:{base}"
            else:
                for cand in batch_import.get(fp, []):
                    if cand in name_kind_in_file and base in name_kind_in_file[cand] and name_kind_in_file[cand][base] == "class":
                        tgt = f"class:{cand}:{base}"
                        break
            if tgt and tgt in seen_ids:
                add_edge(src_id, tgt, "inherits", 0.9)
                inherits_added += 1

# dedupe
uniq = {}
for e in edges:
    uniq[(e["source"], e["target"], e["type"])] = e
edges = list(uniq.values())

out = {
    "batchIndex": BATCH_INDEX,
    "batchFiles": [{"path": f["path"], "language": f["language"], "sizeLines": f["sizeLines"], "fileCategory": f["fileCategory"]} for f in batch_files],
    "nodes": nodes,
    "edges": edges,
}
op = UA_DIR / "intermediate" / "batch-7.json"
op.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")

from collections import Counter
print(f"nodes={len(nodes)} edges={len(edges)} files={len(batch_files)}")
print(Counter(n["type"] for n in nodes))
print(Counter(e["type"] for e in edges))
print(f"imports expected={import_total} calls_added~{calls_added} inherits_added~{inherits_added}")
print("wrote", op, op.stat().st_size, "bytes")
json.load(io.open(op, encoding="utf-8"))
# validate IDs prefix
valid_prefix = ("file:", "function:", "class:", "config:", "document:", "service:", "pipeline:", "resource:", "table:", "schema:", "endpoint:")
bad_ids = [n["id"] for n in nodes if not n["id"].startswith(valid_prefix)]
print("bad node ids:", len(bad_ids))
ids = {n["id"] for n in nodes}
bad_edges = [e for e in edges if e["type"] in ("contains", "exports", "calls", "inherits", "implements", "depends_on", "tested_by") and (e["source"] not in ids or e["target"] not in ids)]
print("non-imports dangling:", len(bad_edges))
for e in bad_edges[:5]:
    print(" BAD:", e)
empty = [n["id"] for n in nodes if not n.get("summary") or not n.get("tags")]
print("missing summary/tags:", len(empty))
