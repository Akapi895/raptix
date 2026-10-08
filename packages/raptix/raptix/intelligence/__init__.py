"""Intelligence subsystem (W3 boundary, populated in W5).

Owner of agents, prompts, and LLM access:

- ``agents/`` received ``agents/{standard,plugins,build.py,task_spec.py}``
  in W5 (organized by role/domain, never by UKC phase),
- ``prompts/`` received ``agents/prompts/`` in W5 (no prompt-behavior
  change),
- ``llm/`` received ``llm/`` in W5; provider implementations from
  ``infra/config/*.py`` migrate to ``intelligence/llm/providers/``
  gradually,
- ``skills/`` runtime layer (loader/registry/selector/engine) forms in
  W8–W9 while the corpus splits out to ``packages/raptix-skills``.

The W5 re-export shims (``raptix.agents``, ``raptix.llm``) were retired
in W11 (see ``raptix-repository-architecture.md`` §9 and §32, waves W3,
W5, W8–W9, W11).
"""
