"""``access.move_laterally`` → NetExec adapter (opt-in ``sandbox-ad``).

Second implementation of the same semantic capability as
``ad.impacket.lateral`` — the exact reason the frozen T2 contract made
``ExecutionSpec.implementation_id`` required. Impacket probes one
principal over psexec/wmiexec/atexec; NetExec sweeps SMB command
execution with the credential at hand. Both run in their declared
profiles; neither replaces the other.

Output is the netexec/CrackMapExec console log — the existing
``crackmapexec`` T3 parser already normalizes that format (its module
docstring covers netexec explicitly).
"""

from __future__ import annotations

from raptix.execution.adapters.base import (
    AdapterParameterError,
    CommandAdapter,
    int_param,
    str_param,
)
from raptix_core.types.capability import CapabilityId, CapabilityRequest


class NetExecAdapter(CommandAdapter):
    capability_id = CapabilityId("access.move_laterally")
    adapter_id = "ad.netexec"
    # The kali ``netexec`` package installs both ``nxc`` and ``netexec``
    # entrypoints; ``nxc`` is the canonical short name probed here.
    executable = "nxc"
    artifact_formats = ("crackmapexec",)
    default_timeout_seconds = 1800

    def build_argv(self, request: CapabilityRequest) -> list[str]:
        target = str_param(request, "target")
        protocol = str_param(request, "protocol", default="smb", required=False)
        if protocol not in {"smb", "wmi", "winrm"}:
            raise AdapterParameterError(
                "parameter 'protocol' must be one of ['smb', 'wmi', 'winrm']"
            )
        username = str_param(request, "username")
        password = str_param(request, "password", allow_spaces=True)
        domain = str_param(request, "domain", default="", required=False)
        hashes = str_param(request, "hashes", default="", required=False)
        if hashes and ":" not in hashes:
            raise AdapterParameterError(
                "parameter 'hashes' must be NTLM format '<lm>:<nt>' or '<nt>:<nt>'"
            )
        command = str_param(request, "command", default="whoami", required=False, allow_spaces=True)
        port = int_param(request, "port", minimum=1, maximum=65535)

        # The netexec console log IS the artifact: the sandbox executor
        # captures stdout (the ``crackmapexec`` parser normalizes that
        # format), so no output-file flag is added here.
        argv = ["nxc", protocol, target, "-u", username, "-p", password]
        if domain:
            argv.extend(["-d", domain])
        if hashes:
            argv.extend(["-H", hashes])
        if port is not None:
            argv.extend(["--port", str(port)])
        argv.extend(["-x", command])
        return argv
