"""The runtime's operator mailbox routes: accept, duplicate, explicit refusals, and the instance read."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from raptix.execution.session import instance_mailbox as mb
from raptix.execution.session.instance_mailbox import InstanceMailbox


@pytest.fixture
def client(tmp_path, monkeypatch):
    from raptix.interfaces.api.plugins_api import app

    box = InstanceMailbox(tmp_path / "mailbox.sqlite")
    box.start_instance("thread-1", "disp-1", 1, "recon")
    monkeypatch.setattr(mb, "_default", box)
    yield TestClient(app)
    box.close()


def test_accepted_then_duplicate_then_visible_in_the_instance_read(client):
    url = "/_raptix/instances/thread-1/disp-1/messages"
    accepted = client.post(url, json={"messageId": "m-1", "body": "Check the login form."})
    assert accepted.status_code == 200
    assert (
        accepted.json()["status"] == "accepted"
        and accepted.json()["message"]["state"] == "accepted"
    )

    again = client.post(url, json={"messageId": "m-1", "body": "Check the login form."})
    assert again.json()["status"] == "duplicate"

    read = client.get("/_raptix/instances/thread-1/disp-1").json()
    assert read["instances"] == [
        {
            "attempt": 1,
            "role": "recon",
            "state": "running",
            "startedAt": read["instances"][0]["startedAt"],
            "finishedAt": None,
        }
    ]
    assert [m["messageId"] for m in read["messages"]] == ["m-1"]


def test_a_refusal_is_an_explicit_409_with_its_reason(client):
    response = client.post(
        "/_raptix/instances/thread-1/disp-unknown/messages",
        json={"messageId": "m-2", "body": "hello"},
    )
    assert response.status_code == 409
    assert (
        response.json()["status"] == "refused"
        and response.json()["reason"] == "instance_not_running"
    )


def test_an_oversized_body_is_refused_before_anything_is_stored(client):
    response = client.post(
        "/_raptix/instances/thread-1/disp-1/messages",
        json={"messageId": "m-3", "body": "x" * (mb.MAX_BODY_CHARS + 1)},
    )
    assert response.status_code == 409 and response.json()["reason"] == "message_too_large"
    assert client.get("/_raptix/instances/thread-1/disp-1").json()["messages"] == []


def test_the_thread_listing_names_running_attempts_for_the_roster(client):
    listing = client.get("/_raptix/threads/thread-1/instances").json()
    assert listing["threadId"] == "thread-1"
    assert [(row["dispatchId"], row["attempt"], row["state"]) for row in listing["instances"]] == [
        ("disp-1", 1, "running")
    ]
