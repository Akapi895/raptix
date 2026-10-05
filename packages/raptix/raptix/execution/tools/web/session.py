"""W10 compatibility exports for plugin-owned session analysis."""

from raptix_web import session as _implementation
from raptix_web.session import CookieAnalysis, analyze_cookie, shannon_entropy

__all__ = ["CookieAnalysis", "analyze_cookie", "shannon_entropy"]
__getattr__ = _implementation.__getattribute__
