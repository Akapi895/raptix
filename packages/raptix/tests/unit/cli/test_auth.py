"""Tests for headless auth introspection: factory.auth_inventory + the CLI."""

from __future__ import annotations

import json

import pytest

from raptix.cli.auth import main as auth_main
from raptix.intelligence.llm import factory
from raptix.intelligence.llm.factory import AuthMethod

# Every env var that could enable a method, so a test starts from a known
# blank slate regardless of the host/CI environment.
_PROVIDER_ENV_VARS = (
    *factory._API_METHOD_ENV.values(),
    *factory._OAUTH_METHOD_ENV.values(),
    *factory._LOCAL_METHOD_ENV.values(),
    "RAPTIX_AUTH_PRIORITY",
    "RAPTIX_HOME",
    "OLLAMA_MODEL",
    "OLLAMA_CLOUD_MODEL",
    "LMSTUDIO_MODEL",
    "LLAMACPP_MODEL",
    "CUSTOM_OPENAI_API_KEY",
    "CLAUDE_CODE_CREDENTIALS_PATH",
    "ANTHROPIC_OAUTH_TOKEN",
    "CODEX_AUTH_PATH",
)


@pytest.fixture
def clean_env(monkeypatch, tmp_path):
    for name in _PROVIDER_ENV_VARS:
        monkeypatch.delenv(name, raising=False)
    # Redirect HOME so OAuth credential-file lookups (~/.claude, ~/.config/…)
    # resolve into an empty dir instead of the developer's real tokens.
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("USERPROFILE", str(tmp_path))
    return monkeypatch


def test_inventory_nothing_configured(clean_env):
    inv = factory.auth_inventory()
    assert not inv.any_active
    assert inv.resolved_chain == ()
    assert all(not s.configured for s in inv.statuses)
    # Every enum member is reported, classified into a known bucket.
    assert {s.method for s in inv.statuses} == set(AuthMethod)
    assert all(s.kind in ("api", "subscription", "local") for s in inv.statuses)


def test_inventory_api_key_active(clean_env):
    clean_env.setenv("ANTHROPIC_API_KEY", "sk-ant-api03-" + "x" * 40)
    inv = factory.auth_inventory()
    anthropic = next(s for s in inv.statuses if s.method == AuthMethod.ANTHROPIC_API)
    assert anthropic.configured
    assert anthropic.active
    assert anthropic.kind == "api"
    assert AuthMethod.ANTHROPIC_API in inv.resolved_chain
    assert inv.any_active


def test_gateway_key_activates_method(clean_env):
    # An OpenAI-compatible gateway key (oh-my-pi parity) is detected and
    # routed exactly like any first-party API key — it is in the default
    # priority, so a lone OpenCode key produces an active chain.
    clean_env.setenv("OPENCODE_API_KEY", "sk-" + "o" * 40)
    inv = factory.auth_inventory()
    opencode = next(s for s in inv.statuses if s.method == AuthMethod.OPENCODE_API)
    assert opencode.configured
    assert opencode.active
    assert opencode.kind == "api"
    assert AuthMethod.OPENCODE_API in inv.resolved_chain


def test_placeholder_key_is_not_configured(clean_env):
    clean_env.setenv("ANTHROPIC_API_KEY", "your-anthropic-key-here")
    inv = factory.auth_inventory()
    anthropic = next(s for s in inv.statuses if s.method == AuthMethod.ANTHROPIC_API)
    assert not anthropic.configured
    assert not inv.any_active


def test_subscription_auto_routes_by_default(clean_env):
    clean_env.setenv("RAPTIX_AUTH_CLAUDE_CODE", "true")
    clean_env.setenv("ANTHROPIC_OAUTH_TOKEN", "test-env-token")
    inv = factory.auth_inventory()
    claude = next(s for s in inv.statuses if s.method == AuthMethod.ANTHROPIC_OAUTH)
    assert claude.configured and claude.in_priority and claude.active
    assert claude.kind == "subscription"
    assert AuthMethod.ANTHROPIC_OAUTH in inv.resolved_chain


def test_configured_but_idle_when_priority_omits(clean_env):
    # configured_but_idle still flags a credential the user excluded via an
    # explicit priority list — wired but deliberately not routed.
    clean_env.setenv("ANTHROPIC_API_KEY", "sk-ant-api03-" + "x" * 40)
    clean_env.setenv("OPENAI_API_KEY", "sk-" + "y" * 48)
    clean_env.setenv("RAPTIX_AUTH_PRIORITY", "openai_api")
    inv = factory.auth_inventory()
    anthropic = next(s for s in inv.statuses if s.method == AuthMethod.ANTHROPIC_API)
    assert anthropic.configured
    assert not anthropic.in_priority
    assert not anthropic.active
    assert AuthMethod.ANTHROPIC_API in {s.method for s in inv.configured_but_idle}


def test_explicit_priority_ignores_retired_subscription(clean_env):
    clean_env.setenv("RAPTIX_AUTH_GEMINI", "true")
    clean_env.setenv("GEMINI_ACCESS_TOKEN", "unused-token")
    clean_env.setenv("GEMINI_API_KEY", "AIza" + "a" * 35)
    clean_env.setenv("RAPTIX_AUTH_PRIORITY", "google_oauth,google_api")
    inv = factory.auth_inventory()
    retired = next(s for s in inv.statuses if s.method == AuthMethod.GOOGLE_OAUTH)
    assert retired.kind == "subscription"
    assert retired.in_priority and not retired.configured and not retired.active
    assert retired.detail == "subscription handler retired"
    assert inv.resolved_chain == (AuthMethod.GOOGLE_API,)


def test_cli_status_json(clean_env, capsys):
    clean_env.setenv("OPENAI_API_KEY", "sk-" + "y" * 48)
    rc = auth_main(["status", "--json", "--no-env-file"])
    assert rc == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["any_active"] is True
    assert "openai_api" in payload["resolved_chain"]
    assert any(m["method"] == "openai_api" and m["active"] for m in payload["methods"])


def test_cli_doctor_exit_codes(clean_env, capsys):
    # No credentials → doctor fails for CI preflight.
    assert auth_main(["doctor", "--no-env-file"]) == 2
    capsys.readouterr()
    # With a real key → doctor passes.
    clean_env.setenv("GROQ_API_KEY", "gsk_" + "z" * 40)
    assert auth_main(["doctor", "--no-env-file"]) == 0
    assert "active" in capsys.readouterr().out.lower()
