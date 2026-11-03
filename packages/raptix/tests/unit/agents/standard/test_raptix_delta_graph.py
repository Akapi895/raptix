"""The delta-messages orchestrator must differ from the plain ``raptix`` graph only in its ``messages`` channel.

If a new middleware channel is added to the orchestrator, this test fails until ``DeltaDispatchState`` is updated too;
otherwise new execution threads would silently lose that channel.
"""

from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage
from langgraph.channels.delta import DeltaChannel

from raptix.intelligence.agents.standard.raptix import create_raptix_agent
from raptix.intelligence.agents.standard.raptix_delta import DeltaDispatchState


class _FakeChat(GenericFakeChatModel):
    def bind_tools(self, tools, **kwargs):
        return self


def _graph(**kwargs):
    llm = _FakeChat(messages=iter([AIMessage(content="ok")]))
    return create_raptix_agent(llm=llm, backend=None, **kwargs)


def _channels(runnable) -> dict[str, type]:
    compiled = getattr(runnable, "bound", runnable)
    return {name: type(channel) for name, channel in compiled.channels.items()}


def test_delta_graph_differs_from_plain_graph_only_in_messages() -> None:
    plain = _channels(_graph())
    delta = _channels(_graph(state_schema=DeltaDispatchState))

    assert set(plain) == set(delta), f"channel sets differ: {set(plain) ^ set(delta)}"
    differing = {name for name in plain if plain[name] is not delta[name]}
    assert differing == {"messages"}
    assert delta["messages"] is DeltaChannel
