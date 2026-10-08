"""ADR-0046 — context-overflow errors keep their subtype through translation.

deepagents' summarization middleware catches
``langchain_core.exceptions.ContextOverflowError`` to compact-and-retry
instead of failing the run. The model factory's error translator previously
rewrapped every 400 (including overflow) as ``RuntimeError``, so the recovery
branch could never fire. These tests pin the preserved subtype and the
unchanged translation of ordinary 400s.
"""

from __future__ import annotations

import httpx
import pytest
from langchain_core.exceptions import ContextOverflowError
from langchain_openai.chat_models.base import (
    OpenAIAPIContextOverflowError,
    OpenAIContextOverflowError,
)

from raptix.intelligence.llm.factory import _reraise_with_actionable_message


def _overflow_error(cls):
    request = httpx.Request("POST", "http://proxy.test/v1/chat/completions")
    if issubclass(cls, OpenAIContextOverflowError):
        response = httpx.Response(
            400,
            request=request,
            json={"error": {"message": "maximum context length is exceeded"}},
        )
        return cls("maximum context length is exceeded", response=response, body=None)
    # OpenAIAPIContextOverflowError takes a bare ``request``.
    return cls("maximum context length is exceeded", request, body=None)


@pytest.mark.parametrize("cls", [OpenAIContextOverflowError, OpenAIAPIContextOverflowError])
def test_overflow_subtype_survives_translation(cls) -> None:
    exc = _overflow_error(cls)

    # The translator must NOT raise a reworded RuntimeError; returning lets
    # the caller's trailing ``raise`` re-raise the original exception.
    assert _reraise_with_actionable_message(exc, "custom/zai-org/GLM-5.3-Flash") is None
    assert isinstance(exc, ContextOverflowError)


def test_ordinary_bad_request_still_translated_to_runtime_error() -> None:
    from openai import BadRequestError

    request = httpx.Request("POST", "http://proxy.test/v1/chat/completions")
    response = httpx.Response(
        400,
        request=request,
        json={"error": {"message": "unsupported parameter: temperature"}},
    )
    plain = BadRequestError("unsupported parameter: temperature", response=response, body=None)

    with pytest.raises(RuntimeError):
        _reraise_with_actionable_message(plain, "custom/kimi-k2.7-code")
