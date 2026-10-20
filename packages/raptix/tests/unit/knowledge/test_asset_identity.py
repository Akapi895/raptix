"""Locator normalization for the runtime writers (ADR-0094)."""

from __future__ import annotations

import pytest

from raptix.knowledge.graph.asset_identity import (
    canonical_key,
    dns_ref,
    host_ref,
    identity_for,
    identity_props,
    origin_host_ref,
    web_origin_ref,
)
from raptix_core.types.asset import AssetKind


def test_ipv6_is_compressed_and_lowercased() -> None:
    assert host_ref("2001:DB8:0:0::0001").canonical_key == "2001:db8::1"


def test_dns_name_drops_trailing_dot_and_case() -> None:
    assert dns_ref("App.Example.COM.").canonical_key == "app.example.com"


def test_origin_makes_default_port_explicit() -> None:
    assert (
        web_origin_ref("HTTPS://App.Example.com/login?next=/").canonical_key
        == "https://app.example.com:443"
    )
    assert web_origin_ref("http://10.0.0.5").canonical_key == "http://10.0.0.5:80"


def test_http_and_https_on_one_ip_share_host_but_not_origin() -> None:
    http = web_origin_ref("http://10.0.0.5")
    https = web_origin_ref("https://10.0.0.5")
    assert http != https
    assert (
        origin_host_ref("http://10.0.0.5")
        == origin_host_ref("https://10.0.0.5")
        == host_ref("10.0.0.5")
    )


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


def test_identity_for_host_reads_the_key_before_props() -> None:
    identity = identity_for("eng-1", "Host", "host::app.example.com", {"ip": "10.0.0.5"})
    assert identity == identity_props("eng-1", dns_ref("app.example.com"))


def test_identity_for_host_falls_back_to_the_ip_prop_when_the_key_has_no_locator() -> None:
    identity = identity_for("eng-1", "Host", "host::", {"ip": "10.0.0.5"})
    assert identity == identity_props("eng-1", host_ref("10.0.0.5"))


@pytest.mark.parametrize(
    ("kind", "key"),
    [
        ("Host", "host::"),
        ("Host", "host::*.example.com"),
        ("Host", "host::bad name"),
        ("Entrypoint", "entrypoint::"),
        ("Entrypoint", "entrypoint::ftp://example.com/"),
    ],
)
def test_identity_for_rejects_locators_that_do_not_resolve(kind: str, key: str) -> None:
    assert identity_for("eng-1", kind, key, {}) is None


def test_identity_for_leaves_other_kinds_to_their_own_writers() -> None:
    assert identity_for("eng-1", "Vulnerability", "vuln::1", {"url": "https://a.test/"}) is None


def test_entrypoint_identity_is_the_origin_of_its_url() -> None:
    identity = identity_for("eng-1", "Entrypoint", "entrypoint::https://App.example.com/a?x=1", {})
    assert identity == identity_props("eng-1", web_origin_ref("https://app.example.com/"))


def test_canonical_key_redacts_entrypoint_urls_and_keeps_other_keys() -> None:
    assert (
        canonical_key("entrypoint::https://u:p@app.example.com/login?token=abc&page=2")
        == "entrypoint::https://app.example.com/login?token=REDACTED&page=2"
    )
    assert canonical_key("host::10.0.0.5") == "host::10.0.0.5"


def test_canonical_key_error_never_echoes_the_malformed_url() -> None:
    with pytest.raises(ValueError) as exc:
        canonical_key("entrypoint::https://u:hunter2@[::1/admin")
    assert "hunter2" not in str(exc.value)
