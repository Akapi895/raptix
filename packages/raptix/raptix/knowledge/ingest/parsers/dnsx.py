"""dnsx JSONL output parser (``dnsx -o``)."""

from __future__ import annotations

import json
from typing import Any

from raptix.knowledge.ingest.parsers._shared import (
    node_observation,
    sniff_first_json_line,
    summary_observation,
)
from raptix_core.types.capability import Artifact, Observation


class DnsxParser:
    format_id = "dnsx"
    parser_version = "1.0.0"

    def supports(self, artifact: Artifact, content: bytes) -> float:
        record = sniff_first_json_line(content)
        if record is None:
            return 0.0
        if ("a" in record or "aaaa" in record or "cname" in record) and (
            "host" in record or "name" in record
        ):
            return 0.75
        return 0.0

    def parse(self, artifact: Artifact, content: bytes) -> list[Observation]:
        observations: list[Observation] = []
        hosts_added = 0

        for raw in content.decode("utf-8").splitlines():
            line = raw.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            host_value = str(row.get("host") or row.get("name") or "").strip().lower().rstrip(".")
            if not host_value:
                continue
            a = row.get("a") or []
            aaaa = row.get("aaaa") or []
            cname = row.get("cname") or []
            cname_list = cname if isinstance(cname, list) else []

            alias_edges: list[dict[str, Any]] = []
            for target in cname_list:
                target_label = str(target).lower().rstrip(".")
                if not target_label:
                    continue
                alias_edges.extend(
                    [
                        {
                            "to_key": f"host::{target_label}",
                            "kind": "EXPOSES",
                            "weight": 0.5,
                            "key": f"cname::{host_value}->{target_label}",
                        }
                    ]
                )
                observations.append(
                    node_observation(
                        "Host",
                        key=f"host::{target_label}",
                        label=target_label,
                        props={"source": "dnsx-cname"},
                        edges_out=[
                            {
                                "to_key": f"host::{host_value}",
                                "kind": "HOSTS",
                                "weight": 0.5,
                                "key": f"cname-rev::{target_label}->{host_value}",
                            }
                        ],
                    )
                )

            observations.append(
                node_observation(
                    "Host",
                    key=f"host::{host_value}",
                    label=host_value,
                    props={
                        "source": "dnsx",
                        "a_records": a if isinstance(a, list) else [],
                        "aaaa_records": aaaa if isinstance(aaaa, list) else [],
                        "cname_records": cname_list,
                    },
                    edges_out=alias_edges,
                )
            )
            hosts_added += 1

        observations.append(summary_observation({"hosts_added": hosts_added}))
        return observations
