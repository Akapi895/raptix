"""ADR-0048 — capacity profile, operator overrides, rebind re-derivation.

The summarization slot picks thresholds from the model's profile when present
(fraction-based) and otherwise falls back to a fixed 170K/6. These tests pin:
  - defaults unchanged when no env is set;
  - ``RAPTIX_LLM__MAX_INPUT_TOKENS`` switches to fraction defaults;
  - operator trigger/keep overrides (and invalid values fail naming the env);
  - a rebind to a profiled request model re-derives thresholds without
    mutating the shared inner; an operator override is never recomputed.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from deepagents.backends.state import StateBackend
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_openai import ChatOpenAI

from raptix.intelligence.agents.middleware_slots import _make_summarization

_ENVS = (
    "RAPTIX_LLM__MAX_INPUT_TOKENS",
    "RAPTIX_SUMMARIZATION_TRIGGER_TOKENS",
    "RAPTIX_SUMMARIZATION_KEEP_MESSAGES",
)


def _base_model() -> GenericFakeChatModel:
    return GenericFakeChatModel(messages=iter([]))


def _profiled_model() -> ChatOpenAI:
    # ChatOpenAI ships a profile with max_input_tokens → fraction defaults.
    return ChatOpenAI(model="gpt-4o-mini", api_key="sk-dummy", base_url="http://localhost:1/")


def _clear_envs(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in _ENVS:
        monkeypatch.delenv(name, raising=False)


def _helper(monkeypatch: pytest.MonkeyPatch):
    _clear_envs(monkeypatch)
    proxy = _make_summarization(backend=StateBackend(), llm=_base_model())
    return proxy, proxy._inner._lc_helper


def test_defaults_unchanged_when_envs_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    _, helper = _helper(monkeypatch)
    assert helper.trigger == ("tokens", 170000)
    assert helper.keep == ("messages", 6)


def test_capacity_profile_selects_fraction_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    _clear_envs(monkeypatch)
    monkeypatch.setenv("RAPTIX_LLM__MAX_INPUT_TOKENS", "200000")

    proxy = _make_summarization(backend=StateBackend(), llm=_base_model())

    assert proxy._inner._lc_helper.trigger == ("fraction", 0.85)
    assert proxy._inner._lc_helper.keep == ("fraction", 0.10)


def test_operator_overrides_applied(monkeypatch: pytest.MonkeyPatch) -> None:
    _clear_envs(monkeypatch)
    monkeypatch.setenv("RAPTIX_SUMMARIZATION_TRIGGER_TOKENS", "90000")
    monkeypatch.setenv("RAPTIX_SUMMARIZATION_KEEP_MESSAGES", "12")

    proxy = _make_summarization(backend=StateBackend(), llm=_base_model())

    assert proxy._inner._lc_helper.trigger == ("tokens", 90000)
    assert proxy._inner._lc_helper.keep == ("messages", 12)


def test_invalid_override_fails_naming_the_env(monkeypatch: pytest.MonkeyPatch) -> None:
    _clear_envs(monkeypatch)
    monkeypatch.setenv("RAPTIX_SUMMARIZATION_TRIGGER_TOKENS", "not-an-int")

    with pytest.raises(RuntimeError, match="RAPTIX_SUMMARIZATION_TRIGGER_TOKENS"):
        _make_summarization(backend=StateBackend(), llm=_base_model())


def test_invalid_capacity_fails_naming_the_env(monkeypatch: pytest.MonkeyPatch) -> None:
    _clear_envs(monkeypatch)
    monkeypatch.setenv("RAPTIX_LLM__MAX_INPUT_TOKENS", "-5")

    with pytest.raises(RuntimeError, match="RAPTIX_LLM__MAX_INPUT_TOKENS"):
        _make_summarization(backend=StateBackend(), llm=_base_model())


def test_rebind_re_derives_thresholds_for_profiled_model(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    proxy, helper = _helper(monkeypatch)
    assert helper.trigger == ("tokens", 170000)

    scoped = proxy._scoped_inner(SimpleNamespace(model=_profiled_model()))

    assert scoped is not proxy._inner
    assert scoped._lc_helper.trigger == ("fraction", 0.85)
    assert scoped._lc_helper.keep == ("fraction", 0.10)
    # The shared inner must not be mutated.
    assert proxy._inner._lc_helper.trigger == ("tokens", 170000)


def test_rebind_keeps_operator_override(monkeypatch: pytest.MonkeyPatch) -> None:
    _clear_envs(monkeypatch)
    monkeypatch.setenv("RAPTIX_SUMMARIZATION_TRIGGER_TOKENS", "90000")
    monkeypatch.setenv("RAPTIX_SUMMARIZATION_KEEP_MESSAGES", "12")
    proxy = _make_summarization(backend=StateBackend(), llm=_base_model())

    scoped = proxy._scoped_inner(SimpleNamespace(model=_profiled_model()))

    assert scoped._lc_helper.trigger == ("tokens", 90000)
    assert scoped._lc_helper.keep == ("messages", 12)
