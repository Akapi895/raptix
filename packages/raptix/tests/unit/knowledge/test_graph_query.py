"""Bounded retrieval never accepts caller scope or arbitrary Cypher."""

import pytest

from raptix.knowledge.graph.query import GraphQuery


@pytest.mark.parametrize(
    "params",
    [
        {"engagement": "other"},
        {"limit": 21},
        {"depth": 3},
        {"kind": "Host) MATCH (n) DELETE n //"},
        {"cypher": "RETURN 1"},
    ],
)
def test_query_rejects_unbounded_or_scope_overriding_input(params):
    with pytest.raises(ValueError):
        GraphQuery(query_type="search", params=params)


def test_observation_query_requires_typed_identity():
    with pytest.raises(ValueError):
        GraphQuery(query_type="observation", params={"key": "host::1"})
