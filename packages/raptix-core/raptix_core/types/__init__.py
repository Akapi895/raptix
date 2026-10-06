"""Pure-pydantic types for the Raptix contract layer.

Submodules:

  * ``engagement`` — red-team planning documents (RoE, ConOps, OPPLAN,
    Finding, Objective, OpsecLevel, C2Tier, MITREPhase, ...). Was
    ``decepticon/core/schemas.py``.
  * ``llm`` — model selection types (Tier, AuthMethod, ModelProfile,
    ModelAssignment, ModelRouter, Credentials, LLMModelMapping,
    ProxyConfig). Was ``decepticon/llm/models.py``.
  * ``kg`` — knowledge-graph node / edge types and helpers. Was
    ``decepticon/tools/research/graph.py``.
  * ``roe`` — machine-readable Rules-of-Engagement *enforcement* schema
    (``EnforcementMode``, ``ScopeRule``, ``MachineEnforcement``,
    ``Decision``, ``evaluate_target``, ``evaluate_command``). The
    evaluation layer that decides allow/deny for a target or command;
    consumed by the framework's RoE-enforcement middleware. Distinct from
    ``engagement.RoE`` (the planning document).
  * ``capability`` — capability-registry contracts (Wave T2 of
    ``docs/tool-optimization-implementation-plan.md``): ``CapabilityManifest``,
    ``ImplementationSpec``, ``CompletionSpec``, the Availability/
    Eligibility pair, and the Request/Execution/Observation/Result
    round-trip types.

These modules import only ``pydantic`` + stdlib + ``typing_extensions`` —
no ``langchain`` / ``langgraph`` / ``deepagents`` / ``httpx`` /
``fastapi``. Suitable to import from any context.
"""

from __future__ import annotations

from raptix_core.types import capability, engagement, kg, llm, roe

__all__ = ["engagement", "llm", "kg", "roe", "capability"]
