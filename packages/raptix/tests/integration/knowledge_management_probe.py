"""Controlled model, actual graph assembly and Neo4j reads for the Web acceptance check."""

import json
import sys
from typing import Any

from langchain.agents import create_agent
from langchain_core.language_models.fake_chat_models import FakeMessagesListChatModel
from langchain_core.messages import AIMessage, ToolMessage

from raptix.intelligence.agents.configured_graphs import _build_graph
from raptix.intelligence.agents.middleware_slots import _make_kg
from raptix.intelligence.agents.specialist_configuration import Assembly
from raptix.knowledge.graph.state import KGState


class ProbeState(KGState):
    engagement_name: str


class ProbeModel(FakeMessagesListChatModel):
    def bind_tools(self, tools: Any, **kwargs: Any) -> Any:
        self.metadata = {"tool_names": [tool.name for tool in tools]}
        return self


def main() -> None:
    settings = json.loads(sys.argv[1])
    enabled = settings["enabled"]
    model = ProbeModel(
        responses=[
            *(
                [
                    AIMessage(
                        content="",
                        tool_calls=[
                            {
                                "name": "kg_query_reference",
                                "id": "reference-acceptance",
                                "args": {
                                    "query_type": "search_by_name",
                                    "params": json.dumps(
                                        {"kind": "KrgReference", "q": "command", "limit": 5}
                                    ),
                                },
                            }
                        ],
                    )
                ]
                if enabled
                else []
            ),
            AIMessage(content="acceptance complete"),
        ]
    )
    middlewares = []

    def factory() -> Any:
        middleware = _make_kg(role="recon")
        assert middleware is not None
        middlewares.append(middleware)
        return create_agent(model, middleware=[middleware], state_schema=ProbeState)

    graph = _build_graph("recon", {"recon": factory}, Assembly(), {}, None, enabled)
    try:
        result = graph.invoke(
            {
                "messages": [("user", "Inspect the configured reference-assistance path")],
                "engagement_name": settings["engagement"],
            },
            {"configurable": {"thread_id": settings["thread_id"]}},
        )
        names = (model.metadata or {})["tool_names"]
        assert ("kg_query_reference" in names) is enabled
        assert {"kg_record", "kg_ingest"} <= set(names)
        if enabled:
            outputs = [
                json.loads(message.content)
                for message in result["messages"]
                if isinstance(message, ToolMessage)
            ]
            assert outputs and outputs[0]["nodes"]
        assert result["messages"][-1].content == "acceptance complete"
        sys.stdout.write(
            json.dumps({"enabled": enabled, "tools": names, "retrieval_executed": enabled}) + "\n"
        )
    finally:
        for middleware in middlewares:
            middleware.store.close()


if __name__ == "__main__":
    main()
