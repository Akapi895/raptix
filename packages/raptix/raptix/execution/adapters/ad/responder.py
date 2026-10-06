"""``network.capture_ntlm`` → responder adapter (base profile).

Defaults to analyze mode (``-A`` — listen without poisoning); active
poisoning is an explicit ``poison=True`` request parameter. Aggressive
or not, authorization is evaluated at invocation time, never by the
adapter.
"""

from __future__ import annotations

from raptix.execution.adapters.base import CommandAdapter, bool_param, str_param
from raptix_core.types.capability import CapabilityId, CapabilityRequest

ANALYZE_FLAGS = ["-A"]
POISON_FLAGS = ["-wrfPd"]


class ResponderAdapter(CommandAdapter):
    capability_id = CapabilityId("network.capture_ntlm")
    adapter_id = "ad.responder"
    executable = "responder"
    artifact_formats = ("responder_log",)
    default_timeout_seconds = 1800

    def build_argv(self, request: CapabilityRequest) -> list[str]:
        interface = str_param(request, "interface")
        poison = bool_param(request, "poison", default=False)

        flags = POISON_FLAGS if poison else ANALYZE_FLAGS
        return ["responder", "-I", interface, *flags]
