"""pspy log parser (``pspy_log`` — target-side process watcher output).

pspy prints periodic snapshot lines alongside command events::

    CMD: UID=0     PID=1337   | /usr/sbin/cron -f
    CMD: UID=1000  PID=1420   | /usr/bin/backup.sh
    ........................................................

Only ``CMD:`` lines are process-execution evidence; separator and
config lines never become observations. Root-owned commands
(``UID=0``) are the privilege-escalation signal: they become Service
observations keyed by command, so the KG keeps cron/backup jobs the
operator can target. Commands are truncated to a bounded text size and
the summary records how many commands were seen in total.
"""

from __future__ import annotations

import re

from raptix.knowledge.ingest.parsers._shared import node_observation, summary_observation
from raptix_core.types.capability import Artifact, Observation

_CMD_LINE = re.compile(r"^CMD: UID=(?P<uid>\d+)\s+PID=(?P<pid>\d+)\s+\|\s*(?P<cmd>.+)$")
_MAX_COMMAND_TEXT = 200
_MAX_NODES = 100


class PspyLogParser:
    format_id = "pspy_log"
    parser_version = "1.0.0"

    def supports(self, artifact: Artifact, content: bytes) -> float:
        for line in content[:4096].decode("utf-8", errors="replace").splitlines():
            if _CMD_LINE.match(line):
                return 0.8
            if line.strip() == "Config: printing commands (exit = empty process)":
                return 0.7
        return 0.0

    def parse(self, artifact: Artifact, content: bytes) -> list[Observation]:
        observations: list[Observation] = []
        seen: dict[tuple[str, str], Observation] = {}
        total = 0
        root_commands = 0
        for line in content.decode("utf-8", errors="replace").splitlines():
            match = _CMD_LINE.match(line)
            if match is None:
                continue
            total += 1
            uid = match.group("uid")
            cmd = match.group("cmd").strip()[:_MAX_COMMAND_TEXT]
            if uid == "0":
                root_commands += 1
                key = (f"proc-root::{cmd}", "Service")
                if key not in seen and len(seen) < _MAX_NODES:
                    seen[key] = node_observation(
                        "Service",
                        key=key[0],
                        label=cmd,
                        props={
                            "source": "pspy",
                            "uid": 0,
                            "command": cmd,
                            "evidence": "observed_execution",
                        },
                    )
        observations.extend(seen.values())
        observations.append(
            summary_observation(
                {
                    "commands_seen": total,
                    "root_commands_seen": root_commands,
                    "root_unique_commands": len(seen),
                }
            )
        )
        return observations
