#!/usr/bin/env python3
"""Sinh batch-3.json cho Raptix (file-analyzer batch 3, tieng Viet)."""
import ast
import io
import json
import pathlib
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

PROJECT_ROOT = r"D:\.VTNet\redteam\raptix"
UA_DIR = pathlib.Path(PROJECT_ROOT) / ".ua"
BATCH_INDEX = 3

batches = json.load(open(UA_DIR / "intermediate" / "batches.json", encoding="utf-8"))
batch = [b for b in batches["batches"] if b.get("batchIndex") == BATCH_INDEX][0]
batch_files = batch["files"]
batch_import = batch["batchImportData"]
neighbor_map = batch.get("neighborMap", {})

ext = json.load(open(UA_DIR / "tmp" / "ua-file-extract-results-3.json", encoding="utf-8"))
results = {r["path"]: r for r in ext["results"]}

# ---------- AST: lay class (name, start, end, methods, bases) ----------
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
            out.append({"name": n.name, "start": n.lineno, "end": n.end_lineno,
                        "methods": methods, "bases": bases})
    return out

classes_by_file = {f["path"]: get_classes(f["path"]) for f in batch_files}

# ---------- metadata tieng Viet cho file ----------
FILE_META = {
 "packages/raptix/raptix/backends/factory.py": ("Factory lựa chọn backend sandbox thực thi lệnh cho agent: phân giải endpoint từ cấu hình run, cấu hình toàn cục và biến môi trường, đồng thời cache instance HTTPSandbox dùng chung theo cặp URL/token.", ["factory", "sandbox-backend", "endpoint-resolution", "configuration"], "Dùng cache chia sẻ theo (base_url, token) để tái sử dụng kết nối sandbox."),
 "packages/raptix/raptix/blue_cell/__init__.py": ("Barrel của package Blue Cell (tác tử phòng thủ): giới thiệu vòng lặp vaccine tấn công-phòng thủ và re-export RuleMatcher cùng BlueCellTap.", ["barrel", "blue-cell", "entry-point", "defensive-security"], None),
 "packages/raptix/raptix/blue_cell/rule_match.py": ("Bộ khớp quy tắc phát hiện theo kiểu Sigma/regex: biên dịch pattern, đánh giá điều kiện boolean trên sự kiện và tính thời gian phát hiện trung bình MTTD.", ["detection-rules", "sigma-matcher", "mttd", "blue-cell"], "Hỗ trợ cả quy tắc Sigma YAML lẫn dict regex phẳng, không phụ thuộc pysigma."),
 "packages/raptix/raptix/blue_cell/tap.py": ("Đầu đọc luồng sự kiện BlueCellTap: bóc mã ANSI, phân tích dòng log tmux thành TapEvent và đọc sự kiện theo batch để agent phòng thủ tiêu thụ.", ["event-tap", "tmux-logs", "telemetry", "blue-cell"], None),
 "packages/raptix/raptix/llm/__init__.py": ("Barrel của package LLM: re-export factory, router và các kiểu cấu hình model, credential dùng chung toàn dự án.", ["barrel", "llm", "entry-point", "model-routing"], None),
 "packages/raptix/raptix/tools/__init__.py": ("Barrel tổng hợp toàn bộ công cụ của agent: gom BASH, research, contracts, web, cloud, AD, evidence và reporting thành một registry duy nhất.", ["barrel", "tool-registry", "entry-point", "agent-tools"], None),
 "packages/raptix/raptix/tools/bash/__init__.py": ("Barrel công cụ bash: re-export bash, bash_output, bash_kill, bash_status và danh sách BASH_TOOLS.", ["barrel", "bash-tools", "entry-point", "sandbox-exec"], None),
 "packages/raptix/raptix/tools/bash/bash.py": ("Công cụ thực thi shell trong sandbox Kali qua session tmux bền vững: chạy lệnh, đọc output, kill và kiểm tra trạng thái, kèm nén dòng lặp, khử ANSI và offload output lớn ra scratch.", ["bash-execution", "tmux-sandbox", "agent-tool", "output-management"], "Session tmux giữ working directory, biến môi trường và job nền xuyên suốt các lượt gọi."),
 "packages/raptix/raptix/tools/bash/prompt.py": ("Tài liệu prompt nguồn duy nhất cho công cụ bash: mô tả ngữ nghĩa và tham số của bash, bash_output, bash_kill, bash_status để mọi agent dùng thống nhất.", ["prompt-docs", "bash-tools", "agent-guidance", "tool-semantics"], None),
 "packages/raptix/raptix/tools/contracts/__init__.py": ("Barrel công cụ kiểm toán hợp đồng thông minh: re-export harness Foundry, quét pattern Solidity và ingest Slither.", ["barrel", "smart-contracts", "entry-point", "security-audit"], None),
 "packages/raptix/raptix/tools/contracts/foundry.py": ("Sinh harness kiểm thử Foundry từ template dựng sẵn cho ba kịch bản reentrancy, kiểm soát truy cập và flashloan.", ["foundry", "smart-contracts", "test-generation", "reentrancy"], None),
 "packages/raptix/raptix/tools/contracts/patterns.py": ("Quét pattern regex trên mã nguồn Solidity để phát hiện mẫu lỗ hổng phổ biến, ghi nhận dòng, mức độ và bằng chứng cho từng phát hiện.", ["solidity-scan", "pattern-matching", "vulnerability-detection", "static-analysis"], None),
 "packages/raptix/raptix/tools/contracts/slither.py": ("Nạp kết quả phân tích Slither dạng JSON vào knowledge graph: chuẩn hóa lỗ hổng, contract và file, khử trùng lặp theo khóa ổn định rồi liên kết finding.", ["slither", "kg-ingest", "vulnerability-management", "solidity"], "Khóa khử trùng lặp ổn định giúp nhiều phần tử trỏ về cùng một lỗ hổng."),
 "packages/raptix/raptix/tools/contracts/tools.py": ("Lớp tool LangChain cho kiểm toán hợp đồng: bọc quét Solidity, ingest Slither và sinh test Foundry thành tool gọi được từ agent.", ["agent-tool", "smart-contracts", "langchain-tools", "security-audit"], None),
 "packages/raptix/raptix/tools/defense/blue_cell.py": ("Tool quét Blue Cell: đọc batch sự kiện từ tap, khớp quy tắc phát hiện, ghi node DetectionFired và thống kê MTTD vào knowledge graph.", ["blue-cell", "detection-scan", "mttd", "agent-tool"], None),
 "packages/raptix/raptix/tools/defense/brief.py": ("Xây dựng báo cáo phòng thủ: tổng hợp độ phủ phát hiện, lỗ hổng, phân vị MTTD, kết xuất Markdown và lớp phủ ATT&CK Navigator.", ["defense-brief", "attack-navigator", "reporting", "coverage-analysis"], None),
 "packages/raptix/raptix/tools/proxy/__init__.py": ("Barrel công cụ proxy Caido: re-export client và các tool truy vấn request, sitemap và quy tắc scope.", ["barrel", "caido-proxy", "entry-point", "web-testing"], None),
 "packages/raptix/raptix/tools/proxy/tools.py": ("Client Caido và tool truy vấn proxy HTTP: liệt kê, xem, gửi và lặp lại request, quản lý scope và sitemap phục vụ kiểm thử web.", ["caido-proxy", "http-interception", "agent-tool", "web-testing"], "CaidoConfig đọc từ biến môi trường, cho phép bọc lỗi gọi an toàn."),
 "packages/raptix/raptix/tools/references/tools.py": ("Tool tri thức tham chiếu cho agent: tra cứu tài liệu, payload, CVE PoC, báo cáo HackerOne, oneliner, killchain và methodology.", ["knowledge-base", "payloads", "cve-reference", "agent-tool"], "Nội dung corpus được làm sạch ký tự điều khiển trước khi trả về agent."),
 "packages/raptix/raptix/tools/research/__init__.py": ("Barrel khởi tạo package research: công bố trạng thái và store knowledge graph dùng chung cho các tool nghiên cứu.", ["barrel", "research-tools", "entry-point", "knowledge-graph"], None),
 "packages/raptix/raptix/tools/research/_engagement_scope.py": ("Tiện ích gắn phạm vi engagement: bọc thuộc tính của engagement đang hoạt động vào payload để tách biệt dữ liệu đa chiến dịch.", ["engagement-scope", "multi-tenancy", "utility", "context"], None),
 "packages/raptix/raptix/tools/research/_state.py": ("Trạng thái và store dùng chung của tool research: shim tương thích kho cũ, persistence theo workspace và transaction trên knowledge graph.", ["kg-store", "state-management", "engagement-scope", "persistence"], "Shim _LegacyStoreShim giữ tương thích trong khi backend chuyển dần sang KGStore."),
 "packages/raptix/raptix/tools/research/bounty.py": ("Kiểm tra phạm vi bug bounty và sinh báo cáo: đối chiếu target với scope, liên kết lỗ hổng liên quan và kết xuất báo cáo Markdown.", ["bug-bounty", "scope-check", "reporting", "agent-tool"], None),
 "packages/raptix/raptix/tools/research/chain.py": ("Lập kế hoạch chuỗi tấn công trên knowledge graph: tính chi phí cạnh, liệt kê chuỗi, thăng cấp chuỗi và chấm điểm critical-path, phân tích ảnh hưởng.", ["attack-chains", "path-planning", "impact-analysis", "knowledge-graph"], None),
 "packages/raptix/raptix/tools/research/dedupe.py": ("Khử trùng lặp phát hiện: chuẩn hóa host, endpoint và CWE, tiền lọc, phân cụm và đối chiếu phán quyết trùng lặp.", ["dedupe", "finding-management", "clustering", "data-quality"], None),
 "packages/raptix/raptix/tools/research/health.py": ("Chẩn đoán sức khỏe backend knowledge graph: trả về revision, thống kê Neo4j và mã thoát CLI.", ["health-check", "diagnostics", "neo4j", "cli"], None),
 "packages/raptix/raptix/tools/research/osint.py": ("Làm giàu OSINT: truy vấn Shodan, Censys và ZoomEye trong phạm vi cho phép, hợp nhất và khử trùng lặp phát hiện.", ["osint", "shodan", "censys", "reconnaissance"], "Luôn kiểm tra scope trước khi gọi API ngoài; có catalog mock cho môi trường offline."),
 "packages/raptix/raptix/tools/research/patch.py": ("Đề xuất và xác minh bản vá: tạo node patch trên graph, chạy kiểm thử qua sandbox và đối chiếu pattern thành công.", ["patch-management", "remediation", "sandbox-verify", "agent-tool"], None),
 "packages/raptix/raptix/tools/research/poc.py": ("Xác thực PoC và vector CVSS 3.1: phân tích vector, khớp tín hiệu output, chạy qua sandbox và lưu kết quả có băm.", ["poc-validation", "cvss", "sandbox-runner", "verification"], "Vector CVSS được mô hình hóa bằng enum AV/AC/PR/UI/Scope/Impact."),
 "packages/raptix/raptix/tools/research/sarif.py": ("Nạp kết quả SARIF vào knowledge graph: lập chỉ mục rule, ánh xạ severity và vị trí, hỗ trợ đọc trực tiếp từ file.", ["sarif", "sast-ingest", "severity-mapping", "static-analysis"], None),
 "packages/raptix/raptix/tools/research/scanner_tools.py": ("Quét shard và xếp hạng ứng viên bí mật: chia nhỏ file, chấm điểm hit, lọc nhiễu, khử trùng lặp và ghi candidate vào graph.", ["secret-scan", "candidate-ranking", "shard-scan", "knowledge-graph"], None),
 "packages/raptix/raptix/tools/research/secret_scanner.py": ("Quét và kiểm chứng secret lộ lọt: nhận diện credential GitHub, OpenAI, Stripe, Slack, GitLab, SendGrid rồi probe tính hợp lệ.", ["secret-detection", "credential-validation", "leak-prevention", "security"], None),
 "packages/raptix/raptix/tools/research/tech_detection.py": ("Nhận diện stack công nghệ mục tiêu: khớp signature banner và header, áp quy tắc RoE rồi hợp nhất kết quả.", ["tech-fingerprinting", "banner-grab", "scope-aware", "reconnaissance"], None),
 "packages/raptix/raptix/tools/research/tools.py": ("Registry tool research trung tâm với hơn 50 tool: CRUD knowledge graph, tra cứu và làm giàu CVE, ingest scanner, phân tích JWT/OAuth/cookie/Solidity/binary và fuzzing.", ["tool-registry", "knowledge-graph", "cve-enrichment", "scanner-ingest"], "File registry lớn nhất batch, gom mọi thao tác graph và ingest của agent nghiên cứu."),
 "packages/raptix/raptix/tools/verification.py": ("Xác minh phát hiện ưu tiên workspace: chạy PoC kèm đối chứng baseline bắt buộc trong sandbox trước khi công nhận lỗ hổng.", ["finding-verification", "poc-runner", "baseline-control", "agent-tool"], "Kết quả chỉ hợp lệ khi cả lệnh PoC lẫn lệnh đối chứng đều khớp pattern kỳ vọng."),
}

DOMAIN_TAG = {
 "backends/factory": "sandbox-backend", "blue_cell": "blue-cell",
 "llm": "llm", "tools/bash": "bash-tools", "tools/contracts": "smart-contracts",
 "tools/defense": "defense", "tools/proxy": "proxy-tools", "tools/references": "knowledge-base",
 "tools/research": "research-tools", "tools/verification": "verification",
}

def domain_of(path):
    for k, v in DOMAIN_TAG.items():
        if k in path:
            return v
    return "utility"

VERB_VI = [
 ("ingest", "Nạp {o} vào knowledge graph"), ("enrich", "Làm giàu {o} bằng dữ liệu CVE"),
 ("dedupe", "Khử trùng lặp {o}"), ("normalize", "Chuẩn hóa {o}"),
 ("validate", "Kiểm chứng {o}"), ("verify", "Xác minh {o}"),
 ("scan", "Quét {o}"), ("detect", "Phát hiện {o}"),
 ("parse", "Phân tích {o}"), ("extract", "Trích xuất {o}"),
 ("compute", "Tính toán {o}"), ("resolve", "Phân giải {o}"),
 ("build", "Xây dựng {o}"), ("render", "Kết xuất {o}"),
 ("format", "Định dạng {o}"), ("merge", "Hợp nhất {o}"),
 ("query", "Truy vấn {o}"), ("lookup", "Tra cứu {o}"),
 ("search", "Tìm kiếm {o}"), ("suggest", "Đề xuất {o}"),
 ("propose", "Đề xuất {o}"), ("promote", "Thăng cấp {o}"),
 ("plan", "Lập kế hoạch {o}"), ("match", "Khớp {o}"),
 ("compile", "Biên dịch {o}"), ("evaluate", "Đánh giá {o}"),
 ("score", "Chấm điểm {o}"), ("rank", "Xếp hạng {o}"),
 ("classify", "Phân loại {o}"), ("triage", "Phân loại {o}"),
 ("strip", "Loại bỏ {o}"), ("sanitize", "Làm sạch {o}"),
 ("compress", "Nén {o}"), ("prune", "Dọn dẹp {o}"),
 ("track", "Theo dõi {o}"), ("record", "Ghi nhận {o}"),
 ("ensure", "Bảo đảm {o}"), ("load", "Tải {o}"),
 ("save", "Lưu {o}"), ("fetch", "Tải về {o}"),
 ("hydrate", "Bù đắp {o}"), ("hash", "Băm {o}"),
 ("audit", "Kiểm toán {o}"), ("check", "Kiểm tra {o}"),
 ("find", "Tìm {o}"), ("walk", "Duyệt {o}"),
 ("create", "Tạo {o}"), ("generate", "Sinh {o}"),
 ("upsert", "Ghi {o}"), ("cluster", "Phân cụm {o}"),
 ("filter", "Lọc {o}"), ("convert", "Chuyển đổi {o}"),
]

def vi_func_summary(name, path, lines, exported, callers=None):
    clean = name.lstrip("_")
    low = clean.lower()
    obj = " ".join(clean.split("_")[1:]) if "_" in clean else clean
    obj = obj or "kết quả"
    for verb, tmpl in VERB_VI:
        if low == verb or low.startswith(verb + "_"):
            s1 = tmpl.format(o=obj) + "."
            break
    else:
        s1 = f"Thực hiện nghiệp vụ `{name}` ({lines} dòng)."
    if exported:
        s2 = "Được export để agent và module khác gọi trực tiếp."
    else:
        s2 = "Hàm nội bộ, chỉ phục vụ logic trong mô-đun."
    s1 = s1[0].upper() + s1[1:]
    return s1 + " " + s2

FUNC_SUMMARY_OVERRIDE = {
 ("packages/raptix/raptix/backends/factory.py", "build_sandbox_backend"): "Dựng backend sandbox cho agent từ cấu hình: phân giải endpoint rồi trả về instance HTTPSandbox dùng chung.",
 ("packages/raptix/raptix/backends/factory.py", "_resolve_endpoint"): "Phân giải endpoint sandbox theo thứ tự ưu tiên: cấu hình run, cấu hình toàn cục, rồi biến môi trường.",
 ("packages/raptix/raptix/tools/bash/bash.py", "bash"): "Thực thi lệnh shell trong session tmux của sandbox, hỗ trợ chạy nền, timeout và mô tả bắt buộc cho audit.",
 ("packages/raptix/raptix/tools/bash/bash.py", "bash_output"): "Đọc output của lệnh đang chạy hoặc đã chạy nền trong session tmux chỉ định.",
 ("packages/raptix/raptix/tools/bash/bash.py", "bash_kill"): "Kết thúc lệnh/session đang chạy trong sandbox và dọn dẹp trạng thái liên quan.",
 ("packages/raptix/raptix/tools/bash/bash.py", "bash_status"): "Truy vấn trạng thái các lệnh và session tmux đang hoạt động trong sandbox.",
 ("packages/raptix/raptix/tools/bash/bash.py", "get_sandbox"): "Lấy hoặc khởi tạo backend sandbox cho engagement hiện tại từ cấu hình.",
 ("packages/raptix/raptix/tools/research/tools.py", "kg_add_node"): "Thêm node vào knowledge graph trong transaction, tự động gắn phạm vi engagement.",
 ("packages/raptix/raptix/tools/research/tools.py", "kg_add_edge"): "Thêm cạnh vào knowledge graph trong transaction, tự động gắn phạm vi engagement.",
 ("packages/raptix/raptix/tools/research/tools.py", "kg_query"): "Truy vấn lỗ hổng và node trên graph theo loại và ngưỡng severity tối thiểu.",
 ("packages/raptix/raptix/tools/research/tools.py", "cve_enrich_dependencies"): "Quét manifest phụ thuộc, tra cứu CVE cho từng gói và ghi finding làm giàu vào graph.",
 ("packages/raptix/raptix/tools/research/tools.py", "plan_attack_chains"): "Liệt kê chuỗi tấn công từ graph rồi thăng cấp các chuỗi đáng chú ý nhất.",
 ("packages/raptix/raptix/tools/research/tools.py", "validate_finding"): "Chạy PoC qua sandbox để xác thực finding, kèm phân tích vector CVSS.",
 ("packages/raptix/raptix/tools/research/chain.py", "plan_chains"): "Liệt kê các chuỗi tấn công khả thi từ knowledge graph theo chi phí cạnh và độ nghiêm trọng.",
 ("packages/raptix/raptix/tools/research/chain.py", "promote_chain"): "Thăng cấp chuỗi tấn công thành node AttackPath bền vững trên graph.",
 ("packages/raptix/raptix/tools/research/osint.py", "osint_enrich"): "Làm giàu thông tin domain qua Shodan, Censys và ZoomEye trong phạm vi scope cho phép.",
 ("packages/raptix/raptix/tools/research/bounty.py", "bounty_scope_check"): "Kiểm tra target có thuộc phạm vi bounty không và ghi nhận kết quả lên graph.",
 ("packages/raptix/raptix/tools/research/bounty.py", "format_bounty_report"): "Sinh báo cáo bounty Markdown từ finding đã liên kết lỗ hổng trên graph.",
 ("packages/raptix/raptix/tools/research/patch.py", "patch_propose"): "Tạo đề xuất vá cho lỗ hổng đã xác minh và lưu node patch lên graph.",
 ("packages/raptix/raptix/tools/research/patch.py", "patch_verify"): "Chạy kiểm thử bản vá trong sandbox và đối chiếu output với pattern thành công.",
 ("packages/raptix/raptix/tools/research/poc.py", "validate_poc"): "Chạy PoC trong sandbox, khớp tín hiệu thành công và phân loại kết quả xác thực.",
 ("packages/raptix/raptix/tools/research/poc.py", "sandbox_runner"): "Thực thi lệnh PoC trong sandbox với timeout và phân loại lỗi hạ tầng.",
 ("packages/raptix/raptix/tools/research/poc.py", "parse_cvss_vector"): "Phân tích chuỗi vector CVSS 3.1 thành đối tượng có cấu trúc để chấm điểm.",
 ("packages/raptix/raptix/tools/research/sarif.py", "ingest_sarif"): "Nạp tài liệu SARIF vào knowledge graph kèm ánh xạ rule và severity.",
 ("packages/raptix/raptix/tools/research/dedupe.py", "find_duplicate"): "Tìm phát hiện trùng lặp cho một finding dựa trên chữ ký và phán quyết của judge.",
 ("packages/raptix/raptix/tools/research/dedupe.py", "kg_dedupe_findings"): "Tool khử trùng lặp finding trên graph theo cụm tiền lọc.",
 ("packages/raptix/raptix/tools/research/tech_detection.py", "detect_tech_stack"): "Nhận diện stack công nghệ của mục tiêu từ banner và header HTTP.",
 ("packages/raptix/raptix/tools/research/secret_scanner.py", "scan_secrets"): "Quét văn bản tìm secret theo pattern rồi phân loại mức độ rủi ro.",
 ("packages/raptix/raptix/tools/research/secret_scanner.py", "validate_credential"): "Probe tính hợp lệ của credential phát hiện được qua API nhà cung cấp.",
 ("packages/raptix/raptix/tools/defense/blue_cell.py", "blue_cell_scan"): "Tool quét Blue Cell: đọc sự kiện, khớp rule và ghi DetectionFired vào graph.",
 ("packages/raptix/raptix/tools/defense/brief.py", "build_defense_brief"): "Tổng hợp số liệu phòng thủ gồm độ phủ, lỗ hổng và phân vị MTTD.",
 ("packages/raptix/raptix/tools/defense/brief.py", "defense_brief"): "Tool sinh báo cáo phòng thủ Markdown từ dữ liệu detection trên graph.",
 ("packages/raptix/raptix/tools/defense/brief.py", "export_attack_navigator"): "Xuất lớp phủ ATT&CK Navigator JSON từ báo cáo phòng thủ.",
 ("packages/raptix/raptix/tools/contracts/patterns.py", "scan_solidity_source"): "Quét mã nguồn Solidity bằng regex tìm mẫu lỗ hổng và trả về danh sách phát hiện.",
 ("packages/raptix/raptix/tools/contracts/slither.py", "ingest_slither_json"): "Nạp payload Slither JSON vào knowledge graph với khử trùng lặp ổn định.",
 ("packages/raptix/raptix/tools/contracts/slither.py", "ingest_slither_file"): "Đọc file Slither JSON rồi nạp vào knowledge graph.",
 ("packages/raptix/raptix/tools/verification.py", "validate_workspace_finding"): "Chạy PoC và đối chứng baseline trong sandbox để xác thực finding cấp workspace.",
 ("packages/raptix/raptix/tools/proxy/tools.py", "proxy_list_requests"): "Liệt kê request HTTP đã chặn được trong proxy Caido.",
 ("packages/raptix/raptix/tools/proxy/tools.py", "proxy_send_request"): "Gửi request tùy chỉnh qua proxy Caido để kiểm thử thủ công.",
 ("packages/raptix/raptix/tools/research/health.py", "backend_health"): "Trả về trạng thái sức khỏe backend Neo4j gồm revision và thống kê.",
 ("packages/raptix/raptix/blue_cell/tap.py", "_parse_line_to_event"): "Phân tích một dòng log tmux thành sự kiện TapEvent có cấu trúc.",
 ("packages/raptix/raptix/blue_cell/rule_match.py", "load_rules"): "Tải quy tắc phát hiện từ file JSON hoặc JSONL vào RuleMatcher.",
 ("packages/raptix/raptix/blue_cell/rule_match.py", "score_mttd"): "Tính thời gian phát hiện trung bình MTTD từ danh sách sự kiện.",
}

CLASS_META = {
 ("packages/raptix/raptix/blue_cell/rule_match.py", "DetectionRule"): ("Mô hình quy tắc phát hiện với selection, điều kiện boolean và khung thời gian.", ["detection-rule", "data-model", "blue-cell"]),
 ("packages/raptix/raptix/blue_cell/rule_match.py", "DetectionEvent"): ("Sự kiện telemetry chuẩn hóa dùng cho khớp quy tắc, kèm hàm tính MTTD.", ["telemetry-event", "data-model", "mttd"]),
 ("packages/raptix/raptix/blue_cell/rule_match.py", "RuleMatcher"): ("Bộ khớp quy tắc: nạp rule, khớp từng sự kiện và trả về phát hiện.", ["rule-engine", "detection", "matcher"]),
 ("packages/raptix/raptix/blue_cell/tap.py", "TapEvent"): ("Sự kiện đọc từ tap với timestamp, nguồn và payload, chuyển được thành dict.", ["event-model", "telemetry", "data-model"]),
 ("packages/raptix/raptix/blue_cell/tap.py", "BlueCellTap"): ("Đầu đọc log tmux của Blue Cell: liệt kê session, đọc batch và theo dõi luồng sự kiện.", ["event-tap", "tmux-logs", "blue-cell"]),
 ("packages/raptix/raptix/tools/proxy/tools.py", "CaidoError"): ("Ngoại lệ chuẩn cho mọi lỗi gọi Caido proxy.", ["error-model", "caido-proxy", "exception"]),
 ("packages/raptix/raptix/tools/proxy/tools.py", "CaidoConfig"): ("Cấu hình kết nối Caido đọc từ biến môi trường qua from_env.", ["configuration", "caido-proxy", "env-config"]),
 ("packages/raptix/raptix/tools/proxy/tools.py", "CaidoClient"): ("Client gọi Caido: truy vấn request, gửi/lặp request và đọc sitemap.", ["api-client", "caido-proxy", "http-testing"]),
 ("packages/raptix/raptix/tools/research/chain.py", "ChainStep"): ("Một bước trong chuỗi tấn công gồm node, cạnh và chi phí.", ["attack-chain", "data-model", "path-step"]),
 ("packages/raptix/raptix/tools/research/chain.py", "Chain"): ("Chuỗi tấn công hoàn chỉnh với nhãn, tóm tắt và chuyển đổi dict.", ["attack-chain", "data-model", "path-planning"]),
 ("packages/raptix/raptix/tools/research/_state.py", "_LegacyStoreShim"): ("Shim tương thích kho cũ: bọc KGStore, persistence file và batch upsert.", ["compatibility-shim", "kg-store", "persistence"]),
 ("packages/raptix/raptix/tools/contracts/foundry.py", "FoundryHarness"): ("Mô hình harness Foundry sinh ra từ template kiểm thử.", ["foundry", "test-harness", "data-model"]),
 ("packages/raptix/raptix/tools/contracts/patterns.py", "ContractFinding"): ("Phát hiện quét pattern Solidity kèm rule, dòng và severity.", ["finding-model", "solidity", "static-analysis"]),
 ("packages/raptix/raptix/tools/contracts/patterns.py", "_Pattern"): ("Định nghĩa nội bộ một pattern regex quét Solidity.", ["pattern-def", "solidity", "internal"]),
 ("packages/raptix/raptix/tools/contracts/slither.py", "_IngestState"): ("Trạng thái nạp Slither: gom quan sát, khử trùng lặp và tạo cạnh.", ["ingest-state", "slither", "dedupe"]),
 ("packages/raptix/raptix/tools/research/dedupe.py", "DuplicateVerdict"): ("Phán quyết trùng lặp cho một cặp phát hiện.", ["verdict-model", "dedupe", "data-model"]),
 ("packages/raptix/raptix/tools/research/dedupe.py", "_Signature"): ("Chữ ký nội bộ dùng so khớp trùng lặp finding.", ["signature", "dedupe", "internal"]),
 ("packages/raptix/raptix/tools/research/poc.py", "AV"): ("Enum vector tấn công AV trong CVSS 3.1.", ["cvss", "enum", "scoring"]),
 ("packages/raptix/raptix/tools/research/poc.py", "AC"): ("Enum độ phức tạp tấn công AC trong CVSS 3.1.", ["cvss", "enum", "scoring"]),
 ("packages/raptix/raptix/tools/research/poc.py", "PR"): ("Enum quyền yêu cầu PR trong CVSS 3.1.", ["cvss", "enum", "scoring"]),
 ("packages/raptix/raptix/tools/research/poc.py", "UI"): ("Enum tương tác người dùng UI trong CVSS 3.1.", ["cvss", "enum", "scoring"]),
 ("packages/raptix/raptix/tools/research/poc.py", "Scope"): ("Enum phạm vi Scope trong CVSS 3.1.", ["cvss", "enum", "scoring"]),
 ("packages/raptix/raptix/tools/research/poc.py", "Impact"): ("Enum mức ảnh hưởng C/I/A trong CVSS 3.1.", ["cvss", "enum", "scoring"]),
 ("packages/raptix/raptix/tools/research/poc.py", "CVSSVector"): ("Vector CVSS 3.1 có cấu trúc với ba nhóm metric và tính điểm.", ["cvss", "scoring", "data-model"]),
 ("packages/raptix/raptix/tools/research/poc.py", "PoCResult"): ("Kết quả xác thực PoC kèm phân loại và bằng chứng output.", ["poc-result", "verification", "data-model"]),
 ("packages/raptix/raptix/tools/research/tech_detection.py", "_Signature"): ("Định nghĩa nội bộ một signature nhận diện công nghệ.", ["signature", "fingerprinting", "internal"]),
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

# exports theo file tu extraction
exports_by_file = {}
for fp, r in results.items():
    ex = r.get("exports") or []
    exports_by_file[fp] = {e["name"] for e in ex}

funcs_by_file = {}
for fp, r in results.items():
    funcs_by_file[fp] = {f["name"]: f for f in (r.get("functions") or [])}

# ---------- file nodes + function/class nodes ----------
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
        if lines < 10 and not is_exp:
            continue
        key = (fp, fname)
        if key in FUNC_SUMMARY_OVERRIDE:
            s1 = FUNC_SUMMARY_OVERRIDE[key]
            summ = s1 + (" Được export để agent và module khác gọi trực tiếp." if is_exp else "")
        else:
            summ = vi_func_summary(fname, fp, lines, is_exp)
        dom = domain_of(fp)
        verb = fname.lstrip("_").split("_")[0].lower()
        tag3 = "exported" if is_exp else "internal"
        ftags = [dom, verb if verb else "helper", tag3]
        # dam bao 3 tags, lowercase hyphenated
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
        if len(c["methods"]) < 2 and lines < 20 and not is_exp:
            continue
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

# ---------- imports edges 1:1 ----------
import_total = 0
for f in batch_files:
    fp = f["path"]
    for dst in batch_import.get(fp, []):
        add_edge("file:" + fp, "file:" + dst, "imports", 0.7)
        import_total += 1

# ---------- calls edges tu callGraph + import/neighbor evidence ----------
# ten export -> loai (function/class) cho file trong batch
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

calls_added = 0
for f in batch_files:
    fp = f["path"]
    r = results[fp]
    cg = r.get("callGraph") or []
    local_names = set(funcs_by_file.get(fp, {})) | {c["name"] for c in classes_by_file.get(fp, [])}
    imported = batch_import.get(fp, [])
    for e in cg:
        caller, callee = e.get("caller"), e.get("callee")
        if not caller or not callee:
            continue
        if any(ch in callee for ch in ".()[]\"' "):
            continue
        if caller not in funcs_by_file.get(fp, {}):
            continue  # caller phai la node da tao (bo qua method-level caller)
        if callee in local_names:
            continue  # chi calls lien file
        # tim file dich trong imports co export ten nay
        target_fp = None
        kind = None
        for cand in imported:
            if cand in name_kind_in_file and callee in name_kind_in_file[cand]:
                target_fp = cand
                kind = name_kind_in_file[cand][callee]
                break
        if target_fp is None:
            # thu neighbor symbols cua file dich da import
            for cand in imported:
                syms = neighbor_symbols.get(cand, {})
                # khong co neighbor map cho file dich cross-batch? dung map cua src
                pass
            src_syms = neighbor_symbols.get(fp, {})
            if callee in src_syms:
                tpath = src_syms[callee]
                if tpath in imported:
                    target_fp = tpath
                    kind = "class" if callee[:1].isupper() else "function"
        if target_fp is None:
            continue
        src_id = f"function:{fp}:{caller}"
        tgt_id = f"{kind}:{target_fp}:{callee}"
        if src_id in seen_ids:
            add_edge(src_id, tgt_id, "calls", 0.8)
            calls_added += 1

# dedupe edges (source, target, type)
uniq = {}
for e in edges:
    uniq[(e["source"], e["target"], e["type"])] = e
edges = list(uniq.values())

# ---------- ghi output ----------
out = {
    "batchIndex": BATCH_INDEX,
    "batchFiles": [{"path": f["path"], "language": f["language"], "sizeLines": f["sizeLines"], "fileCategory": f["fileCategory"]} for f in batch_files],
    "nodes": nodes,
    "edges": edges,
}
op = UA_DIR / "intermediate" / "batch-3.json"
op.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")

n_imports = sum(1 for e in edges if e["type"] == "imports")
n_contains = sum(1 for e in edges if e["type"] == "contains")
n_exports = sum(1 for e in edges if e["type"] == "exports")
n_calls = sum(1 for e in edges if e["type"] == "calls")
print(f"nodes={len(nodes)} edges={len(edges)} files={len(batch_files)}")
print(f"imports={n_imports} (expected {import_total}) contains={n_contains} exports={n_exports} calls={n_calls}")
print("wrote", op, op.stat().st_size, "bytes")
# kiem tra JSON hop le
json.load(open(op, encoding="utf-8"))
print("JSON valid")
