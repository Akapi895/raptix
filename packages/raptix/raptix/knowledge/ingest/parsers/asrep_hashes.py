"""impacket-GetNPUsers AS-REP hash output parser."""

from __future__ import annotations

from raptix.knowledge.ingest.parsers._shared import node_observation, summary_observation
from raptix_core.types.capability import Artifact, Observation


class AsrepHashesParser:
    format_id = "asrep_hashes"
    parser_version = "1.0.0"

    def supports(self, artifact: Artifact, content: bytes) -> float:
        if content[:4096].lstrip().startswith(b"$krb5asrep$"):
            return 0.9
        return 0.0

    def parse(self, artifact: Artifact, content: bytes) -> list[Observation]:
        domain = str(artifact.metadata.get("domain") or "")
        observations: list[Observation] = []
        added = 0
        for line in content.decode("utf-8", errors="replace").splitlines():
            line = line.strip()
            if not line.startswith("$krb5asrep$"):
                continue
            # Format: $krb5asrep$23$USER@DOMAIN:SALT$ENCRYPTED_TIMESTAMP
            # split("$", 4) →
            #   [0]=''  [1]='krb5asrep'  [2]='23'
            #   [3]='USER@DOMAIN:SALT'   [4]='ENCRYPTED_TIMESTAMP'
            after_dollars = line.split("$", 4)
            if len(after_dollars) < 5:
                continue
            user_part = after_dollars[3].split(":", 1)[0]
            user = user_part.split("@", 1)[0]
            dom = user_part.split("@", 1)[1] if "@" in user_part else domain
            label = f"{dom}\\{user}" if dom else user
            observations.append(
                node_observation(
                    "Credential",
                    key=f"cred-asrep::{label}",
                    label=label,
                    props={
                        "source": "impacket-GetNPUsers",
                        "secret_type": "krb5asrep",
                        "hashcat_mode": 18200,
                        "hash": line,
                    },
                )
            )
            added += 1

        observations.append(summary_observation({"asrep_hashes_added": added}))
        return observations
