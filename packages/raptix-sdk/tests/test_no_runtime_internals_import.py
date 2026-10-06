"""SDK must not import private runtime internals (repo_invariant §36).

``raptix-sdk`` may import ``raptix_core.*`` and its own ``raptix_sdk.*``
surface. Importing ``raptix.*`` (the runtime package) would couple the
public plugin-author API to framework internals that change without
notice and pull in heavyweight dependencies (LangChain, LangGraph,
httpx, etc.) for every plugin consumer.

Uses static AST analysis so the check runs without the runtime installed.
"""

from __future__ import annotations

import ast
from pathlib import Path

_SDK_ROOT = Path(__file__).resolve().parent.parent / "raptix_sdk"

_ALLOWED_PREFIXES = frozenset({
    "raptix_core",
    "raptix_sdk",
})

_FORBIDDEN_PREFIX = "raptix."


def _collect_imports(path: Path) -> list[tuple[Path, int, str]]:
    violations: list[tuple[Path, int, str]] = []
    for py_file in _SDK_ROOT.rglob("*.py"):
        try:
            tree = ast.parse(py_file.read_text(encoding="utf-8"), filename=str(py_file))
        except SyntaxError:
            continue
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    if _is_forbidden(alias.name):
                        violations.append((py_file.relative_to(path), node.lineno, alias.name))
            elif isinstance(node, ast.ImportFrom) and node.module:
                if _is_forbidden(node.module):
                    violations.append((py_file.relative_to(path), node.lineno, node.module))
    return violations


def _is_forbidden(module_name: str) -> bool:
    if not module_name.startswith("raptix"):
        return False
    top = module_name.split(".")[0]
    return top not in _ALLOWED_PREFIXES


def test_sdk_does_not_import_runtime_internals() -> None:
    violations = _collect_imports(_SDK_ROOT.parent)
    if violations:
        detail = "\n".join(
            f"  {path}:{line} imports {mod!r}"
            for path, line, mod in violations
        )
        raise AssertionError(
            f"raptix-sdk must not import runtime internals (repo_invariant §36).\n"
            f"Found {len(violations)} violation(s):\n{detail}"
        )
