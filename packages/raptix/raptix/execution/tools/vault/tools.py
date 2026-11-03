"""Vault tools: reversible credential storage the agent can use during an engagement.

Not bound to any execution surface -- a plain value-returning tool call, not
specific to bash, webshell, future PTY (ADR-0095, still Status: Proposed, no
code yet) or a future C2 integration. Any of those can call ``vault_retrieve``
before typing/issuing a credential once they exist; no vault-side rework is
needed to add that caller later.

Engagement scope is read only from state/context, never an LLM-suppliable
argument -- mirrors ``KGStore``'s hard ``$engagement`` requirement. Resolution
order matches ``evidence/tools.py::inspect_evidence`` exactly (``kg_engagement``
then ``engagement_name`` from state, then the active-engagement contextvar,
then ``configurable``), so this tool scope-resolves the same way every other
engagement-scoped tool in this codebase does.
"""

from __future__ import annotations

import json
from typing import Annotated, Any

from langchain_core.runnables import RunnableConfig
from langchain_core.tools import tool
from langgraph.prebuilt import InjectedState

from raptix.execution.tools.vault.client import (
    VaultUnavailable,
    list_secrets,
    retrieve_secret,
    store_secret,
)


def _json(data: Any) -> str:
    return json.dumps(data, indent=2, default=str, ensure_ascii=False)


def _resolve_workspace_slug(config: RunnableConfig | None, state: dict | None) -> str | None:
    from raptix_core.utils.engagement_scope import get_active_engagement

    configurable = (config or {}).get("configurable") or {}
    slug = (
        (state or {}).get("kg_engagement")
        or (state or {}).get("engagement_name")
        or get_active_engagement()
        or configurable.get("engagement_name")
    )
    return slug if isinstance(slug, str) and slug else None


@tool
def vault_store(
    name: str,
    value: str,
    description: str = "",
    kind: str = "credential",
    config: RunnableConfig | None = None,
    state: Annotated[dict | None, InjectedState] = None,
) -> str:
    """Store a credential/secret found during this engagement for later reuse.

    Scoped to this engagement's project; never crosses into another
    engagement's vault. Storing under a name that already exists replaces
    the previous value (the old one is revoked, not silently overwritten).

    Args:
        name: Short identifier to retrieve this secret by later (e.g. "db-admin-password").
        value: The plaintext secret to store.
        description: Optional human-readable note.
        kind: Display hint only -- "credential" | "api_key" | "token" | "other".

    Returns:
        JSON {status, name, vault_ref}. ``vault_ref`` is a ``vault://<id>``
        reference suitable for ``kg_record``'s ``credential_ref`` field --
        passing it there is optional, never required.
    """
    workspace_slug = _resolve_workspace_slug(config, state)
    if workspace_slug is None:
        return _json({"error": "missing_engagement_scope"})
    try:
        result = store_secret(
            workspace_slug,
            name,
            value,
            description=description,
            kind=kind,
            actor=f"agent@{workspace_slug}",
        )
    except VaultUnavailable as exc:
        return _json({"error": str(exc)})
    return _json(
        {
            "status": "stored",
            "name": result.get("name", name),
            "vault_ref": result.get("vault_ref", ""),
        }
    )


@tool
def vault_retrieve(
    name: str,
    config: RunnableConfig | None = None,
    state: Annotated[dict | None, InjectedState] = None,
) -> str:
    """Retrieve a previously stored credential by name, from this engagement's project vault.

    Args:
        name: The identifier passed to ``vault_store`` when the secret was saved.

    Returns:
        JSON {name, value} on success, or {error} if missing/revoked/unscoped.
    """
    workspace_slug = _resolve_workspace_slug(config, state)
    if workspace_slug is None:
        return _json({"error": "missing_engagement_scope"})
    try:
        value = retrieve_secret(workspace_slug, name)
    except VaultUnavailable as exc:
        return _json({"error": str(exc)})
    return _json({"name": name, "value": value})


@tool
def vault_list(
    config: RunnableConfig | None = None,
    state: Annotated[dict | None, InjectedState] = None,
) -> str:
    """List secret names (not values) stored for this engagement's project vault.

    Returns:
        JSON {secrets: [{name, kind, description, revoked}, ...]}.
    """
    workspace_slug = _resolve_workspace_slug(config, state)
    if workspace_slug is None:
        return _json({"error": "missing_engagement_scope"})
    try:
        secrets = list_secrets(workspace_slug)
    except VaultUnavailable as exc:
        return _json({"error": str(exc)})
    return _json({"secrets": secrets})


VAULT_TOOLS = [vault_store, vault_retrieve, vault_list]
