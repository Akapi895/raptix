"""The instance mailbox middleware injects accepted operator messages at the model-call safe point only."""

from __future__ import annotations

import asyncio
import itertools

import pytest
from langchain_core.messages import HumanMessage

from raptix.core.dispatch_context import DispatchContext, active_dispatch
from raptix.execution.session.instance_mailbox import (
    DELIVERED,
    HANDLED,
    UNDELIVERED,
    InstanceMailbox,
)
from raptix.middleware import instance_mailbox as mw


class FakeRequest:
    def __init__(self, messages):
        self.messages = list(messages)

    def override(self, **overrides):
        return FakeRequest(overrides.get("messages", self.messages))


@pytest.fixture
def box(tmp_path, monkeypatch):
    clock = (f"2026-10-18T00:00:{i:02d}+00:00" for i in itertools.count())
    mailbox = InstanceMailbox(tmp_path / "mailbox.sqlite", clock=lambda: next(clock))
    monkeypatch.setattr(mw, "default_mailbox", lambda: mailbox)
    yield mailbox
    mailbox.close()


def _enter_dispatch(thread_id: str = "thread-1", dispatch_id: str = "disp-1", attempt: int = 1):
    return active_dispatch.set(
        DispatchContext(dispatch_id, None, attempt, role="recon", thread_id=thread_id)
    )


def test_a_pending_message_reaches_the_next_model_call_and_is_marked_handled_after_it(box):
    box.start_instance("thread-1", "disp-1", 1, "recon")
    box.accept("m-1", "thread-1", "disp-1", "Prefer the staging host.")
    seen: list[list] = []

    async def handler(request):
        seen.append(list(request.messages))
        return "model-response"

    token = _enter_dispatch()
    try:
        response = asyncio.run(
            mw.InstanceMailboxMiddleware().awrap_model_call(
                FakeRequest([HumanMessage("scan it")]), handler
            )
        )
    finally:
        active_dispatch.reset(token)

    assert response == "model-response"
    injected = seen[0][-1]
    assert isinstance(injected, HumanMessage) and "[message m-1]" in injected.content
    assert "Prefer the staging host." in injected.content
    assert "does not change your role" in injected.content
    assert box.snapshot("thread-1", "disp-1")[1][0].state == HANDLED


def test_a_model_call_with_nothing_pending_is_passed_through_untouched(box):
    box.start_instance("thread-1", "disp-1", 1, "recon")
    original = FakeRequest([HumanMessage("scan it")])
    seen: list = []

    async def handler(request):
        seen.append(request)
        return "ok"

    token = _enter_dispatch()
    try:
        asyncio.run(mw.InstanceMailboxMiddleware().awrap_model_call(original, handler))
    finally:
        active_dispatch.reset(token)
    assert seen[0] is original


def test_calls_outside_a_dispatch_never_touch_the_mailbox(box):
    box.start_instance("thread-1", "disp-1", 1, "recon")
    box.accept("m-1", "thread-1", "disp-1", "for the instance only")
    original = FakeRequest([HumanMessage("orchestrator turn")])
    seen: list = []

    async def handler(request):
        seen.append(request)
        return "ok"

    asyncio.run(mw.InstanceMailboxMiddleware().awrap_model_call(original, handler))
    assert seen[0] is original
    assert box.snapshot("thread-1", "disp-1")[1][0].state == "accepted"


def test_a_failed_model_turn_leaves_the_message_delivered_and_never_offers_it_again(box):
    box.start_instance("thread-1", "disp-1", 1, "recon")
    box.accept("m-1", "thread-1", "disp-1", "one shot")

    async def failing(request):
        raise RuntimeError("provider timeout")

    token = _enter_dispatch()
    try:
        with pytest.raises(RuntimeError):
            asyncio.run(mw.InstanceMailboxMiddleware().awrap_model_call(FakeRequest([]), failing))
        assert box.snapshot("thread-1", "disp-1")[1][0].state == DELIVERED

        seen: list = []

        async def handler(request):
            seen.append(list(request.messages))
            return "ok"

        asyncio.run(mw.InstanceMailboxMiddleware().awrap_model_call(FakeRequest([]), handler))
    finally:
        active_dispatch.reset(token)
    assert seen[0] == []


def test_a_message_left_when_the_instance_ends_is_reported_undelivered(box):
    box.start_instance("thread-1", "disp-1", 1, "recon")
    box.accept("m-1", "thread-1", "disp-1", "too late")
    box.finish_instance("thread-1", "disp-1", 1)
    assert box.snapshot("thread-1", "disp-1")[1][0].state == UNDELIVERED
