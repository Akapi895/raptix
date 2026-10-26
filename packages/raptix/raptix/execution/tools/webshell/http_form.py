from __future__ import annotations

import re
import shlex
from dataclasses import dataclass

from raptix.execution.tools.webshell.profile import WebShellProfile

OUTPUT_LIMIT_BYTES = 196_608
HTTP_STATUS_MARKER = "__RAPTIX_HTTP_STATUS__:"
CURL_EXIT_MARKER = "__RAPTIX_CURL_EXIT__:"
_WRITE_OUT = r"\n__RAPTIX_HTTP_STATUS__:%{http_code}\n"
_CWD_FOOTER_RE = re.compile(r"\n\[cwd: [^\]\n]*\]\s*$")
_AMBIGUOUS_CURL_EXITS = frozenset({28, 55, 56, 92})


@dataclass(frozen=True)
class HttpFormResult:
    http_status: int | None
    body: str
    curl_exit: int | None
    output_truncated: bool
    timed_out: bool
    error: str | None


def build_curl_args(
    profile: WebShellProfile, command: str, *, timeout_seconds: int = 30
) -> list[str]:
    args = [
        "curl",
        "--silent",
        "--show-error",
        "--request",
        profile.method,
        "--max-time",
        str(timeout_seconds),
        "--connect-timeout",
        "10",
    ]
    for key, value in profile.header_items():
        args.extend(["--header", f"{key}: {value}"])
    args.extend(
        [
            "--data-urlencode",
            f"{profile.command_parameter}={command}",
            "--write-out",
            _WRITE_OUT,
            profile.endpoint,
        ]
    )
    return args


def build_curl_command(profile: WebShellProfile, command: str, *, timeout_seconds: int = 30) -> str:
    curl = shlex.join(build_curl_args(profile, command, timeout_seconds=timeout_seconds))
    return f"{curl}; status=$?; printf '{CURL_EXIT_MARKER}%s\\n' \"$status\""


def _parse_status(value: str) -> int | None:
    text = value.strip()
    if len(text) == 3 and text.isdigit():
        port = int(text)
        if 100 <= port <= 599:
            return port
    return None


def parse_response(raw: str, *, curl_exit: int | None, truncated: bool = False) -> HttpFormResult:
    body = raw
    status: int | None = None
    exit_code = curl_exit
    status_at = raw.rfind(HTTP_STATUS_MARKER)
    if status_at >= 0:
        body = raw[:status_at]
        tail = raw[status_at + len(HTTP_STATUS_MARKER) :]
        lines = tail.splitlines()
        if lines:
            status = _parse_status(lines[0])
        for line in lines[1:]:
            if line.startswith(CURL_EXIT_MARKER):
                try:
                    exit_code = int(line[len(CURL_EXIT_MARKER) :].strip())
                except ValueError:
                    pass
    if body.endswith("\n"):
        body = body[:-1]
    body = _CWD_FOOTER_RE.sub("", body)

    output_truncated = truncated
    encoded = body.encode("utf-8", "replace")
    if len(encoded) > OUTPUT_LIMIT_BYTES:
        body = encoded[:OUTPUT_LIMIT_BYTES].decode("utf-8", "ignore")
        output_truncated = True

    timed_out = exit_code in {28, 124}
    error: str | None = None
    if status is None:
        error = f"curl_exit_{exit_code}" if exit_code is not None else "missing_http_status"
    elif exit_code not in (None, 0):
        error = f"curl_exit_{exit_code}"

    return HttpFormResult(
        http_status=status,
        body=body,
        curl_exit=exit_code,
        output_truncated=output_truncated,
        timed_out=timed_out,
        error=error,
    )


def classify_probe(result: HttpFormResult, pattern: str) -> str:
    if result.http_status is None:
        if result.timed_out or result.curl_exit in _AMBIGUOUS_CURL_EXITS:
            return "unknown"
        return "unreachable"
    if not 200 <= result.http_status < 300:
        return "unreachable"
    try:
        matched = re.search(pattern, result.body) is not None
    except re.error:
        matched = False
    return "reachable" if matched else "reachable_no_proof"


def classify_command(result: HttpFormResult) -> str:
    if result.http_status is None:
        if result.timed_out or result.curl_exit in _AMBIGUOUS_CURL_EXITS:
            return "uncertain"
        return "failed"
    if 200 <= result.http_status < 300:
        return "delivered"
    return "failed"
