"""``network.scan`` → nmap adapter (sandbox binary, base profile).

Builds the argv for one nmap run whose XML report (``-oX``) becomes the
``nmap_xml`` artifact the T3 registry already parses. Scan modes are a
fixed, validated mapping — there is no way to pass arbitrary nmap flags
through a capability request.
"""

from __future__ import annotations

import re

from raptix.execution.adapters.base import (
    AdapterParameterError,
    CommandAdapter,
    artifact_name_param,
    bool_param,
    int_param,
    str_param,
)
from raptix_core.types.capability import CapabilityId, CapabilityRequest

_PORTS_RE = re.compile(r"\d{1,5}(?:-\d{1,5})?(?:,\d{1,5}(?:-\d{1,5})?)*")

SCAN_FLAGS = {"connect": "-sT", "syn": "-sS", "udp": "-sU"}


class NmapAdapter(CommandAdapter):
    capability_id = CapabilityId("network.scan")
    adapter_id = "network.nmap"
    executable = "nmap"
    artifact_formats = ("nmap_xml",)
    default_timeout_seconds = 3600

    def build_argv(self, request: CapabilityRequest) -> list[str]:
        target = str_param(request, "target")
        ports = str_param(request, "ports", default="", required=False)
        if ports and not _PORTS_RE.fullmatch(ports):
            raise AdapterParameterError(
                "parameter 'ports' must be a port list like '80,443' or '1-1024'"
            )
        scan_type = self._choice(request, "scan_type", SCAN_FLAGS, default="connect")
        service_detection = bool_param(request, "service_detection", default=True)
        no_ping = bool_param(request, "no_ping", default=False)
        timing = int_param(request, "timing", default=3, minimum=0, maximum=5)
        output_path = artifact_name_param(request, "output_path", default="nmap-scan.xml")

        argv = ["nmap", SCAN_FLAGS[scan_type]]
        if service_detection:
            argv.append("-sV")
        if no_ping:
            argv.append("-Pn")
        if timing is not None:
            argv.append(f"-T{timing}")
        if ports:
            argv.extend(["-p", ports])
        argv.extend(["-oX", output_path, target])
        return argv
