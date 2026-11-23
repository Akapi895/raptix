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
    assert jobs["changes"]["outputs"]["web"] == "${{ steps.app.outputs.web }}"
    steps = jobs["web"]["steps"]
    assert steps[0]["if"] == "needs.changes.outputs.web != 'true'"
    for step in steps[1:]:
        assert step["if"] == "needs.changes.outputs.web == 'true'"
        assert not step.get("continue-on-error", False)
    commands = "\n".join(step.get("run", "") for step in steps)
    for script in ("typecheck", "lint", "build", "test"):
        assert f"npm run {script} --workspace=@raptix/api" in commands
    assert "npm run build --workspace=@raptix/ui-app" in commands
    assert "cd apps/ui-app && npx vitest run" in commands


def test_required_status_includes_web_and_docker_checks() -> None:
    jobs = workflow()["jobs"]
    dependencies = set(jobs["ci-ok"]["needs"])
    assert {"web", "docker-build", "compose-validate"} <= dependencies <= jobs.keys()
    commands = "\n".join(step.get("run", "") for step in jobs["compose-validate"]["steps"])
    assert "docker compose -f docker-compose.yml config" in commands


def test_change_detection_can_read_pr_files_without_write_permissions() -> None:
    config = workflow()
    permissions = config["jobs"]["changes"].get("permissions", config["permissions"])
    assert permissions["contents"] == "read"
    assert permissions.get("pull-requests") == "read"
    assert "write" not in permissions.values()


def test_prisma_client_is_generated_before_api_typecheck() -> None:
    steps = workflow()["jobs"]["web"]["steps"]
    commands = "\n".join(step.get("run", "") for step in steps)
    generate = commands.index("npx prisma generate --schema=apps/api/prisma/schema.prisma")
    typecheck = commands.index("npm run typecheck --workspace=@raptix/api")
    assert generate < typecheck


@pytest.mark.parametrize(
    ("changed_path", "expected"),
    [
        (
            "apps/api/src/services/tool-catalog.ts",
            {("app", "web"), ("docker", "api")},
        ),
        (
            "apps/ui-app/src/ui/actions.ts",
            {("app", "web"), ("docker", "ui-app")},
        ),
        (
            "apps/shared/web-contracts/src/projects.ts",
            {("app", "web"), ("docker", "api"), ("docker", "ui-app")},
        ),
        ("infra/containers/api.Dockerfile", {("docker", "api")}),
        ("infra/containers/ui-app.Dockerfile", {("docker", "ui-app")}),
        ("infra/containers/ui-app.nginx.conf", {("docker", "ui-app")}),
        ("package-lock.json", {("app", "web"), ("docker", "api"), ("docker", "ui-app")}),
        ("docs/architecture/runtime-boundaries.md", set()),
        ("apps/launcher/main.go", set()),
    ],
)
def test_web_changes_trigger_source_checks_and_affected_images(
    changed_path: str, expected: set[tuple[str, str]]
) -> None:
    steps = workflow()["jobs"]["changes"]["steps"]
    filters = {
        step["id"]: yaml.safe_load(step["with"]["filters"])
        for step in steps
        if step.get("id") in {"app", "docker"}
    }
    web_filters = {("app", "web"), ("docker", "api"), ("docker", "ui-app")}
    triggered = {
        (step, lane)
        for step, lane in web_filters
        if any(fnmatchcase(changed_path, pattern) for pattern in filters[step][lane])
    }
    assert triggered == expected
