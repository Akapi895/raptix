"""The verifier's only verdict path for a workspace finding (ADR-0103).

The verifier passes a finding id and nothing else. This module reads the sealed Proof of Concept block from the finding,
checks the seal and the baseline, runs the PoC through ``validate_workspace_finding`` with the values from the file, and
writes the verdict. No command, pattern or CVSS vector comes from the model.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from langchain_core.runnables import RunnableConfig
from langchain_core.tools import tool

from raptix.execution.backends.project_files import (
    ProjectFiles,
    ProjectFileUnavailable,
    project_files_for,
)
from raptix.execution.tools.plumbing.verification import validate_workspace_finding
from raptix_core.types.roe import evaluate_command, evaluate_target, evaluate_time_window

FINDING_ID = re.compile(r"FIND-\d{3}")
POC_BLOCK = re.compile(r"## Proof of Concept.*?```json\n(.*?)\n```", re.DOTALL)
_SEAL = "spec_sha256"
_TEXT_FIELDS = ("file", "poc_sha256", "payload", "command", "negative_command", "cvss_vector")
_PATTERN_FIELDS = ("success_patterns", "negative_patterns")
_POC_DIRECTORY = "findings/poc/"
_MIN_PATTERN_LENGTH = 4


class _Refused(Exception):
    """The finding cannot be verified as written. The message is the reason recorded in the verification file."""


@dataclass(frozen=True)
class PocSpec:
    file: str
    poc_sha256: str
    payload: str
    command: str
    success_patterns: tuple[str, ...]
    negative_command: str
    negative_patterns: tuple[str, ...]
    cvss_vector: str


def read_poc_block(markdown: str) -> dict[str, Any] | None:
    """The JSON object under the Proof of Concept heading, or None when the finding has no PoC block."""
    match = POC_BLOCK.search(markdown)
    if match is None:
        return None
    try:
        block = json.loads(match.group(1))
    except json.JSONDecodeError as exc:
        raise _Refused(f"poc_block_invalid_json: {exc.msg}") from exc
    if not isinstance(block, dict):
        raise _Refused("poc_block_not_object")
    return block


def seal_of(block: dict[str, Any]) -> str:
    """SHA-256 of the block's canonical JSON without its own seal. The generator computes the same value."""
    body = {key: value for key, value in block.items() if key != _SEAL}
    canonical = json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def parse_spec(block: dict[str, Any]) -> PocSpec:
    missing = [key for key in (*_TEXT_FIELDS, *_PATTERN_FIELDS, _SEAL) if key not in block]
    if missing:
        raise _Refused(f"poc_block_missing: {', '.join(missing)}")
    for key in _TEXT_FIELDS:
        if not isinstance(block[key], str) or not block[key].strip():
            raise _Refused(f"poc_block_invalid: {key}")
    for key in _PATTERN_FIELDS:
        value = block[key]
        if (
            not isinstance(value, list)
            or not value
            or not all(isinstance(item, str) for item in value)
        ):
            raise _Refused(f"poc_block_invalid: {key}")
    if not block["file"].startswith(_POC_DIRECTORY):
        raise _Refused(f"poc_block_invalid: file must be under {_POC_DIRECTORY}")
    return PocSpec(
        file=block["file"],
        poc_sha256=block["poc_sha256"],
        payload=block["payload"],
        command=block["command"],
        success_patterns=tuple(block["success_patterns"]),
        negative_command=block["negative_command"],
        negative_patterns=tuple(block["negative_patterns"]),
        cvss_vector=block["cvss_vector"],
    )


def _squashed(text: str) -> str:
    return " ".join(text.split())


def check_candidate(spec: PocSpec) -> None:
    """The baseline must be the PoC with its payload removed, and every pattern must be specific enough to prove something."""
    if spec.command.count(spec.payload) != 1:
        raise _Refused("baseline_invalid: the payload must occur exactly once in the command")
    if _squashed(spec.negative_command) != _squashed(spec.command.replace(spec.payload, "", 1)):
        raise _Refused(
            "baseline_invalid: negative_command is not the command with the payload removed"
        )
    for pattern in (*spec.success_patterns, *spec.negative_patterns):
        if "," in pattern:
            raise _Refused("pattern_invalid: a pattern cannot contain a comma")
        if len(pattern) < _MIN_PATTERN_LENGTH:
            raise _Refused(
                f"pattern_invalid: shorter than {_MIN_PATTERN_LENGTH} characters: {pattern!r}"
            )
        try:
            compiled = re.compile(pattern)
        except re.error as exc:
            raise _Refused(f"pattern_invalid: {exc}") from exc
        if compiled.search("") is not None:
            raise _Refused(f"pattern_invalid: matches the empty output: {pattern!r}")


def with_status(markdown: str, status: str) -> str:
    """The finding with its frontmatter status set. The status line is the only field this writes."""
    line = f"status: {status}"
    if markdown.startswith("---\n"):
        end = markdown.find("\n---", 4)
        if end != -1:
            lines = markdown[:end].split("\n")
            for index, existing in enumerate(lines):
                if existing.startswith("status:"):
                    lines[index] = line
                    break
            else:
                lines.append(line)
            return "\n".join(lines) + markdown[end:]
    return f"---\n{line}\n---\n{markdown}"


def _out_of_scope(files: ProjectFiles, commands: tuple[str, ...]) -> str | None:
    """The RoE decision for each command, made with the functions the middleware applies to bash. None when allowed."""
    # Imported here: the RoE middleware imports the execution layer, which this module belongs to.
    from raptix.middleware._command_targets import extract_targets
    from raptix.middleware.roe import load_rules

    try:
        rules = load_rules(files)
    except ProjectFileUnavailable as exc:
        raise _Refused(f"roe_unavailable: {exc}") from exc
    window = evaluate_time_window(datetime.now(UTC), rules)
    if not window.allow:
        return f"{window.reason_code}: {window.reason_detail}"
    for command in commands:
        decision = evaluate_command(command, rules)
        if not decision.allow:
            return f"{decision.reason_code}: {decision.reason_detail}"
        for target in sorted(extract_targets(command)):
            decision = evaluate_target(target, rules)
            if not decision.allow:
                return f"{decision.reason_code}: {decision.reason_detail}"
    return None


def _complete(execution: Any) -> bool:
    return (
        isinstance(execution, dict)
        and bool(execution)
        and all(
            isinstance(step, dict) and step.get("complete") is True and step.get("exit_code") == 0
            for step in execution.values()
        )
    )


def _record(
    finding_id: str,
    verdict: str,
    refusal: str | None,
    block: dict[str, Any] | None,
    result: dict[str, Any] | None,
) -> dict[str, Any]:
    return {
        "finding_id": finding_id,
        "verdict": verdict,
        "refusal": refusal,
        "recorded_at": datetime.now(UTC).isoformat(),
        "poc_sha256": block.get("poc_sha256") if block else None,
        "spec_sha256": block.get(_SEAL) if block else None,
        "command": block.get("command") if block else None,
        "negative_command": block.get("negative_command") if block else None,
        "tool_result": result,
    }


async def _verdict(
    files: ProjectFiles, finding_id: str, markdown: str, config: RunnableConfig
) -> dict[str, Any]:
    block: dict[str, Any] | None = None
    try:
        block = read_poc_block(markdown)
        if block is None:
            raise _Refused("no_poc_block")
        spec = _verified_spec(files, block)
        scope = _out_of_scope(files, (spec.command, spec.negative_command))
        if scope is not None:
            raise _Refused(f"out_of_scope: {scope}")
    except _Refused as refusal:
        return _record(finding_id, "candidate", str(refusal), block, None)

    raw = await validate_workspace_finding.ainvoke(
        {
            "finding_id": finding_id,
            "poc_command": spec.command,
            "success_patterns": ",".join(spec.success_patterns),
            "negative_command": spec.negative_command,
            "negative_patterns": ",".join(spec.negative_patterns),
            "cvss_vector": spec.cvss_vector,
        },
        config=config,
    )
    try:
        result = json.loads(str(raw))
    except json.JSONDecodeError:
        return _record(
            finding_id, "candidate", "verification_error: unreadable tool output", block, None
        )
    if "error" in result:
        return _record(
            finding_id, "candidate", f"verification_error: {result['error']}", block, result
        )
    if result.get("validated") is True:
        return _record(finding_id, "confirmed", None, block, result)
    if not _complete(result.get("verification_execution")):
        return _record(finding_id, "candidate", "execution_incomplete", block, result)
    return _record(finding_id, "rejected", None, block, result)


def _persist(files: ProjectFiles, finding_id: str, markdown: str, record: dict[str, Any]) -> None:
    """Writes the verdict file and the finding's status. A confirmed status is written only after its record, and any other
    status before its record, so a finding never reads as confirmed without a validated record behind it."""
    evidence = f"findings/evidence/{finding_id}_verification.json"
    body = json.dumps(record, sort_keys=True, indent=2).encode("utf-8")
    status = with_status(markdown, record["verdict"]).encode("utf-8")
    if record["verdict"] == "confirmed":
        files.write_bytes(evidence, body)
        files.write_bytes(f"findings/{finding_id}.md", status)
    else:
        files.write_bytes(f"findings/{finding_id}.md", status)
        files.write_bytes(evidence, body)


def _verified_spec(files: ProjectFiles, block: dict[str, Any]) -> PocSpec:
    """The sealed spec after the seal, the PoC file hash and the structural checks. Raises _Refused otherwise."""
    if block.get(_SEAL) != seal_of(block):
        raise _Refused("seal_mismatch: the block changed after it was sealed")
    spec = parse_spec(block)
    poc = files.read_bytes(spec.file)
    if poc is None:
        raise _Refused(f"poc_file_missing: {spec.file}")
    if hashlib.sha256(poc).hexdigest() != spec.poc_sha256:
        raise _Refused("poc_hash_mismatch: the PoC file changed after it was sealed")
    check_candidate(spec)
    return spec


# ADR-0104: a sealed command may carry this placeholder outside its payload. The operator's value replaces it at run time.
TOKEN_PLACEHOLDER = "{{TOKEN}}"
_EXCERPT_CHARS = 16000
_SOURCE_CHARS = 65536


_TOKEN_VALUE = re.compile(r"[A-Za-z0-9._+/=:@%-]{1,512}")


def substitute_token(command: str, token: str | None) -> str:
    """The command with every placeholder replaced by the run-time value.

    The value must be one token of letters, digits and ``._+/=:@%-``. That set has no shell syntax, so the value can
    sit inside quotes or outside them without adding a word, a quote or a command to the executed line.
    """
    if TOKEN_PLACEHOLDER not in command:
        return command
    if token is None or _TOKEN_VALUE.fullmatch(token) is None:
        raise _Refused("run_time_value_invalid: enter one token of letters, digits and ._+/=:@%-")
    return command.replace(TOKEN_PLACEHOLDER, token)


def _excerpt(text: str, token: str | None) -> str:
    """Output for the console: the run-time value is removed before the text is cut."""
    clean = text.replace(token, "[redacted]") if token else text
    return clean[:_EXCERPT_CHARS]


def _matched(patterns: tuple[str, ...], output: str) -> list[str]:
    return [pattern for pattern in patterns if re.search(pattern, output)]


async def read_sealed_poc(files: ProjectFiles, finding_id: str) -> dict[str, Any]:
    """The sealed PoC of a finding, read-only: its commands, its patterns and whether the seal holds."""
    markdown_bytes = files.read_bytes(f"findings/{finding_id}.md")
    if markdown_bytes is None:
        return {"finding_id": finding_id, "status": "finding_not_found"}
    try:
        block = read_poc_block(markdown_bytes.decode("utf-8"))
        if block is None:
            return {"finding_id": finding_id, "status": "no_poc_block"}
        spec = _verified_spec(files, block)
    except _Refused as refusal:
        return {"finding_id": finding_id, "status": "refused", "refusal": str(refusal)}
    source = files.read_bytes(spec.file) or b""
    return {
        "finding_id": finding_id,
        "status": "sealed",
        "file": spec.file,
        "payload": spec.payload,
        "command": spec.command,
        "negative_command": spec.negative_command,
        "success_patterns": list(spec.success_patterns),
        "negative_patterns": list(spec.negative_patterns),
        "cvss_vector": spec.cvss_vector,
        "run_time_value": TOKEN_PLACEHOLDER in spec.command
        or TOKEN_PLACEHOLDER in spec.negative_command,
        "source": source[:_SOURCE_CHARS].decode("utf-8", errors="replace"),
        "source_truncated": len(source) > _SOURCE_CHARS,
    }


async def reproduce_sealed(
    files: ProjectFiles,
    runner: Callable[[str], Awaitable[tuple[str, str, int]]],
    finding_id: str,
    token: str | None,
) -> dict[str, Any]:
    """Run the sealed PoC once, positive and negative, through the verifier's gates (ADR-0104). Writes no verdict."""
    # Imported here, as in _out_of_scope: the RoE middleware imports the execution layer.
    from raptix.middleware.roe import ABORT_PATH

    try:
        markdown_bytes = files.read_bytes(f"findings/{finding_id}.md")
        if markdown_bytes is None:
            raise _Refused("finding_not_found")
        block = read_poc_block(markdown_bytes.decode("utf-8"))
        if block is None:
            raise _Refused("no_poc_block")
        spec = _verified_spec(files, block)
        if TOKEN_PLACEHOLDER in spec.payload:
            raise _Refused("poc_block_invalid: the payload cannot contain the run-time placeholder")
        if files.exists(ABORT_PATH):
            raise _Refused("agent_halted: the operator's .abort marker is present")
        positive_command = substitute_token(spec.command, token)
        negative_command = substitute_token(spec.negative_command, token)
        scope = _out_of_scope(files, (positive_command, negative_command))
        if scope is not None:
            raise _Refused(f"out_of_scope: {scope}")
    except _Refused as refusal:
        return {"finding_id": finding_id, "outcome": "refused", "refusal": str(refusal)}
    except ProjectFileUnavailable as exc:
        return {
            "finding_id": finding_id,
            "outcome": "refused",
            "refusal": f"project_unavailable: {exc}",
        }

    positive_out, positive_err, positive_exit = await runner(positive_command)
    negative_out, negative_err, negative_exit = await runner(negative_command)
    positive_text = f"{positive_out}\n{positive_err}"
    negative_text = f"{negative_out}\n{negative_err}"
    # The shape of a verifier pass, reported for the reader. Only verify_workspace_candidate writes the verdict.
    reproduced = (
        bool(_matched(spec.success_patterns, positive_text))
        and bool(_matched(spec.negative_patterns, negative_text))
        and not _matched(spec.success_patterns, negative_text)
    )
    result = {
        "finding_id": finding_id,
        "outcome": "ran",
        "reproduced": reproduced,
        "command": spec.command,
        "negative_command": spec.negative_command,
        "poc_sha256": spec.poc_sha256,
        "spec_sha256": block[_SEAL],
        "positive": {
            "exit_code": positive_exit,
            "matched_patterns": _matched(spec.success_patterns, positive_text),
            "output": _excerpt(positive_text, token),
        },
        "negative": {
            "exit_code": negative_exit,
            "matched_patterns": _matched(spec.negative_patterns, negative_text),
            "output": _excerpt(negative_text, token),
        },
        "recorded_at": datetime.now(UTC).isoformat(),
    }
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%S%fZ")
    files.write_bytes(
        f"findings/evidence/{finding_id}_reproduce_{stamp}.json",
        json.dumps(result, sort_keys=True, indent=2).encode("utf-8"),
    )
    return result


@tool
async def verify_workspace_candidate(finding_id: str, config: RunnableConfig) -> str:
    """Verify a workspace finding from its sealed Proof of Concept and record the verdict.

    Pass the finding id only. The command, patterns and CVSS vector are read from findings/FIND-NNN.md and cannot be
    supplied here. The result is written to findings/evidence/FIND-NNN_verification.json, and the finding's status is set
    to the same verdict: confirmed only when the PoC validated against its baseline, rejected when it ran and did not
    validate, and candidate when it could not be verified as written.
    """
    if not FINDING_ID.fullmatch(finding_id):
        return json.dumps({"error": "invalid_finding_id"}, sort_keys=True)
    try:
        files = project_files_for(config)
        markdown_bytes = files.read_bytes(f"findings/{finding_id}.md")
        if markdown_bytes is None:
            return json.dumps(
                {"error": "finding_not_found", "finding_id": finding_id}, sort_keys=True
            )
        markdown = markdown_bytes.decode("utf-8")
        record = await _verdict(files, finding_id, markdown, config)
        _persist(files, finding_id, markdown, record)
    except ProjectFileUnavailable as exc:
        return json.dumps({"error": "project_unavailable", "reason": str(exc)}, sort_keys=True)
    except UnicodeDecodeError:
        return json.dumps({"error": "finding_not_utf8", "finding_id": finding_id}, sort_keys=True)
    return json.dumps(
        {
            "finding_id": finding_id,
            "verdict": record["verdict"],
            "refusal": record["refusal"],
            "record": f"findings/evidence/{finding_id}_verification.json",
        },
        sort_keys=True,
    )


CANDIDATE_VERIFICATION_TOOLS = [verify_workspace_candidate]
