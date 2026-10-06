"""``web.test_injection`` → sqlmap adapter (base profile).

Injection probing for one HTTP endpoint. Risky by nature (it actively
exploits candidate parameters), so the capability is HIGH risk and the
adapter keeps every knob explicit and validated — ``--batch`` is always
on (non-interactive), and arbitrary sqlmap options cannot pass through.
"""

from __future__ import annotations

import re

from raptix.execution.adapters.base import (
    AdapterParameterError,
    CommandAdapter,
    artifact_name_param,
    http_url_param,
    int_param,
    str_param,
)
from raptix_core.types.capability import CapabilityId, CapabilityRequest

_TECHNIQUE_RE = re.compile(r"[BEQSTU]+")

TECHNIQUES = ("B", "E", "Q", "S", "T", "U")


class SqlmapAdapter(CommandAdapter):
    capability_id = CapabilityId("web.test_injection")
    adapter_id = "web.sqlmap"
    executable = "sqlmap"
    artifact_formats = ("sqlmap_log",)
    default_timeout_seconds = 7200

    def build_argv(self, request: CapabilityRequest) -> list[str]:
        url = http_url_param(request, "url")
        data = str_param(request, "data", default="", required=False, allow_spaces=True)
        method = str_param(request, "method", default="", required=False)
        if method and method.upper() not in {"GET", "POST", "PUT"}:
            raise AdapterParameterError("parameter 'method' must be GET, POST, or PUT")
        level = int_param(request, "level", default=1, minimum=1, maximum=5)
        risk = int_param(request, "risk", default=1, minimum=1, maximum=3)
        technique = str_param(request, "technique", default="", required=False)
        if technique and not _TECHNIQUE_RE.fullmatch(technique):
            raise AdapterParameterError(
                f"parameter 'technique' must only use {''.join(TECHNIQUES)}"
            )
        output_dir = artifact_name_param(request, "output_dir", default="sqlmap")

        argv = [
            "sqlmap",
            "-u",
            url,
            "--batch",
            "--output-dir",
            output_dir,
            f"--level={level}",
            f"--risk={risk}",
        ]
        if data:
            argv.extend(["--data", data])
        if method:
            argv.extend(["--method", method.upper()])
        if technique:
            argv.extend(["--technique", technique])
        return argv
