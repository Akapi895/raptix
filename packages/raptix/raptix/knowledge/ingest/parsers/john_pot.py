"""John the Ripper pot-file parser (``access.crack_hash`` output).

A ``--pot`` file line is ``<ciphertext>:<plaintext>`` — the recovered
credential evidence of an offline crack. Only records where a
plaintext followed a non-empty ciphertext become observations; the
credential-bearing props travel in the engagement-scoped KG (the
canonical state store) and never into telemetry/eval metadata.
"""

from __future__ import annotations

from typing import Any

from raptix.knowledge.ingest.parsers._shared import node_observation, summary_observation
from raptix_core.types.capability import Artifact, Observation


class JohnPotParser:
    format_id = "john_pot"
    parser_version = "1.0.0"

    def supports(self, artifact: Artifact, content: bytes) -> float:
        for line in content[:4096].decode("utf-8", errors="replace").splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#"):
                continue
            if ":" in stripped and stripped.split(":", 1)[0]:
                # Low confidence on purpose: "key: value" text shares the
                # shape. Explicit expected-format resolution (the adapter
                # path) is primary; any dedicated sniffer outranks this.
                return 0.6
            return 0.0
        return 0.0

    def parse(self, artifact: Artifact, content: bytes) -> list[Observation]:
        fmt = str(artifact.metadata.get("format") or "")
        observations: list[Observation] = []
        recovered = 0
        for line in content.decode("utf-8", errors="replace").splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or ":" not in stripped:
                continue
            ciphertext, _, plaintext = stripped.partition(":")
            if not ciphertext or not plaintext:
                # No recovered text (e.g. the NT empty-hash entry) is not
                # a recovered credential — record nothing.
                continue
            label = plaintext[:80] or "<empty>"
            props: dict[str, Any] = {
                "source": "john",
                "secret_type": "recovered_plaintext",
                "ciphertext": ciphertext,
                "plaintext": plaintext,
                "evidence": "offline_crack",
            }
            if fmt:
                props["hash_format"] = fmt
            observations.append(
                node_observation(
                    "Credential",
                    key=f"cred-cracked::{ciphertext}",
                    label=label,
                    props=props,
                )
            )
            recovered += 1

        observations.append(summary_observation({"recovered": recovered}))
        return observations
