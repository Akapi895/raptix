"""Asset identity contract: stored kind values, versioned keys and stable IDs (ADR-0094)."""

from __future__ import annotations

import pytest

from raptix_core.types.asset import ASSET_KEY_VERSION, AssetKind, AssetRef, asset_id


def test_stored_kind_values_are_frozen() -> None:
    assert {kind.value for kind in AssetKind} == {
        "host",
        "dns_name",
        "web_origin",
        "network_segment",
        "cloud_resource",
        "identity",
        "mobile_app",
        "device",
        "artifact",
    }


def test_key_embeds_version_kind_and_namespace() -> None:
    ref = AssetRef(AssetKind.HOST, "net:corp", "10.0.0.5")
    assert ref.key == f"v{ASSET_KEY_VERSION}:host:net:corp:10.0.0.5"


def test_reference_rejects_empty_namespace_or_key() -> None:
    with pytest.raises(ValueError):
        AssetRef(AssetKind.HOST, "", "10.0.0.5")
    with pytest.raises(ValueError):
        AssetRef(AssetKind.HOST, "default", "")


def test_asset_id_is_stable_and_scoped_to_engagement() -> None:
    ref = AssetRef(AssetKind.HOST, "default", "10.0.0.5")
    assert asset_id("eng-a", ref) == asset_id("eng-a", ref)
    assert asset_id("eng-a", ref).startswith("asset_")
    assert asset_id("eng-a", ref) != asset_id("eng-b", ref)


def test_asset_id_separates_kind_and_namespace() -> None:
    host = AssetRef(AssetKind.HOST, "default", "app.example.com")
    dns = AssetRef(AssetKind.DNS_NAME, "default", "app.example.com")
    other_ns = AssetRef(AssetKind.HOST, "net:dmz", "10.0.0.5")
    assert asset_id("eng", host) != asset_id("eng", dns)
    assert asset_id("eng", AssetRef(AssetKind.HOST, "default", "10.0.0.5")) != asset_id(
        "eng", other_ns
    )


def test_asset_id_requires_engagement() -> None:
    with pytest.raises(ValueError):
        asset_id("", AssetRef(AssetKind.HOST, "default", "10.0.0.5"))
