"""``access.crack_hash`` → John the Ripper adapter (``sandbox-credentials``).

Offline credential recovery against hashes already extracted by
``access.credential_dump`` / AS-REP workflows. Deliberate limits:

* the hash material is read from ``hash_file`` inside the sandbox
  workspace — placing credential-bearing content is the caller's
  guarded step, the adapter only names the file (executor payloads are
  argv-only; no shell, no stdin);
* the wordlist is the profile's pinned benchmark dictionary — never an
  assumed ``rockyou.txt`` (TC-5 item 2);
* input format selection is REQUIRED (``--format``) — no silent
  autodetect drift between runs;
* a dedicated pot file (``--pot``) is always passed so cracked results
  land in a deterministic artifact the ``john_pot`` parser normalizes,
  instead of the sandbox user's global pot file.

Execution stays behind the normal guardrails; the CRITICAL-risk
credential handling and telemetry redaction rules apply downstream.
"""

from __future__ import annotations

from raptix.execution.adapters.base import (
    AdapterParameterError,
    CommandAdapter,
    artifact_name_param,
    str_param,
)
from raptix_core.types.capability import CapabilityId, CapabilityRequest

_WORDLIST_PATH = "/opt/raptix/share/wordlists/benchmark-dict.txt"
_FORMATS = (
    "raw-md5",
    "raw-sha1",
    "raw-sha256",
    "nt",
    "krb5asrep",
    "krb5tgs",
    "bcrypt",
)


class JohnAdapter(CommandAdapter):
    capability_id = CapabilityId("access.crack_hash")
    adapter_id = "credentials.john"
    executable = "john"
    artifact_formats = ("john_pot",)
    default_timeout_seconds = 3600

    def build_argv(self, request: CapabilityRequest) -> list[str]:
        fmt = str_param(request, "format")
        if fmt not in _FORMATS:
            raise AdapterParameterError(f"parameter 'format' must be one of {sorted(_FORMATS)}")
        hash_file = artifact_name_param(request, "hash_file", default="hashes.txt")
        pot_file = artifact_name_param(request, "pot_file", default="john.pot")

        return [
            "john",
            f"--format={fmt}",
            f"--wordlist={_WORDLIST_PATH}",
            f"--pot={pot_file}",
            hash_file,
        ]
