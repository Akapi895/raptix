"""Durable operator mailbox for running dispatch instances (P10c): state machine, dedup, bounds, restart."""

from __future__ import annotations

import itertools

import pytest

from raptix.execution.session import instance_mailbox as mb
from raptix.execution.session.instance_mailbox import InstanceMailbox


@pytest.fixture
def path(tmp_path):
    return tmp_path / "mailbox.sqlite"


@pytest.fixture
def mailbox(path):
    clock = (f"2026-10-18T00:00:{i:02d}+00:00" for i in itertools.count())
    box = InstanceMailbox(path, clock=lambda: next(clock))
    yield box
    box.close()


def _running(box: InstanceMailbox, attempt: int = 1) -> None:
    box.start_instance("thread-1", "disp-1", attempt, "recon")


def test_message_to_running_instance_is_accepted_then_delivered_once(mailbox):
    _running(mailbox)
    result = mailbox.accept("m-1", "thread-1", "disp-1", "Check the admin panel first.")
    assert result.status == "accepted"
    assert result.message.state == mb.ACCEPTED and result.attempt == 1

    delivered = mailbox.drain("thread-1", "disp-1", 1)
    assert [m.message_id for m in delivered] == ["m-1"]
    assert delivered[0].state == mb.DELIVERED
    mailbox.mark_handled(["m-1"], "model_turn_completed")
    assert mailbox.drain("thread-1", "disp-1", 1) == []


def test_handled_is_recorded_only_after_the_turn_that_received_it(mailbox):
    _running(mailbox)
    mailbox.accept("m-1", "thread-1", "disp-1", "Focus on the API.")
    mailbox.drain("thread-1", "disp-1", 1)
    _, messages = mailbox.snapshot("thread-1", "disp-1")
    assert messages[0].state == mb.DELIVERED and messages[0].handled_at is None

    mailbox.mark_handled(["m-1"], "model_turn_completed")
    _, messages = mailbox.snapshot("thread-1", "disp-1")
    assert messages[0].state == mb.HANDLED and messages[0].outcome == "model_turn_completed"


def test_delivery_keeps_arrival_order(mailbox):
    _running(mailbox)
    for i in range(3):
        mailbox.accept(f"m-{i}", "thread-1", "disp-1", f"note {i}")
    delivered = mailbox.drain("thread-1", "disp-1", 1)
    assert [m.message_id for m in delivered] == ["m-0", "m-1", "m-2"]
    assert [m.seq for m in delivered] == [1, 2, 3]


def test_retried_request_with_the_same_id_creates_no_second_message(mailbox):
    _running(mailbox)
    first = mailbox.accept("m-1", "thread-1", "disp-1", "one")
    again = mailbox.accept("m-1", "thread-1", "disp-1", "one")
    assert first.status == "accepted"
    assert again.status == "duplicate" and again.message.message_id == "m-1"
    assert len(mailbox.snapshot("thread-1", "disp-1")[1]) == 1


def test_same_message_id_for_another_instance_is_a_conflict(mailbox):
    _running(mailbox)
    mailbox.start_instance("thread-1", "disp-2", 1, "exploit")
    mailbox.accept("m-1", "thread-1", "disp-1", "one")
    result = mailbox.accept("m-1", "thread-1", "disp-2", "one")
    assert result.status == "refused" and result.reason == "message_id_conflict"


def test_message_is_refused_when_no_instance_is_running(mailbox):
    result = mailbox.accept("m-1", "thread-1", "disp-1", "hello")
    assert result.status == "refused" and result.reason == "instance_not_running"


def test_message_is_refused_once_the_instance_has_finished_and_pending_ones_become_undelivered(
    mailbox,
):
    _running(mailbox)
    mailbox.accept("m-1", "thread-1", "disp-1", "too late")
    mailbox.finish_instance("thread-1", "disp-1", 1)
    _, messages = mailbox.snapshot("thread-1", "disp-1")
    assert messages[0].state == mb.UNDELIVERED and messages[0].outcome == "instance_finished"
    assert mailbox.accept("m-2", "thread-1", "disp-1", "after").reason == "instance_not_running"


def test_message_targets_the_latest_attempt_and_never_an_earlier_one(mailbox):
    _running(mailbox, attempt=1)
    mailbox.finish_instance("thread-1", "disp-1", 1)
    _running(mailbox, attempt=2)
    result = mailbox.accept("m-1", "thread-1", "disp-1", "for attempt two")
    assert result.status == "accepted" and result.attempt == 2
    assert mailbox.drain("thread-1", "disp-1", 1) == []
    assert [m.message_id for m in mailbox.drain("thread-1", "disp-1", 2)] == ["m-1"]


def test_bounds_refuse_empty_oversized_and_overfull_mailboxes(mailbox):
    _running(mailbox)
    assert mailbox.accept("m-e", "thread-1", "disp-1", "   ").reason == "empty_message"
    assert (
        mailbox.accept("m-big", "thread-1", "disp-1", "x" * (mb.MAX_BODY_CHARS + 1)).reason
        == "message_too_large"
    )
    assert mailbox.accept("bad id!", "thread-1", "disp-1", "x").reason == "invalid_message_id"
    for i in range(mb.MAX_PENDING):
        assert mailbox.accept(f"m-{i}", "thread-1", "disp-1", "note").status == "accepted"
    full = mailbox.accept("m-over", "thread-1", "disp-1", "one more")
    assert full.status == "refused" and full.reason == "mailbox_full"


def test_restart_never_redelivers_and_marks_instances_that_were_running_as_interrupted(path):
    box = InstanceMailbox(path)
    box.start_instance("thread-1", "disp-1", 1, "recon")
    box.accept("m-1", "thread-1", "disp-1", "before the restart")
    assert [m.message_id for m in box.drain("thread-1", "disp-1", 1)] == ["m-1"]
    box.close()

    reopened = InstanceMailbox(path)
    try:
        instances, messages = reopened.snapshot("thread-1", "disp-1")
        assert instances[0].state == "interrupted"
        assert messages[0].state == mb.UNDELIVERED
        assert messages[0].outcome == "instance_interrupted"
        assert reopened.drain("thread-1", "disp-1", 1) == []
        assert (
            reopened.accept("m-2", "thread-1", "disp-1", "after").reason == "instance_not_running"
        )
    finally:
        reopened.close()


def test_stale_attempt_cannot_redirect_a_message_to_its_replacement(mailbox):
    _running(mailbox)
    mailbox.finish_instance("thread-1", "disp-1", 1)
    _running(mailbox, 2)
    refused = mailbox.accept("stale", "thread-1", "disp-1", "old guidance", expected_attempt=1)
    assert refused.reason == "stale_attempt"
    assert mailbox.drain("thread-1", "disp-1", 2) == []


def test_same_id_with_changed_body_conflicts(mailbox):
    _running(mailbox)
    mailbox.accept("stable", "thread-1", "disp-1", "first", expected_attempt=1)
    assert mailbox.accept("stable", "thread-1", "disp-1", "changed", expected_attempt=1).reason == "message_id_conflict"


def test_cancel_ack_precedes_observed_termination_and_rejects_messages(mailbox):
    _running(mailbox)
    assert mailbox.request_cancel("thread-1", "disp-1", 1) == "cancel_requested"
    assert mailbox.cancellation_requested("thread-1", "disp-1", 1)
    assert mailbox.accept("late", "thread-1", "disp-1", "hello", expected_attempt=1).reason == "instance_not_running"
    mailbox.finish_instance("thread-1", "disp-1", 1)
    assert mailbox.snapshot("thread-1", "disp-1")[0][0].state == "cancelled"


def test_replacement_attempt_goes_above_every_recorded_attempt_and_keeps_its_intent(mailbox):
    mailbox.start_instance("thread-1", "disp-1", 1, "recon", "map the web target")
    mailbox.request_cancel("thread-1", "disp-1", 1)
    mailbox.finish_instance("thread-1", "disp-1", 1)
    assert mailbox.max_attempt("thread-1", "disp-1") == 1
    mailbox.start_instance("thread-1", "disp-1", 2, "recon", "map the web target")
    assert mailbox.max_attempt("thread-1", "disp-1") == 2
    assert [row.intent for row in mailbox.snapshot("thread-1", "disp-1")[0]] == ["map the web target"] * 2
    assert mailbox.accept("after-retry", "thread-1", "disp-1", "focus on /admin", expected_attempt=2).status == "accepted"


def test_roster_keeps_the_dispatch_that_started_each_attempt(mailbox):
    mailbox.start_instance("thread-1", "disp-parent", 1, "surface_exploit")
    mailbox.start_instance("thread-1", "disp-child", 1, "recon", parent_dispatch_id="disp-parent")
    parents = {
        row.dispatch_id: row.parent_dispatch_id for _, row in mailbox.list_instances("thread-1")
    }
    assert parents == {"disp-parent": None, "disp-child": "disp-parent"}


def test_grant_needs_an_ended_attempt_and_admits_one_replacement(mailbox):
    mailbox.start_instance("thread-1", "disp-1", 1, "recon", "map the target", "OBJ-1")
    assert mailbox.open_grant("cmd-early-01", "thread-1", "disp-1", 1, "retry", None).reason == "attempt_not_ended"
    mailbox.finish_instance("thread-1", "disp-1", 1)
    opened = mailbox.open_grant("cmd-retry-01", "thread-1", "disp-1", 1, "retry", None)
    assert opened.status == "opened" and opened.grant.intent == "map the target" and opened.grant.objective_id == "OBJ-1"
    assert mailbox.open_grant("cmd-retry-02", "thread-1", "disp-1", 1, "retry", None).reason == "replacement_pending"
    assert mailbox.open_grant("cmd-retry-01", "thread-1", "disp-1", 1, "retry", None).status == "duplicate"
    mailbox.consume_grant("cmd-retry-01")
    assert mailbox.open_grant("cmd-retry-03", "thread-1", "disp-1", 1, "retry", None).reason == "already_replaced"


def test_revoked_grant_is_withdrawn_and_reassign_gets_a_new_dispatch(mailbox):
    mailbox.start_instance("thread-1", "disp-1", 1, "recon", "map the target", None)
    mailbox.finish_instance("thread-1", "disp-1", 1)
    opened = mailbox.open_grant("cmd-move-0001", "thread-1", "disp-1", 1, "reassign", "exploit")
    assert opened.grant.target_dispatch_id.startswith("disp-1-r") and opened.grant.target_role == "exploit"
    assert mailbox.revoke_grant("cmd-move-0001") == "revoked"
    assert mailbox.open_grant_for_target("thread-1", opened.grant.target_dispatch_id) is None
