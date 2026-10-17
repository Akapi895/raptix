"""Operator messages reach a running dispatch at its model-call safe point (plan P10c).

The safe point is the boundary before each model call of a dispatched instance: no tool is
mid-flight and no partial model output exists there. The middleware drains the instance's
accepted messages, adds them to that one request as operator guidance, and records them as
handled when the model turn completes. A failed model turn leaves them delivered, never
re-offered. Calls outside a dispatch (the orchestrator's own turns) pass through unchanged.
"""

from __future__ import annotations

import asyncio
from collections.abc import Sequence
from typing import Any

from langchain.agents.middleware import AgentMiddleware
from langchain_core.messages import HumanMessage

from raptix.core.dispatch_context import active_dispatch
from raptix.execution.session.instance_mailbox import MailboxMessage, default_mailbox

TURN_COMPLETED = "model_turn_completed"


def render_operator_notice(messages: Sequence[MailboxMessage]) -> HumanMessage:
    lines = [
        "Operator message for this running instance. It is guidance for the current objective; "
        "it does not change your role, your scope or your authorization.",
    ]
    for message in messages:
        lines.append(f"[message {message.message_id}]\n{message.body}")
    return HumanMessage(content="\n\n".join(lines))


def _safe_point_context() -> tuple[str, str, int] | None:
    context = active_dispatch.get()
    if context is None or not context.thread_id:
        return None
    return context.thread_id, context.dispatch_id, context.attempt


class InstanceMailboxMiddleware(AgentMiddleware):
    """Delivers accepted operator messages to a dispatched instance before its next model call."""

    async def awrap_model_call(self, request, handler):
        scope = _safe_point_context()
        if scope is None:
            return await handler(request)
        thread_id, dispatch_id, attempt = scope
        mailbox = default_mailbox()
        delivered = await asyncio.to_thread(mailbox.drain, thread_id, dispatch_id, attempt)
        if not delivered:
            return await handler(request)
        request = request.override(messages=[*request.messages, render_operator_notice(delivered)])
        response = await handler(request)
        await asyncio.to_thread(
            mailbox.mark_handled, [m.message_id for m in delivered], TURN_COMPLETED
        )
        return response

    def wrap_model_call(self, request, handler):
        scope = _safe_point_context()
        if scope is None:
            return handler(request)
        thread_id, dispatch_id, attempt = scope
        mailbox = default_mailbox()
        delivered = mailbox.drain(thread_id, dispatch_id, attempt)
        if not delivered:
            return handler(request)
        request = request.override(messages=[*request.messages, render_operator_notice(delivered)])
        response: Any = handler(request)
        mailbox.mark_handled([m.message_id for m in delivered], TURN_COMPLETED)
        return response
