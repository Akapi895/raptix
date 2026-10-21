"""Normalize locators into canonical asset references (ADR-0094).

A web origin and the host it resolves to are separate assets. Two origins that
share an IP are not merged: the IP only links them.
"""

from __future__ import annotations

import ipaddress
import re
from collections.abc import Mapping
from typing import Any
from urllib.parse import parse_qsl, quote, urlencode, urlsplit, urlunsplit

from raptix_core.types.asset import ASSET_KEY_VERSION, AssetKind, AssetRef, asset_id

DEFAULT_PORTS: dict[str, int] = {"http": 80, "https": 443}

# Kinds the asset catalog reconciles. The KG write boundary stamps their identity (ADR-0094).
ASSET_BEARING_KINDS = frozenset({"Host", "Entrypoint"})
# Ports that carry a web origin when a scanner reports them open. Shared by every nmap writer.
WEB_PORTS = frozenset({80, 443, 8000, 8080, 8443, 8888})
REDACTED = "REDACTED"
_HOST_PREFIX = "host::"
_ENTRYPOINT_PREFIX = "entrypoint::"
_DNS_NAME = re.compile(r"[a-z0-9_-]+(?:\.[a-z0-9_-]+)*")
_SENSITIVE_NAME = re.compile(
    r"(?i)pass|pwd|secret|token|key|auth|session|sid|cookie|sig|credential|access"
)


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


def _host_ref_for_locator(value: str) -> AssetRef:
    try:
        return host_ref(value)
    except ValueError:
        if _DNS_NAME.fullmatch(value.strip().rstrip(".").lower()) is None:
            raise
        return dns_ref(value)


def identity_for(
    engagement: str, kind: str, key: str, props: Mapping[str, Any]
) -> dict[str, Any] | None:
    """Identity props for a Host or Entrypoint observation, or None when its locator is invalid.

    The key is read before props: it is the locator the writer merges on, while props can hold a
    different value for the same node (for example the resolved IP of a DNS name).
    """
    try:
        if kind == "Host":
            value = key.removeprefix(_HOST_PREFIX) or str(props.get("ip") or "")
            ref = _host_ref_for_locator(value)
        elif kind == "Entrypoint":
            url = key.removeprefix(_ENTRYPOINT_PREFIX) or str(props.get("url") or "")
            ref = web_origin_ref(url)
        else:
            return None
    except ValueError:
        return None
    return identity_props(engagement, ref)


def is_web_url(value: str) -> bool:
    """True for an http or https URL, whatever the case of the scheme (urlsplit lowercases it)."""
    try:
        return urlsplit(value.strip()).scheme in DEFAULT_PORTS
    except ValueError:
        return False


def redact_text(value: str) -> str:
    """A text value with any web URL in it redacted. A URL that does not parse becomes REDACTED, never raw."""
    if not is_web_url(value):
        return value
    try:
        return redact_url(value.strip())
    except ValueError:
        return REDACTED


def canonical_key(key: str) -> str:
    """The key an observation is stored under; entrypoint keys hold a URL and are redacted.

    Raises ``ValueError`` for a malformed entrypoint URL without echoing it, so a secret inside it
    never reaches an error message.
    """
    if not key.startswith(_ENTRYPOINT_PREFIX):
        return key
    url = key.removeprefix(_ENTRYPOINT_PREFIX)
    try:
        if urlsplit(url).scheme not in DEFAULT_PORTS:
            return key
        return _ENTRYPOINT_PREFIX + redact_url(url)
    except ValueError as exc:
        raise ValueError("entrypoint key is not a valid URL") from exc


def redact_url(url: str) -> str:
    """Drop userinfo and fragment, and mask sensitive query values. Other content is kept."""
    parts = urlsplit(url)
    host = parts.hostname or ""
    if ":" in host:
        host = f"[{host}]"
    netloc = host if parts.port is None else f"{host}:{parts.port}"
    query = urlencode(
        [
            (name, REDACTED if is_sensitive_name(name) else value)
            for name, value in parse_qsl(parts.query, keep_blank_values=True)
        ],
        quote_via=quote,
    )
    return urlunsplit((parts.scheme, netloc, parts.path, query, ""))


def is_sensitive_name(name: str) -> bool:
    """Parameter or query names that usually carry credentials or session material."""
    return _SENSITIVE_NAME.search(name) is not None
