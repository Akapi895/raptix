"""Live-Neo4j proof that re-ingesting the same real scanner output is
idempotent at the graph level, not just "same observation keys" (the
stronger half of docs/design/2026-11-03-graph-technical-design.md Mục 9
roadmap step 1, criterion (c)). Companion to the parser-level checks in
packages/raptix/tests/unit/middleware/test_autoingest_real_scanner_output.py,
which run key-stability checks without a live store."""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from langchain_core.messages import ToolMessage

from raptix.middleware.kg_autoingest import KGAutoIngestMiddleware

FIXTURES = Path(__file__).parents[2] / "fixtures" / "real_scanner_output"


class _FakeSandbox:
    def __init__(self, content: bytes) -> None:
        self._content = content

    def ls_info(self, directory: str) -> list[dict[str, Any]]:
        return [{"path": f"{directory}/nmap.xml", "size": len(self._content)}]

    def download_files(
        self, paths: list[str], *, workspace_path: str | None = None, max_bytes: int | None = None
    ) -> list[Any]:
        return [SimpleNamespace(content=self._content, error=None)]


@pytest.mark.asyncio
async def test_real_nmap_capture_ingested_twice_does_not_duplicate_the_host(
    kgstore: Any, engagement: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("RAPTIX_KG_AUTOINGEST", "1")
    content = (FIXTURES / "nmap.xml").read_bytes()
    hook = KGAutoIngestMiddleware(store=kgstore, sandbox=_FakeSandbox(content), role="recon")

    async def handler(_request: Any) -> ToolMessage:
        return ToolMessage(
            content="scan complete\n[Exit code: 0]", name="bash", tool_call_id="nmap-live-1"
        )

    request = SimpleNamespace(
        tool=SimpleNamespace(name="bash"),
        tool_call={
            "id": "nmap-live-1",
            "args": {"command": "nmap -sT -p 8999 -oX /workspace/nmap.xml 127.0.0.1"},
        },
        state={"engagement_name": engagement, "workspace_path": "/workspace"},
        runtime=None,
    )

    await hook.awrap_tool_call(request, handler)
    rows_after_first = kgstore.execute_read(
        "MATCH (n:Host) WHERE n.engagement = $engagement RETURN count(n) AS c",
        {},
        engagement=engagement,
    )
    count_after_first = rows_after_first[0]["c"]
    assert count_after_first >= 1

    # Re-ingest the identical real capture under a different episode id,
    # exactly as a re-run of the same scan would -- the host count must not
    # grow, proving KGStore's MERGE-by-key dedup, not just equal input keys.
    request.tool_call = {**request.tool_call, "id": "nmap-live-2"}
    await hook.awrap_tool_call(request, handler)
    rows_after_second = kgstore.execute_read(
        "MATCH (n:Host) WHERE n.engagement = $engagement RETURN count(n) AS c",
        {},
        engagement=engagement,
    )
    assert rows_after_second[0]["c"] == count_after_first
