"""Measure provider cache buckets on a real route before any cache tuning (WP-E2).

A measurement probe, not a tuner: it sends a fixed request set (identical
requests, an append-only prefix, a changed suffix), records the cache-related
usage buckets the provider returns, and reports whether prefix caching is
observable. Absence of evidence is reported as UNKNOWN — latency alone is never
treated as proof. No threshold is tuned from these results.
"""

from __future__ import annotations

import argparse
import json
import os
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

Transport = Callable[[list[dict[str, str]]], dict[str, Any]]

_STATIC_CONTEXT = "Reconnaissance context for the target engagement. " * 256


@dataclass(frozen=True)
class ProbeCase:
    name: str
    messages: list[dict[str, str]] = field(default_factory=list)


def usage_buckets(payload: dict[str, Any]) -> dict[str, int]:
    """Extract cache-relevant token buckets across OpenAI and Anthropic shapes."""
    usage = payload.get("usage") or {}
    details = usage.get("prompt_tokens_details") or {}
    return {
        "input_tokens": int(usage.get("prompt_tokens") or usage.get("input_tokens") or 0),
        "output_tokens": int(usage.get("completion_tokens") or usage.get("output_tokens") or 0),
        "cached_tokens": int(
            details.get("cached_tokens") or usage.get("cache_read_input_tokens") or 0
        ),
        "cache_creation_tokens": int(
            usage.get("cache_creation_input_tokens") or details.get("cache_creation_tokens") or 0
        ),
    }


def build_cases() -> list[ProbeCase]:
    base = [
        {"role": "system", "content": _STATIC_CONTEXT},
        {"role": "user", "content": "Summarize the exposed services."},
    ]
    appended = [
        *base,
        {"role": "assistant", "content": "HTTP/443 and SSH/22."},
        {"role": "user", "content": "Which is riskiest?"},
    ]
    changed = [
        {"role": "system", "content": _STATIC_CONTEXT},
        {"role": "user", "content": "List the DNS records instead."},
    ]
    return [
        ProbeCase("identical_1", base),
        ProbeCase("identical_2", base),
        ProbeCase("append_prefix", appended),
        ProbeCase("changed_suffix", changed),
    ]


def run_probe(transport: Transport, cases: Sequence[ProbeCase]) -> list[dict[str, Any]]:
    """Call ``transport`` once per case and record the returned token buckets."""
    results: list[dict[str, Any]] = []
    for case in cases:
        started = time.monotonic()
        payload = transport(list(case.messages))
        from raptix.runtime.recording import _usage_numbers

        usage = payload.get("usage") or {}
        present = (
            "cached_tokens" in (usage.get("prompt_tokens_details") or {})
            or "cache_read_input_tokens" in usage
        )
        results.append(
            {
                "case": case.name,
                "buckets": usage_buckets(payload),
                "cache_bucket_present": present,
                "raw_usage": _usage_numbers(usage),
                "latency_s": round(time.monotonic() - started, 3),
                "served_model": payload.get("model"),
                "cache_state_control": "uncontrolled",
            }
        )
    return results


def analyze(results: Sequence[dict[str, Any]]) -> dict[str, Any]:
    by_case = {result["case"]: result for result in results}
    second = by_case.get("identical_2", {})
    cached = second.get("buckets", {}).get("cached_tokens", 0)
    observed = cached > 0
    return {
        "prefix_cache_observed": observed,
        "identical_second_cached_tokens": cached,
        "verdict": (
            "prefix caching observed on the second identical request"
            if observed
            else "NOT_OBSERVED: cache bucket reported zero"
            if second.get("cache_bucket_present")
            else "UNKNOWN: route returned no cache buckets"
        ),
    }


def http_transport(*, base_url: str, api_key: str, model: str, timeout: float = 60.0) -> Transport:
    """OpenAI-compatible chat-completions transport; httpx is imported on call."""
    url = base_url.rstrip("/") + "/chat/completions"

    def call(messages: list[dict[str, str]]) -> dict[str, Any]:
        import httpx

        response = httpx.post(
            url,
            headers={"Authorization": f"Bearer {api_key}"},
            json={"model": model, "messages": messages, "max_tokens": 32},
            timeout=timeout,
        )
        response.raise_for_status()
        return response.json()

    return call


def main(argv: Sequence[str] | None = None) -> dict[str, Any]:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--model", default=os.environ.get("CUSTOM_OPENAI_MODEL", "zai-org/GLM-5.3-Flash")
    )
    parser.add_argument("--base-url", default=os.environ.get("CUSTOM_OPENAI_API_BASE", ""))
    parser.add_argument("--api-key", default=os.environ.get("CUSTOM_OPENAI_API_KEY", ""))
    parser.add_argument("--out", default="")
    parser.add_argument("--env-file", type=Path)
    parser.add_argument("--route", choices=("custom", "proxy", "both"), default="custom")
    parser.add_argument(
        "--proxy-url", default=os.environ.get("RAPTIX_LLM__PROXY_URL", "http://localhost:4000")
    )
    parser.add_argument("--proxy-model")
    args = parser.parse_args(argv)
    settings = dict(os.environ)
    if args.env_file:
        from dotenv import dotenv_values

        settings.update(
            {
                k: v
                for k, v in dotenv_values(args.env_file, interpolate=False).items()
                if v is not None
            }
        )
    routes = []
    if args.route in {"custom", "both"}:
        routes.append(
            (
                "provider",
                args.base_url or settings.get("CUSTOM_OPENAI_API_BASE", ""),
                args.api_key or settings.get("CUSTOM_OPENAI_API_KEY", ""),
                settings.get("CUSTOM_OPENAI_MODEL", args.model),
            )
        )
    if args.route in {"proxy", "both"}:
        routes.append(
            (
                "proxy",
                args.proxy_url,
                settings.get("RAPTIX_LLM__PROXY_API_KEY") or settings.get("LITELLM_MASTER_KEY", ""),
                args.proxy_model or "custom/" + settings.get("CUSTOM_OPENAI_MODEL", args.model),
            )
        )
    boundaries = []
    for boundary, base_url, api_key, model in routes:
        parsed = urlsplit(base_url)
        safe_endpoint = (
            f"{parsed.scheme}://{parsed.hostname or ''}"
            + (f":{parsed.port}" if parsed.port else "")
            + parsed.path
        )
        item = {"boundary": boundary, "model": model, "endpoint": safe_endpoint}
        try:
            results = run_probe(
                http_transport(base_url=base_url, api_key=api_key, model=model), build_cases()
            )
            item.update(results=results, analysis=analyze(results), available=True)
        except Exception as exc:
            item.update(available=False, error_type=type(exc).__name__)
            response = getattr(exc, "response", None)
            if response is not None:
                item["http_status"] = response.status_code
        boundaries.append(item)
    report = {
        "measured_at": datetime.now(timezone.utc).isoformat(),
        "boundaries": boundaries,
        "billing_savings_claim": False,
    }
    if args.out:
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        Path(args.out).write_text(json.dumps(report, indent=2), encoding="utf-8")
    return report


if __name__ == "__main__":
    print(json.dumps(main(), indent=2))
