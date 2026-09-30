"""CVE-Bench harness for Raptix.

Sibling to the XBOW provider. The offline three-CVE fixture set supports
deterministic smoke coverage; ``benchmark.cve_bench.live`` dispatches full
upstream metadata through a running Raptix stack and consumes only
structured evaluator evidence from the per-challenge workspace.
"""
