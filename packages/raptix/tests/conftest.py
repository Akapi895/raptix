"""Shared fixtures for the raptix runtime tests."""

from __future__ import annotations

import pytest

from raptix.execution.session import instance_mailbox as mb


@pytest.fixture(autouse=True)
def isolated_instance_mailbox(tmp_path, monkeypatch):
    """Each test gets its own operator mailbox, so attempt numbers never carry over between runs."""
    monkeypatch.setenv(mb.PATH_ENV, str(tmp_path / "instance_mailbox.sqlite"))
    monkeypatch.setattr(mb, "_default", None)
    yield
    if mb._default is not None:
        mb._default.close()
