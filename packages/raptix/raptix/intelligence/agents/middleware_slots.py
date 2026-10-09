"""Middleware slot registry — the plugin-override foundation.

Every Raptix agent factory composes its middleware stack from a
fixed, canonically-ordered list of named slots. Plugins replace or
disable slots by name via ``PluginBundle.replaced_middleware`` /
``PluginBundle.disabled_middleware`` — no inline middleware construction
in agent factories, which previously locked downstream extensions out of the
standard stack.

Slot order is the canonical assembly order. The 16 agent factories all
walk ``MiddlewareSlot`` in declaration order; any slot the agent's role
opts out of (per ``SLOTS_PER_ROLE``) is skipped silently. Plugin-added
middleware (``PluginBundle.items`` of middleware shape) still appends
*after* the standard slots — this is the additive escape hatch for new
middleware that doesn't fit an existing slot.

Adding a new slot is a three-step change: add the enum member, add a
default factory under ``DEFAULT_SLOT_FACTORIES``, and pin the
applicability set in ``SLOTS_PER_ROLE``. Adding a new role likewise
needs an entry in ``SLOTS_PER_ROLE``.
"""

from __future__ import annotations

import copy
import logging
from collections.abc import Awaitable, Callable
from typing import Any

# Middleware classes & factory helpers — imported at module level so
# slot factories don't pay per-call import cost. langchain + langgraph
# packages are listed as runtime deps; only ``benchmark_skill_sources``
# is raptix-internal.
from deepagents.middleware.patch_tool_calls import PatchToolCallsMiddleware
from deepagents.middleware.summarization import create_summarization_middleware
from langchain.agents.middleware import AgentMiddleware, ModelFallbackMiddleware
from langchain_anthropic.middleware import AnthropicPromptCachingMiddleware

from raptix.execution.session.recording import RecordingMiddleware
from raptix.intelligence.agents._benchmark_mode import benchmark_skill_sources
from raptix.middleware import (
    EngagementContextMiddleware,
    FilesystemMiddleware,
    KGMiddleware,
    OPPLANMiddleware,
    RoEGuardrailMiddleware,
    SkillsMiddleware,
    UntrustedOutputMiddleware,
)
from raptix.middleware.budget import BudgetEnforcementMiddleware
from raptix.middleware.event_logging import EventLogMiddleware
from raptix.middleware.hitl import (
    DEFAULT_HIGH_IMPACT_POLICY,
    HITLApprovalMiddleware,
)
from raptix.middleware.model_override import ModelOverrideMiddleware
from raptix.middleware.notifications import SandboxNotificationMiddleware
from raptix.middleware.opscontrol_notifications import (
    OpsControlNotificationMiddleware,
)
from raptix.middleware.prompt_injection_shield import PromptInjectionShieldMiddleware
from raptix.middleware.proxy_key_override import ProxyKeyOverrideMiddleware
from raptix.middleware.roe import build_default_sink

# Slot enum + per-role applicability mapping + safety-critical set
# all live in the contract layer now (raptix_core.contracts.slots).
# Phase 1.C of the redesign split this file: the langchain-bound
# factory helpers stay here; the pure-data declarations moved so
# plugin authors can import them without the framework runtime.
# Re-exported here (and pinned in ``__all__`` below) so existing
# framework call sites — ``raptix.intelligence.agents.build`` and the test
# tree — keep working until Phase 2 rewrites them to import from
# ``raptix_core.contracts.slots`` directly.
from raptix_core.contracts.slots import (
    SAFETY_CRITICAL_SLOTS,
    SLOTS_PER_ROLE,
    MiddlewareSlot,
)
from raptix_core.plugin_loader import load_plugin_skill_sources

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────────────
# Skills sources — role-specific
# ─────────────────────────────────────────────────────────────────────


def skills_sources_for(role: str) -> list[str]:
    """Default SkillsMiddleware ``sources`` list for an OSS role.

    Returns the path list for one of the 10 standard OSS agents
    (``recon``, ``exploit``, ``soundwave``, ...). ``benchmark_skill_sources()``
    is appended when ``BENCHMARK_MODE`` is active — see
    ``decepticon/agents/_benchmark_mode.py``. Plugin-contributed paths
    (registered under the ``raptix.skills`` entry-point group) are
    appended last so commercial / 3rd-party skills can layer on top of
    the OSS baseline without overriding the whole SKILLS slot factory.

    Plugin specialists (detector, scanner, vulnresearch, …) and any
    out-of-tree commercial agent should NOT rely on this fallback —
    they pass an explicit ``skill_sources=`` kwarg to ``build_middleware``
    instead (see the 6 OSS plugin factories for the canonical pattern).
    The fallback exists purely so the OSS 10 standard factories don't
    have to repeat ``[f"/skills/standard/{_ROLE}/", "/skills/shared/"]``
    each.
    """
    # Skill node paths are a separate namespace from role keys. The
    # orchestrator's skill tree lives under ``standard/raptix/``; the
    # legacy ``decepticon`` role name maps to it until 2.0.0.
    directory = {
        "postexploit": "post-exploit",
        "cloud_hunter": "cloud",
        "decepticon": "raptix",
    }.get(role, role)
    standard = [] if role == "blue_cell" else [f"/skills/standard/{directory}/"]
    routers = ["/skills/standard/exploit/"] if role in {"raptix", "decepticon"} else []
    base = [*standard, "/skills/shared/", *benchmark_skill_sources(), *routers]
    return [*base, *load_plugin_skill_sources(role)]


# ─────────────────────────────────────────────────────────────────────
# Default slot factories
# ─────────────────────────────────────────────────────────────────────
#
# Each factory takes a uniform kwarg set: backend, llm, role,
# fallback_models, sandbox, subagents. Slots that don't need a
# particular kwarg ignore it (``**_`` keyword sink). The uniform
# signature lets ``build_middleware`` call every slot factory the
# same way — and lets plugin-supplied replacement factories drop in
# without surprising arg-shape mismatches.


def _make_engagement_context(**_: Any):
    return EngagementContextMiddleware()


def _make_tried_edges(*, role: str, **_: Any):
    import os

    if os.environ.get("RAPTIX_KG_TRIED_EDGES", "0").strip().lower() not in {
        "1",
        "true",
        "yes",
    }:
        return None
    from raptix.knowledge.graph.store import (
        KGStore,
        KGStoreConfigError,
        KGStoreUnavailableError,
    )
    from raptix.middleware.tried_edges import TriedEdgesMiddleware

    try:
        return TriedEdgesMiddleware(store=KGStore.from_env(), role=role)
    except (KGStoreConfigError, KGStoreUnavailableError, ImportError) as exc:
        logger.debug("tried-edge slot skipped: %s", exc)
        return None


def _make_roe_guardrail(*, role: str, **_: Any):
    """Build the RoE guardrail middleware with a per-engagement sink.

    The sink path defaults to ``<workspace>/audit/roe-decisions.jsonl``
    and is resolved lazily on first tool call (workspace_path is not
    yet hydrated at slot-build time). Operators can pin a path with
    ``RAPTIX_ROE_AUDIT_PATH``.
    """
    import os

    sink = build_default_sink(os.environ.get("RAPTIX_WORKSPACE_PATH"))
    return RoEGuardrailMiddleware(sink=sink)


def _make_untrusted_output(*, role: str, **_: Any):
    """Build the per-engagement untrusted-output middleware.

    The quarantine ledger path resolves to
    ``/workspace/audit/untrusted-quarantine.jsonl`` via the bash
    workspace at runtime - the middleware itself does not need to know
    the engagement slug at construction time because every call
    receives ``request.state["workspace_path"]`` already hydrated by
    EngagementContextMiddleware (which runs immediately before this
    slot in canonical order).
    """
    import os

    ledger = os.environ.get("RAPTIX_QUARANTINE_LEDGER")
    return UntrustedOutputMiddleware(quarantine_path=ledger)


def _make_skills(*, backend: Any, role: str, skill_sources: list[str] | None = None, **_: Any):
    sources = list(skill_sources) if skill_sources is not None else skills_sources_for(role)
    return SkillsMiddleware(backend=backend, sources=sources)


def _make_filesystem(*, backend: Any, **_: Any):
    return FilesystemMiddleware(backend=backend)


def _make_subagent(*, backend: Any, subagents: list | None = None, **_: Any):
    from raptix.middleware.dispatch import DispatchMiddleware

    m = DispatchMiddleware(backend=backend, subagents=subagents or [])
    # Register the durable sub-agent transcript channel on the ORCHESTRATOR
    # state. ``AgentMiddleware.state_schema`` is the per-instance schema that
    # ``create_agent`` auto-merges into the compiled graph state at build time.
    # SubAgentMiddleware doesn't override it (it inherits AgentState), so we set
    # it here to SubagentTranscriptState — which EXTENDS AgentState, preserving
    # deepagents' own channels (messages / jump_to / structured_response) while
    # adding ``subagent_transcripts`` with its accumulating reducer. Without
    # this, the key StreamingRunnable returns would be forwarded by task() but
    # have no declared channel to land in, and the checkpoint would drop it.
    m.state_schema = DispatchMiddleware.state_schema
    return m


def _make_opplan(*, backend: Any, **_: Any):
    return OPPLANMiddleware(backend=backend)


def _make_kg(*, role: str, **_: Any):
    """Conditional slot — returns None when the KGStore can't be built.

    Mirrors :func:`_make_model_fallback`: the agent factory keeps
    building, the KG slot is just absent for that run. Operators see
    a single warning identifying which env var or driver call failed.

    Agent factory call sites import analyst.py at module load to build
    the LangGraph platform graph (`if is_bundle_enabled("standard"):
    graph = create_analyst_agent()`); raising here would block every
    dev box and CI runner that doesn't have Neo4j env vars set, even
    for pytest invocations that never touch the KG path.
    """
    import os

    from raptix.knowledge.graph.store import (
        KGStoreConfigError,
        KGStoreUnavailableError,
    )

    try:
        enabled_tools = {"kg_surface_inventory"} if role == "raptix" else None
        experimental = os.environ.get("RAPTIX_KG_OPERATIONAL_SHADOW", "0").lower() in {
            "1",
            "true",
            "yes",
        }
        return KGMiddleware(
            enabled_tools=enabled_tools,
            operational_shadow=role == "raptix" and experimental,
            # Wave T4: the orchestrator gets the planner's
            # planning-context projection (cheapest known attack paths)
            # injected automatically instead of calling a
            # get_attack_context() tool every turn.
            planning_context=role == "raptix",
        )
    except (KGStoreConfigError, KGStoreUnavailableError, ImportError) as exc:
        # ImportError covers the case where the optional ``neo4j``
        # driver isn't installed in the env that imports analyst.py
        # (e.g. CI runners that ship the framework wheel without the
        # KG runtime deps but still load module-level
        # ``graph = create_analyst_agent()``).
        logging.getLogger(__name__).warning("KG slot skipped: %s", exc)
        return None


def _make_kg_autoingest(*, sandbox: Any = None, role: str, **_: Any):
    import os

    from raptix.knowledge.graph.store import (
        KGStore,
        KGStoreConfigError,
        KGStoreUnavailableError,
    )
    from raptix.middleware.kg_autoingest import KGAutoIngestMiddleware

    if sandbox is None or os.environ.get("RAPTIX_KG_AUTOINGEST", "0").lower() not in {
        "1",
        "true",
        "yes",
    }:
        return None
    try:
        return KGAutoIngestMiddleware(store=KGStore.from_env(), sandbox=sandbox, role=role)
    except (KGStoreConfigError, KGStoreUnavailableError, ImportError) as exc:
        logger.debug("KG auto-ingest slot skipped: %s", exc)
        return None


def _make_sandbox_notification(*, sandbox: Any = None, **_: Any):
    if sandbox is None:
        raise ValueError(
            "SandboxNotificationMiddleware requires a sandbox kwarg; "
            "the agent factory must pass the HTTPSandbox instance it built."
        )
    return SandboxNotificationMiddleware(sandbox=sandbox)


def _make_opscontrol_notification(**_: Any):
    """ADR-0006 workload-state-transition delivery for the orchestrator.

    Returns a middleware that polls the opscontrol UDS once per turn and
    injects ``<system-reminder>`` blocks for state transitions
    (starting → running / stopped / unknown). When the daemon is
    unreachable (``make dev`` / ``make smoke`` paths, or pre-Sprint-1
    installs) the middleware degrades to a no-op so boot does not break.
    """
    return OpsControlNotificationMiddleware()


def _make_model_override(*, role: str | None = None, **_: Any):
    return ModelOverrideMiddleware(role=role)


def _make_proxy_key_override(**_: Any):
    return ProxyKeyOverrideMiddleware()


def _make_model_fallback(*, fallback_models: list | None = None, **_: Any):
    """Conditional slot — returns None when no fallback chain exists.

    ``build_middleware`` filters None results out so the absent
    fallback simply skips the slot, mirroring the legacy
    ``if fallback_models: middleware.append(...)`` branch.
    """
    if not fallback_models:
        return None
    return ModelFallbackMiddleware(*fallback_models)


class _SafeSummarizationProxy(AgentMiddleware):
    """Defensive wrapper around the deepagents summarization middleware.

    The inner middleware's ``wrap_model_call`` / ``awrap_model_call``
    hooks issue a live LLM call to compute the summary; a provider
    timeout or 5xx would otherwise propagate up and kill the whole
    agent run for one transient backend failure. This proxy delegates
    to the inner hook and, on exception, logs a warning and falls back
    to invoking the downstream ``handler`` unchanged — effectively
    skipping summarization for that turn rather than aborting the run.
    Successful summarization is passed through untouched.
    """

    def __init__(self, inner: AgentMiddleware) -> None:
        super().__init__()
        self._inner = inner
        # Forward the inner's state schema and tools so langchain's agent
        # factory sees the same merged state shape and registered tools
        # it would see for the unwrapped middleware. ``name`` is a
        # property on AgentMiddleware so it's delegated below instead.
        self.state_schema = inner.state_schema
        self.tools = list(getattr(inner, "tools", []) or [])

    @property
    def name(self) -> str:
        return self._inner.name

    def _scoped_inner(self, request: Any) -> AgentMiddleware:
        """Bind summary generation to this request's already-selected model.

        ProxyKeyOverrideMiddleware is immediately outside this middleware in
        the canonical stack, so ``request.model`` carries the engagement's
        LiteLLM virtual key. Deep Agents otherwise calls the process-global
        model captured at graph construction for summaries. Shallow-copy both
        middleware layers before rebinding: one shared LangGraph worker can
        summarize two tenant runs concurrently without either key becoming
        mutable global state.
        """
        # A request without a model (older shapes, and the fallback tests'
        # stubs) has nothing to rebind — use the inner middleware as-is rather
        # than raising into the fallback below, which would silently drop
        # summarization for the turn.
        model = getattr(request, "model", None)
        if model is None or model is self._inner.model:
            return self._inner
        scoped_inner = copy.copy(self._inner)
        scoped_helper = copy.copy(self._inner._lc_helper)
        scoped_helper.model = model
        scoped_inner._lc_helper = scoped_helper
        return scoped_inner

    def wrap_model_call(self, request: Any, handler: Callable[[Any], Any]) -> Any:
        try:
            return self._scoped_inner(request).wrap_model_call(request, handler)
        except Exception:
            logger.warning(
                "Summarization middleware failed; skipping summarization "
                "this turn and forwarding the original request.",
                exc_info=True,
            )
            return handler(request)

    async def awrap_model_call(self, request: Any, handler: Callable[[Any], Awaitable[Any]]) -> Any:
        try:
            return await self._scoped_inner(request).awrap_model_call(request, handler)
        except Exception:
            logger.warning(
                "Summarization middleware failed; skipping summarization "
                "this turn and forwarding the original request.",
                exc_info=True,
            )
            return await handler(request)


def _make_summarization(*, backend: Any, llm: Any, **_: Any):
    return _SafeSummarizationProxy(create_summarization_middleware(llm, backend))


def _make_prompt_caching(**_: Any):
    return AnthropicPromptCachingMiddleware(unsupported_model_behavior="ignore")


def _make_patch_tool_calls(**_: Any):
    return PatchToolCallsMiddleware()


def _make_record(*, role: str = "", **_: Any):
    """Full-fidelity run recording — opt-in via ``RAPTIX_RUNTIME__RECORD_PATH``.

    Returns None (slot skipped) unless the env var names a record file, so
    default engagements assemble byte-identical stacks and pay zero
    recording cost. When set, the sink is opened EAGERLY and an unusable
    path fails agent build with the env var named — a silent no-op here is
    exactly how capture was lost without anyone noticing. Every agent
    appends its model + tool round-trips to the same JSONL through a shared
    per-path sink (single global seq per process); entries carry an
    agent/engagement/objective envelope that replay ignores.
    """
    import os

    record_path = os.environ.get("RAPTIX_RUNTIME__RECORD_PATH", "").strip()
    if not record_path:
        return None
    try:
        return RecordingMiddleware(role=role)
    except Exception as exc:
        raise RuntimeError(
            f"RAPTIX_RUNTIME__RECORD_PATH={record_path!r} is not usable: {exc}. "
            "Fix the path or unset the variable."
        ) from exc


def _make_event_log(*, role: str = "", **_: Any):
    # Thread the role in: it is the only reliable source of the agent name
    # (the runtime object has no ``agent_name``), and without it every logged
    # and telemetered event is unattributable.
    return EventLogMiddleware(role=role)


def _make_budget(**_: Any):
    return BudgetEnforcementMiddleware()


def _make_prompt_injection_shield(**_: Any):
    # UNTRUSTED_OUTPUT already injects its own quarantine system policy;
    # appending the shield's policy too would double-inject. The shield
    # still wraps deny-listed tool output and dedups against
    # UNTRUSTED_TOOL_NAMES (see prompt_injection_shield._maybe_wrap).
    return PromptInjectionShieldMiddleware(append_policy_to_system=False)


# Falsy spellings of RAPTIX_HITL__ENABLED — anything else enables HITL.
_HITL_FALSY: frozenset[str] = frozenset({"", "0", "false", "no", "off"})


def _make_hitl(*, role: str, **_: Any):
    """Operator-approval gate — opt-in via ``RAPTIX_HITL__ENABLED``.

    Returns None (slot skipped) unless the env flag is truthy, so default
    engagements never freeze waiting on a human. The transport is left
    unset (``transport=None``) so HITLApprovalMiddleware resolves it
    per request from ``request.state['workspace_path']`` — standard graphs
    are built once at import but a long-lived server serves many
    engagements, so the workspace can't be bound at build time. The
    resolved transport writes ``<workspace>/approvals/{requests,
    decisions}.jsonl`` — a contract shared with the web bridge.
    """
    import os

    if os.environ.get("RAPTIX_HITL__ENABLED", "").strip().lower() in _HITL_FALSY:
        return None

    eid = os.environ.get("RAPTIX_ENGAGEMENT_ID", "default-engagement")
    return HITLApprovalMiddleware(
        DEFAULT_HIGH_IMPACT_POLICY,
        transport=None,
        engagement_name=eid,
        agent_name=role,
    )


SlotFactory = Callable[..., Any]


DEFAULT_SLOT_FACTORIES: dict[MiddlewareSlot, SlotFactory] = {
    MiddlewareSlot.ENGAGEMENT_CONTEXT: _make_engagement_context,
    MiddlewareSlot.TRIED_EDGES: _make_tried_edges,
    MiddlewareSlot.ROE_GUARDRAIL: _make_roe_guardrail,
    MiddlewareSlot.HITL_APPROVAL: _make_hitl,
    MiddlewareSlot.UNTRUSTED_OUTPUT: _make_untrusted_output,
    MiddlewareSlot.PROMPT_INJECTION_SHIELD: _make_prompt_injection_shield,
    MiddlewareSlot.SKILLS: _make_skills,
    MiddlewareSlot.FILESYSTEM: _make_filesystem,
    MiddlewareSlot.SUBAGENT: _make_subagent,
    MiddlewareSlot.OPPLAN: _make_opplan,
    MiddlewareSlot.KG: _make_kg,
    MiddlewareSlot.KG_AUTOINGEST: _make_kg_autoingest,
    MiddlewareSlot.EVENT_LOG: _make_event_log,
    MiddlewareSlot.SANDBOX_NOTIFICATION: _make_sandbox_notification,
    MiddlewareSlot.OPSCONTROL_NOTIFICATION: _make_opscontrol_notification,
    MiddlewareSlot.BUDGET: _make_budget,
    MiddlewareSlot.MODEL_OVERRIDE: _make_model_override,
    MiddlewareSlot.MODEL_FALLBACK: _make_model_fallback,
    MiddlewareSlot.PROXY_KEY_OVERRIDE: _make_proxy_key_override,
    MiddlewareSlot.SUMMARIZATION: _make_summarization,
    MiddlewareSlot.PROMPT_CACHING: _make_prompt_caching,
    MiddlewareSlot.PATCH_TOOL_CALLS: _make_patch_tool_calls,
    MiddlewareSlot.RECORD: _make_record,
}
"""Slot → factory mapping. Plugin overrides shallow-merge into this
dict at assembly time (without mutating the module-level constant) —
see ``raptix.intelligence.agents.build.build_middleware``."""


__all__ = [
    # Re-exported from raptix_core.contracts.slots so existing call
    # sites keep working — see the import comment above.
    "MiddlewareSlot",
    "SAFETY_CRITICAL_SLOTS",
    "SLOTS_PER_ROLE",
    # Framework-side helpers and factories (stay in framework because
    # they depend on langchain / langgraph / deepagents).
    "DEFAULT_SLOT_FACTORIES",
    "SlotFactory",
    "skills_sources_for",
]
