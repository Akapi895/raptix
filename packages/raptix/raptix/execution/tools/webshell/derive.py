"""Deterministic derivation of a WebShell profile from a sealed PoC (M2.1, ADR-0105).

Parses the sealed command with shlex, extracts the HTTP endpoint, form parameter,
headers and probe values.  Returns a validated profile or ``needs_refinement`` when
the command is not a recognisable curl POST with form data.
"""

from __future__ import annotations

import shlex
from typing import Any
from urllib.parse import urlsplit

from raptix.execution.backends.project_files import ProjectFileUnavailable, ProjectFiles
from raptix.execution.tools.plumbing.candidate_verification import (
    PocSpec,
    _Refused,
    check_candidate,
    parse_spec,
    read_poc_block,
    seal_of,
)
from raptix.execution.tools.webshell.profile import WebShellProfile, normalize_target

_SPEC_SHA256 = "spec_sha256"
_SKIP_FLAGS = frozenset(
    {"-s", "--silent", "-S", "--show-error", "-k", "--insecure", "-L", "--location", "-v", "--verbose"}
)
_ARG_FLAGS = frozenset(
    {"--max-time", "--connect-timeout", "-w", "--write-out", "-o", "--output", "--retry", "-u", "--user"}
)
_ALLOWED_HEADER_KEYS = frozenset({"user-agent", "content-type"})


def _parse_curl_tokens(tokens: list[str]) -> dict[str, Any] | None:
    if not tokens or tokens[0] != "curl":
        return None

    url: str | None = None
    method: str | None = None
    headers: dict[str, str] = {}
    data_urlencode: list[str] = []
    data_entries: list[str] = []

    i = 1
    while i < len(tokens):
        tok = tokens[i]
        if tok in ("-X", "--request") and i + 1 < len(tokens):
            i += 1
            method = tokens[i].upper()
        elif tok in ("-H", "--header") and i + 1 < len(tokens):
            i += 1
            colon = tokens[i].find(":")
            if colon > 0:
                headers[tokens[i][:colon].strip()] = tokens[i][colon + 1 :].strip()
        elif tok == "--data-urlencode" and i + 1 < len(tokens):
            i += 1
            data_urlencode.append(tokens[i])
        elif tok in ("-d", "--data", "--data-raw") and i + 1 < len(tokens):
            i += 1
            data_entries.append(tokens[i])
        elif tok in _SKIP_FLAGS:
            pass
        elif tok in _ARG_FLAGS and i + 1 < len(tokens):
            i += 1
        elif tok.startswith("-"):
            pass
        elif url is None:
            url = tok
        i += 1

    if url is None:
        return None
    if method is None and (data_urlencode or data_entries):
        method = "POST"

    form: dict[str, str] = {}
    for entry in data_urlencode:
        eq = entry.find("=")
        if eq > 0:
            form[entry[:eq]] = entry[eq + 1 :]
    for entry in data_entries:
        for pair in entry.split("&"):
            eq = pair.find("=")
            if eq > 0:
                form[pair[:eq]] = pair[eq + 1 :]

    return {"url": url, "method": method or "GET", "headers": headers, "form": form}


def _derive_from_spec(spec: PocSpec, block: dict[str, Any]) -> dict[str, Any]:
    try:
        pos_tokens = shlex.split(spec.command)
        neg_tokens = shlex.split(spec.negative_command)
    except ValueError:
        return {"status": "needs_refinement", "reason": "command_not_parseable"}

    pos = _parse_curl_tokens(pos_tokens)
    neg = _parse_curl_tokens(neg_tokens)
    if pos is None or neg is None:
        return {"status": "needs_refinement", "reason": "not_a_curl_command"}
    if pos["method"] != "POST":
        return {"status": "needs_refinement", "reason": "method_not_post"}
    if pos["url"] != neg["url"]:
        return {"status": "needs_refinement", "reason": "url_mismatch_between_commands"}

    endpoint: str = pos["url"]
    try:
        host = urlsplit(endpoint).hostname
    except Exception:
        return {"status": "needs_refinement", "reason": "endpoint_parse_failed"}
    if not host:
        return {"status": "needs_refinement", "reason": "no_host_in_endpoint"}
    target = normalize_target(host)

    pos_form: dict[str, str] = pos["form"]
    neg_form: dict[str, str] = neg["form"]
    candidates = [
        (key, value)
        for key, value in pos_form.items()
        if spec.payload in value and neg_form.get(key, "") != value
    ]
    if len(candidates) != 1:
        return {"status": "needs_refinement", "reason": "command_parameter_ambiguous"}

    command_parameter, probe_command = candidates[0]
    if not spec.success_patterns:
        return {"status": "needs_refinement", "reason": "no_success_patterns"}
    probe_pattern = spec.success_patterns[0]

    profile_headers: dict[str, str] = {}
    for key, value in pos.get("headers", {}).items():
        if key.lower() in _ALLOWED_HEADER_KEYS:
            profile_headers[key] = value

    profile_data: dict[str, Any] = {
        "provider": "http-form-command",
        "target": target,
        "endpoint": endpoint,
        "method": "POST",
        "content_type": "application/x-www-form-urlencoded",
        "command_parameter": command_parameter,
        "probe_command": probe_command,
        "probe_pattern": probe_pattern,
    }
    if profile_headers:
        profile_data["headers"] = profile_headers

    try:
        profile = WebShellProfile.model_validate(profile_data)
    except Exception as exc:
        return {"status": "needs_refinement", "reason": f"profile_invalid: {exc}"}

    return {
        "status": "derived",
        "profile": profile.model_dump(exclude_none=True),
        "poc_sha256": spec.poc_sha256,
        "spec_sha256": block.get(_SPEC_SHA256),
    }


async def derive_profile(files: ProjectFiles, finding_id: str) -> dict[str, Any]:
    """Read the sealed PoC for *finding_id* and derive a WebShellProfile deterministically."""
    try:
        md = files.read_bytes(f"findings/{finding_id}.md")
    except ProjectFileUnavailable as exc:
        return {"status": "refused", "reason": f"project_unavailable: {exc}"}
    if md is None:
        return {"status": "refused", "reason": "finding_not_found"}

    try:
        block = read_poc_block(md.decode("utf-8"))
    except _Refused as exc:
        return {"status": "refused", "reason": str(exc)}
    if block is None:
        return {"status": "refused", "reason": "no_poc_block"}

    if block.get(_SPEC_SHA256) != seal_of(block):
        return {"status": "refused", "reason": "seal_mismatch"}

    try:
        spec = parse_spec(block)
        check_candidate(spec)
    except _Refused as exc:
        return {"status": "refused", "reason": str(exc)}

    return _derive_from_spec(spec, block)
