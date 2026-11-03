"""Authentication for the LangGraph API of the web execution plane.

Only the web API holds the runtime API token. Project sandboxes never receive it, so a command inside one project's
sandbox cannot list threads, read state, or start runs on the runtime. The token is read from the file named by
RAPTIX_RUNTIME_API_TOKEN_FILE. If the file is missing or too short, every request is refused, so the runtime can
never serve unauthenticated callers.
"""

import hmac
import os
from pathlib import Path
from typing import Annotated

from fastapi import Header, HTTPException
from langgraph_sdk import Auth

TOKEN_FILE_ENV = "RAPTIX_RUNTIME_API_TOKEN_FILE"
_MIN_TOKEN_BYTES = 32
_token_cache: str | None = None


def _expected_token() -> str | None:
    global _token_cache
    if _token_cache is not None:
        return _token_cache
    raw_path = os.environ.get(TOKEN_FILE_ENV, "").strip()
    if not raw_path:
        return None
    try:
        token = Path(raw_path).read_text(encoding="utf-8").strip()
    except OSError:
        return None
    if len(token) < _MIN_TOKEN_BYTES:
        return None
    _token_cache = token
    return token


def _matches(authorization: str | None) -> bool:
    expected = _expected_token()
    if expected is None or authorization is None or not authorization.startswith("Bearer "):
        return False
    return hmac.compare_digest(authorization[len("Bearer ") :], expected)


def require_runtime_token(authorization: Annotated[str | None, Header()] = None) -> None:
    """FastAPI dependency for routes this runtime serves outside the LangGraph auth handler."""
    if not _matches(authorization):
        raise HTTPException(status_code=401, detail="missing or invalid runtime token")


auth = Auth()


@auth.authenticate
async def authenticate(authorization: str | None) -> Auth.types.MinimalUserDict:
    if not _matches(authorization):
        raise Auth.exceptions.HTTPException(
            status_code=401, detail="missing or invalid runtime token"
        )
    return {"identity": "raptix-web-api"}
