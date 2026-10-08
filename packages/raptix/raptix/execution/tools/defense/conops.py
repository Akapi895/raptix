"""Re-export shim — the defense domain's CONOPS resolution moved to the
``plugins/defense`` plugin (``raptix_defense``).

Wave T13 (domain pluginization): the canonical home of this module is
now ``raptix_defense.conops``. Every historical import path keeps
working through this shim; new code imports from the plugin. The
SIEM/EDR detection pushers and the ``@tool`` wrapper layer stay in the
runtime (they POST over HTTP — plugin packs import stdlib + SDK/core
only), as does the blue_cell detection loop.
"""

from raptix_defense.conops import (
    ConOpsLookupError,
    engagement_slug,
    list_targets,
    resolve_auth_value,
    resolve_siem_target,
)

__all__ = [
    "ConOpsLookupError",
    "engagement_slug",
    "list_targets",
    "resolve_auth_value",
    "resolve_siem_target",
]
