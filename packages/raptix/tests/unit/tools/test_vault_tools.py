"""Vault tools never cross-leak workspace_slug between engagements, and never call out with a missing scope."""

from __future__ import annotations

import asyncio
import json
from typing import Any

import pytest

from raptix.execution.tools.vault import tools as vault_tools


class _CaptureClient:
    def __init__(self) -> None:
        self.store_calls: list[tuple[str, str, str]] = []
        self.retrieve_calls: list[tuple[str, str]] = []
        self.list_calls: list[str] = []

    def store_secret(self, workspace_slug: str, name: str, value: str, **_: Any) -> dict[str, Any]:
        self.store_calls.append((workspace_slug, name, value))
        return {"name": name, "vault_ref": f"vault://{workspace_slug}-{name}"}

    def retrieve_secret(self, workspace_slug: str, name: str) -> str:
        self.retrieve_calls.append((workspace_slug, name))
        return f"value-for-{workspace_slug}"

    def list_secrets(self, workspace_slug: str) -> list[dict[str, Any]]:
        self.list_calls.append(workspace_slug)
        return []


@pytest.fixture
def capture(monkeypatch: pytest.MonkeyPatch) -> _CaptureClient:
    client = _CaptureClient()
    monkeypatch.setattr(vault_tools, "store_secret", client.store_secret)
    monkeypatch.setattr(vault_tools, "retrieve_secret", client.retrieve_secret)
    monkeypatch.setattr(vault_tools, "list_secrets", client.list_secrets)
    return client


def test_missing_engagement_scope_makes_zero_http_calls(capture: _CaptureClient) -> None:
    result = json.loads(vault_tools.vault_store.func(name="x", value="y", config=None, state={}))
    assert result == {"error": "missing_engagement_scope"}
    assert capture.store_calls == []

    result = json.loads(vault_tools.vault_retrieve.func(name="x", config=None, state=None))
    assert result == {"error": "missing_engagement_scope"}
    assert capture.retrieve_calls == []

    result = json.loads(vault_tools.vault_list.func(config=None, state={"irrelevant": True}))
    assert result == {"error": "missing_engagement_scope"}
    assert capture.list_calls == []


def test_vault_store_result_never_contains_the_raw_value(capture: _CaptureClient) -> None:
    result_json = vault_tools.vault_store.func(
        name="db-admin-password",
        value="Sup3rSecretValue!",
        config=None,
        state={"engagement_name": "proj-a"},
    )
    assert "Sup3rSecretValue!" not in result_json
    result = json.loads(result_json)
    assert result == {
        "status": "stored",
        "name": "db-admin-password",
        "vault_ref": "vault://proj-a-db-admin-password",
    }


def test_kg_engagement_takes_priority_over_engagement_name(capture: _CaptureClient) -> None:
    vault_tools.vault_store.func(
        name="n",
        value="v",
        config=None,
        state={"kg_engagement": "proj-kg", "engagement_name": "proj-plain"},
    )
    assert capture.store_calls == [("proj-kg", "n", "v")]


def test_concurrent_calls_for_two_engagements_never_cross_leak(capture: _CaptureClient) -> None:
    async def run() -> None:
        await asyncio.gather(
            asyncio.to_thread(
                vault_tools.vault_store.func,
                name="n",
                value="a-value",
                config=None,
                state={"engagement_name": "project-a"},
            ),
            asyncio.to_thread(
                vault_tools.vault_store.func,
                name="n",
                value="b-value",
                config=None,
                state={"engagement_name": "project-b"},
            ),
        )
        await asyncio.gather(
            asyncio.to_thread(
                vault_tools.vault_retrieve.func,
                name="n",
                config=None,
                state={"engagement_name": "project-a"},
            ),
            asyncio.to_thread(
                vault_tools.vault_retrieve.func,
                name="n",
                config=None,
                state={"engagement_name": "project-b"},
            ),
        )

    asyncio.run(run())

    store_slugs = {slug for slug, _, _ in capture.store_calls}
    retrieve_slugs = {slug for slug, _ in capture.retrieve_calls}
    assert store_slugs == {"project-a", "project-b"}
    assert retrieve_slugs == {"project-a", "project-b"}
    # Every recorded call's value/result must match its own engagement, never the other's.
    for slug, _, value in capture.store_calls:
        assert value == ("a-value" if slug == "project-a" else "b-value")


def test_configurable_engagement_name_is_the_last_fallback(capture: _CaptureClient) -> None:
    vault_tools.vault_list.func(
        config={"configurable": {"engagement_name": "from-configurable"}}, state=None
    )
    assert capture.list_calls == ["from-configurable"]
