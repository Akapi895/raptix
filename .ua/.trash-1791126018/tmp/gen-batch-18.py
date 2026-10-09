#!/usr/bin/env python3
"""Generate UA batch-18.json (benchmark harness, providers, schemas, reporter, runner, scorer + tests)."""
import io
import json
import os
import re

UA = r"D:\.VTNet\redteam\raptix\.ua"
ROOT = r"D:\.VTNet\redteam\raptix"
IDX = 18
batches = json.load(io.open(os.path.join(UA, "intermediate", "batches.json"), encoding="utf-8"))
b = [x for x in batches["batches"] if x.get("batchIndex") == IDX][0]
ext = json.load(io.open(os.path.join(UA, "tmp", "ua-file-extract-results-%d.json" % IDX), encoding="utf-8"))
results = {r["path"]: r for r in ext["results"]}

FILE_META = {
    "benchmark/__init__.py": ("Barrel gói benchmark: điểm vào package, re-export cấu hình và schema.", ["barrel", "entry-point", "benchmark"], ""),
    "benchmark/__main__.py": ("Điểm vào chạy benchmark qua runner (python -m benchmark).", ["entry-point", "benchmark", "cli"], ""),
    "benchmark/config.py": ("Cấu hình benchmark: URL LangGraph/LiteLLM mặc định từ env và BenchmarkConfig.", ["cấu-hình", "benchmark", "env"], ""),
    "benchmark/harness.py": ("Harness chạy challenge: gọi docker, dựng kickoff prompt, cộng token usage, truy vấn cost và provision workspace.", ["harness", "benchmark", "thực-thi"], "Python: cùng pattern StreamingEngine phía agent, đo lường cost theo window."),
    "benchmark/provenance.py": ("Ghi provenance lượt chạy: model assignments, image container, git, hash artifact và sanitize config.", ["provenance", "tái-lập", "benchmark"], ""),
    "benchmark/providers/__init__.py": ("Barrel providers: gom base và các provider benchmark.", ["barrel", "benchmark", "provider"], ""),
    "benchmark/providers/base.py": ("Lớp cơ sở BaseBenchmarkProvider cho mọi provider benchmark.", ["provider", "lớp-cơ-sở", "benchmark"], ""),
    "benchmark/providers/buttercup.py": ("Provider Buttercup: xác định challenges root, ensure upstream git và đọc metadata challenge.", ["provider", "buttercup", "benchmark"], ""),
    "benchmark/providers/cybench.py": ("Provider CyBench: quét task docker từ thư mục benchmarks.", ["provider", "cybench", "benchmark"], ""),
    "benchmark/providers/cybergym.py": ("Provider CyberGym: nạp spec YAML, phát hiện crash và kiểm tra fix còn hiệu lực.", ["provider", "cybergym", "benchmark"], ""),
    "benchmark/providers/exploitbench.py": ("Provider ExploitBench: parse năm từ bug id, phân loại subsystem và lặp JSON cân bằng.", ["provider", "exploitbench", "benchmark"], ""),
    "benchmark/providers/exploitbench_capabilities.py": ("Chấm capability ExploitBench: tier tốt nhất, điểm số, trung bình và hợp nhất.", ["capability", "chấm-điểm", "exploitbench"], ""),
    "benchmark/providers/mhbench.py": ("Provider MHBench OpenStack: snapshot/spec topology, SSH key, chọn flag target và topology sinh sẵn.", ["provider", "mhbench", "openstack"], "Python: module lớn nhất benchmark, quản lý vòng đời topology ngoài."),
    "benchmark/providers/xbow.py": ("Provider XBOW: nạp challenge từ file benchmark.json mỗi thư mục.", ["provider", "xbow", "benchmark"], ""),
    "benchmark/reporter.py": ("Reporter kết quả batch: ghi JSON và markdown kèm provenance.", ["báo-cáo", "benchmark", "kết-quả"], ""),
    "benchmark/runner.py": ("Runner điều phối benchmark: dựng provider và provenance, chạy tuần tự, async và song song.", ["runner", "điều-phối", "benchmark"], ""),
    "benchmark/schemas.py": ("Schema Pydantic benchmark: Challenge, SetupResult, ChallengeResult, provenance, report, filter và env/spec.", ["schema", "pydantic", "benchmark"], ""),
    "benchmark/scorer.py": ("Scorer: chấm điểm theo level/tag và thời gian hoàn thành.", ["chấm-điểm", "benchmark", "kết-quả"], ""),
    "benchmark/state.py": ("State benchmark: BenchmarkStepResult và BenchmarkRunState.", ["trạng-thái", "benchmark", "state"], ""),
    "packages/raptix/tests/unit/benchmark/test_cybench_provider.py": ("Kiểm thử provider CyBench: phát hiện task docker và đánh giá.", ["test", "pytest", "cybench"], ""),
    "packages/raptix/tests/unit/benchmark/test_cybergym_provider.py": ("Kiểm thử provider CyberGym: nạp task từ spec và kickoff PoC.", ["test", "pytest", "cybergym"], ""),
    "packages/raptix/tests/unit/benchmark/test_harness.py": ("Kiểm thử Harness: chạy challenge với docker/docker giả và provider giả.", ["test", "pytest", "harness"], ""),
    "packages/raptix/tests/unit/benchmark/test_harness_cost.py": ("Kiểm thử truy vấn cost của Harness: cộng spend, non-200, rỗng và bỏ qua non-numeric.", ["test", "pytest", "cost"], ""),
    "packages/raptix/tests/unit/benchmark/test_mhbench_provider.py": ("Kiểm thử provider MHBench: flag, SSH key, topology ngoài và registry.", ["test", "pytest", "mhbench"], ""),
    "packages/raptix/tests/unit/benchmark/test_provenance.py": ("Kiểm thử provenance: ghi source artifact, model assignments, image container và nối vào reporter/runner.", ["test", "pytest", "provenance"], ""),
    "packages/raptix/tests/unit/benchmark/test_schemas.py": ("Kiểm thử schema benchmark: tạo Challenge/Result/Report/Filter và flag pattern.", ["test", "pytest", "schema"], ""),
    "packages/raptix/tests/unit/benchmark/test_scorer.py": ("Kiểm thử Scorer với kết quả pha trộn.", ["test", "pytest", "scorer"], ""),
    "packages/raptix/tests/unit/benchmark/test_xbow_provider.py": ("Kiểm thử provider XBOW: nạp challenge, hash flag và đánh giá.", ["test", "pytest", "xbow"], ""),
}

FN_META = {
    ("benchmark/config.py", "_default_langgraph_url"): ("URL LangGraph mặc định từ env cho benchmark.", ["cấu-hình", "langgraph", "env"]),
    ("benchmark/config.py", "_default_litellm_url"): ("URL LiteLLM mặc định từ env cho benchmark.", ["cấu-hình", "litellm", "env"]),
    ("benchmark/harness.py", "_run_docker"): ("Chạy lệnh docker qua subprocess, cảnh báo khi thiếu binary.", ["docker", "subprocess", "harness"]),
    ("benchmark/harness.py", "_sum_token_usage"): ("Cộng token usage từ messages.", ["token", "usage", "tổng-hợp"]),
    ("benchmark/harness.py", "_build_kickoff_prompt"): ("Dựng prompt kickoff cho challenge.", ["prompt", "kickoff", "challenge"]),
    ("benchmark/provenance.py", "capture_declared_model_assignments"): ("Ghi nhận model assignments đã khai báo, kiểm tra priority container.", ["provenance", "model", "ghi-nhận"]),
    ("benchmark/provenance.py", "capture_container_images"): ("Ghi nhận image container: ưu tiên registry digest, giữ image id local.", ["provenance", "container", "image"]),
    ("benchmark/provenance.py", "_git"): ("Chạy lệnh git lấy thông tin nguồn.", ["git", "provenance", "nguồn"]),
    ("benchmark/provenance.py", "_artifact_hash"): ("Hash artifact, bỏ qua cache Python sinh ra.", ["hash", "artifact", "provenance"]),
    ("benchmark/provenance.py", "_sanitize"): ("Sanitize config khỏi secret trước khi ghi provenance.", ["sanitize", "bảo-mật", "provenance"]),
    ("benchmark/provenance.py", "_benchmark_revisions"): ("Ghi nhận revision benchmark.", ["revision", "provenance", "benchmark"]),
    ("benchmark/provenance.py", "capture_run_provenance"): ("Ghi toàn bộ provenance một lượt chạy benchmark.", ["provenance", "lượt-chạy", "tái-lập"]),
    ("benchmark/providers/buttercup.py", "_challenges_root"): ("Thư mục challenges gốc của Buttercup.", ["buttercup", "challenges", "đường-dẫn"]),
    ("benchmark/providers/buttercup.py", "_ensure_upstream"): ("Ensure upstream git đã clone, tạo thư mục cha khi thiếu.", ["upstream", "git", "đồng-bộ"]),
    ("benchmark/providers/buttercup.py", "_read_challenge_metadata"): ("Đọc metadata challenge từ file JSON.", ["metadata", "challenge", "đọc"]),
    ("benchmark/providers/cybergym.py", "_is_crash"): ("Nhận biết bản ghi có phải crash không.", ["cybergym", "crash", "phát-hiện"]),
    ("benchmark/providers/cybergym.py", "_fix_survives"): ("Kiểm tra fix còn hiệu lực sau chạy.", ["cybergym", "fix", "kiểm-tra"]),
    ("benchmark/providers/exploitbench.py", "_parse_year_from_bug_id"): ("Parse năm từ bug id bằng regex.", ["parse", "bug-id", "năm"]),
    ("benchmark/providers/exploitbench.py", "_classify_subsystem"): ("Phân loại subsystem từ bug id và tags.", ["phân-loại", "subsystem", "tags"]),
    ("benchmark/providers/exploitbench.py", "_iter_balanced_json_objects"): ("Lặp đối tượng JSON cân bằng giữa các nhóm.", ["lặp", "cân-bằng", "json"]),
    ("benchmark/providers/exploitbench_capabilities.py", "best_tier_for_caps"): ("Tier tốt nhất cho capability map.", ["capability", "tier", "chấm-điểm"]),
    ("benchmark/providers/exploitbench_capabilities.py", "capability_score"): ("Điểm số capability.", ["capability", "điểm", "chấm-điểm"]),
    ("benchmark/providers/exploitbench_capabilities.py", "capability_mean"): ("Điểm trung bình capability.", ["capability", "trung-bình", "chấm-điểm"]),
    ("benchmark/providers/exploitbench_capabilities.py", "merge_capabilities"): ("Hợp nhất nhiều capability map.", ["capability", "hợp-nhất", "tổng-hợp"]),
    ("benchmark/providers/mhbench.py", "_load_generated_topologies"): ("Nạp topology sinh sẵn từ thư mục gen.", ["topology", "sinh-sẵn", "nạp"]),
    ("benchmark/providers/mhbench.py", "_workspace_root"): ("Thư mục workspace root cho MHBench.", ["workspace", "đường-dẫn", "mhbench"]),
    ("benchmark/providers/mhbench.py", "_expected_flag"): ("Flag kỳ vọng dạng shape cho challenge.", ["flag", "challenge", "kỳ-vọng"]),
    ("benchmark/providers/mhbench.py", "_resolve_ssh_key_path"): ("Giải quyết đường dẫn SSH key đã stage.", ["ssh", "key", "đường-dẫn"]),
    ("benchmark/providers/mhbench.py", "_resolve_external_topology"): ("Giải quyết topology ngoài từ section cấu hình.", ["topology", "ngoài", "giải-quyết"]),
    ("benchmark/providers/mhbench.py", "_select_flag_target"): ("Chọn flag target cho challenge.", ["flag", "target", "chọn"]),
    ("benchmark/runner.py", "_build_run_provenance"): ("Dựng provenance lượt chạy từ config, filter và runtime inputs.", ["provenance", "runner", "tái-lập"]),
    ("benchmark/runner.py", "_build_provider"): ("Dựng provider theo tên đã chọn.", ["provider", "factory", "runner"]),
    ("benchmark/runner.py", "run"): ("Chạy benchmark theo chế độ đã cấu hình.", ["runner", "chạy", "điều-phối"]),
    ("benchmark/runner.py", "_run_sequential"): ("Chạy tuần tự các challenge.", ["runner", "tuần-tự", "thực-thi"]),
    ("benchmark/runner.py", "_run_sequential_async"): ("Chạy tuần tự bất đồng bộ các challenge.", ["runner", "async", "thực-thi"]),
    ("benchmark/runner.py", "_run_parallel"): ("Chạy song song các challenge.", ["runner", "song-song", "thực-thi"]),
}

CLASS_META = {
    ("benchmark/config.py", "BenchmarkConfig"): ("Cấu hình benchmark: URL dịch vụ, provider và giới hạn chạy.", ["cấu-hình", "benchmark", "data-model"]),
    ("benchmark/harness.py", "AgentResponse"): ("Phản hồi agent trong harness benchmark.", ["harness", "phản-hồi", "data-model"]),
    ("benchmark/harness.py", "_ActiveRun"): ("Trạng thái run đang hoạt động của harness.", ["harness", "run", "trạng-thái"]),
    ("benchmark/harness.py", "Harness"): ("Harness thực thi challenge: setup, kickoff agent, đo lường và cost.", ["harness", "thực-thi", "benchmark"]),
    ("benchmark/provenance.py", "ProvenanceCaptureError"): ("Lỗi ghi provenance.", ["lỗi", "provenance", "ngoại-lệ"]),
    ("benchmark/providers/base.py", "BaseBenchmarkProvider"): ("Giao diện provider benchmark: nạp challenge, setup và evaluate.", ["provider", "lớp-cơ-sở", "benchmark"]),
    ("benchmark/providers/buttercup.py", "ButtercupProvider"): ("Provider nạp challenge Buttercup từ upstream.", ["provider", "buttercup", "benchmark"]),
    ("benchmark/providers/cybench.py", "CybenchProvider"): ("Provider quét task CyBench dạng docker.", ["provider", "cybench", "benchmark"]),
    ("benchmark/providers/cybergym.py", "CyberGymProvider"): ("Provider CyberGym từ spec YAML qua HTTP.", ["provider", "cybergym", "benchmark"]),
    ("benchmark/providers/exploitbench.py", "ExploitBenchProvider"): ("Provider ExploitBench với phân loại subsystem và capability.", ["provider", "exploitbench", "benchmark"]),
    ("benchmark/providers/mhbench.py", "HostInfo"): ("Thông tin host topology MHBench.", ["topology", "host", "data-model"]),
    ("benchmark/providers/mhbench.py", "TopologySnapshot"): ("Ảnh topology tại một thời điểm.", ["topology", "snapshot", "data-model"]),
    ("benchmark/providers/mhbench.py", "TopologySpec"): ("Đặc tả topology MHBench.", ["topology", "spec", "data-model"]),
    ("benchmark/providers/mhbench.py", "MHBenchProvider"): ("Provider MHBench OpenStack: topology, SSH, flag và setup.", ["provider", "mhbench", "openstack"]),
    ("benchmark/providers/mhbench.py", "_OpenStackQueryError"): ("Lỗi truy vấn OpenStack.", ["lỗi", "openstack", "ngoại-lệ"]),
    ("benchmark/providers/mhbench.py", "_SshKeyStageError"): ("Lỗi stage SSH key.", ["lỗi", "ssh", "ngoại-lệ"]),
    ("benchmark/providers/mhbench.py", "_PostSetupError"): ("Lỗi sau setup topology.", ["lỗi", "setup", "ngoại-lệ"]),
    ("benchmark/providers/mhbench.py", "ExternalTopology"): ("Topology ngoài do cấu hình chỉ định.", ["topology", "ngoài", "data-model"]),
    ("benchmark/providers/xbow.py", "XBOWProvider"): ("Provider XBOW từ benchmark.json.", ["provider", "xbow", "benchmark"]),
    ("benchmark/reporter.py", "Reporter"): ("Ghi báo cáo batch JSON/markdown kèm provenance.", ["báo-cáo", "benchmark", "kết-quả"]),
    ("benchmark/schemas.py", "Challenge"): ("Schema challenge benchmark.", ["schema", "challenge", "pydantic"]),
    ("benchmark/schemas.py", "SetupResult"): ("Kết quả setup challenge.", ["schema", "setup", "pydantic"]),
    ("benchmark/schemas.py", "ChallengeResult"): ("Kết quả một challenge.", ["schema", "kết-quả", "pydantic"]),
    ("benchmark/schemas.py", "RunProvenance"): ("Provenance một lượt chạy.", ["schema", "provenance", "pydantic"]),
    ("benchmark/schemas.py", "BenchmarkReport"): ("Báo cáo tổng hợp benchmark.", ["schema", "báo-cáo", "pydantic"]),
    ("benchmark/schemas.py", "FilterConfig"): ("Cấu hình lọc challenge.", ["schema", "lọc", "pydantic"]),
    ("benchmark/schemas.py", "ExploitBenchEnv"): ("Môi trường ExploitBench.", ["schema", "exploitbench", "env"]),
    ("benchmark/schemas.py", "ExploitBenchSpec"): ("Đặc tả ExploitBench.", ["schema", "exploitbench", "spec"]),
    ("benchmark/scorer.py", "Scorer"): ("Chấm điểm benchmark theo level/tag/thời gian.", ["chấm-điểm", "benchmark", "kết-quả"]),
    ("benchmark/state.py", "BenchmarkStepResult"): ("Kết quả một bước benchmark.", ["state", "bước", "benchmark"]),
    ("benchmark/state.py", "BenchmarkRunState"): ("State lượt chạy benchmark.", ["state", "lượt-chạy", "benchmark"]),
}

TEST_PAIRS = [
    ("benchmark/providers/cybench.py", "packages/raptix/tests/unit/benchmark/test_cybench_provider.py"),
    ("benchmark/providers/cybergym.py", "packages/raptix/tests/unit/benchmark/test_cybergym_provider.py"),
    ("benchmark/harness.py", "packages/raptix/tests/unit/benchmark/test_harness.py"),
    ("benchmark/harness.py", "packages/raptix/tests/unit/benchmark/test_harness_cost.py"),
    ("benchmark/providers/mhbench.py", "packages/raptix/tests/unit/benchmark/test_mhbench_provider.py"),
    ("benchmark/provenance.py", "packages/raptix/tests/unit/benchmark/test_provenance.py"),
    ("benchmark/reporter.py", "packages/raptix/tests/unit/benchmark/test_provenance.py"),
    ("benchmark/runner.py", "packages/raptix/tests/unit/benchmark/test_provenance.py"),
    ("benchmark/schemas.py", "packages/raptix/tests/unit/benchmark/test_schemas.py"),
    ("benchmark/scorer.py", "packages/raptix/tests/unit/benchmark/test_scorer.py"),
    ("benchmark/providers/xbow.py", "packages/raptix/tests/unit/benchmark/test_xbow_provider.py"),
]

TEST_FILE_PROD = {}
for _p, _t in TEST_PAIRS:
    TEST_FILE_PROD.setdefault(_t, _p)


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
    if name.startswith("_") and not name.startswith("__"):
        return ("Hàm nội bộ %s (%d dòng) trong %s." % (name, lines, base),
                ["nội-bộ", "python", path.split("/")[-2]])
    return ("Hàm %s (%d dòng) trong %s." % (name, lines, base),
            ["tiện-ích", "python", path.split("/")[-2]])


def fallback_class(path, name, lines, methods, is_test):
    base = path.split("/")[-1]
    if is_test or name.startswith("Test"):
        return test_class_summary(name, path), test_class_tags(name)
    if name.endswith("Error"):
        return ("Ngoại lệ %s (%d dòng) trong %s." % (name, lines, base), ["lỗi", "ngoại-lệ", "python"])
    if name.startswith("_"):
        return ("Lớp nội bộ %s (%d dòng) trong %s." % (name, lines, base), ["nội-bộ", "python", "data-model"])
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
