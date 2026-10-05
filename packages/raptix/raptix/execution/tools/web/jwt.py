"""W10 compatibility exports for plugin-owned JWT analysis."""

from raptix_web import jwt as _implementation
from raptix_web.jwt import (
    DEFAULT_WEAK_SECRETS,
    JWTClaims,
    JWTHeader,
    JWTToken,
    crack_hs_secret,
    forge_token,
    parse_token,
    verify_hs,
)

__all__ = [
    "DEFAULT_WEAK_SECRETS",
    "JWTClaims",
    "JWTHeader",
    "JWTToken",
    "crack_hs_secret",
    "forge_token",
    "parse_token",
    "verify_hs",
]
__getattr__ = _implementation.__getattribute__
