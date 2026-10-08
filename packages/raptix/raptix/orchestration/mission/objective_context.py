"""Graph channel for dispatch-local objective attribution."""

from typing import Annotated, NotRequired

from langchain.agents import AgentState
from langchain.agents.middleware.types import OmitFromInput

from raptix.middleware.state_reducers import reduce_converging_value


class ObjectiveContextState(AgentState):
    # Parent joins keep the last-joined cursor. Children receive a separate
    # state copy before invocation, so parallel attribution never uses that cursor.
    active_objective_id: NotRequired[Annotated[str, reduce_converging_value]]
    worker_result: NotRequired[Annotated[dict, OmitFromInput, reduce_converging_value]]
