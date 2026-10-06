"""Apps must not contain Python runtime modules (repo_invariant §36).

``apps/`` houses TypeScript (CLI/Web/Desktop) and Go (Launcher) clients.
If a ``.py`` file is ever added under ``apps/``, this test fails loudly —
the file must either justify its placement (build tool, code generator)
and be added to the allowlist, or be moved to the appropriate package.

Allowed exceptions are standalone build/codegen scripts that import only
``raptix_core`` types (never private ``raptix.*`` runtime internals).
"""

from __future__ import annotations

import ast
from pathlib import Path

_APPS_ROOT = Path(__file__).resolve().parent.parent / "apps"

_ALLOWED_SCRIPTS = frozenset(
    {
        Path("web/tools/capture-runtime.py"),
        Path("web/tools/generate-planning-schemas.py"),
    }
)

_FORBIDDEN_PREFIX = "raptix."
_ALLOWED_PREFIXES = frozenset({"raptix_core", "raptix_sdk"})


def _is_forbidden_import(module_name: str) -> bool:
    if not module_name.startswith("raptix"):
        return False
    top = module_name.split(".")[0]
    return top not in _ALLOWED_PREFIXES


def test_apps_have_no_private_runtime_imports() -> None:
    violations: list[tuple[Path, int, str]] = []
    for py_file in _APPS_ROOT.rglob("*.py"):
        rel = py_file.relative_to(_APPS_ROOT)
        if rel in _ALLOWED_SCRIPTS:
            try:
                tree = ast.parse(py_file.read_text(encoding="utf-8"), filename=str(py_file))
            except SyntaxError:
                continue
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    for alias in node.names:
                        if _is_forbidden_import(alias.name):
                            violations.append((rel, node.lineno, alias.name))
                elif isinstance(node, ast.ImportFrom) and node.module:
                    if _is_forbidden_import(node.module):
                        violations.append((rel, node.lineno, node.module))
            continue

        violations.append((rel, 0, "<unexpected Python file under apps/>"))

    if violations:
        detail = "\n".join(f"  apps/{path}:{line} — {mod}" for path, line, mod in violations)
        raise AssertionError(
            f"apps/ must not contain Python runtime logic (repo_invariant §36).\n"
            f"Found {len(violations)} violation(s):\n{detail}\n"
            f"If a new build script is legitimate, add it to _ALLOWED_SCRIPTS "
            f"and ensure it imports only raptix_core/raptix_sdk, never raptix.*."
        )
