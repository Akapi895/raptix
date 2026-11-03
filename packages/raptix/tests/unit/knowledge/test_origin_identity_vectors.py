"""Web origin keys match the shared vectors the web server tests also read (ADR-0094 parity)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from raptix.knowledge.graph.asset_identity import web_origin_ref

VECTORS_PATH = Path(__file__).resolve().parents[5] / "apps/web/tests/fixtures/asset-map/origin-identity-vectors.json"
VECTORS: list[dict[str, str | None]] = json.loads(VECTORS_PATH.read_text(encoding="utf-8"))


@pytest.mark.parametrize("vector", VECTORS, ids=lambda vector: str(vector["input"]))
def test_origin_key_matches_the_vector(vector: dict[str, str | None]) -> None:
    if vector["origin"] is None:
        with pytest.raises(ValueError):
            web_origin_ref(str(vector["input"]))
        return
    assert web_origin_ref(str(vector["input"])).canonical_key == vector["origin"]
