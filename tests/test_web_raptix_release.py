"""Release assets and lifecycle catalogs must match the deployed new web stack."""

import re
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[1]
WEB_IMAGES = {"raptix-web-raptix-ui", "raptix-web-raptix-api"}


def test_release_builds_both_web_images_with_version_stamping() -> None:
    release = yaml.safe_load((ROOT / ".github/workflows/release.yml").read_text())
    matrix = release["jobs"]["docker"]["strategy"]["matrix"]["include"]
    mapping = {entry["image"]: entry["dockerfile"] for entry in matrix}
    assert mapping["raptix-web-raptix-ui"] == "containers/web-raptix.Dockerfile"
    assert mapping["raptix-web-raptix-api"] == "containers/web-raptix-server.Dockerfile"
    for dockerfile in ("web-raptix.Dockerfile", "web-raptix-server.Dockerfile"):
        source = (ROOT / "containers" / dockerfile).read_text()
        assert "org.opencontainers.image.version" in source
        assert "ARG VERSION" in source


@pytest.mark.parametrize(
    "filename", ["release.yml", "release-recover.yml", "promote-stable.yml", "pin-digests.yml"]
)
def test_active_release_lifecycle_has_new_images_and_the_compose_registry(filename: str) -> None:
    workflow = yaml.safe_load((ROOT / ".github/workflows" / filename).read_text())
    scripts = "\n".join(
        step.get("run", "") for job in workflow["jobs"].values() for step in job.get("steps", [])
    )
    assert not re.search(r"\braptix-web\b(?!-)", scripts)
    catalogs = re.findall(r"images=\((.*?)\)|images=\"([^\"]+)\"", scripts, re.S)
    assert catalogs
    for array, string in catalogs:
        assert WEB_IMAGES <= set((array or string).split())
    assert "ghcr.io/bittersecurity/" not in (ROOT / ".github/workflows" / filename).read_text()


def test_installer_updater_and_checksum_manifest_include_web_compose() -> None:
    for filename in (
        "scripts/install.sh",
        "scripts/install.ps1",
        "clients/launcher/internal/updater/updater.go",
    ):
        assert "docker-compose.web-raptix.yml" in (ROOT / filename).read_text()
    release = (ROOT / ".github/workflows/release.yml").read_text()
    assert "sha256sum docker-compose.yml docker-compose.web-raptix.yml" in release
    compose = (ROOT / "docker-compose.web-raptix.yml").read_text()
    for image in WEB_IMAGES:
        assert f"ghcr.io/akapi895/{image}:" in compose
    launcher_release = yaml.safe_load((ROOT / "clients/launcher/.goreleaser.yml").read_text())
    assert launcher_release["release"]["github"] == {"owner": "Akapi895", "name": "raptix"}
