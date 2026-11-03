"""Orchestrator graph whose ``messages`` channel is a DeltaChannel (checkpoint state slimming, option F).

Served as the ``raptix-delta`` assistant. New execution threads are created on this graph. Existing threads stay on
``raptix``: a plain-messages checkpoint cannot be seeded into a delta channel safely in the installed LangGraph (the
migration probe lost tool results mid-interrupt and the newest human turn at a clean boundary). Design and evidence:
``docs/design/2026-10-20-checkpoint-state-slimming-design.md`` section 4.

The only channel that differs from ``raptix`` is ``messages``. ``test_raptix_delta_graph`` pins that.
"""

from __future__ import annotations

from typing import Annotated, Required

from deepagents._messages_reducer import _messages_delta_reducer
from langchain_core.messages import AnyMessage
from langgraph.channels.delta import DeltaChannel

from raptix.intelligence.agents.standard.raptix import create_raptix_agent
from raptix.middleware.dispatch import DispatchState
from raptix_core.plugin_loader import is_bundle_enabled

MESSAGES_SNAPSHOT_FREQUENCY = 50


class DeltaDispatchState(DispatchState):
    """The orchestrator state with ``messages`` stored as deltas plus a snapshot every N updates."""

    messages: Required[
        Annotated[
            list[AnyMessage],
            DeltaChannel(_messages_delta_reducer, snapshot_frequency=MESSAGES_SNAPSHOT_FREQUENCY),
        ]
    ]


# Same guard as the ``raptix`` graph: construction is skipped when the standard bundle is disabled.
if is_bundle_enabled("standard"):
    graph = create_raptix_agent(state_schema=DeltaDispatchState)
