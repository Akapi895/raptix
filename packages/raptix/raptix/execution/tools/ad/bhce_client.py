"""Re-export shim â€” the BloodHound CE REST client moved to the
active-directory plugin.

Wave T13 (domain pluginization): the canonical home of this module is now
``raptix_active_directory.bhce_client``. Every historical import path
keeps working through this shim; new code imports from the plugin.
"""

from raptix_active_directory.bhce_client import (
    _AUTH_SCHEME,  # noqa: F401 — shim re-export (tests reach it here)
    BHCEClient,
    BHCEConfigError,
    BHCEHTTPError,
    sign_request,
)

__all__ = [
    "BHCEClient",
    "BHCEConfigError",
    "BHCEHTTPError",
    "sign_request",
]
