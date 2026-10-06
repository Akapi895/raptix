"""Subfinder plaintext output parser (``subfinder -o``)."""

from __future__ import annotations

from raptix.knowledge.ingest.parsers._shared import node_observation, summary_observation
from raptix_core.types.capability import Artifact, Observation


class SubfinderParser:
    format_id = "subfinder"
    parser_version = "1.0.0"

    def supports(self, artifact: Artifact, content: bytes) -> float:
        head = content[:4096].decode("utf-8", errors="ignore")
        lines = [line.strip() for line in head.splitlines() if line.strip()]
        if not lines or lines[0].lstrip().startswith(("{", "[", "<")):
            return 0.0
        if all("." in line and " " not in line and ".." not in line for line in lines[:5]):
            return 0.4
        return 0.0

    def parse(self, artifact: Artifact, content: bytes) -> list[Observation]:
        root_domain = str(artifact.metadata.get("root_domain") or "").strip().lower()
        observations: list[Observation] = []
        domains_added = 0
        entrypoints_added = 0

        for raw_line in content.decode("utf-8").splitlines():
            domain = raw_line.strip().lower().rstrip(".")
            if not domain or " " in domain:
                continue
            if root_domain and not domain.endswith(root_domain):
                continue

            host_edges = [
                {"to_key": f"entrypoint::{scheme}://{domain}/", "kind": "EXPOSES", "weight": 0.5}
                for scheme in ("https", "http")
            ]
            observations.append(
                node_observation(
                    "Host",
                    key=f"host::{domain}",
                    label=domain,
                    props={"source": "subfinder", "root_domain": root_domain or None},
                    edges_out=host_edges,
                )
            )
            domains_added += 1

            for scheme in ("https", "http"):
                url = f"{scheme}://{domain}/"
                observations.append(
                    node_observation(
                        "Entrypoint",
                        key=f"entrypoint::{url}",
                        label=url,
                        props={"source": "subfinder", "host": domain, "scheme": scheme},
                        edges_out=[{"to_key": f"host::{domain}", "kind": "HOSTS", "weight": 0.5}],
                    )
                )
                entrypoints_added += 1

        observations.append(
            summary_observation(
                {"domains_added": domains_added, "entrypoints_added": entrypoints_added}
            )
        )
        return observations
