"""LinPEAS text-output parser (``peas_txt`` — target-side PE resource).

LinPEAS sections look like::

    ══════════════════════════════════════════════
    ══════════════════════════════════════════════
    ╔══════════╣ System Information
    ├─[!] Vulnerable to CVE-2021-4034
    ├─════╣ Users with console
        user100        uid=1000
    ╚ https://book.hacktricks.wiki/...

The parser is intentionally conservative: it normalizes CVE markers and
section headers into bounded summary signals. It never fabricates host
or privilege evidence from section titles — the observed lines become
summary signals only, and CVE markers become Vulnerability observations
keyed by the CVE id. This parser pairs with a future (ADR-0043-gated)
target-side execution path; it is registered now so the output format
contract is frozen before the execution path lands.
"""

from __future__ import annotations

import re

from raptix.knowledge.ingest.parsers._shared import node_observation, summary_observation
from raptix_core.types.capability import Artifact, Observation

_CVE_MARKER = re.compile(r"(?<![\w-])(CVE-\d{4}-\d{4,7})(?![\w-])")
_SECTION_MARKER = re.compile(r"[╔╚]═+\[?[╠╣]?\s*(?P<title>[A-Za-z][^\n═]{3,80})")
_MAX_CVES = 20
_MAX_SIGNALS = 12
_MAX_SIGNAL_TEXT = 120


class PeasTxtParser:
    format_id = "peas_txt"
    parser_version = "1.0.0"

    def supports(self, artifact: Artifact, content: bytes) -> float:
        head = content[:4096].decode("utf-8", errors="replace")
        if "linpeas" in head.lower():
            return 0.9
        if _CVE_MARKER.search(head) and _SECTION_MARKER.search(head):
            return 0.7
        return 0.0

    def parse(self, artifact: Artifact, content: bytes) -> list[Observation]:
        text = content.decode("utf-8", errors="replace")
        cves: list[str] = []
        for match in _CVE_MARKER.finditer(text):
            cve = match.group(1)
            if cve not in cves:
                cves.append(cve)
            if len(cves) >= _MAX_CVES:
                break
        sections = [m.group("title").strip() for m in _SECTION_MARKER.finditer(text)]
        vulnerable_to = [
            cve
            for cve in cves
            if re.search(r"vulnerable.{0,40}" + re.escape(cve), text, re.IGNORECASE)
        ]

        observations: list[Observation] = []
        for cve in cves:
            observations.append(
                node_observation(
                    "Vulnerability",
                    key=f"vuln-cve::{cve}",
                    label=cve,
                    props={
                        "source": "linpeas",
                        "cve": cve,
                        "evidence": "tool_reported",
                        "target_reported_vulnerable": cve in vulnerable_to,
                    },
                )
            )
        observations.append(
            summary_observation(
                {
                    "sections": sections[:_MAX_SIGNALS],
                    "cves": cves,
                    "vulnerable_to": vulnerable_to,
                    "signals": [
                        line.strip()[:_MAX_SIGNAL_TEXT]
                        for line in text.splitlines()
                        if "!!!" in line or re.match(r"^\s*╔", line)
                    ][:_MAX_SIGNALS],
                }
            )
        )
        return observations
