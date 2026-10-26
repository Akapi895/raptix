from __future__ import annotations

import asyncio
import re
import time
from typing import Any

from raptix.execution.backends.project_files import (
    ProjectFiles,
    project_files_for,
    project_sandbox_for,
)
from raptix.execution.tools.webshell.gates import check_request
from raptix.execution.tools.webshell.http_form import (
    build_curl_command,
    classify_command,
    classify_probe,
    parse_response,
)
from raptix.execution.tools.webshell.profile import WebShellProfile

DEFAULT_HTTP_TIMEOUT_SECONDS = 30


def _result(
    *,
    state: str,
    http_status: int | None = None,
    matched: bool | None = None,
    output: str = "",
    output_truncated: bool = False,
    error: str | None = None,
    duration_ms: int = 0,
) -> dict[str, Any]:
    return {
        "state": state,
        "http_status": http_status,
        "matched": matched,
        "output": output,
        "output_truncated": output_truncated,
        "error": error,
        "duration_ms": duration_ms,
    }


async def _run(
    sandbox: Any,
    profile: WebShellProfile,
    payload: str,
    *,
    is_probe: bool,
    timeout_seconds: int,
) -> dict[str, Any]:
    curl = build_curl_command(profile, payload, timeout_seconds=timeout_seconds)
    started = time.monotonic()
    try:
        response = await asyncio.wait_for(
            asyncio.to_thread(sandbox.execute, curl, timeout=timeout_seconds),
            timeout=timeout_seconds + 15,
        )
    except asyncio.TimeoutError:
        return _result(
            state="unknown" if is_probe else "uncertain",
            error="sandbox_timeout",
            duration_ms=int((time.monotonic() - started) * 1000),
        )
    except Exception as exc:
        return _result(
            state="unknown" if is_probe else "uncertain",
            error=f"sandbox_error: {type(exc).__name__}",
            duration_ms=int((time.monotonic() - started) * 1000),
        )

    parsed = parse_response(
        str(getattr(response, "output", "") or ""),
        curl_exit=getattr(response, "exit_code", None),
        truncated=bool(getattr(response, "truncated", False)),
    )
    matched: bool | None = None
    if is_probe:
        state = classify_probe(parsed, profile.probe_pattern)
        if parsed.http_status is not None:
            try:
                matched = re.search(profile.probe_pattern, parsed.body) is not None
            except re.error:
                matched = False
    else:
        state = classify_command(parsed)

    return _result(
        state=state,
        http_status=parsed.http_status,
        matched=matched,
        output=parsed.body,
        output_truncated=parsed.output_truncated,
        error=parsed.error,
        duration_ms=int((time.monotonic() - started) * 1000),
    )


async def probe_with(
    files: ProjectFiles,
    sandbox: Any,
    profile: WebShellProfile,
    *,
    timeout_seconds: int = DEFAULT_HTTP_TIMEOUT_SECONDS,
) -> dict[str, Any]:
    check_request(files, profile.target, profile.probe_command)
    return await _run(
        sandbox,
        profile,
        profile.probe_command,
        is_probe=True,
        timeout_seconds=timeout_seconds,
    )


async def execute_with(
    files: ProjectFiles,
    sandbox: Any,
    profile: WebShellProfile,
    command: str,
    *,
    timeout_seconds: int = DEFAULT_HTTP_TIMEOUT_SECONDS,
) -> dict[str, Any]:
    check_request(files, profile.target, command)
    return await _run(
        sandbox,
        profile,
        command,
        is_probe=False,
        timeout_seconds=timeout_seconds,
    )


async def probe_webshell(
    config: Any,
    profile: WebShellProfile,
    *,
    timeout_seconds: int = DEFAULT_HTTP_TIMEOUT_SECONDS,
) -> dict[str, Any]:
    return await probe_with(
        project_files_for(config),
        project_sandbox_for(config),
        profile,
        timeout_seconds=timeout_seconds,
    )


async def execute_webshell(
    config: Any,
    profile: WebShellProfile,
    command: str,
    *,
    timeout_seconds: int = DEFAULT_HTTP_TIMEOUT_SECONDS,
) -> dict[str, Any]:
    return await execute_with(
        project_files_for(config),
        project_sandbox_for(config),
        profile,
        command,
        timeout_seconds=timeout_seconds,
    )
