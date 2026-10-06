"""``web.fuzz_paths`` → gobuster adapter (base profile).

Directory/file brute forcing in ``dir`` mode. The wordlist is an
explicit parameter (defaulting to the dirb common list shipped in the
sandbox image); the run writes plain output for the T3 ``gobuster``
parser.
"""

from __future__ import annotations

import re

from raptix.execution.adapters.base import (
    AdapterParameterError,
    CommandAdapter,
    artifact_name_param,
    http_url_param,
    int_param,
    str_list_param,
    str_param,
)
from raptix_core.types.capability import CapabilityId, CapabilityRequest

_EXTENSION_RE = re.compile(r"[A-Za-z0-9]{1,10}")

DEFAULT_WORDLIST = "/usr/share/wordlists/dirb/common.txt"


class GobusterAdapter(CommandAdapter):
    capability_id = CapabilityId("web.fuzz_paths")
    adapter_id = "web.gobuster"
    executable = "gobuster"
    artifact_formats = ("gobuster",)
    default_timeout_seconds = 3600

    def build_argv(self, request: CapabilityRequest) -> list[str]:
        url = http_url_param(request, "url")
        wordlist = str_param(request, "wordlist", default=DEFAULT_WORDLIST, required=False)
        extensions = str_list_param(request, "extensions")
        threads = int_param(request, "threads", default=10, minimum=1, maximum=64)
        output_path = artifact_name_param(request, "output_path", default="gobuster.txt")

        argv = [
            "gobuster",
            "dir",
            "-u",
            url,
            "-w",
            wordlist,
            "-t",
            str(threads if threads is not None else 10),
            "-o",
            output_path,
            "-q",
        ]
        if extensions:
            bad = [ext for ext in extensions if not _EXTENSION_RE.fullmatch(ext)]
            if bad:
                raise AdapterParameterError(
                    f"parameter 'extensions' entries must be alphanumeric: {bad}"
                )
            argv.extend(["-x", ",".join(extensions)])
        return argv
