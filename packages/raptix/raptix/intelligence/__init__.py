"""Intelligence subsystem boundary (W3).

Future owner of agents, prompts, runtime skill layer, and LLM access:

- ``agents/`` receives ``agents/{standard,plugins,build.py,task_spec.py}``
  in W5 (organized by role/domain, never by UKC phase),
- ``prompts/`` receives ``agents/prompts/`` in W5 (no prompt-behavior
  change),
- ``llm/`` receives ``llm/`` in W5; provider implementations from
  ``infra/config/*.py`` migrate to ``intelligence/llm/providers/``
  gradually,
- ``skills/`` runtime layer (loader/registry/selector/engine) forms in
  W8–W9 while the corpus splits out to ``packages/raptix-skills``.

Nothing is imported here yet. Compatibility re-export shims are added
when ownership moves (see ``raptix-repository-architecture.md`` §9 and
§32, waves W3, W5, W8–W9).
"""
