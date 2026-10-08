"""``ad.collect_bloodhound`` → NetExec BloodHound collection adapter.

The collector half of the TC-6 chain: NetExec's built-in BloodHound
collection (bloodhound.py 1.9.0 in the ``sandbox-ad`` profile) produces
the SharpHound-compatible ZIP the existing ``bhce_ingest_zip`` tool
already ingests through BHCE's official pipeline. Console output stays
in the netexec/CME log format the ``crackmapexec`` T3 parser reads; the
zip artifact itself goes to BHCE, not the ParserRegistry.
"""

from __future__ import annotations

from raptix.execution.adapters.base import (
    AdapterParameterError,
    CommandAdapter,
    artifact_name_param,
    str_param,
)
from raptix_core.types.capability import CapabilityId, CapabilityRequest


class NetExecBloodHoundAdapter(CommandAdapter):
    capability_id = CapabilityId("ad.collect_bloodhound")
    adapter_id = "ad.netexec.bloodhound"
    executable = "nxc"
    artifact_formats = ("crackmapexec",)
    default_timeout_seconds = 1800

    def build_argv(self, request: CapabilityRequest) -> list[str]:
        target = str_param(request, "target")
        username = str_param(request, "username")
        password = str_param(request, "password", allow_spaces=True)
        domain = str_param(request, "domain", default="", required=False)
        collection = str_param(request, "collection", default="All", required=False)
        if collection not in {"All", "Default", "DCOnly", "Session", "Trusts", "LocalAdmin"}:
            raise AdapterParameterError(
                "parameter 'collection' must be one of ['All', 'Default', 'DCOnly', "
                "'Session', 'Trusts', 'LocalAdmin']"
            )
        output_path = artifact_name_param(request, "output_path", default="bh-collection")

        # The collection zip lands in the netexec logs dir named by
        # --zip-name (no arbitrary paths); the console log — the T3-parsed
        # artifact — goes to stdout.
        argv = ["nxc", "ldap", target, "-u", username, "-p", password]
        if domain:
            argv.extend(["-d", domain])
        argv.extend(["--bloodhound", "-c", collection, "--zip-name", output_path])
        return argv
