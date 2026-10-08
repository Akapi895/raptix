"""Responder capture log parser (``ad.responder`` adapter output).

Parses the NTLM capture pairs Responder writes to its session log /
console (``[HTTP] NTLMv2-SSP Client : ...`` followed by the matching
``[... ] NTLMv2-SSP Hash : user::DOMAIN:...`` line) into Credential +
User + client-Host observations. Poisoning/analysis lines are counted
in the summary only — a poisoned name or an LLMNR query is not a
captured credential.
"""

from __future__ import annotations

import hashlib
import re
from typing import Any

from raptix.knowledge.ingest.parsers._shared import node_observation, summary_observation
from raptix_core.types.capability import Artifact, Observation

_CLIENT_LINE = re.compile(
    r"^\[(?P<proto>[A-Z0-9]+)\]\s+(?P<sub>NTLMv[12](?:-SSP)?)\s+Client\s*:\s*(?P<client>\S+)"
)
_HASH_LINE = re.compile(
    r"^\[(?P<proto>[A-Z0-9]+)\]\s+(?P<sub>NTLMv[12](?:-SSP)?)\s+Hash\s*:\s*(?P<hash>\S.*?)\s*$"
)
_POISONING_LINE = re.compile(r"^\[\+\]\s*Poisoning", re.IGNORECASE)
_ANALYSIS_LINE = re.compile(r"^\[Analysis\]")
_MAX_HASH_TEXT = 1000


class ResponderLogParser:
    format_id = "responder_log"
    parser_version = "1.0.0"

    def supports(self, artifact: Artifact, content: bytes) -> float:
        head = content[:4096].decode("utf-8", errors="replace")
        if _HASH_LINE.search(head):
            return 0.8
        if _POISONING_LINE.search(head) or _ANALYSIS_LINE.search(head):
            return 0.4
        return 0.0

    def parse(self, artifact: Artifact, content: bytes) -> list[Observation]:
        text = content.decode("utf-8", errors="replace")

        captures: list[dict[str, str]] = []
        pending: dict[tuple[str, str], str] = {}
        poisoning = 0
        analysis = 0
        for line in text.splitlines():
            if _POISONING_LINE.match(line):
                poisoning += 1
            if _ANALYSIS_LINE.match(line):
                analysis += 1
            client = _CLIENT_LINE.match(line)
            if client is not None:
                pending[(client.group("proto"), client.group("sub"))] = client.group("client")
                continue
            hash_match = _HASH_LINE.match(line)
            if hash_match is None:
                continue
            key = (hash_match.group("proto"), hash_match.group("sub"))
            client_ip = pending.pop(key, "")
            captures.append(
                {
                    "protocol": hash_match.group("proto"),
                    "subtype": hash_match.group("sub"),
                    "client": client_ip,
                    "hash": hash_match.group("hash"),
                }
            )

        observations: list[Observation] = []
        for capture in captures:
            hash_text = capture["hash"][:_MAX_HASH_TEXT]
            fields = hash_text.split(":")
            user = fields[0] if fields else ""
            domain = fields[2] if len(fields) > 2 else ""
            label = f"{domain}\\{user}" if domain else user
            digest = hashlib.sha1(hash_text.encode("utf-8")).hexdigest()[:12]
            props: dict[str, Any] = {
                "source": "responder",
                "secret_type": capture["subtype"].replace("-SSP", "").lower(),
                "protocol": capture["protocol"],
                "hash": hash_text,
                "evidence": "captured_authentication",
            }
            edges_out: list[dict[str, Any]] = []
            if capture["client"]:
                props["client"] = capture["client"]
            if label:
                edges_out.append(
                    {
                        "to_key": f"user::{label}",
                        "kind": "AUTHENTICATES_TO",
                        "weight": 0.5,
                    }
                )
                observations.append(
                    node_observation(
                        "User",
                        key=f"user::{label}",
                        label=label,
                        props={"source": "responder", "domain": domain},
                    )
                )
            observations.append(
                node_observation(
                    "Credential",
                    key=f"cred-ntlm::{label or 'unknown'}::{digest}",
                    label=label or "unknown",
                    props=props,
                    edges_out=edges_out,
                )
            )
            if capture["client"]:
                observations.append(
                    node_observation(
                        "Host",
                        key=f"host::{capture['client']}",
                        label=capture["client"],
                        props={"source": "responder", "address": capture["client"]},
                    )
                )

        observations.append(
            summary_observation(
                {
                    "captures": len(captures),
                    "poisoning_lines": poisoning,
                    "analysis_lines": analysis,
                }
            )
        )
        return observations
