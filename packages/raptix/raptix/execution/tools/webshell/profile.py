from __future__ import annotations

import re
from typing import Any, Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

HTTP_FORM_PROVIDER = "http-form-command"
HTTP_FORM_METHOD = "POST"
HTTP_FORM_CONTENT_TYPE = "application/x-www-form-urlencoded"
_ALLOWED_HEADERS = frozenset({"user-agent", "content-type"})
_COMMAND_PARAMETER_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_.-]{0,63}$")
_TARGET_FORBIDDEN_RE = re.compile(r"[\s/?#@]")
_CONTROL_RE = re.compile(r"[\x00-\x1f\x7f]")


class WebShellProfileError(ValueError):
    pass


def normalize_target(value: str) -> str:
    target = value.strip().lower()
    if target.startswith("[") and target.endswith("]"):
        target = target[1:-1]
    return target


class WebShellProfile(BaseModel):
    model_config = ConfigDict(extra="forbid")

    provider: Literal["http-form-command"]
    target: str = Field(min_length=1, max_length=253)
    endpoint: str = Field(min_length=1, max_length=2048)
    method: Literal["POST"] = HTTP_FORM_METHOD
    content_type: Literal["application/x-www-form-urlencoded"] = HTTP_FORM_CONTENT_TYPE
    command_parameter: str = Field(min_length=1, max_length=64)
    probe_command: str = Field(min_length=1, max_length=1024)
    probe_pattern: str = Field(min_length=4, max_length=256)
    expected_user: str | None = Field(default=None, max_length=128)
    headers: dict[str, str] | None = None

    @field_validator("target")
    @classmethod
    def _validate_target(cls, value: str) -> str:
        target = normalize_target(value)
        if not target or not target.isascii():
            raise ValueError("target must be a non-empty ASCII host or IP")
        if _TARGET_FORBIDDEN_RE.search(target):
            raise ValueError("target must be a host or IP without scheme, path or whitespace")
        return target

    @field_validator("endpoint")
    @classmethod
    def _validate_endpoint(cls, value: str) -> str:
        if _CONTROL_RE.search(value) or any(ch.isspace() for ch in value):
            raise ValueError("endpoint must not contain whitespace or control characters")
        if "\\" in value:
            raise ValueError("endpoint must not contain backslashes")
        try:
            parts = urlsplit(value)
            host = parts.hostname
            port = parts.port
        except ValueError as exc:
            raise ValueError(f"endpoint is not a valid URL: {exc}") from exc
        if parts.scheme not in {"http", "https"} or not host:
            raise ValueError("endpoint must be an http(s) URL with a host")
        if parts.username is not None or parts.password is not None or parts.fragment:
            raise ValueError("endpoint must not contain credentials or a fragment")
        if not host.isascii():
            raise ValueError("endpoint host must be ASCII")
        if port is not None and not 1 <= port <= 65535:
            raise ValueError("endpoint port is out of range")
        return value

    @field_validator("command_parameter")
    @classmethod
    def _validate_command_parameter(cls, value: str) -> str:
        if not _COMMAND_PARAMETER_RE.fullmatch(value):
            raise ValueError("command_parameter must be a simple form field name")
        return value

    @field_validator("probe_command")
    @classmethod
    def _validate_probe_command(cls, value: str) -> str:
        if _CONTROL_RE.search(value):
            raise ValueError("probe_command must not contain control characters")
        return value

    @field_validator("probe_pattern")
    @classmethod
    def _validate_probe_pattern(cls, value: str) -> str:
        if "," in value:
            raise ValueError("probe_pattern must be a single regex")
        try:
            compiled = re.compile(value)
        except re.error as exc:
            raise ValueError(f"probe_pattern is not a valid regex: {exc}") from exc
        if compiled.search(""):
            raise ValueError("probe_pattern must not match an empty string")
        return value

    @field_validator("expected_user")
    @classmethod
    def _validate_expected_user(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if not value or _CONTROL_RE.search(value):
            raise ValueError("expected_user must not be empty or contain control characters")
        return value

    @field_validator("headers")
    @classmethod
    def _validate_headers(cls, value: dict[str, str] | None) -> dict[str, str] | None:
        if value is None:
            return None
        seen: set[str] = set()
        for key, header_value in value.items():
            lowered = key.strip().lower()
            if lowered not in _ALLOWED_HEADERS:
                raise ValueError(f"header {key!r} is not allowlisted")
            if lowered in seen:
                raise ValueError(f"header {key!r} is duplicated")
            seen.add(lowered)
            if _CONTROL_RE.search(header_value) or len(header_value) > 1024:
                raise ValueError(f"header {key!r} has an invalid value")
            if lowered == "content-type" and header_value.strip().lower() != HTTP_FORM_CONTENT_TYPE:
                raise ValueError("content-type header must match the profile content_type")
        return value

    @model_validator(mode="after")
    def _endpoint_matches_target(self) -> WebShellProfile:
        host = urlsplit(self.endpoint).hostname or ""
        if normalize_target(host) != self.target:
            raise ValueError("endpoint host must match target")
        return self

    def header_items(self) -> list[tuple[str, str]]:
        items = list((self.headers or {}).items())
        if not any(key.lower() == "content-type" for key, _ in items):
            items.append(("Content-Type", self.content_type))
        return items


def parse_profile(data: Any) -> WebShellProfile:
    return WebShellProfile.model_validate(data)
