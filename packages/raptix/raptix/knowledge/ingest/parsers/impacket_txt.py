"""Impacket console output parser (``ad.impacket.*`` adapters).

One ``impacket_txt`` format serves two capabilities whose tool output
shares the format name — disambiguation is deterministic, not guessed:

  * **credential extraction** (``access.credential_dump`` /
    ``impacket-secretsdump``): ``account:rid:lm:nt:::`` hash lines
    (SAM/NTDS) are the only lines that carry credential evidence.
  * **lateral execution** (``access.move_laterally`` /
    ``impacket-psexec`` / ``-wmiexec`` / ``-atexec``): service-manager
    markers plus the remote command's bounded output tail.
  * **failure-only output** (``[-]``/``[!]`` lines, NT ``STATUS_*``
    errors, tracebacks): zero node observations — a failed execution
    must never become fabricated success.

When both positive shapes appear in one artifact (mixed capture) both
observation families are emitted and the summary names the mix; when
only failure signals are present the summary reports them instead.
"""

from __future__ import annotations

import re
from typing import Any

from raptix.knowledge.ingest.parsers._shared import node_observation, summary_observation
from raptix_core.types.capability import Artifact, Observation

_NTDS_LINE = re.compile(
    r"^(?P<account>[^:\s][^:]*):(?P<rid>\d{1,10}):"
    r"(?P<lm>[0-9a-fA-F]{32}):(?P<nt>[0-9a-fA-F]{32}):::\s*$"
)
_LATERAL_MARKER = re.compile(
    r"Requesting shares on|Found writable share|Uploading file|"
    r"Opening SVCManager on|Creating service|Starting service"
)
_FAILURE_LINE = re.compile(r"^(\[-\]|\[!\])|STATUS_[A-Z_]+|Traceback \(most recent call last\)")
_TARGET_LINE = re.compile(r"(?:Requesting shares on|Opening SVCManager on)\s+(\S+)")
_MAX_OUTPUT_LINES = 10
_MAX_OUTPUT_TEXT = 200
_MAX_FAILURE_SIGNALS = 5
_MAX_FAILURE_TEXT = 160


def _credential_lines(text: str) -> list[dict[str, str]]:
    matches: list[dict[str, str]] = []
    for line in text.splitlines():
        match = _NTDS_LINE.match(line)
        if match is not None:
            matches.append(match.groupdict())
    return matches


def _failure_signals(text: str) -> list[str]:
    signals: list[str] = []
    for line in text.splitlines():
        stripped = line.strip()
        if stripped and _FAILURE_LINE.search(stripped):
            signals.append(stripped[:_MAX_FAILURE_TEXT])
            if len(signals) >= _MAX_FAILURE_SIGNALS:
                break
    return signals


def _detect_target(text: str, metadata: Any) -> str:
    declared = str(metadata.get("target") or "")
    if declared:
        return declared
    for line in text.splitlines():
        match = _TARGET_LINE.search(line)
        if match is not None:
            # Marker lines pad with trailing dots ("Opening SVCManager on
            # 10.0.0.10....."); strip them, never the hostname itself.
            return match.group(1).rstrip(".")
    return ""


class ImpacketTxtParser:
    format_id = "impacket_txt"
    parser_version = "1.0.0"

    def supports(self, artifact: Artifact, content: bytes) -> float:
        head = content[:4096].decode("utf-8", errors="replace")
        if _credential_lines(head):
            return 0.9
        if sum(1 for line in head.splitlines() if _LATERAL_MARKER.search(line)) >= 2:
            return 0.8
        return 0.0

    def parse(self, artifact: Artifact, content: bytes) -> list[Observation]:
        text = content.decode("utf-8", errors="replace")
        credentials = _credential_lines(text)
        command_output = self._command_output(text)
        marker_count = sum(1 for line in text.splitlines() if _LATERAL_MARKER.search(line))
        # Lateral-execution evidence needs the sequence to have actually
        # run: >= 2 service markers AND command output after them. Two
        # markers followed by an error is a failed attempt, never a
        # session.
        has_lateral = marker_count >= 2 and bool(command_output)

        observations: list[Observation] = []
        summary: dict[str, Any] = {}
        if credentials:
            observations.extend(self._credential_observations(artifact, credentials))
            summary["shape"] = "mixed" if has_lateral else "credential_extraction"
            summary["accounts_extracted"] = len(credentials)
        elif has_lateral:
            observations.extend(self._lateral_observations(artifact, text, command_output))
            summary["shape"] = "lateral_execution"
        else:
            summary["shape"] = "failure"
        failure_signals = _failure_signals(text)
        if failure_signals:
            summary["failure_signals"] = failure_signals
        observations.append(summary_observation(summary))
        return observations

    def _credential_observations(
        self, artifact: Artifact, credentials: list[dict[str, str]]
    ) -> list[Observation]:
        target = str(artifact.metadata.get("target") or "")
        observations: list[Observation] = []
        if target:
            observations.append(
                node_observation(
                    "Host",
                    key=f"host::{target}",
                    label=target,
                    props={"source": "impacket-secretsdump", "address": target},
                )
            )
        for cred in credentials:
            account = cred["account"]
            is_machine = account.endswith("$")
            props: dict[str, Any] = {
                "source": "impacket-secretsdump",
                "secret_type": "ntlm",
                "rid": int(cred["rid"]),
                "hash": cred["nt"],
                "account": account,
                "evidence": "tool_reported",
            }
            if target:
                props["target"] = target
            edges_out: list[dict[str, Any]] = []
            if not is_machine and "\\" in account:
                domain, _, user = account.rpartition("\\")
                props["domain"] = domain
                edges_out.append(
                    {"to_key": f"user::{account}", "kind": "AUTHENTICATES_TO", "weight": 0.5}
                )
                observations.append(
                    node_observation(
                        "User",
                        key=f"user::{account}",
                        label=account,
                        props={"source": "impacket-secretsdump", "domain": domain, "user": user},
                    )
                )
            observations.append(
                node_observation(
                    "Credential",
                    key=f"cred-ntlm::{account}",
                    label=account,
                    props=props,
                    edges_out=edges_out,
                )
            )
        return observations

    def _lateral_observations(
        self, artifact: Artifact, text: str, command_output: list[str]
    ) -> list[Observation]:
        target = _detect_target(text, artifact.metadata)
        observations: list[Observation] = []
        if target:
            observations.append(
                node_observation(
                    "Host",
                    key=f"host::{target}",
                    label=target,
                    props={"source": "impacket", "address": target},
                )
            )
        props: dict[str, Any] = {
            "source": "impacket",
            "evidence": "remote_command_execution",
        }
        if target:
            props["target"] = target
        technique = str(artifact.metadata.get("technique") or "")
        if technique:
            props["technique"] = technique
        if command_output:
            props["command_output"] = command_output
        session_key = f"session::impacket::{target}" if target else "session::impacket::unknown"
        observations.append(
            node_observation("Session", key=session_key, label=session_key, props=props)
        )
        return observations

    def _command_output(self, text: str) -> list[str]:
        """Bounded remote-command output tail: lines after the last
        service-execution marker that are not impacket's own chatter."""
        lines = [line.rstrip() for line in text.splitlines()]
        last_marker = -1
        for index, line in enumerate(lines):
            if _LATERAL_MARKER.search(line):
                last_marker = index
        output: list[str] = []
        for line in lines[last_marker + 1 :]:
            stripped = line.strip()
            if not stripped or _FAILURE_LINE.search(stripped):
                continue
            if stripped.startswith("["):
                continue
            output.append(stripped[:_MAX_OUTPUT_TEXT])
            if len(output) >= _MAX_OUTPUT_LINES:
                break
        return output
