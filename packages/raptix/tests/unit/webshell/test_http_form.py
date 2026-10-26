from __future__ import annotations

import shlex

from raptix.execution.tools.webshell.http_form import (
    CURL_EXIT_MARKER,
    HTTP_STATUS_MARKER,
    OUTPUT_LIMIT_BYTES,
    build_curl_command,
    classify_command,
    classify_probe,
    parse_response,
)
from raptix.execution.tools.webshell.profile import WebShellProfile


def _profile(**overrides):
    data = {
        "provider": "http-form-command",
        "target": "10.129.88.4",
        "endpoint": "http://10.129.88.4/dev/phpbash.php",
        "method": "POST",
        "content_type": "application/x-www-form-urlencoded",
        "command_parameter": "cmd",
        "probe_command": "id;hostname",
        "probe_pattern": "uid=33",
        "expected_user": "www-data",
        "headers": {"User-Agent": "raptix-test"},
    }
    data.update(overrides)
    return WebShellProfile.model_validate(data)


def _response(body: str, status: int, exit_code: int = 0) -> str:
    return f"{body}\n{HTTP_STATUS_MARKER}{status}\n{CURL_EXIT_MARKER}{exit_code}\n"


def test_build_command_passes_payload_as_data_not_shell():
    command = "id; echo 'quoted'; echo \"double\"; echo $HOME"
    built = build_curl_command(_profile(), command)
    curl_part, _, status_part = built.partition("; status=$?;")
    args = shlex.split(curl_part)
    data_at = args.index("--data-urlencode") + 1
    assert args[data_at] == f"cmd={command}"
    assert args[args.index("--max-time") + 1] == "30"
    assert args[args.index("--connect-timeout") + 1] == "10"
    assert args[-1] == "http://10.129.88.4/dev/phpbash.php"
    assert "printf" in status_part
    assert "$status" in status_part


def test_build_command_includes_only_profile_headers():
    built = build_curl_command(_profile(), "id")
    assert "--header 'User-Agent: raptix-test'" in built
    assert "--header 'Content-Type: application/x-www-form-urlencoded'" in built


def test_parse_response_splits_status_and_body():
    result = parse_response(_response("uid=33(www-data)", 200), curl_exit=0)
    assert result.http_status == 200
    assert result.body == "uid=33(www-data)"
    assert result.error is None


def test_parse_response_takes_last_marker_and_ignores_stderr():
    raw = f"body\n{HTTP_STATUS_MARKER}200\n{CURL_EXIT_MARKER}0\n<stderr>warning</stderr>"
    result = parse_response(raw, curl_exit=0)
    assert result.http_status == 200
    assert result.body == "body"
    assert result.curl_exit == 0


def test_parse_response_strips_cwd_footer():
    result = parse_response(_response("uid=33\n[cwd: /workspace]", 200), curl_exit=0)
    assert result.body == "uid=33"


def test_parse_response_bounds_output():
    body = "x" * (OUTPUT_LIMIT_BYTES + 10)
    result = parse_response(_response(body, 200), curl_exit=0)
    assert len(result.body.encode("utf-8")) == OUTPUT_LIMIT_BYTES
    assert result.output_truncated is True


def test_parse_response_reports_missing_status():
    result = parse_response("no response", curl_exit=7)
    assert result.http_status is None
    assert result.error == "curl_exit_7"


def test_classify_probe():
    reachable = parse_response(_response("uid=33(www-data)", 200), curl_exit=0)
    assert classify_probe(reachable, "uid=33") == "reachable"
    no_proof = parse_response(_response("login page", 200), curl_exit=0)
    assert classify_probe(no_proof, "uid=33") == "reachable_no_proof"
    wrong_status = parse_response(_response("nope", 500), curl_exit=0)
    assert classify_probe(wrong_status, "uid=33") == "unreachable"
    timeout = parse_response("timed out", curl_exit=28)
    assert classify_probe(timeout, "uid=33") == "unknown"
    refused = parse_response("connection refused", curl_exit=7)
    assert classify_probe(refused, "uid=33") == "unreachable"


def test_classify_command():
    delivered = parse_response(_response("ok", 200), curl_exit=0)
    assert classify_command(delivered) == "delivered"
    failed = parse_response(_response("error", 500), curl_exit=0)
    assert classify_command(failed) == "failed"
    timeout = parse_response("timed out", curl_exit=28)
    assert classify_command(timeout) == "uncertain"
    broken = parse_response("connection refused", curl_exit=7)
    assert classify_command(broken) == "failed"
