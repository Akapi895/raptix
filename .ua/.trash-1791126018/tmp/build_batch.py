#!/usr/bin/env python3
"""Assemble batch-<idx>.json for the Raptix UA file-analyzer run (batches 31-35).

Reads the deterministic extract-structure.mjs output plus LLM-authored
annotations (Vietnamese summaries/tags) and emits the final GraphFragment:
  { batchIndex, batchFiles (verbatim 4 fields), nodes, edges }

Edge contract (matches agents/file-analyzer.md + batches 1-30 precedent):
  contains  1.0  file -> symbol (all emitted symbol nodes)
  exports   0.8  file -> symbol (only symbols in the extractor's exports list)
  imports   0.7  1:1 batchImportData (never aggregated)
  calls     0.8  from callGraph, resolved same-file -> imports -> aliases -> neighborMap
  tested_by 0.5  production -> test (derived from test files' batchImportData)
  inherits / implements 0.9 (only via annotations.extraEdges when grounded)
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

PROJECT_ROOT = Path(r"D:\.VTNet\redteam\raptix")
UA_DIR = PROJECT_ROOT / ".ua"
TMP = UA_DIR / "tmp"
INTERMEDIATE = UA_DIR / "intermediate"
BATCHES_JSON = INTERMEDIATE / "batches.json"

EDGE_WEIGHTS = {
    "contains": 1.0,
    "exports": 0.8,
    "imports": 0.7,
    "calls": 0.8,
    "inherits": 0.9,
    "implements": 0.9,
    "depends_on": 0.6,
    "tested_by": 0.5,
}

ID_RE = re.compile(r"^(file|function|class|config|document|service|table|endpoint|pipeline|schema|resource):")
CLASS_DEF_RE_CACHE: dict[str, set[str]] = {}


def load_json(p: Path):
    with p.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def write_json_no_bom(p: Path, obj) -> None:
    text = json.dumps(obj, ensure_ascii=False, indent=2)
    with p.open("w", encoding="utf-8", newline="\n") as fh:
        fh.write(text + "\n")


def class_names_in_file(abs_path: Path) -> set[str]:
    key = str(abs_path)
    if key in CLASS_DEF_RE_CACHE:
        return CLASS_DEF_RE_CACHE[key]
    names: set[str] = set()
    try:
        text = abs_path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        CLASS_DEF_RE_CACHE[key] = names
        return names
    for m in re.finditer(r"(?m)^\s*(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)", text):
        names.add(m.group(1))
    CLASS_DEF_RE_CACHE[key] = names
    return names


def kind_for_symbol(path: str, name: str, exports_by_path: dict) -> str:
    if name in class_names_in_file(PROJECT_ROOT / path):
        return "class"
    return "function"


def is_test_path(path: str) -> bool:
    parts = path.replace("\\", "/").split("/")
    base = parts[-1]
    if "/tests/" in path or "/test/" in path:
        return True
    return base.startswith("test_") or base.endswith("_test.go") or ".test." in base or base.endswith("_spec.ts")


class Builder:
    def __init__(self, idx: int, ann: dict, batches_doc: dict):
        self.idx = idx
        self.ann = ann
        self.exports_by_path = batches_doc.get("exportsByPath", {})
        batch = next(b for b in batches_doc["batches"] if b["batchIndex"] == idx)
        self.batch_files = batch["files"]
        self.batch_import_data = batch["batchImportData"]
        self.neighbor_map = batch.get("neighborMap", {}) or {}

        self.extract = load_json(TMP / f"ua-file-analyzer-output-{idx}.json")
        self.results_by_path = {r["path"]: r for r in self.extract["results"]}

        self.nodes = []
        self.node_ids = set()
        self.edges = []
        self.edge_keys = set()
        # per-file symbol tables
        self.file_symbols: dict[str, dict[str, str]] = {}  # path -> name -> node id
        self.file_methods: dict[str, dict[str, list[str]]] = {}  # path -> method -> [class node ids]
        self.file_node_ids: dict[str, str] = {}
        self.exports_of_file: dict[str, set[str]] = {}

        self.aliases: dict[str, str] = dict(ann.get("aliases", {}))
        self.extra_imports: dict[str, list[str]] = dict(ann.get("extraImports", {}))

    # ------------------------------------------------------------------ nodes
    def add_node(self, node: dict) -> None:
        if node["id"] in self.node_ids:
            raise ValueError(f"duplicate node id: {node['id']}")
        self.node_ids.add(node["id"])
        self.nodes.append(node)

    def meta(self, kind: str, key: str) -> dict:
        table = self.ann[kind]
        if key not in table:
            raise ValueError(f"missing annotation for {kind}: {key}")
        m = table[key]
        out = {"summary": m["summary"], "tags": m["tags"], "complexity": m["complexity"]}
        if "languageNotes" in m:
            out["languageNotes"] = m["languageNotes"]
        return out

    def build_file_nodes(self) -> None:
        for f in self.batch_files:
            path = f["path"]
            meta = self.meta("files", path)
            name = path.replace("\\", "/").split("/")[-1]
            node = {
                "id": f"file:{path}",
                "type": "file",
                "name": name,
                "filePath": path,
                "summary": meta["summary"],
                "tags": meta["tags"],
                "complexity": meta["complexity"],
            }
            if "languageNotes" in meta:
                node["languageNotes"] = meta["languageNotes"]
            self.add_node(node)
            self.file_node_ids[path] = node["id"]

    def symbol_significant(self, path: str, kind: str, entry: dict) -> bool:
        exported = entry["name"] in self.exports_of_file.get(path, set())
        if exported:
            return True
        lines = entry["endLine"] - entry["startLine"] + 1
        if kind == "function":
            return lines >= 10
        methods = entry.get("methods") or []
        return len(methods) >= 2 or lines >= 20

    def build_symbol_nodes(self) -> None:
        for f in self.batch_files:
            path = f["path"]
            res = self.results_by_path.get(path)
            if not res:
                continue
            exported = {e["name"] for e in res.get("exports") or []}
            self.exports_of_file[path] = exported
            symbols = self.file_symbols.setdefault(path, {})
            methods = self.file_methods.setdefault(path, {})
            entries = []
            for fn in res.get("functions") or []:
                entries.append(("function", fn))
            for cl in res.get("classes") or []:
                entries.append(("class", cl))
            for kind, entry in entries:
                name = entry["name"]
                if kind == "class":
                    for meth in entry.get("methods") or []:
                        methods.setdefault(meth, []).append(name)
                if not self.symbol_significant(path, kind, entry):
                    continue
                sid = f"{kind}:{path}:{name}"
                symbols[name] = sid
                meta = self.meta("symbols", f"{path}::{name}")
                node = {
                    "id": sid,
                    "type": kind,
                    "name": name,
                    "filePath": path,
                    "lineRange": [entry["startLine"], entry["endLine"]],
                    "summary": meta["summary"],
                    "tags": meta["tags"],
                    "complexity": meta["complexity"],
                }
                if "languageNotes" in meta:
                    node["languageNotes"] = meta["languageNotes"]
                self.add_node(node)

    # ------------------------------------------------------------------ edges
    def add_edge(self, source: str, target: str, etype: str, weight: float | None = None) -> None:
        if source == target:
            return
        w = EDGE_WEIGHTS[etype] if weight is None else weight
        key = (source, target, etype)
        if key in self.edge_keys:
            return
        self.edge_keys.add(key)
        self.edges.append({
            "source": source,
            "target": target,
            "type": etype,
            "direction": "forward",
            "weight": w,
        })

    def build_contains_exports(self) -> None:
        for f in self.batch_files:
            path = f["path"]
            fid = self.file_node_ids.get(path)
            if not fid:
                continue
            exported = self.exports_of_file.get(path, set())
            for name, sid in self.file_symbols.get(path, {}).items():
                self.add_edge(fid, sid, "contains")
                if name in exported:
                    self.add_edge(fid, sid, "exports")

    def build_imports(self) -> None:
        for f in self.batch_files:
            path = f["path"]
            fid = self.file_node_ids.get(path)
            if not fid:
                continue
            for target_path in self.batch_import_data.get(path) or []:
                self.add_edge(fid, f"file:{target_path}", "imports")

    def build_tested_by(self) -> None:
        for f in self.batch_files:
            path = f["path"]
            if not is_test_path(path):
                continue
            for target_path in self.batch_import_data.get(path) or []:
                if is_test_path(target_path):
                    continue
                self.add_edge(f"file:{target_path}", f"file:{path}", "tested_by")

    # ------------------------------------------------------------- call graph
    def resolve_undirected(self, src_path: str, name: str) -> str | None:
        # 1. same file
        sid = self.file_symbols.get(src_path, {}).get(name)
        if sid:
            return sid
        # 2. imported files (batchImportData order) then annotation extraImports
        candidates = list(self.batch_import_data.get(src_path) or [])
        candidates += [p for p in self.extra_imports.get(src_path, []) if p not in candidates]
        for cand in candidates:
            if name in self.exports_by_path.get(cand, []):
                kind = kind_for_symbol(cand, name, self.exports_by_path)
                node_id = f"{kind}:{cand}:{name}"
                return node_id if node_id in self.node_ids or True else node_id
        # 3. neighborMap
        for entry in self.neighbor_map.get(src_path) or []:
            if name in (entry.get("symbols") or []):
                kind = kind_for_symbol(entry["path"], name, self.exports_by_path)
                return f"{kind}:{entry['path']}:{name}"
        return None

    def resolve_dotted(self, src_path: str, callee: str) -> str | None:
        head, _, _rest = callee.partition(".")
        base = head.rstrip("()").strip()
        attr = callee.rstrip("()").split(".")[-1]
        if not base:
            return None
        # 1. same-file symbol (Class.method / func.attr patterns)
        sid = self.file_symbols.get(src_path, {}).get(base)
        if sid:
            return sid
        # 2. explicit alias -> module file
        alias_path = self.aliases.get(base)
        if alias_path:
            if attr in self.exports_by_path.get(alias_path, []):
                kind = kind_for_symbol(alias_path, attr, self.exports_by_path)
                return f"{kind}:{alias_path}:{attr}"
            return None
        # 3. imported file whose stem matches the base identifier
        candidates = list(self.batch_import_data.get(src_path) or [])
        candidates += [p for p in self.extra_imports.get(src_path, []) if p not in candidates]
        for cand in candidates:
            stem = cand.replace("\\", "/").split("/")[-1]
            stem = re.sub(r"\.(py|ts|tsx|js|mjs|go)$", "", stem)
            if stem == base and attr in self.exports_by_path.get(cand, []):
                kind = kind_for_symbol(cand, attr, self.exports_by_path)
                return f"{kind}:{cand}:{attr}"
        # 4. imported file exporting the base symbol itself (Class.method /
        #    imported-function attribute access like `tool.ainvoke`)
        for cand in candidates:
            if base in self.exports_by_path.get(cand, []):
                kind = kind_for_symbol(cand, base, self.exports_by_path)
                return f"{kind}:{cand}:{base}"
        return None

    def resolve_caller(self, src_path: str, caller: str) -> str | None:
        sid = self.file_symbols.get(src_path, {}).get(caller)
        if sid:
            return sid
        owners = self.file_methods.get(src_path, {}).get(caller) or []
        if len(owners) == 1:
            cls_name = owners[0]
            return self.file_symbols.get(src_path, {}).get(cls_name)
        return None

    def build_calls(self) -> None:
        for f in self.batch_files:
            path = f["path"]
            res = self.results_by_path.get(path)
            if not res:
                continue
            for entry in res.get("callGraph") or []:
                caller = entry["caller"]
                callee = entry["callee"]
                src = self.resolve_caller(path, caller)
                if not src:
                    continue
                if "." in callee:
                    tgt = self.resolve_dotted(path, callee)
                else:
                    tgt = self.resolve_undirected(path, callee)
                if not tgt:
                    continue
                self.add_edge(src, tgt, "calls")

    def build_extra_edges(self) -> None:
        for e in self.ann.get("extraEdges", []):
            self.add_edge(e["source"], e["target"], e["type"], e.get("weight"))

    # ------------------------------------------------------------------ run
    def run(self) -> dict:
        self.build_file_nodes()
        self.build_symbol_nodes()
        self.build_contains_exports()
        self.build_imports()
        self.build_tested_by()
        self.build_calls()
        self.build_extra_edges()

        # ------------------------------------------------------------ validate
        expected_imports = sum(len(v or []) for v in self.batch_import_data.values())
        actual_imports = sum(1 for e in self.edges if e["type"] == "imports")
        assert actual_imports == expected_imports, (
            f"imports mismatch: {actual_imports} != {expected_imports}"
        )
        for n in self.nodes:
            assert ID_RE.match(n["id"]), f"bad id: {n['id']}"
            assert n["summary"], f"empty summary: {n['id']}"
            assert 3 <= len(n["tags"]) <= 5, f"tags out of range: {n['id']}"
            assert n["complexity"] in {"simple", "moderate", "complex"}, n["id"]
        for e in self.edges:
            assert e["source"] != e["target"], f"self edge: {e}"
            assert ID_RE.match(e["source"]) and ID_RE.match(e["target"]), f"bad edge id: {e}"
        doc = {
            "batchIndex": self.idx,
            "batchFiles": self.batch_files,
            "nodes": self.nodes,
            "edges": self.edges,
        }
        out_path = INTERMEDIATE / f"batch-{self.idx}.json"
        write_json_no_bom(out_path, doc)
        by_type_nodes: dict[str, int] = {}
        for n in self.nodes:
            by_type_nodes[n["type"]] = by_type_nodes.get(n["type"], 0) + 1
        by_type_edges: dict[str, int] = {}
        for e in self.edges:
            by_type_edges[e["type"]] = by_type_edges.get(e["type"], 0) + 1
        print(f"batch-{self.idx}: nodes={len(self.nodes)} {by_type_nodes}")
        print(f"batch-{self.idx}: edges={len(self.edges)} {by_type_edges}")
        print(f"batch-{self.idx}: imports {actual_imports}/{expected_imports} OK -> {out_path}")
        return doc


def main() -> None:
    idx = int(sys.argv[1])
    ann_path = Path(sys.argv[2])
    ann = load_json(ann_path)
    batches_doc = load_json(BATCHES_JSON)
    Builder(idx, ann, batches_doc).run()


if __name__ == "__main__":
    main()
