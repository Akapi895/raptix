"""Canonical asset references shared by the runtime and the Web catalog (ADR-0094).

Pure stdlib: the runtime derives the same ``assetId`` the Web catalog stores,
without calling the Web server.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from enum import StrEnum

ASSET_KEY_VERSION = 2


class AssetKind(StrEnum):
    """What a canonical key identifies. Values are stored; never rename them."""

    HOST = "host"
    DNS_NAME = "dns_name"
    WEB_ORIGIN = "web_origin"
    NETWORK_SEGMENT = "network_segment"
    CLOUD_RESOURCE = "cloud_resource"
    IDENTITY = "identity"
    MOBILE_APP = "mobile_app"
    DEVICE = "device"
    ARTIFACT = "artifact"


@dataclass(frozen=True)
class AssetRef:
    """A normalized locator: kind, namespace and canonical key."""

    kind: AssetKind
    namespace: str
    canonical_key: str

    def __post_init__(self) -> None:
        if not self.namespace or not self.canonical_key:
            raise ValueError("asset reference requires a namespace and a canonical key")

    @property
    def key(self) -> str:
        """Human-readable form for logs and diagnostics. Not an identity input."""
        return f"v{ASSET_KEY_VERSION}:{self.kind.value}:{self.namespace}:{self.canonical_key}"


def _field(value: str) -> str:
    """Length-prefixed field: ``len(utf8 bytes):value``. Unambiguous for any content."""
    return f"{len(value.encode('utf-8'))}:{value}"


def asset_id(engagement: str, ref: AssetRef) -> str:
    """Stable catalog ID for ``ref`` inside one engagement.

    The input is the length-prefixed tuple (engagement, version, kind, namespace,
    canonical key). Joining with a separator is ambiguous when a namespace or key
    contains that separator, so every field carries its own byte length. The Web
    server computes the same encoding (``assetIdFor`` in graph-service.ts).
    """
    if not engagement:
        raise ValueError("asset id requires an engagement")
    encoded = "".join(
        _field(part)
        for part in (
            engagement,
            str(ASSET_KEY_VERSION),
            ref.kind.value,
            ref.namespace,
            ref.canonical_key,
        )
    )
    return f"asset_{hashlib.sha256(encoded.encode('utf-8')).hexdigest()[:32]}"
