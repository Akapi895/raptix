"""Nuclei JSONL output parser (``nuclei -jsonl``)."""

from __future__ import annotations

import json
from urllib.parse import urlparse

from raptix.knowledge.ingest.parsers._shared import (
    node_observation,
    severity_from_string,
    sniff_first_json_line,
    summary_observation,
)
from raptix_core.types.capability import Artifact, Observation


def _cve_ids(info: dict) -> list[str]:
    classification = info.get("classification")
    if not isinstance(classification, dict):
        return []
    raw = classification.get("cve-id")
    if isinstance(raw, str):
        raw = [raw]
    if not isinstance(raw, list):
        return []
    ids: list[str] = []
    for value in raw:
        if not isinstance(value, str):
            continue
        cid = value.strip().upper()
        if cid.startswith("CVE-"):
            ids.append(cid)
    return ids


class NucleiJsonlParser:
    format_id = "nuclei_jsonl"
    parser_version = "1.0.0"

    def supports(self, artifact: Artifact, content: bytes) -> float:
        record = sniff_first_json_line(content)
        if record is None:
            return 0.0
        if isinstance(record.get("info"), dict) and (
            "template-id" in record or "templateID" in record or "matched-at" in record
        ):
            return 0.75
        return 0.0

    def parse(self, artifact: Artifact, content: bytes) -> list[Observation]:
        scanner_hint = str(artifact.metadata.get("scanner_hint") or "nuclei")
        observations: list[Observation] = []
        parsed = 0
        skipped = 0

        for raw_line in content.decode("utf-8").splitlines():
            line = raw_line.strip()
            if not line:
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                skipped += 1
                continue

            info = record.get("info") if isinstance(record.get("info"), dict) else {}
            severity = severity_from_string(info.get("severity"))
            rule_id = str(record.get("template-id") or "unknown-template")
            target = str(record.get("matched-at") or record.get("host") or "unknown-target")
            parsed += 1

            vuln_key = f"{scanner_hint}::{rule_id}::{target}"
            cves = _cve_ids(info)
            observations.append(
                node_observation(
                    "Vulnerability",
                    key=vuln_key,
                    label=f"[{scanner_hint}:{rule_id}] {target}",
                    props={
                        "scanner": scanner_hint,
                        "rule_id": rule_id,
                        "severity": severity.value,
                        "type": record.get("type"),
                        "matcher_name": record.get("matcher-name"),
                        "message": record.get("matched-at") or target,
                        "tags": (info.get("tags") if isinstance(info.get("tags"), list) else []),
                    },
                    edges_out=[{"to_key": f"cve::{cid}", "kind": "MAPS_TO"} for cid in cves],
                )
            )

            parsed_target = urlparse(target)
            if parsed_target.scheme and parsed_target.netloc:
                url_key = f"url::{target}"
                entrypoint_key = f"entrypoint::{target}"
                observations.append(
                    node_observation(
                        "URL",
                        key=url_key,
                        label=target,
                        props={"source": scanner_hint},
                    )
                )
                observations.append(
                    node_observation(
                        "Entrypoint",
                        key=entrypoint_key,
                        label=target,
                        props={
                            "source": scanner_hint,
                            "scheme": parsed_target.scheme,
                            "host": parsed_target.hostname,
                            "port": parsed_target.port,
                        },
                        edges_out=[
                            {"to_key": url_key, "kind": "HOSTS", "weight": 0.5},
                            {"to_key": vuln_key, "kind": "HAS_VULN", "weight": 0.4},
                        ],
                    )
                )
            else:
                host_label = target.split(":", 1)[0]
                observations.append(
                    node_observation(
                        "Host",
                        key=f"host::{host_label}",
                        label=host_label,
                        props={"source": scanner_hint},
                        edges_out=[{"to_key": vuln_key, "kind": "HAS_VULN", "weight": 0.4}],
                    )
                )

            for cid in cves:
                observations.append(
                    node_observation(
                        "CVE",
                        key=f"cve::{cid}",
                        label=cid,
                        props={"source": scanner_hint},
                    )
                )

        observations.append(summary_observation({"parsed": parsed, "skipped": skipped}))
        return observations
