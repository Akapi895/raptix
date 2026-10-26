"""Console routes for a finding's sealed Proof of Concept: read it, and reproduce it with a run-time value (ADR-0104).

The caller names the project sandbox for the run. The routes inherit the runtime API token requirement from the app they
are mounted on. The run-time value is read from the request body, used once, and never logged or stored.
"""

from __future__ import annotations

import re
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from raptix.execution.backends.project_files import (
    ProjectFileUnavailable,
    project_files_for,
    project_sandbox_for,
)
from raptix.execution.tools.plumbing.candidate_verification import read_sealed_poc, reproduce_sealed
from raptix.execution.tools.research.poc import sandbox_runner

router = APIRouter(prefix="/_raptix/findings/{finding_id}", tags=["findings"])

_FINDING_ID = re.compile(r"FIND-\d{3}")


class SandboxRef(BaseModel):
    sandbox_url: str
    sandbox_token: str | None = None


class ReproduceRequest(SandboxRef):
    token: str | None = None


def _checked_id(finding_id: str) -> str:
    if not _FINDING_ID.fullmatch(finding_id):
        raise HTTPException(status_code=400, detail="invalid_finding_id")
    return finding_id


def _config(ref: SandboxRef) -> dict[str, Any]:
    return {"configurable": {"sandbox_url": ref.sandbox_url, "sandbox_token": ref.sandbox_token}}


@router.post("/poc")
async def read_poc(finding_id: str, body: SandboxRef) -> dict[str, Any]:
    _checked_id(finding_id)
    try:
        return await read_sealed_poc(project_files_for(_config(body)), finding_id)
    except ProjectFileUnavailable as exc:
        raise HTTPException(status_code=503, detail=f"project_unavailable: {exc}") from exc


@router.post("/reproduce")
async def reproduce(finding_id: str, body: ReproduceRequest) -> dict[str, Any]:
    _checked_id(finding_id)
    config = _config(body)
    try:
        runner = sandbox_runner(project_sandbox_for(config), workspace_path="/workspace")
        return await reproduce_sealed(project_files_for(config), runner, finding_id, body.token)
    except ProjectFileUnavailable as exc:
        raise HTTPException(status_code=503, detail=f"project_unavailable: {exc}") from exc
