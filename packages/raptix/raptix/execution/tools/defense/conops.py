"""Re-export shims — the defense domain's CONOPS + SIEM/EDR builders moved
to the ``plugins/defense`` plugin (``raptix_defense``).

Wave T13 (domain pluginization): the canonical home of these modules is
now ``raptix_defense.*``. Every historical import path keeps working
through these shims; new code imports from the plugin. The blue_cell
detection loop and the ``@tool`` wrapper layer stay in the runtime.
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
