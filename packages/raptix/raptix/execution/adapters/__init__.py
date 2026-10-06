"""Adapter layer (Wave T7 of the tool-optimization plan).

Thin, deterministic translations from capability requests to sandbox
executor payloads for the binaries already installed in the sandbox
image (nmap, subfinder, sqlmap, gobuster, nikto, python3-impacket,
responder). Adapters prove the architecture before T8 adds new
executor profiles.

Contract (see :mod:`raptix.execution.adapters.base`):

* an adapter BUILDS an :class:`~raptix_core.types.capability.ExecutionSpec`
  — it never executes (sandbox dispatch owns execution, with the RoE /
  authorization guards) and never parses output (the T3
  ``ParserRegistry`` owns normalization);
* the :class:`AdapterResolver` dispatches by capability + availability
  and never falls back to bash — a capability with no healthy
  implementation or no registered adapter is unavailable.
"""

from raptix.execution.adapters.ad.impacket import (
    ImpacketCredentialDumpAdapter,
    ImpacketLateralMoveAdapter,
)
from raptix.execution.adapters.ad.responder import ResponderAdapter
from raptix.execution.adapters.base import (
    AdapterParameterError,
    CommandAdapter,
    ToolAdapter,
)
from raptix.execution.adapters.network.nmap import NmapAdapter
from raptix.execution.adapters.network.subfinder import SubfinderAdapter
from raptix.execution.adapters.resolver import (
    AdapterResolutionError,
    AdapterResolver,
    default_adapters,
)
from raptix.execution.adapters.web.gobuster import GobusterAdapter
from raptix.execution.adapters.web.nikto import NiktoAdapter
from raptix.execution.adapters.web.sqlmap import SqlmapAdapter

__all__ = [
    "AdapterParameterError",
    "AdapterResolutionError",
    "AdapterResolver",
    "CommandAdapter",
    "GobusterAdapter",
    "ImpacketCredentialDumpAdapter",
    "ImpacketLateralMoveAdapter",
    "NiktoAdapter",
    "NmapAdapter",
    "ResponderAdapter",
    "SqlmapAdapter",
    "SubfinderAdapter",
    "ToolAdapter",
    "default_adapters",
]
