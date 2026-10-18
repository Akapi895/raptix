"""Deterministic instance cases (P10): sibling isolation, cancel in flight, parent stop, and recovery."""

from __future__ import annotations

import pytest

from raptix.core.dispatch_context import DispatchContext, active_dispatch
from raptix.execution.session.instance_mailbox import default_mailbox
from raptix.middleware import instance_mailbox as mw


class _Request:
    def __init__(self, messages: list) -> None:
        self.messages = messages

    def override(self, **kwargs):
        return _Request(kwargs.get("messages", self.messages))


def _enter(dispatch: str, attempt: int = 1):
    return active_dispatch.set(DispatchContext(dispatch, None, attempt, role="recon", thread_id="thread-1"))


def test_two_instances_of_one_role_keep_their_messages_apart() -> None:
    box = default_mailbox()
    box.start_instance("thread-1", "disp-a", 1, "recon")
    box.start_instance("thread-1", "disp-b", 1, "recon")
    assert box.accept("m-a", "thread-1", "disp-a", "for a", expected_attempt=1).status == "accepted"
    assert box.drain("thread-1", "disp-b", 1) == []
    assert [m.message_id for m in box.drain("thread-1", "disp-a", 1)] == ["m-a"]


def test_cancel_lands_before_the_next_model_or_tool_admission() -> None:
    box = default_mailbox()
    box.start_instance("thread-1", "disp-c", 1, "recon")
    box.request_cancel("thread-1", "disp-c", 1)
    token = _enter("disp-c")
    try:
        with pytest.raises(mw.InstanceCancellationRequested):
            mw.InstanceMailboxMiddleware().wrap_model_call(_Request([]), lambda r: pytest.fail("model must not run"))
        with pytest.raises(mw.InstanceCancellationRequested):
            mw.InstanceMailboxMiddleware().wrap_tool_call(object(), lambda r: pytest.fail("tool must not run"))
    finally:
        active_dispatch.reset(token)


def test_cancel_during_a_model_call_lets_it_finish_and_stops_at_the_next_boundary() -> None:
    box = default_mailbox()
    box.start_instance("thread-1", "disp-d", 1, "recon")
    token = _enter("disp-d")
    seen: list[str] = []

    def model_call(request):
        seen.append("model")
        box.request_cancel("thread-1", "disp-d", 1)  # the operator cancels while the model call is in flight
        return "answer"

    try:
        assert mw.InstanceMailboxMiddleware().wrap_model_call(_Request([]), model_call) == "answer"
        with pytest.raises(mw.InstanceCancellationRequested):
            mw.InstanceMailboxMiddleware().wrap_tool_call(object(), lambda r: pytest.fail("tool must not run"))
    finally:
        active_dispatch.reset(token)
    assert seen == ["model"]
    box.finish_instance("thread-1", "disp-d", 1)
    assert box.snapshot("thread-1", "disp-d")[0][0].state == "cancelled"


def test_parent_stop_interrupts_the_attempt_and_leaves_queued_messages_undelivered() -> None:
    box = default_mailbox()
    box.start_instance("thread-1", "disp-e", 1, "recon")
    box.accept("m-e", "thread-1", "disp-e", "queued", expected_attempt=1)
    box.finish_instance("thread-1", "disp-e", 1, interrupted=True)
    instances, messages = box.snapshot("thread-1", "disp-e")
    assert instances[0].state == "interrupted"
    assert messages[0].state == "undelivered" and messages[0].outcome == "instance_interrupted"
