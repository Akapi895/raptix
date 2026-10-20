"""Normalize locators into canonical asset references (ADR-0094).

A web origin and the host it resolves to are separate assets. Two origins that
share an IP are not merged: the IP only links them.
"""

from __future__ import annotations

import ipaddress
from typing import Any
from urllib.parse import urlsplit

from raptix_core.types.asset import ASSET_KEY_VERSION, AssetKind, AssetRef, asset_id

DEFAULT_PORTS: dict[str, int] = {"http": 80, "https": 443}


def host_ref(address: str, *, namespace: str = "default") -> AssetRef:
    """Host identified by an IP address; IPv4 and IPv6 use their compressed form."""
    ip = ipaddress.ip_address(address.strip())
    return AssetRef(AssetKind.HOST, namespace, ip.compressed)


def dns_ref(name: str, *, namespace: str = "default") -> AssetRef:
    """DNS name: lowercased, without a trailing dot."""
    canonical = name.strip().rstrip(".").lower()
    if not canonical:
        raise ValueError("dns name is empty")
    return AssetRef(AssetKind.DNS_NAME, namespace, canonical)


def host_or_dns_ref(value: str, *, namespace: str = "default") -> AssetRef:
    """A host ref when ``value`` is an IP address, otherwise a DNS ref."""
    try:
        return host_ref(value, namespace=namespace)
    except ValueError:
        return dns_ref(value, namespace=namespace)


def identity_props(engagement: str, ref: AssetRef) -> dict[str, Any]:
    """Identity properties every asset-bearing KG node carries (ADR-0094)."""
    return {
        "asset_id": asset_id(engagement, ref),
        "asset_kind": ref.kind.value,
        "asset_namespace": ref.namespace,
        "asset_canonical": ref.canonical_key,
        "asset_key_version": ASSET_KEY_VERSION,
    }


def web_origin_ref(url: str, *, namespace: str = "default") -> AssetRef:
    """Web origin ``scheme://host:port``; the default port is made explicit."""
    scheme, host, port = _origin_parts(url)
    return AssetRef(AssetKind.WEB_ORIGIN, namespace, f"{scheme}://{_bracket(host)}:{port}")


def origin_host_ref(url: str, *, namespace: str = "default") -> AssetRef:
    """The host an origin belongs to: a host ref for an IP, a DNS ref for a name."""
    _, host, _ = _origin_parts(url)
    return host_or_dns_ref(host, namespace=namespace)


def _origin_parts(url: str) -> tuple[str, str, int]:
    parts = urlsplit(url.strip())
    scheme = parts.scheme.lower()
    if scheme not in DEFAULT_PORTS:
        raise ValueError(f"unsupported origin scheme: {scheme!r}")
    if not parts.hostname:
        raise ValueError("origin has no host")
    host = parts.hostname.rstrip(".").lower()
    return scheme, host, parts.port or DEFAULT_PORTS[scheme]


def _bracket(host: str) -> str:
    return f"[{host}]" if ":" in host else host
