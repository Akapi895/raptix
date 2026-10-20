"""Locator normalization for the runtime writers (ADR-0094)."""

from __future__ import annotations

import pytest
from raptix.knowledge.graph.asset_identity import (
    dns_ref,
    host_ref,
    origin_host_ref,
    web_origin_ref,
)
from raptix_core.types.asset import AssetKind


def test_ipv6_is_compressed_and_lowercased() -> None:
    assert host_ref("2001:DB8:0:0::0001").canonical_key == "2001:db8::1"


def test_dns_name_drops_trailing_dot_and_case() -> None:
    assert dns_ref("App.Example.COM.").canonical_key == "app.example.com"


def test_origin_makes_default_port_explicit() -> None:
    assert web_origin_ref("HTTPS://App.Example.com/login?next=/").canonical_key == "https://app.example.com:443"
    assert web_origin_ref("http://10.0.0.5").canonical_key == "http://10.0.0.5:80"


def test_http_and_https_on_one_ip_share_host_but_not_origin() -> None:
    http = web_origin_ref("http://10.0.0.5")
    https = web_origin_ref("https://10.0.0.5")
    assert http != https
    assert origin_host_ref("http://10.0.0.5") == origin_host_ref("https://10.0.0.5") == host_ref("10.0.0.5")


def test_virtual_hosts_on_one_ip_are_separate_origins() -> None:
    first = web_origin_ref("https://a.example.com")
    second = web_origin_ref("https://b.example.com")
    assert first != second
    assert origin_host_ref("https://a.example.com").kind is AssetKind.DNS_NAME
    assert origin_host_ref("https://10.0.0.5").kind is AssetKind.HOST


def test_ipv6_origin_keeps_brackets() -> None:
    assert web_origin_ref("http://[2001:db8::1]:8080").canonical_key == "http://[2001:db8::1]:8080"


def test_namespace_separates_the_same_locator() -> None:
    assert host_ref("10.0.0.5", namespace="net:corp") != host_ref("10.0.0.5", namespace="net:dmz")


@pytest.mark.parametrize("bad", ["ftp://example.com", "https://", "not a url"])
def test_invalid_origins_are_rejected(bad: str) -> None:
    with pytest.raises(ValueError):
        web_origin_ref(bad)


def test_empty_dns_name_is_rejected() -> None:
    with pytest.raises(ValueError):
        dns_ref("  .")
