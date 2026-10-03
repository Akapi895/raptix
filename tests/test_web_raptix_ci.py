"""The actual workflow must route web changes to executable quality steps."""

from fnmatch import fnmatchcase
from pathlib import Path
from typing import Any

import pytest
import yaml


def workflow() -> dict[str, Any]:
    root = Path(__file__).resolve().parents[1]
    return yaml.safe_load((root / ".github/workflows/ci.yml").read_text(encoding="utf-8"))


def test_web_filter_output_is_exported_and_every_quality_step_consumes_it() -> None:
    jobs = workflow()["jobs"]
    assert jobs["changes"]["outputs"]["web-raptix"] == "${{ steps.app.outputs['web-raptix'] }}"
    steps = jobs["web-raptix"]["steps"]
    assert steps[0]["if"] == "needs.changes.outputs['web-raptix'] != 'true'"
    for step in steps[1:]:
        expected = "needs.changes.outputs['web-raptix'] == 'true'"
        if step.get("uses", "").startswith("actions/upload-artifact@"):
            expected = f"always() && {expected}"
        assert step["if"] == expected
        assert not step.get("continue-on-error", False)
    commands = "\n".join(step.get("run", "") for step in steps)
    for script in ("typecheck", "lint", "build", "test"):
        assert f"npm run {script} --workspace=@raptix/web-raptix-server" in commands
        assert f"npm run {script} --workspace=@raptix/web-raptix" in commands
    assert "node clients/web-raptix/tools/verify-docker-real-mode.mjs" in commands
    assert "VITE_DATA_MODE=real" not in commands  # Docker default must be exercised.


def test_required_status_includes_new_web_job_and_only_existing_dependencies() -> None:
    jobs = workflow()["jobs"]
    dependencies = jobs["ci-ok"]["needs"]
    assert "web-raptix" in dependencies
    assert "web" not in dependencies
    assert set(dependencies) <= set(jobs)
    commands = "\n".join(step.get("run", "") for step in jobs["compose-validate"]["steps"])
    assert "docker compose -f docker-compose.web-raptix.yml config" in commands


def test_change_detection_can_read_pr_files_without_write_permissions() -> None:
    config = workflow()
    permissions = config["jobs"]["changes"].get("permissions", config["permissions"])
    assert permissions["contents"] == "read"
    assert permissions.get("pull-requests") == "read"
    assert "write" not in permissions.values()


def test_owned_prisma_client_is_generated_before_clean_server_typecheck() -> None:
    steps = workflow()["jobs"]["web-raptix"]["steps"]
    commands = "\n".join(step.get("run", "") for step in steps)
    generate = commands.index("npm run prisma:generate --workspace=@raptix/web-raptix-server")
    typecheck = commands.index("npm run typecheck --workspace=@raptix/web-raptix-server")
    assert generate < typecheck


@pytest.mark.parametrize(
    ("changed_path", "should_run"),
    [
        ("clients/web-raptix/src/App.tsx", True),
        ("clients/web-raptix/server/src/main.ts", True),
        ("clients/shared/web-contracts/src/projects.ts", True),
        ("clients/shared/streaming/src/index.ts", True),
        ("containers/web-raptix.Dockerfile", True),
        ("containers/web-raptix-server.Dockerfile", True),
        ("containers/web-raptix-proxy.conf", True),
        ("docker-compose.web-raptix.yml", True),
        ("package-lock.json", True),
        (".github/workflows/ci.yml", True),
        ("docs/QUALITY_BAR.md", False),
        ("clients/web/src/app/page.tsx", False),
        ("clients/launcher/main.go", False),
    ],
)
def test_actual_web_filter_routes_source_contracts_and_deployment_changes(
    changed_path: str, should_run: bool
) -> None:
    steps = workflow()["jobs"]["changes"]["steps"]
    app = next(step for step in steps if step.get("id") == "app")
    patterns = yaml.safe_load(app["with"]["filters"])["web-raptix"]
    assert any(fnmatchcase(changed_path, pattern) for pattern in patterns) is should_run
