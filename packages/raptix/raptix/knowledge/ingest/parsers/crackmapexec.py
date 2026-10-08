"""crackmapexec / netexec log output parser."""

from __future__ import annotations

import re

from raptix.knowledge.ingest.parsers._shared import node_observation, summary_observation
from raptix_core.types.capability import Artifact, Observation

_SUCCESS_RE = re.compile(r"\[\+\].*?([A-Za-z0-9._-]+)[\\/]([A-Za-z0-9._-]+):(\S+)")
_ADMIN_RE = re.compile(r"\(Pwn3d!?\)")


class CrackMapExecParser:
    format_id = "crackmapexec"
    parser_version = "1.0.0"

    def supports(self, artifact: Artifact, content: bytes) -> float:
        head = content[:4096].decode("utf-8", errors="replace")
        if "[+]" in head and _SUCCESS_RE.search(head):
            return 0.7
        return 0.0

    def parse(self, artifact: Artifact, content: bytes) -> list[Observation]:
        protocol = str(artifact.metadata.get("protocol") or "smb")
        target = str(artifact.metadata.get("target") or "")
        text = content.decode("utf-8", errors="replace")

        observations: list[Observation] = []
        creds_added = 0
        admins_added = 0
        for line in text.splitlines():
            if "[+]" not in line:
                continue
            match = _SUCCESS_RE.search(line)
            if not match:
                continue
            domain, user, secret = match.group(1), match.group(2), match.group(3)
            is_admin = bool(_ADMIN_RE.search(line))
            observations.append(
                node_observation(
                    "Credential",
                    key=f"cred::{domain}\\{user}",
                    label=f"{domain}\\{user}",
                    props={
                        "source": "crackmapexec",
                        "protocol": protocol,
                        "target": target,
                        "secret_type": (
                            "ntlm" if ":" in secret and len(secret) >= 32 else "password"
                        ),
                        "admin": is_admin,
                    },
                    edges_out=[
                        {
                            "to_key": f"user::{domain}\\{user}",
                            "kind": "AUTHENTICATES_TO",
                            "weight": 0.5,
                        }
                    ],
                )
            )
            observations.append(
                node_observation(
                    "User",
                    key=f"user::{domain}\\{user}",
                    label=f"{domain}\\{user}",
                    props={"source": "crackmapexec", "domain": domain},
                )
            )
            creds_added += 1
            if is_admin:
                admins_added += 1

        observations.append(
            summary_observation({"creds_added": creds_added, "admin_creds_added": admins_added})
        )
        return observations
