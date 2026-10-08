"""Custom agent contributed to Raptix."""

from __future__ import annotations


def get_agent() -> object:
    """Plugin factory returning a compiled agent (LangGraph CompiledGraph).

    Replace this stub with your real agent construction — see
    ``raptix.intelligence.agents.standard.recon:SUBAGENT_SPEC`` for an
    example of the framework's factory pattern.
    """
    raise NotImplementedError(
        "decepticon_example_agent: replace get_agent() with your compiled-graph factory"
    )


# LangGraph platform discovers ``graph`` as the module-level attribute.
graph = None
