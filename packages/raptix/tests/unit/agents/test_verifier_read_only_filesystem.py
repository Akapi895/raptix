from __future__ import annotations

from raptix.intelligence.agents.middleware_slots import _make_filesystem


def _tool_names(role: str | None) -> set[str]:
    middleware = _make_filesystem(backend=None, role=role)
    return {tool.name for tool in middleware.tools}


def test_verifier_filesystem_has_no_write_tools() -> None:
    names = _tool_names("verifier")

    assert "write_file" not in names
    assert "edit_file" not in names


def test_verifier_filesystem_keeps_read_tools() -> None:
    names = _tool_names("verifier")

    assert {"ls", "read_file", "glob", "grep"} <= names


def test_other_roles_keep_write_tools() -> None:
    names = _tool_names("exploit")

    assert {"write_file", "edit_file"} <= names
