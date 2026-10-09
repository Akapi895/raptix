"""Raptix middleware - custom AgentMiddleware implementations."""

from importlib import import_module
from typing import Any

_MODULES = {
    "BudgetEnforcementMiddleware": "budget",
    "EngagementContextMiddleware": "engagement",
    "EventLogMiddleware": "event_logging",
    "FilesystemMiddleware": "filesystem",
    "KGMiddleware": "kg",
    "SandboxNotificationMiddleware": "notifications",
    "OPPLANMiddleware": "opplan",
    "PromptInjectionShieldMiddleware": "prompt_injection_shield",
    "RoEEnforcementMiddleware": "roe",
    "RoEGuardrailMiddleware": "roe",
    "SkillogyMiddleware": "skillogy",
    "maybe_install_skillogy": "skillogy",
    "SkillsMiddleware": "skills",
    "UntrustedOutputMiddleware": "untrusted_output",
}


def __getattr__(name: str) -> Any:
    if name not in __all__:
        raise AttributeError(name)
    value = getattr(import_module(f"raptix.middleware.{_MODULES.get(name, 'hitl')}"), name)
    globals()[name] = value
    return value


__all__ = [
    "ApprovalDecision",
    "ApprovalPolicyRule",
    "ApprovalRequest",
    "ApprovalTransport",
    "BudgetEnforcementMiddleware",
    "DEFAULT_HIGH_IMPACT_POLICY",
    "EngagementContextMiddleware",
    "EventLogMiddleware",
    "FileBackedApprovalTransport",
    "FilesystemMiddleware",
    "HITLApprovalMiddleware",
    "InProcessApprovalTransport",
    "KGMiddleware",
    "OPPLANMiddleware",
    "PromptInjectionShieldMiddleware",
    "RoEEnforcementMiddleware",
    "RoEGuardrailMiddleware",
    "SandboxNotificationMiddleware",
    "SkillogyMiddleware",
    "SkillsMiddleware",
    "UntrustedOutputMiddleware",
    "maybe_install_skillogy",
]
