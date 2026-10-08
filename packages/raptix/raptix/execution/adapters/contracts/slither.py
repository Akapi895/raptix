"""``contracts.audit_static`` → Slither adapter (``sandbox-contracts``).

Static Solidity analysis with the pinned slither binary (pip, profile
``sandbox-contracts``). The offline pattern scanner in plugins/contracts
stays the zero-dependency tier; this adapter adds the real analyzer.

Output is slither's JSON report (``--json``) normalized by the
``slither_json`` T3 parser. Target files must already exist in the
sandbox workspace — placing source material is the caller's guarded
step, the adapter only names the file.
"""

from __future__ import annotations

from raptix.execution.adapters.base import (
    AdapterParameterError,
    CommandAdapter,
    artifact_name_param,
    int_param,
    str_param,
)
from raptix_core.types.capability import CapabilityId, CapabilityRequest


class SlitherAdapter(CommandAdapter):
    capability_id = CapabilityId("contracts.audit_static")
    adapter_id = "contracts.slither"
    executable = "slither"
    artifact_formats = ("slither_json",)
    default_timeout_seconds = 1800

    def build_argv(self, request: CapabilityRequest) -> list[str]:
        target_file = str_param(request, "target_file")
        if not target_file.endswith(".sol"):
            raise AdapterParameterError(
                "parameter 'target_file' must point to a .sol file inside the workspace"
            )
        output_path = artifact_name_param(request, "output_path", default="slither.json")
        solc_version = str_param(request, "solc_version", default="", required=False)
        int_param(request, "timeout", default=1800, minimum=30, maximum=7200)  # executor-level

        argv = ["slither", target_file, "--json", output_path]
        if solc_version:
            argv.extend(["--solc", solc_version])
        return argv
