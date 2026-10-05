"""W10 compatibility exports for plugin-owned OAuth analysis."""

from raptix_web import oauth as _implementation
from raptix_web.oauth import OAuthFinding, analyze_oauth_callback

__all__ = ["OAuthFinding", "analyze_oauth_callback"]
__getattr__ = _implementation.__getattribute__
