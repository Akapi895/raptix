"""Unit tests for the tokenized lexical WHERE builder in Neo4jBackend.

``_lexical_match_clause`` is pure string building over cypher parameters —
no driver needed. Live-run evidence (Silentium lab, 2026-10): the legacy
whole-phrase CONTAINS made natural multi-word queries miss
("engagement startup" vs ``engagement-startup``).
"""

from __future__ import annotations

from raptix.skills.engine.server.neo4j_backend import Neo4jBackend


def test_multi_token_query_ands_per_token_conjuncts():
    params: dict = {}
    clause = Neo4jBackend._lexical_match_clause("engagement startup", params)
    assert " AND " in clause
    assert "$qt0" in clause and "$qt1" in clause
    assert "$query" not in clause
    assert params == {"qt0": "engagement", "qt1": "startup"}
    assert clause.count("s.name") == 2
    assert "s.description" in clause and "s.when_to_use" in clause


def test_hyphens_underscores_dots_are_separators():
    params: dict = {}
    clause = Neo4jBackend._lexical_match_clause("engagement-startup", params)
    assert params == {"qt0": "engagement", "qt1": "startup"}
    clause2 = Neo4jBackend._lexical_match_clause("priv_escalation.v2", params)
    assert params == {"qt0": "priv", "qt1": "escalation", "qt2": "v2"}
    assert " AND " in clause and " AND " in clause2


def test_word_order_irrelevant_same_params():
    p1: dict = {}
    p2: dict = {}
    Neo4jBackend._lexical_match_clause("port scan service enumeration", p1)
    Neo4jBackend._lexical_match_clause("enumeration service scan port", p2)
    assert sorted(p1.values()) == sorted(p2.values())
    assert set(p1.values()) == {"port", "scan", "service", "enumeration"}


def test_single_token_keeps_legacy_whole_phrase_semantics():
    params: dict = {}
    clause = Neo4jBackend._lexical_match_clause("kerberoast", params)
    assert params == {"query": "kerberoast"}
    assert "$qt0" not in clause
    assert "CONTAINS $query" in clause


def test_separator_only_query_falls_back_to_raw_lower():
    params: dict = {}
    clause = Neo4jBackend._lexical_match_clause("---", params)
    assert params == {"query": "---"}
    assert "CONTAINS $query" in clause


def test_single_hyphenated_term_becomes_two_and_tokens():
    # "kill-chain" normalizes into two tokens; matching then ANDs them, so
    # "kill-chain-analysis" (both substrings present) still matches.
    params: dict = {}
    Neo4jBackend._lexical_match_clause("kill-chain", params)
    assert params == {"qt0": "kill", "qt1": "chain"}
