"""Graph channel for dispatch-local objective attribution."""

from typing import Annotated, NotRequired

from langchain.agents import AgentState

from raptix.middleware.state_reducers import reduce_converging_value


class ObjectiveContextState(AgentState):
    # Parent joins keep the last-joined cursor. Children receive a separate
    # state copy before invocation, so parallel attribution never uses that cursor.
    active_objective_id: NotRequired[Annotated[str, reduce_converging_value]]
