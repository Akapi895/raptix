"""``network.snmp_enumerate`` → snmpwalk adapter (``sandbox-network-extra``).

Appliance/network-device enumeration through the sandbox's Net-SNMP
utilities. The adapter keeps the version/credential contract typed:

* ``1`` / ``2c`` require a community string;
* ``3`` requires the typed USM parameters (username, auth protocol +
  passphrase, optional privacy) — a community-string interface is
  insufficient for v3 (TC-7 item 2), and passing one is rejected;
* walks are bounded by the executor timeout, and the OIDs walked are
  the fixed SYSTEM + IF-MIB descriptors — arbitrary OID passthrough is
  not offered.

Output is snmpwalk's text report, normalized by the ``snmpwalk_txt``
T3 parser.
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

_AUTH_PROTOCOLS = ("MD5", "SHA")
_PRIV_PROTOCOLS = ("DES", "AES")


class SnmpwalkAdapter(CommandAdapter):
    capability_id = CapabilityId("network.snmp_enumerate")
    adapter_id = "network.snmpwalk"
    executable = "snmpwalk"
    artifact_formats = ("snmpwalk_txt",)
    default_timeout_seconds = 900

    def build_argv(self, request: CapabilityRequest) -> list[str]:
        target = str_param(request, "target")
        port = int_param(request, "port", default=161, minimum=1, maximum=65535)
        version = str_param(request, "version", default="2c", required=False)
        output_path = artifact_name_param(request, "output_path", default="snmpwalk.txt")

        argv = ["snmpwalk", "-v", version, "-On", "-t", "2", "-r", "1"]
        if version in {"1", "2c"}:
            community = str_param(request, "community", default="public", required=False)
            if community:
                argv.extend(["-c", community])
        elif version == "3":
            argv.extend(self._v3_params(request))
        else:
            raise AdapterParameterError("parameter 'version' must be one of ['1', '2c', '3']")
        # Net-SNMP transport spec: plain host uses the default 161;
        # anything else names the transport explicitly (udp6 for v6).
        transport = target
        if ":" in target:
            transport = f"udp6:{target}:{port}"
        elif port != 161:
            transport = f"udp:{target}:{port}"
        argv.extend(
            [
                transport,
                "SYSTEM",
                "IF-MIB::ifDescr",
                "-o",
                output_path,
            ]
        )
        return argv

    def _v3_params(self, request: CapabilityRequest) -> list[str]:
        username = str_param(request, "v3_username", default="", required=False)
        auth_protocol = str_param(request, "v3_auth_protocol", default="", required=False)
        auth_passphrase = str_param(
            request, "v3_auth_passphrase", default="", required=False, allow_spaces=True
        )
        priv_protocol = str_param(request, "v3_priv_protocol", default="", required=False)
        priv_passphrase = str_param(
            request, "v3_priv_passphrase", default="", required=False, allow_spaces=True
        )
        if not username:
            raise AdapterParameterError(
                "SNMPv3 requires typed USM parameters ('v3_username' et al.); "
                "a community string is not a v3 credential"
            )
        params = ["-u", username]
        if auth_protocol or auth_passphrase:
            if not auth_protocol or not auth_passphrase:
                raise AdapterParameterError(
                    "SNMPv3 auth requires both 'v3_auth_protocol' and 'v3_auth_passphrase'"
                )
            if auth_protocol not in _AUTH_PROTOCOLS:
                raise AdapterParameterError(
                    f"parameter 'v3_auth_protocol' must be one of {sorted(_AUTH_PROTOCOLS)}"
                )
            params.extend(["-l", "authNoPriv", "-a", auth_protocol, "-A", auth_passphrase])
        if priv_protocol or priv_passphrase:
            if not priv_protocol or not priv_passphrase:
                raise AdapterParameterError(
                    "SNMPv3 privacy requires both 'v3_priv_protocol' and 'v3_priv_passphrase'"
                )
            if priv_protocol not in _PRIV_PROTOCOLS:
                raise AdapterParameterError(
                    f"parameter 'v3_priv_protocol' must be one of {sorted(_PRIV_PROTOCOLS)}"
                )
            if not auth_passphrase:
                raise AdapterParameterError("SNMPv3 privacy level requires auth parameters as well")
            params[params.index("authNoPriv")] = "authPriv"
            params.extend(["-x", priv_protocol, "-X", priv_passphrase])
        return params
