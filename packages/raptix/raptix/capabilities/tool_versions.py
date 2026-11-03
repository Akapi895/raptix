"""Tool-version manifests → execution provenance (TC-3).

The sandbox image records installed tool versions as TSV manifests in
``/opt/raptix/tool-versions/<profile>.tsv`` (one ``tool<TAB>version``
line per binary, written at build time). This module is the runtime
half of that provenance chain: it parses manifest content (fetched by
the caller through ``ArtifactStore``/sandbox download — never a
filesystem path assumption) and builds the provenance dicts that
``build_execution_provenance`` embeds in execution metadata.

Honesty rules (TC-3 items 3 + 5):

* a tool line with no version is recorded as an explicit
  ``"unknown"`` evidence gap, never silently dropped;
* a tool absent from every manifest resolves to ``None`` — callers
  must treat that as "unknown version", not "not applicable";
* manifests describe TOOL versions only. They never carry parameter
  values, credentials, hashes, tokens, or keys.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from raptix.capabilities.provenance import build_execution_provenance


def parse_tool_versions_tsv(content: str) -> dict[str, str]:
    """Parse one ``<profile>.tsv`` manifest into ``{tool: version}``.

    Lines are ``tool<TAB>version`` (whitespace-tolerant); blank lines
    and ``#`` comments are skipped. A tool line with an empty version
    records the explicit ``"unknown"`` gap marker. Malformed lines
    (no tab) are recorded as ``"malformed:<line>"`` gaps rather than
    being silently ignored.
    """
    versions: dict[str, str] = {}
    for line in content.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        # Partition the RAW line: a tool with an empty version is a
        # genuine "unknown" gap, and strip() would erase its trailing tab.
        if "\t" not in line:
            versions[f"malformed:{stripped[:64]}"] = "unknown"
            continue
        tool, _, version = line.partition("\t")
        tool = tool.strip()
        version = version.strip()
        if not tool:
            continue
        versions[tool] = version or "unknown"
    return versions


def build_tool_provenance(manifest_contents: Mapping[str, str]) -> dict[str, Any]:
    """Merge every profile manifest into one provenance record.

    ``manifest_contents`` maps profile name → manifest content. The
    result is plain JSON-safe data: ``{profile: {tool: version}}`` with
    explicit ``"unknown"`` gaps preserved.
    """
    provenance: dict[str, Any] = {}
    for profile in sorted(manifest_contents):
        provenance[profile] = parse_tool_versions_tsv(manifest_contents[profile])
    return {"profiles": provenance}


def tool_version_from_manifest(versions: dict[str, str], tool: str) -> str | None:
    """The recorded version for ``tool``; ``None`` means unknown — an
    evidence gap callers must surface, never silently omit."""
    version = versions.get(tool)
    if version is None or version == "unknown":
        return None
    return version


def provenance_for_tool(
    *,
    tool_name: str,
    manifest_contents: dict[str, str],
    adapter_version: str | None = None,
    parser_version: str | None = None,
) -> dict[str, Any]:
    """Build one execution's provenance from the recorded manifests.

    The tool version comes from the merged manifests; a tool missing
    from them produces provenance with NO ``tool_version`` key — the
    "unknown, not zero" convention of ``build_execution_provenance``.
    """
    merged = parse_tool_versions_tsv("\n".join(manifest_contents.values()))
    return build_execution_provenance(
        tool_name=tool_name,
        tool_version=tool_version_from_manifest(merged, tool_name),
        adapter_version=adapter_version,
        parser_version=parser_version,
    )
