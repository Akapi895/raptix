"""Cache probe parses provider buckets; positive/unknown verdicts are honest."""

from __future__ import annotations

from benchmarks.context_eval.cache_probe import (
    analyze,
    build_cases,
    run_probe,
    usage_buckets,
)


def test_usage_buckets_reads_openai_prompt_token_details() -> None:
    buckets = usage_buckets(
        {
            "usage": {
                "prompt_tokens": 1000,
                "completion_tokens": 5,
                "prompt_tokens_details": {"cached_tokens": 768},
            }
        }
    )
    assert buckets["input_tokens"] == 1000
    assert buckets["cached_tokens"] == 768


def test_usage_buckets_reads_anthropic_cache_fields() -> None:
    buckets = usage_buckets(
        {
            "usage": {
                "input_tokens": 100,
                "cache_read_input_tokens": 40,
                "cache_creation_input_tokens": 10,
            }
        }
    )
    assert buckets["cached_tokens"] == 40
    assert buckets["cache_creation_tokens"] == 10


def test_probe_flags_prefix_cache_when_second_identical_request_is_cached() -> None:
    cases = build_cases()
    identical = next(case for case in cases if case.name == "identical_2")

    def transport(messages):
        cached = 900 if messages == identical.messages else 0
        return {
            "usage": {
                "prompt_tokens": 1000,
                "completion_tokens": 4,
                "prompt_tokens_details": {"cached_tokens": cached},
            }
        }

    results = run_probe(transport, cases)
    assert [result["case"] for result in results] == [case.name for case in cases]
    assert analyze(results)["prefix_cache_observed"] is True


def test_probe_reports_unknown_when_no_cache_buckets_are_returned() -> None:
    def transport(messages):
        return {"usage": {"prompt_tokens": 1000, "completion_tokens": 4}}

    analysis = analyze(run_probe(transport, build_cases()))
    assert analysis["prefix_cache_observed"] is False
    assert "UNKNOWN" in analysis["verdict"]


def test_explicit_zero_cache_bucket_is_not_reported_as_missing():
    results = run_probe(
        lambda messages: {"usage": {"prompt_tokens_details": {"cached_tokens": 0}}}, build_cases()
    )
    assert "NOT_OBSERVED" in analyze(results)["verdict"]
    assert results[1]["cache_bucket_present"] is True


def test_usage_capture_drops_non_numeric_sensitive_metadata():
    results = run_probe(
        lambda messages: {"usage": {"prompt_tokens": 10, "authorization": "synthetic-secret"}},
        build_cases(),
    )
    assert results[0]["raw_usage"] == {"prompt_tokens": 10}
