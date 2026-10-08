"""``network.discover_subdomains`` → subfinder adapter (base profile).

Passive subdomain enumeration: ``subfinder -d <domain> -json -o <file>``
produces the JSONL output the T3 ``subfinder`` parser consumes.
"""

from __future__ import annotations

from raptix.execution.adapters.base import (
    CommandAdapter,
    artifact_name_param,
    domain_param,
    str_list_param,
)
from raptix_core.types.capability import CapabilityId, CapabilityRequest


class SubfinderAdapter(CommandAdapter):
    capability_id = CapabilityId("network.discover_subdomains")
    adapter_id = "network.subfinder"
    executable = "subfinder"
    artifact_formats = ("subfinder",)
    default_timeout_seconds = 1800

    def build_argv(self, request: CapabilityRequest) -> list[str]:
        domain = domain_param(request, "domain")
        sources = str_list_param(request, "sources")
        output_path = artifact_name_param(request, "output_path", default="subfinder.jsonl")

        argv = ["subfinder", "-d", domain, "-json", "-o", output_path]
        if sources:
            argv.extend(["-sources", ",".join(sources)])
        return argv
