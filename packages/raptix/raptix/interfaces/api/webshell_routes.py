"""Runtime routes for the WebShell provider: validate a profile, probe it, send operator commands, and derive/refine from sealed PoCs."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, ValidationError

from raptix.execution.backends.project_files import ProjectFileUnavailable
from raptix.execution.tools.webshell.derive import derive_profile
from raptix.execution.tools.webshell.gates import WebShellRefused
from raptix.execution.tools.webshell.probe import execute_webshell, probe_webshell
from raptix.execution.tools.webshell.profile import WebShellProfile
from raptix.execution.tools.webshell.refine import refine_profile

router = APIRouter(prefix="/_raptix/webshell", tags=["webshell"])

_REQUEST_ID_PATTERN = r"^[A-Za-z0-9_.:-]{8,128}$"
_FINDING_ID_PATTERN = r"^FIND-[A-Za-z0-9][A-Za-z0-9_-]{0,63}$"


class SandboxRef(BaseModel):
    sandbox_url: str = Field(min_length=1, max_length=2048)
    sandbox_token: str | None = None


class ProbeRequest(SandboxRef):
    request_id: str = Field(pattern=_REQUEST_ID_PATTERN)
    profile: dict[str, Any]


class ExecuteRequest(SandboxRef):
    request_id: str = Field(pattern=_REQUEST_ID_PATTERN)
    profile: dict[str, Any]
    command: str = Field(min_length=1, max_length=8192)


class DeriveRequest(SandboxRef):
    finding_id: str = Field(pattern=_FINDING_ID_PATTERN)
    acquisition_id: str = Field(min_length=1, max_length=128)


class RefineRequest(SandboxRef):
    finding_id: str = Field(pattern=_FINDING_ID_PATTERN)
    acquisition_id: str = Field(min_length=1, max_length=128)
    sealed_poc: dict[str, Any]
    finding_metadata: dict[str, Any] = Field(default_factory=dict)
    allowed_targets: list[str] = Field(min_length=1, max_length=20)
    failure: str | None = Field(default=None, max_length=4096)


def _config(ref: SandboxRef) -> dict[str, Any]:
    return {"configurable": {"sandbox_url": ref.sandbox_url, "sandbox_token": ref.sandbox_token}}


def _validated_profile(data: dict[str, Any]) -> WebShellProfile:
    try:
        return WebShellProfile.model_validate(data)
    except ValidationError as exc:
        first = exc.errors()[0]
        message = str(first.get("msg", "invalid profile"))
        raise HTTPException(
            status_code=400, detail={"code": "invalid_profile", "message": message}
        ) from exc


def _refused(exc: WebShellRefused) -> HTTPException:
    return HTTPException(status_code=403, detail={"code": exc.code, "message": exc.detail})


@router.post("/probe")
async def probe(body: ProbeRequest) -> dict[str, Any]:
    profile = _validated_profile(body.profile)
    try:
        return await probe_webshell(_config(body), profile)
    except WebShellRefused as exc:
        raise _refused(exc) from exc
    except ProjectFileUnavailable as exc:
        raise HTTPException(status_code=503, detail=f"project_unavailable: {exc}") from exc


@router.post("/execute")
async def execute(body: ExecuteRequest) -> dict[str, Any]:
    profile = _validated_profile(body.profile)
    try:
        return await execute_webshell(_config(body), profile, body.command)
    except WebShellRefused as exc:
        raise _refused(exc) from exc
    except ProjectFileUnavailable as exc:
        raise HTTPException(status_code=503, detail=f"project_unavailable: {exc}") from exc


@router.post("/derive")
async def derive(body: DeriveRequest) -> dict[str, Any]:
    from raptix.execution.backends.project_files import project_files_for

    try:
        files = project_files_for(_config(body))
    except ProjectFileUnavailable as exc:
        raise HTTPException(status_code=503, detail=f"project_unavailable: {exc}") from exc
    return await derive_profile(files, body.finding_id)


@router.post("/refine")
async def refine(body: RefineRequest) -> dict[str, Any]:
    try:
        from raptix.intelligence.llm.factory import LLMFactory

        model = LLMFactory().get_model("exploit")
    except Exception as exc:
        raise HTTPException(
            status_code=503, detail=f"llm_unavailable: {type(exc).__name__}"
        ) from exc
    return await refine_profile(
        model,
        body.sealed_poc,
        body.finding_metadata,
        body.allowed_targets,
        body.failure,
    )
