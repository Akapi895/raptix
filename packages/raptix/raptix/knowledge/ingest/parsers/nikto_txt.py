"""Nikto text report parser (``web.scan_web`` adapter, ``-Format txt``).

Nikto findings are known misconfigurations, default files, and dangerous
settings â€” tool-reported, never independently verified. The report
header carries the anchor facts (Target IP / Hostname / Port / Server);
finding lines start with ``+ `` and everything after the header block.

Metadata lines (``Target IP:``, ``Target Hostname:``, ``Target Port:``,
``Server:``, ``End Time:``, the request-count line, ``host(s) tested``)
are anchor/summary data, not findings, and are excluded from the
finding list.
"""

from __future__ import annotations

import hashlib
import re
from typing import Any

from raptix.knowledge.ingest.parsers._shared import node_observation, summary_observation
from raptix_core.types.capability import Artifact, Observation

_TARGET_IP = re.compile(r"^\+\s*Target IP:\s*(?P<value>\S+)")
_TARGET_HOSTNAME = re.compile(r"^\+\s*Target Hostname:\s*(?P<value>\S+)")
_TARGET_PORT = re.compile(r"^\+\s*Target Port:\s*(?P<value>\d+)")
_SERVER = re.compile(r"^\+\s*Server:\s*(?P<value>.+?)\s*$")
_REQUEST_COUNT = re.compile(r"^\+\s*\d+ requests?: .*? item\(s\) reported")
_END_TIME = re.compile(r"^\+\s*End Time:")
_HOSTS_TESTED = re.compile(r"^\+\s*\d+ host\(s\) tested")
_MAX_FINDING_TEXT = 400


def _anchor(text: str) -> dict[str, str]:
    anchor: dict[str, str] = {}
    for line in text.splitlines():
        for regex, key in (
            (_TARGET_IP, "ip"),
            (_TARGET_HOSTNAME, "hostname"),
            (_TARGET_PORT, "port"),
            (_SERVER, "server"),
        ):
            match = regex.match(line)
            if match is not None:
                anchor[key] = match.group("value")
    return anchor


def _findings(text: str) -> list[str]:
    findings: list[str] = []
    for line in text.splitlines():
        if not line.startswith("+ "):
            continue
        if any(
            regex.match(line)
            for regex in (
                _TARGET_IP,
                _TARGET_HOSTNAME,
                _TARGET_PORT,
                _SERVER,
                _REQUEST_COUNT,
                _END_TIME,
                _HOSTS_TESTED,
            )
        ):
            continue
        findings.append(line[2:].strip())
    return findings


class NiktoTxtParser:
    format_id = "nikto_txt"
    parser_version = "1.0.0"

    def supports(self, artifact: Artifact, content: bytes) -> float:
        head = content[:4096].decode("utf-8", errors="replace")
        if "- Nikto v" in head or "+ Nikto v" in head:
            return 0.9
        if "+ Target IP:" in head and "+ Target Port:" in head:
            return 0.8
        return 0.0

    def parse(self, artifact: Artifact, content: bytes) -> list[Observation]:
        text = content.decode("utf-8", errors="replace")
        anchor = _anchor(text)
        findings = _findings(text)
        host_label = anchor.get("hostname") or anchor.get("ip") or ""
        host_key = f"host::{host_label}" if host_label else ""

        observations: list[Observation] = []
        finding_keys: list[str] = []
        for finding in findings:
            text_value = finding[:_MAX_FINDING_TEXT]
            digest = hashlib.sha1(text_value.encode("utf-8")).hexdigest()[:12]
            finding_key = f"misconfig::nikto::{host_label or 'unknown'}::{digest}"
            finding_keys.append(finding_key)
            props: dict[str, Any] = {
                "source": "nikto",
                "text": text_value,
                "evidence": "tool_reported",
            }
            if host_label:
                props["target"] = host_label
            observations.append(
                node_observation(
                    "Misconfiguration",
                    key=finding_key,
                    label=text_value[:120],
                    props=props,
                )
            )

        if host_label:
            host_props: dict[str, Any] = {"source": "nikto"}
            if anchor.get("ip"):
                host_props["ip"] = anchor["ip"]
            if anchor.get("hostname"):
                host_props["hostname"] = anchor["hostname"]
            if anchor.get("port"):
                host_props["port"] = int(anchor["port"])
            host_edges: list[dict[str, Any]] = [
                {"to_key": key, "kind": "HAS_VULN", "weight": 0.6} for key in finding_keys
            ]
            server = anchor.get("server")
            if server:
                observations.append(
                    node_observation(
                        "Technology",
                        key=f"technology::server::{server}",
                        label=server,
                        props={"source": "nikto", "category": "server"},
                    )
                )
                host_edges.append(
                    {"to_key": f"technology::server::{server}", "kind": "RUNS", "weight": 0.6}
                )
            observations.insert(
                0,
                node_observation(
                    "Host",
                    key=host_key,
                    label=host_label,
                    props=host_props,
                    edges_out=host_edges,
                ),
            )

        observations.append(
            summary_observation(
                {
                    "findings": len(findings),
                    "host": host_label,
                    "port": anchor.get("port"),
                    "server": anchor.get("server"),
                }
            )
        )
        return observations
