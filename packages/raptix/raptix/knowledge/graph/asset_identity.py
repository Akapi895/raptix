"""Normalize locators into canonical asset references (ADR-0094).

A web origin and the host it resolves to are separate assets. Two origins that
share an IP are not merged: the IP only links them.
"""

from __future__ import annotations

import ipaddress
from urllib.parse import urlsplit

from raptix_core.types.asset import AssetKind, AssetRef

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


def web_origin_ref(url: str, *, namespace: str = "default") -> AssetRef:
    """Web origin ``scheme://host:port``; the default port is made explicit."""
    scheme, host, port = _origin_parts(url)
    return AssetRef(AssetKind.WEB_ORIGIN, namespace, f"{scheme}://{_bracket(host)}:{port}")


def origin_host_ref(url: str, *, namespace: str = "default") -> AssetRef:
    """The host an origin belongs to: a host ref for an IP, a DNS ref for a name."""
    _, host, _ = _origin_parts(url)
    try:
        return host_ref(host, namespace=namespace)
    except ValueError:
        return dns_ref(host, namespace=namespace)


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
