"""Canonical asset references shared by the runtime and the Web catalog (ADR-0094).

Pure stdlib: the runtime derives the same ``assetId`` the Web catalog stores,
without calling the Web server.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from enum import StrEnum

ASSET_KEY_VERSION = 1


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
        """Versioned string form used as input to :func:`asset_id`."""
        return f"v{ASSET_KEY_VERSION}:{self.kind.value}:{self.namespace}:{self.canonical_key}"


def asset_id(engagement: str, ref: AssetRef) -> str:
    """Stable catalog ID for ``ref`` inside one engagement."""
    if not engagement:
        raise ValueError("asset id requires an engagement")
    digest = hashlib.sha256(f"{engagement}\x1f{ref.key}".encode()).hexdigest()
    return f"asset_{digest[:32]}"
