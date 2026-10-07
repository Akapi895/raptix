"""``web.scan_templates`` → nuclei adapter (opt-in ``sandbox-web`` profile).

Template-driven vulnerability scanning against one URL. The binary and
its template corpus ship in the ``sandbox-web`` build profile only —
declaring the implementation here never qualifies an environment that
has not built that profile (the placement health checker answers
``profile_disabled`` for it).

Output is JSONL (``-jsonl -o``) so the existing ``nuclei_jsonl`` T3
parser normalizes findings deterministically.
"""

from __future__ import annotations

from raptix.execution.adapters.base import (
    AdapterParameterError,
    CommandAdapter,
    artifact_name_param,
    http_url_param,
    str_param,
)
from raptix_core.types.capability import CapabilityId, CapabilityRequest

_SEVERITIES = ("informational", "low", "medium", "high", "critical", "unknown")


class NucleiAdapter(CommandAdapter):
    capability_id = CapabilityId("web.scan_templates")
    adapter_id = "web.nuclei"
    executable = "nuclei"
    artifact_formats = ("nuclei_jsonl",)
    default_timeout_seconds = 3600

    def build_argv(self, request: CapabilityRequest) -> list[str]:
        url = http_url_param(request, "url")
        severity = str_param(request, "severity", default="", required=False)
        if severity and not all(part in _SEVERITIES for part in severity.lower().split(",")):
            raise AdapterParameterError(
                f"parameter 'severity' entries must be one of {sorted(_SEVERITIES)}"
            )
        output_path = artifact_name_param(request, "output_path", default="nuclei.jsonl")

        argv = ["nuclei", "-u", url, "-jsonl", "-o", output_path, "-silent"]
        if severity:
            argv.extend(["-severity", severity.lower()])
        return argv
