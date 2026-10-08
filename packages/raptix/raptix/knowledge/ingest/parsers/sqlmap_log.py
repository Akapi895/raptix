"""sqlmap console/log output parser (``web.test_injection`` adapter output).

Parses the ``--batch`` console log sqlmap writes for a run:

  * injection points â€” the ``Parameter: <name> (<placement>)`` blocks
    between ``---`` markers, each carrying ``Type`` / ``Title`` /
    ``Payload`` technique entries;
  * the back-end DBMS banner;
  * the explicit negative case (``[CRITICAL] ... do not appear to be
    injectable``), which must NOT become fabricated findings.

The target URL is not part of the log itself (sqlmap prints it only at
high verbosity): when the caller knows it (e.g. auto-ingest extracted
the ``-u`` flag) it comes in via ``artifact.metadata["base_url"]`` and
findings are anchored to a ``URL`` node; otherwise findings carry
``url_unknown`` and no host/URL anchor is invented.
"""

from __future__ import annotations

import re
from typing import Any

from raptix.knowledge.ingest.parsers._shared import node_observation, summary_observation
from raptix_core.types.capability import Artifact, Observation

_PARAM_HEADER = re.compile(r"^Parameter:\s*(?P<param>[^:()]+?)\s*\((?P<placement>\w+)\)\s*$")
_TYPE_LINE = re.compile(r"^\s+Type:\s*(?P<value>.+?)\s*$")
_TITLE_LINE = re.compile(r"^\s+Title:\s*(?P<value>.+?)\s*$")
_PAYLOAD_LINE = re.compile(r"^\s+Payload:\s*(?P<value>.+?)\s*$")
_DBMS_LINE = re.compile(r"^back-end DBMS:\s*(?P<value>.+?)\s*$")
_DBMS_INFO = re.compile(r"the back-end DBMS is (?P<value>[A-Za-z0-9 ._-]+?)(?:\.\s*)?$")
_NOT_INJECTABLE = re.compile(r"do not appear to be injectable", re.IGNORECASE)

_MAX_PROPS_TEXT = 300


def _injection_entries(text: str) -> list[dict[str, str]]:
    """Deterministic entries from the ``---``-delimited injection blocks.

    The dict appended to ``entries`` is the same object mutated later
    with ``Title``/``Payload``, so late-arriving fields survive.
    """
    entries: list[dict[str, str]] = []
    current_param: dict[str, str] | None = None
    current_entry: dict[str, str] | None = None
    for line in text.splitlines():
        if line.strip() == "---":
            continue
        header = _PARAM_HEADER.match(line)
        if header is not None:
            current_param = {
                "param": header.group("param").strip().strip("'\""),
                "placement": header.group("placement"),
            }
            current_entry = None
            continue
        if current_param is None:
            continue
        type_match = _TYPE_LINE.match(line)
        if type_match is not None:
            current_entry = {**current_param, "type": type_match.group("value")}
            entries.append(current_entry)
            continue
        if current_entry is None:
            continue
        for regex, key in (
            (_TITLE_LINE, "title"),
            (_PAYLOAD_LINE, "payload"),
        ):
            match = regex.match(line)
            if match is not None:
                current_entry[key] = match.group("value")
    return entries


def _dbms(text: str) -> str | None:
    for line in text.splitlines():
        match = _DBMS_LINE.match(line)
        if match is not None:
            return match.group("value").strip() or None
    for line in text.splitlines():
        match = _DBMS_INFO.search(line)
        if match is not None:
            return match.group("value").strip() or None
    return None


class SqlmapLogParser:
    format_id = "sqlmap_log"
    parser_version = "1.0.0"

    def supports(self, artifact: Artifact, content: bytes) -> float:
        head = content[:4096].decode("utf-8", errors="replace")
        if "sqlmap/" in head:
            return 0.9
        if "sqlmap identified the following injection point(s)" in head:
            return 0.9
        return 0.0

    def parse(self, artifact: Artifact, content: bytes) -> list[Observation]:
        text = content.decode("utf-8", errors="replace")
        base_url = str(artifact.metadata.get("base_url") or "")
        not_injectable = bool(_NOT_INJECTABLE.search(text))

        observations: list[Observation] = []
        entries = () if not_injectable else tuple(_injection_entries(text))
        vuln_keys: list[str] = []
        for entry in entries:
            technique = entry.get("type", "unknown")
            vuln_key = f"vuln::sqlmap::{base_url}::{entry['param']}::{technique}"
            if not base_url:
                vuln_key = f"vuln::sqlmap::{entry['param']}::{technique}"
            vuln_keys.append(vuln_key)
            props: dict[str, Any] = {
                "source": "sqlmap",
                "parameter": entry["param"],
                "placement": entry["placement"],
                "technique": technique,
                "evidence": "tool_reported",
            }
            if not base_url:
                props["url_unknown"] = True
            for key in ("title", "payload"):
                value = entry.get(key)
                if value:
                    props[key] = value[:_MAX_PROPS_TEXT]
            observations.append(
                node_observation(
                    "Vulnerability",
                    key=vuln_key,
                    label=f"SQLi {entry['param']} ({entry['placement']}) {technique}",
                    props=props,
                )
            )
        dbms = _dbms(text)
        if base_url:
            url_edges: list[dict[str, Any]] = [
                {"to_key": vuln_key, "kind": "HAS_VULN", "weight": 0.7} for vuln_key in vuln_keys
            ]
            if dbms:
                observations.append(
                    node_observation(
                        "Technology",
                        key=f"technology::dbms::{dbms}",
                        label=dbms,
                        props={"source": "sqlmap", "category": "dbms"},
                    )
                )
                url_edges.append(
                    {"to_key": f"technology::dbms::{dbms}", "kind": "RUNS", "weight": 0.5}
                )
            observations.insert(
                0,
                node_observation(
                    "URL",
                    key=f"url::{base_url}",
                    label=base_url,
                    props={"source": "sqlmap"},
                    edges_out=url_edges,
                ),
            )
        observations.append(
            summary_observation(
                {
                    "injection_points": len(entries),
                    "parameters": len({entry["param"] for entry in entries}),
                    "dbms": dbms,
                    "not_injectable": not_injectable,
                }
            )
        )
        return observations
