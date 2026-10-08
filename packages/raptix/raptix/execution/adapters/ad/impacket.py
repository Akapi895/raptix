"""Impacket adapters — ``access.move_laterally`` + ``access.credential_dump``.

Both capabilities run through the ``python3-impacket`` package's CLI
wrappers (``impacket-psexec`` / ``impacket-wmiexec`` / ``impacket-atexec``
/ ``impacket-secretsdump``), so probing one wrapper binary is a valid
proxy for the whole package.

Guardrail note: these adapters only BUILD the
:class:`~raptix_core.types.capability.ExecutionSpec` — the credential
material embedded in the impacket principal argument is executor-payload
data, and the standing telemetry rule (never log raw parameter values)
applies to every layer that records it. Execution itself still goes
through the sandbox dispatch with its RoE and authorization guards; the
adapter adds no bypass. The resolver declared these capabilities HIGH /
CRITICAL risk with ``parallel_safe=False``.
"""

from __future__ import annotations

from raptix.execution.adapters.base import (
    CommandAdapter,
    artifact_name_param,
    str_param,
)
from raptix_core.types.capability import CapabilityId, CapabilityRequest

LATERAL_TECHNIQUES = {
    "psexec": "impacket-psexec",
    "wmiexec": "impacket-wmiexec",
    "atexec": "impacket-atexec",
}


def _principal(request: CapabilityRequest) -> str:
    """Build the ``[domain/]user:password@host`` impacket principal."""
    user = str_param(request, "username")
    password = str_param(request, "password", allow_spaces=True)
    domain = str_param(request, "domain", default="", required=False)
    return f"{domain}/{user}:{password}" if domain else f"{user}:{password}"


class ImpacketLateralMoveAdapter(CommandAdapter):
    capability_id = CapabilityId("access.move_laterally")
    adapter_id = "ad.impacket.lateral"
    # Default technique's wrapper; all techniques ship in the same
    # python3-impacket apt package, so probing one probes the package.
    executable = "impacket-psexec"
    artifact_formats = ("impacket_txt",)
    default_timeout_seconds = 1800

    def build_argv(self, request: CapabilityRequest) -> list[str]:
        target = str_param(request, "target")
        technique = self._choice(request, "technique", LATERAL_TECHNIQUES, default="psexec")
        command = str_param(request, "command", default="whoami", required=False, allow_spaces=True)
        hashes = str_param(request, "hashes", default="", required=False)

        argv = [LATERAL_TECHNIQUES[technique], f"{_principal(request)}@{target}", command]
        if hashes:
            argv.extend(["-hashes", hashes])
        return argv


class ImpacketCredentialDumpAdapter(CommandAdapter):
    capability_id = CapabilityId("access.credential_dump")
    adapter_id = "ad.impacket.cred_dump"
    executable = "impacket-secretsdump"
    artifact_formats = ("impacket_txt",)
    default_timeout_seconds = 3600

    def build_argv(self, request: CapabilityRequest) -> list[str]:
        target = str_param(request, "target")
        hashes = str_param(request, "hashes", default="", required=False)
        output_prefix = artifact_name_param(request, "output_prefix", default="secretsdump")

        argv = ["impacket-secretsdump", f"{_principal(request)}@{target}"]
        if hashes:
            argv.extend(["-hashes", hashes])
        argv.extend(["-outputfile", output_prefix])
        return argv
