"""TC-4/TC-6 completion tests — resource manifest contract + BH collection."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from raptix.capabilities.catalog import build_catalog
from raptix.capabilities.resources import (
    TargetResource,
    load_target_resources,
    resource_for_architecture,
    resource_matches_artifact,
)
from raptix_core.types.capability import Artifact

REPO_ROOT = Path(__file__).resolve().parents[5]
MANIFEST = REPO_ROOT / "infra" / "resources" / "target-linux.json"


class TestTargetResourceManifest:
    def test_shipped_manifest_loads_with_verified_digests(self) -> None:
        resources = load_target_resources(MANIFEST)
        assert {r.id for r in resources} == {"linpeas", "pspy64"}
        pspy = next(r for r in resources if r.id == "pspy64")
        assert pspy.version == "v1.2.1"
        assert len(pspy.sha256) == 64 and pspy.sha256 == pspy.sha256.lower()
        assert pspy.output_format == "pspy_log"
        assert pspy.supports_architecture("amd64")

    def test_missing_digest_is_a_defect_never_a_todo(self, tmp_path: Path) -> None:
        broken = dict(_one_entry(), sha256="")
        path = tmp_path / "m.json"
        path.write_text(
            json.dumps(
                {"schema": "raptix.target-resources/1", "platform": "linux", "resources": [broken]}
            ),
            encoding="utf-8",
        )
        with pytest.raises(ValueError, match="sha256 digest is REQUIRED"):
            load_target_resources(path)

    def test_unknown_output_format_is_a_defect(self, tmp_path: Path) -> None:
        broken = dict(_one_entry(), output_format="not_a_format")
        path = tmp_path / "m.json"
        path.write_text(
            json.dumps(
                {"schema": "raptix.target-resources/1", "platform": "linux", "resources": [broken]}
            ),
            encoding="utf-8",
        )
        with pytest.raises(ValueError, match="no registered parser"):
            load_target_resources(path)

    def test_undeclared_architecture_is_unsupported(self) -> None:
        resources = load_target_resources(MANIFEST)
        assert resource_for_architecture(resources, "pspy64", "amd64") is not None
        assert resource_for_architecture(resources, "pspy64", "arm64") is None

    def test_artifact_provenance_must_match_the_resource(self) -> None:
        resource = TargetResource(
            id="pspy64",
            kind="process_watcher",
            version="v1.2.1",
            architectures=("amd64",),
            upstream_url="https://x",
            sha256="a" * 64,
            size_bytes=1,
            output_format="pspy_log",
        )
        good = Artifact(
            id="a",
            artifact_ref="sha256://x",
            producer="t",
            metadata={"resource_id": "pspy64", "resource_sha256": "a" * 64},
        )
        bad = Artifact(
            id="b",
            artifact_ref="sha256://y",
            producer="t",
            metadata={"resource_id": "pspy64", "resource_sha256": "b" * 64},
        )
        assert resource_matches_artifact(resource, good)
        assert not resource_matches_artifact(resource, bad)


def _one_entry() -> dict:
    return {
        "id": "pspy64",
        "kind": "process_watcher",
        "version": "v1.2.1",
        "architectures": ["amd64"],
        "upstream_url": "https://x",
        "sha256": "c" * 64,
        "size_bytes": 1,
        "output_format": "pspy_log",
    }


class TestBloodHoundCollection:
    def test_capability_declares_netexec_profile_backed_impl(self) -> None:
        manifest = next(m for m in build_catalog() if str(m.id) == "ad.collect_bloodhound")
        (impl,) = manifest.implementations
        assert impl.adapter_id == "ad.netexec.bloodhound"
        assert impl.profile == "sandbox-ad"
        assert impl.executable == "nxc"

    def test_collector_argv_is_ldap_bloodhound(self) -> None:
        from raptix.execution.adapters.ad.bloodhound_collect import NetExecBloodHoundAdapter

        argv = NetExecBloodHoundAdapter().build_argv(
            _request(target="10.0.0.1", username="svc", password="pw", domain="CORP")
        )
        assert argv[:2] == ["nxc", "ldap"]
        assert "--bloodhound" in argv and "-c" in argv
        assert argv[argv.index("--zip-name") + 1] == "bh-collection"

    def test_rejects_unknown_collection_scope(self) -> None:
        from raptix.execution.adapters import AdapterParameterError
        from raptix.execution.adapters.ad.bloodhound_collect import NetExecBloodHoundAdapter

        with pytest.raises(AdapterParameterError, match="collection"):
            NetExecBloodHoundAdapter().build_argv(
                _request(target="t", username="u", password="p", collection="Everything")
            )


def _request(**params: object):
    from raptix_core.types.capability import CapabilityId, CapabilityRequest

    return CapabilityRequest(capability_id=CapabilityId("ad.collect_bloodhound"), parameters=params)
