from __future__ import annotations

from datetime import UTC, datetime

from raptix.execution.backends.project_files import ProjectFiles, ProjectFileUnavailable
from raptix.middleware._command_targets import extract_targets
from raptix.middleware.roe import ABORT_PATH, load_rules
from raptix_core.types.roe import (
    EnforcementMode,
    evaluate_command,
    evaluate_target,
    evaluate_time_window,
)


class WebShellRefused(RuntimeError):
    def __init__(self, code: str, detail: str):
        super().__init__(detail)
        self.code = code
        self.detail = detail


def _abort_present(files: ProjectFiles) -> bool:
    try:
        return bool(files.exists(ABORT_PATH))
    except ProjectFileUnavailable as exc:
        raise WebShellRefused("project_unavailable", str(exc)) from exc


def check_request(
    files: ProjectFiles,
    target: str,
    command: str,
    *,
    now: datetime | None = None,
) -> None:
    if _abort_present(files):
        raise WebShellRefused(
            "agent_halted",
            "the operator signalled an emergency abort (.abort); no WebShell request was sent",
        )

    try:
        rules = load_rules(files)
    except ProjectFileUnavailable as exc:
        raise WebShellRefused("roe_unavailable", str(exc)) from exc

    if rules.mode != EnforcementMode.ENFORCE:
        return

    time_decision = evaluate_time_window(now or datetime.now(UTC), rules)
    if not time_decision.allow:
        raise WebShellRefused(time_decision.reason_code, time_decision.reason_detail)

    command_decision = evaluate_command(command, rules)
    if not command_decision.allow:
        raise WebShellRefused(command_decision.reason_code, command_decision.reason_detail)

    targets = {target} | extract_targets(command)
    for candidate in sorted(targets):
        decision = evaluate_target(candidate, rules)
        if not decision.allow:
            raise WebShellRefused(decision.reason_code, decision.reason_detail)
