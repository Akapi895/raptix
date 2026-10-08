"""``web.scan_web`` → nikto adapter (base profile).

Known-misconfiguration web server scanning. Output is written with an
explicit ``-Format txt`` so the artifact format stays deterministic
(``nikto_txt`` — no T3 parser yet; parsing lands with T8+ wiring and
until then surfaces as an honest unknown-format error).
"""

from __future__ import annotations

from raptix.execution.adapters.base import (
    CommandAdapter,
    artifact_name_param,
    bool_param,
    int_param,
    str_param,
)
from raptix_core.types.capability import CapabilityId, CapabilityRequest


class NiktoAdapter(CommandAdapter):
    capability_id = CapabilityId("web.scan_web")
    adapter_id = "web.nikto"
    executable = "nikto"
    artifact_formats = ("nikto_txt",)
    default_timeout_seconds = 7200

    def build_argv(self, request: CapabilityRequest) -> list[str]:
        target = str_param(request, "target")
        port = int_param(request, "port", minimum=1, maximum=65535)
        ssl = bool_param(request, "ssl", default=False)
        tuning = str_param(request, "tuning", default="", required=False)
        output_path = artifact_name_param(request, "output_path", default="nikto.txt")

        argv = ["nikto", "-h", target]
        if port is not None:
            argv.extend(["-p", str(port)])
        if ssl:
            argv.append("-ssl")
        if tuning:
            argv.extend(["-Tuning", tuning])
        argv.extend(["-o", output_path, "-Format", "txt"])
        return argv
