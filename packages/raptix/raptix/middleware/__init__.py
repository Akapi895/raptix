"""Raptix middleware - custom AgentMiddleware implementations."""

from raptix.middleware.budget import BudgetEnforcementMiddleware
from raptix.middleware.engagement import EngagementContextMiddleware
from raptix.middleware.event_logging import EventLogMiddleware
from raptix.middleware.filesystem import FilesystemMiddleware
from raptix.middleware.hitl import (
    DEFAULT_HIGH_IMPACT_POLICY,
    ApprovalDecision,
    ApprovalPolicyRule,
    ApprovalRequest,
    ApprovalTransport,
    FileBackedApprovalTransport,
    HITLApprovalMiddleware,
    InProcessApprovalTransport,
)
from raptix.middleware.kg import KGMiddleware
from raptix.middleware.notifications import (
    SandboxNotificationMiddleware,
)
from raptix.middleware.opplan import OPPLANMiddleware
from raptix.middleware.prompt_injection_shield import (
    PromptInjectionShieldMiddleware,
)
from raptix.middleware.roe import (
    RoEEnforcementMiddleware,  # compat alias, removed at 2.0.0
    RoEGuardrailMiddleware,
)
from raptix.middleware.skillogy import SkillogyMiddleware, maybe_install_skillogy
from raptix.middleware.skills import SkillsMiddleware
from raptix.middleware.untrusted_output import UntrustedOutputMiddleware

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
