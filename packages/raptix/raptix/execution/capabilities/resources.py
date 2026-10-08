"""Target-resource manifest loader (TC-4 packaging half, ADR-0043).

Reads ``infra/resources/target-linux.json`` — the single pinned
inventory of target-side PE resources (LinPEAS, pspy). Rules enforced
here, per the accepted ADR:

* a resource without a verified sha256 digest is a DEFECT — the loader
  raises, it never "fills in later";
* a resource without a declared output format is a defect (parsers are
  the normalization contract);
* architectures are declared explicitly; an amd64-only resource cannot
  be provisioned for arm64;
* the transfer/execution path is NOT part of this module — it stays
  gated on the ADR-0043 threat-model review (no resource code moves or
  runs anything on a target from here).
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path

from raptix_core.types.capability import Artifact

_SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
_MANIFEST_RELPATH = Path("infra") / "resources" / "target-linux.json"


@dataclass(frozen=True)
class TargetResource:
    id: str
    kind: str
    version: str
    architectures: tuple[str, ...]
    upstream_url: str
    sha256: str
    size_bytes: int
    output_format: str

    def supports_architecture(self, arch: str) -> bool:
        return arch in self.architectures


def _manifest_path() -> Path:
    repo_root = Path(__file__).resolve().parents[5]
    return repo_root / _MANIFEST_RELPATH


def load_target_resources(
    manifest_path: Path | None = None,
) -> tuple[TargetResource, ...]:
    """Load + validate the pinned target-resource manifest.

    Raises:
        ValueError: on schema drift, missing digests, bad digest shape,
            unknown output formats, or duplicate resource ids.
    """
    path = manifest_path if manifest_path is not None else _manifest_path()
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("schema") != "raptix.target-resources/1":
        raise ValueError(f"{path}: unsupported manifest schema {data.get('schema')!r}")
    if data.get("platform") != "linux":
        raise ValueError(f"{path}: unsupported platform {data.get('platform')!r}")

    from raptix.knowledge.ingest.registry import default_registry

    registered_formats = {p.format_id for p in default_registry().parsers()}
    seen: set[str] = set()
    resources: list[TargetResource] = []
    for index, entry in enumerate(data.get("resources") or ()):
        where = f"{path}: resources[{index}]"
        resource_id = entry.get("id") or ""
        if not resource_id or resource_id in seen:
            raise ValueError(f"{where}: missing or duplicate resource id {resource_id!r}")
        seen.add(resource_id)
        digest = entry.get("sha256") or ""
        if not _SHA256_RE.match(digest):
            raise ValueError(
                f"{where} ({resource_id}): sha256 digest is REQUIRED and must be "
                "a lowercase 64-hex value — a version marker without a verified "
                "digest is not packagable"
            )
        output_format = entry.get("output_format") or ""
        if output_format not in registered_formats:
            raise ValueError(
                f"{where} ({resource_id}): output_format {output_format!r} has no registered parser"
            )
        archs = tuple(entry.get("architectures") or ())
        if not archs:
            raise ValueError(f"{where} ({resource_id}): architectures must be declared")
        resources.append(
            TargetResource(
                id=resource_id,
                kind=str(entry.get("kind") or ""),
                version=str(entry.get("version") or ""),
                architectures=archs,
                upstream_url=str(entry.get("upstream_url") or ""),
                sha256=digest,
                size_bytes=int(entry.get("size_bytes") or 0),
                output_format=output_format,
            )
        )
    return tuple(resources)


def resource_for_architecture(
    resources: tuple[TargetResource, ...], resource_id: str, arch: str
) -> TargetResource | None:
    """The resource provisioned for ``arch``; ``None`` means unsupported
    (``resource_arch_unsupported`` in the health taxonomy)."""
    for resource in resources:
        if resource.id == resource_id:
            return resource if resource.supports_architecture(arch) else None
    return None


def resource_matches_artifact(resource: TargetResource, artifact: Artifact) -> bool:
    """Provenance check: the artifact records the resource id + sha256 an
    execution actually ran — mismatched provenance is a bug (ADR-0043
    point 3)."""
    return (
        artifact.metadata.get("resource_id") == resource.id
        and artifact.metadata.get("resource_sha256") == resource.sha256
    )
