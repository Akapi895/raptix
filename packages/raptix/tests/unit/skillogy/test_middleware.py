"""Tests for SkillogyMiddleware (middleware.skillogy)."""

from __future__ import annotations

import json

from raptix.middleware.skillogy import (
    SkillogyMiddleware,
    _is_enabled,
    maybe_install_skillogy,
)
from raptix.middleware.skills import SkillsMiddleware


class _FakeSkillsMiddleware(SkillsMiddleware):
    """Test stand-in - SkillsMiddleware requires backend+sources kwargs that
    are heavyweight to construct in unit tests; we only care about its
    presence in the stack so maybe_install_skillogy can detect + swap it."""

    def __init__(self):
        from langchain.agents.middleware import AgentMiddleware

        AgentMiddleware.__init__(self)


class _FakeBackend:
    """Stand-in for ``Neo4jBackend`` — records calls and returns canned dicts so
    the middleware's tool closures can be exercised without a live graph."""

    def __init__(self):
        self.load_calls: list[str] = []
        self.find_calls: list[dict] = []

    def load_skill(self, path, **kwargs):
        self.load_calls.append(path)
        return {
            "name": "t1",
            "path": path,
            "subdomain": "test",
            "body": "# Body of " + path,
        }

    def find_skill(self, **kwargs):
        self.find_calls.append(kwargs)
        return [{"name": "t1", "path": "/skills/t1", "subdomain": "test"}]


def _tools_by_name(mw):
    return {t.name: t for t in mw.tools}


def test_middleware_constructs_with_injected_backend():
    backend = _FakeBackend()
    mw = SkillogyMiddleware(backend=backend)
    assert mw._backend is backend
    # Amendment v0.2.2 trimmed the agent surface to three tools
    # (run_cypher_read dropped).
    assert {t.name for t in mw.tools} == {"load_skill", "find_skill", "traverse"}


def test_middleware_find_skill_tool_returns_json():
    backend = _FakeBackend()
    mw = SkillogyMiddleware(backend=backend, append_policy_to_system=False)
    result = _tools_by_name(mw)["find_skill"].invoke({"subdomain": "test"})
    payload = json.loads(result)
    assert payload["count"] == 1
    assert payload["hits"][0]["name"] == "t1"
    assert backend.find_calls[0]["subdomain"] == "test"


def test_middleware_load_skill_tool_returns_body():
    backend = _FakeBackend()
    mw = SkillogyMiddleware(backend=backend, append_policy_to_system=False)
    result = _tools_by_name(mw)["load_skill"].invoke({"name_or_path": "/skills/ad/k"})
    # Body-only contract: the result is the skill BODY as plain markdown (with a
    # minimal name/path header), NOT a JSON envelope — metadata is search-side.
    assert "# Body of /skills/ad/k" in result
    assert backend.load_calls[0] == "/skills/ad/k"


def test_middleware_load_skill_tool_returns_error_on_exception():
    class _BadBackend:
        def load_skill(self, *args, **kwargs):
            raise RuntimeError("network down")

        def find_skill(self, **kwargs):
            return []

    mw = SkillogyMiddleware(backend=_BadBackend(), append_policy_to_system=False)
    result = _tools_by_name(mw)["load_skill"].invoke({"name_or_path": "/skills/x"})
    payload = json.loads(result)
    assert "error" in payload
    assert "network down" in payload["error"]


def test_load_skill_repeat_returns_pointer_without_backend_call():
    """Second load of the same path in one agent instance returns a short
    pointer (the body is already in context) — the backend is hit once."""
    backend = _FakeBackend()
    mw = SkillogyMiddleware(backend=backend, append_policy_to_system=False)
    tool = _tools_by_name(mw)["load_skill"]
    first = tool.invoke({"name_or_path": "/skills/ad/k"})
    assert "# Body of /skills/ad/k" in first
    second = tool.invoke({"name_or_path": "/skills/ad/k"})
    payload = json.loads(second)
    assert payload["already_loaded"] == "/skills/ad/k"
    assert "force=true" in payload["note"]
    assert backend.load_calls == ["/skills/ad/k"]


def test_load_skill_force_refetches_body():
    backend = _FakeBackend()
    mw = SkillogyMiddleware(backend=backend, append_policy_to_system=False)
    tool = _tools_by_name(mw)["load_skill"]
    tool.invoke({"name_or_path": "/skills/ad/k"})
    again = tool.invoke({"name_or_path": "/skills/ad/k", "force": True})
    assert "# Body of /skills/ad/k" in again
    assert backend.load_calls == ["/skills/ad/k", "/skills/ad/k"]


def test_load_skill_dedupe_keys_on_resolved_path():
    """Loading by name twice also dedupes — the first call records both the
    raw argument and the resolved canonical path, so the second hit is a
    pointer (resolved paths keep working if the agent switches notation)."""
    backend = _FakeBackend()
    mw = SkillogyMiddleware(backend=backend, append_policy_to_system=False)
    tool = _tools_by_name(mw)["load_skill"]
    tool.invoke({"name_or_path": "t1"})
    second = json.loads(tool.invoke({"name_or_path": "t1"}))
    assert second["already_loaded"] == "t1"
    third = json.loads(tool.invoke({"name_or_path": "/skills/t1"}))
    assert third["already_loaded"] == "/skills/t1"


def test_load_skill_fresh_instance_returns_body_again():
    """A new agent instance (new middleware) always gets the full body —
    per-dispatch dedupe only, never cross-generation suppression."""
    tool = _tools_by_name(
        SkillogyMiddleware(backend=_FakeBackend(), append_policy_to_system=False)
    )["load_skill"]
    assert "# Body of /skills/ad/k" in tool.invoke({"name_or_path": "/skills/ad/k"})
    tool2 = _tools_by_name(
        SkillogyMiddleware(backend=_FakeBackend(), append_policy_to_system=False)
    )["load_skill"]
    assert "# Body of /skills/ad/k" in tool2.invoke({"name_or_path": "/skills/ad/k"})


def test_env_flag_recognizes_truthy_values(monkeypatch):
    for v in ("1", "true", "TRUE", "yes", "on"):
        monkeypatch.setenv("RAPTIX_USE_SKILLOGY", v)
        assert _is_enabled() is True


def test_env_flag_recognizes_falsy_values(monkeypatch):
    """Explicit falsy values disable Skillogy under the default-on
    semantics.  Blank string is NOT a disable — anything that isn't an
    explicit ``0`` / ``false`` / ``no`` / ``off`` keeps the default-on
    behaviour, so a blank ``RAPTIX_USE_SKILLOGY`` (often the shape
    a misconfigured ``.env`` produces) leaves Skillogy on rather than
    silently swapping back to the file-system backend.
    """
    monkeypatch.delenv("RAPTIX_SKILL_BACKEND", raising=False)
    for v in ("0", "false", "no", "off"):
        monkeypatch.setenv("RAPTIX_USE_SKILLOGY", v)
        assert _is_enabled() is False, f"explicit {v!r} should disable Skillogy"
    monkeypatch.setenv("RAPTIX_USE_SKILLOGY", "")
    assert _is_enabled() is True, "blank string should NOT disable (default-on)"


def test_maybe_install_skillogy_swaps_skills_middleware_when_enabled(monkeypatch):
    monkeypatch.setenv("RAPTIX_USE_SKILLOGY", "1")
    # Exercise the swap logic, not a live graph: the neo4j driver is an optional
    # extra, so stub the backend factory the constructed middleware would call.
    monkeypatch.setattr("raptix.middleware.skillogy._backend_factory", lambda: _FakeBackend())
    base_stack = [_FakeSkillsMiddleware()]
    out = maybe_install_skillogy(base_stack)
    assert any(isinstance(mw, SkillogyMiddleware) for mw in out)
    assert not any(isinstance(mw, SkillsMiddleware) for mw in out)


def test_maybe_install_skillogy_no_op_when_disabled(monkeypatch):
    monkeypatch.setenv("RAPTIX_USE_SKILLOGY", "0")
    base_stack = [_FakeSkillsMiddleware()]
    out = maybe_install_skillogy(base_stack)
    assert any(isinstance(mw, SkillsMiddleware) for mw in out)
    assert not any(isinstance(mw, SkillogyMiddleware) for mw in out)


def test_maybe_install_skillogy_noop_when_no_skills_present(monkeypatch):
    """Swap-only: with SKILLS intentionally absent (disabled/replaced), an
    enabled flag must NOT inject a fresh SkillogyMiddleware — that would add
    a skill surface the stack opted out of."""
    monkeypatch.setenv("RAPTIX_USE_SKILLOGY", "1")
    from langchain.agents.middleware import AgentMiddleware

    other = AgentMiddleware()
    base_stack = [other]
    out = maybe_install_skillogy(base_stack)
    assert not any(isinstance(mw, SkillogyMiddleware) for mw in out)
    assert out == [other]


def test_maybe_install_skillogy_noop_on_empty_stack(monkeypatch):
    """No SkillsMiddleware to replace -> no-op even on an empty stack."""
    monkeypatch.setenv("RAPTIX_USE_SKILLOGY", "1")
    out = maybe_install_skillogy([])
    assert out == []
