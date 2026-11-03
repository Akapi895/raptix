"""Vault tools — reversible, engagement-scoped credential storage for reuse during a lab.

A plain value-returning tool, not bound to any execution surface: a future
PTY (ADR-0095, Status: Proposed, no code yet) or C2 integration can call
``vault_retrieve`` before typing/issuing a credential the same way bash-driven
work does today -- no vault-side rework needed when either lands.

Tool inventory
--------------
- ``vault_store`` — save a found credential for later reuse in this engagement.
- ``vault_retrieve`` — fetch a previously stored credential by name.
- ``vault_list`` — list stored secret names (never values) for this engagement.
"""

from raptix.execution.tools.vault.tools import VAULT_TOOLS

__all__ = ["VAULT_TOOLS"]
