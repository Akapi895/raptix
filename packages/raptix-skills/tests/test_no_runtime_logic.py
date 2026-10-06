"""Skill corpus must not contain runtime logic (repo_invariant §36).

``raptix-skills`` is a knowledge/content package: SKILL.md files with
metadata. The only Python files allowed are ``__init__.py`` modules and
standalone helper scripts collocated with specific skill definitions
(e.g. parsing scripts in ``defs/*/scripts/``). These helper scripts
must not import any ``raptix`` package — they are standalone utilities.

If a ``.py`` file defines classes or functions with substantial bodies
outside the allowed patterns, the skill corpus is leaking runtime logic.
"""

from __future__ import annotations

import ast
from pathlib import Path

_SKILLS_ROOT = Path(__file__).resolve().parent.parent / "raptix_skills"


def _is_raptix_import(module_name: str) -> bool:
    return module_name.startswith(("raptix.", "raptix_core", "raptix_sdk"))


def test_skills_have_no_raptix_imports() -> None:
    """No .py file in the skill corpus may import raptix packages."""
    violations: list[tuple[Path, int, str]] = []
    for py_file in _SKILLS_ROOT.rglob("*.py"):
        if py_file.name == "__init__.py":
            continue
        try:
            tree = ast.parse(py_file.read_text(encoding="utf-8"), filename=str(py_file))
        except SyntaxError:
            continue
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    if _is_raptix_import(alias.name):
                        violations.append(
                            (py_file.relative_to(_SKILLS_ROOT), node.lineno, alias.name)
                        )
            elif isinstance(node, ast.ImportFrom) and node.module:
                if _is_raptix_import(node.module):
                    violations.append((py_file.relative_to(_SKILLS_ROOT), node.lineno, node.module))

    if violations:
        detail = "\n".join(f"  {path}:{line} imports {mod!r}" for path, line, mod in violations)
        raise AssertionError(
            f"raptix-skills must not import raptix packages (repo_invariant §36).\n"
            f"Found {len(violations)} violation(s):\n{detail}"
        )
