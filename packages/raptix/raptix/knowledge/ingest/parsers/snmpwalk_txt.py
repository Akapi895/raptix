"""snmpwalk text output parser (``network.snmp_enumerate`` output).

snmpwalk with ``-On`` writes numeric-OID lines of the shape::

    .1.3.6.1.2.1.1.1.0 = STRING: "Linux appliance 4.19"
    .1.3.6.1.2.1.2.2.1.1.1 = INTEGER: 1

The parser normalizes them into Service-level evidence anchored to the
walked target, plus a bounded summary. Failure shapes (``Timeout``,
``No Such Object``, ``Authentication failure``) are recorded in the
summary — they never become fabricated interface/system evidence.
"""

from __future__ import annotations

import re

from raptix.knowledge.ingest.parsers._shared import node_observation, summary_observation
from raptix_core.types.capability import Artifact, Observation

_SNMP_LINE = re.compile(
    r"^(?P<oid>\.\d+(?:\.\d+)+)\s*=\s*(?P<type>[A-Za-z0-9-]+):\s*(?P<value>.*)$"
)
_FAILURE_LINE = re.compile(
    r"Timeout|No Such Object|Authentication failure|No Response", re.IGNORECASE
)
_MAX_VALUES = 200
_MAX_VALUE_TEXT = 240
_FAILURE_SIGNALS_MAX = 5

_SYSTEM_PREFIX = ".1.3.6.1.2.1.1."
_IFDESCR_PREFIX = ".1.3.6.1.2.1.2.2.1.2."


class SnmpwalkTxtParser:
    format_id = "snmpwalk_txt"
    parser_version = "1.0.0"

    def supports(self, artifact: Artifact, content: bytes) -> float:
        head = content[:4096].decode("utf-8", errors="replace")
        for line in head.splitlines():
            if _SNMP_LINE.match(line):
                return 0.8
            if _FAILURE_LINE.search(line):
                return 0.5
        return 0.0

    def parse(self, artifact: Artifact, content: bytes) -> list[Observation]:
        text = content.decode("utf-8", errors="replace")
        target = str(artifact.metadata.get("target") or "")
        failures = [
            line.strip()[:_MAX_VALUE_TEXT]
            for line in text.splitlines()
            if _FAILURE_LINE.search(line)
        ][:_FAILURE_SIGNALS_MAX]

        system: dict[str, str] = {}
        interfaces: list[str] = []
        scanned = 0
        for line in text.splitlines():
            match = _SNMP_LINE.match(line)
            if match is None:
                continue
            scanned += 1
            if len(system) + len(interfaces) >= _MAX_VALUES:
                break
            oid = match.group("oid")
            value = match.group("value").strip().strip('"')
            if oid.startswith(_SYSTEM_PREFIX) and value:
                system[oid] = value[:_MAX_VALUE_TEXT]
            elif oid.startswith(_IFDESCR_PREFIX) and value:
                interfaces.append(value[:_MAX_VALUE_TEXT])

        observations: list[Observation] = []
        if target and (system or interfaces):
            observations.append(
                node_observation(
                    "Host",
                    key=f"host::{target}",
                    label=target,
                    props={
                        "source": "snmpwalk",
                        "address": target,
                        "snmp_system": system,
                        "snmp_interfaces": interfaces,
                    },
                )
            )
        observations.append(
            summary_observation(
                {
                    "target": target,
                    "oids_scanned": scanned,
                    "system_values": len(system),
                    "interfaces": len(interfaces),
                    "failures": failures,
                }
            )
        )
        return observations
